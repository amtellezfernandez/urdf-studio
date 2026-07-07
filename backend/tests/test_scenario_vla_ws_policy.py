"""VLA WebSocket policy round-trip against an in-process echo server."""

from __future__ import annotations

import threading

import pytest

pytest.importorskip("websockets")

from backend.services.scenario_policies.vla_ws import (
    VlaWsPolicy,
    VlaWsPolicyError,
    _parse_action_chunk,
)
from backend.services.scenario_runtime.vendor_loader import ensure_geniesim_on_path
from backend.services.sim_backends.types import Observation

ensure_geniesim_on_path()

from geniesim_benchmark.utils.msgpack_numpy import packb, unpackb  # noqa: E402


@pytest.fixture()
def echo_vla_server():
    """A VLA server that returns a 2-action chunk mirroring the request joints."""
    from websockets.sync.server import serve

    received: list[dict] = []

    def handler(connection) -> None:
        for message in connection:
            request = unpackb(message)
            received.append(request)
            joint_states = request["params"]["states"]["joint_states"]
            names = sorted(joint_states)
            chunk = [
                [joint_states[name] + 0.1 for name in names],
                [joint_states[name] + 0.2 for name in names],
            ]
            connection.send(
                packb({"joints": {"kind": "JOINT_ABS", "names": names, "values": chunk}})
            )

    server = serve(handler, "127.0.0.1", 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.socket.getsockname()[1]
    try:
        yield f"ws://127.0.0.1:{port}", received
    finally:
        server.shutdown()


def test_policy_round_trips_chunk_over_websocket(echo_vla_server) -> None:
    url, received = echo_vla_server
    policy = VlaWsPolicy(url, robot_type="carton_gantry", task_name="carton_sorting_0001")
    policy.reset()
    observation = Observation(
        sim_time_s=0.5,
        joint_positions={"gantry_x": 0.4, "gantry_y": -0.15},
    )

    first = policy.next_action(observation, step=1, instruction="pick the carton")
    second = policy.next_action(observation, step=2, instruction="pick the carton")
    policy.shutdown()

    # One inference produced a 2-action chunk; the second step replays buffered.
    assert len(received) == 1
    assert received[0]["method"] == "infer"
    assert received[0]["params"]["prompt"] == "pick the carton"
    assert received[0]["params"]["robot_type"] == "carton_gantry"
    assert first.joint_targets == pytest.approx({"gantry_x": 0.5, "gantry_y": -0.05})
    assert second.joint_targets == pytest.approx({"gantry_x": 0.6, "gantry_y": 0.05})


def test_parse_action_chunk_rejects_bad_shapes() -> None:
    with pytest.raises(VlaWsPolicyError, match="joints"):
        _parse_action_chunk({})
    with pytest.raises(VlaWsPolicyError, match="Unsupported action kind"):
        _parse_action_chunk({"joints": {"kind": "EEF_ABS", "names": ["j"], "values": [[0.1]]}})
    with pytest.raises(VlaWsPolicyError, match="row 0 has 2 values for 1 joints"):
        _parse_action_chunk({"joints": {"kind": "JOINT_ABS", "names": ["j"], "values": [[0.1, 0.2]]}})


def test_parse_action_chunk_applies_attach_to_first_action_only() -> None:
    actions = _parse_action_chunk(
        {
            "joints": {"kind": "JOINT_ABS", "names": ["j"], "values": [[0.1], [0.2]]},
            "attach": "carton_1",
        }
    )

    assert actions[0].attach_object == "carton_1"
    assert actions[1].attach_object is None
