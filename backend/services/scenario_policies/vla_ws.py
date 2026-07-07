from __future__ import annotations

from typing import Any

from backend.services.scenario_policies.base import PolicyAction, ScenarioPolicy
from backend.services.scenario_runtime.vendor_loader import ensure_geniesim_on_path
from backend.services.sim_backends.types import Observation

ensure_geniesim_on_path()

from geniesim_benchmark.utils.msgpack_numpy import packb, unpackb  # noqa: E402

VLA_WS_ACTION_KIND_JOINT_ABS = "JOINT_ABS"


class VlaWsPolicyError(RuntimeError):
    ...


class VlaWsPolicy(ScenarioPolicy):
    """VLA inference policy over Genie Sim's WebSocket + msgpack protocol.

    Speaks the same request envelope as the vendored corobotpolicy
    (``{"method": "infer", "params": {...}}`` packed with the vendored
    msgpack-numpy codec) with a simulator-agnostic state/action shape:

    request params:
        states.joint_states: {joint_name: position_rad}
        object_poses: {object_id: {position_xyz, quat_wxyz}}
        prompt, robot_type, task_name, step_num, sim_time_s

    expected response (an action chunk):
        {"joints": {"kind": "JOINT_ABS", "names": [...], "values": [[...], ...]},
         "attach": "object_id"?, "detach": bool?}

    Genie's dual-arm left_arm/right_arm response shape is embodiment-specific
    and not accepted here; VLA servers targeting arbitrary URDFs return the
    named-joint form above.
    """

    def __init__(self, url: str, *, robot_type: str = "", task_name: str = "") -> None:
        super().__init__(task_name=task_name)
        self._url = url
        self._robot_type = robot_type
        self._ws: Any | None = None

    @classmethod
    def from_params(cls, scenario, scenario_path) -> "VlaWsPolicy":
        url = scenario.policy.params.get("url")
        if not isinstance(url, str) or not url.strip():
            raise VlaWsPolicyError("policy.params.url is required for vla_ws policies.")
        return cls(
            url.strip(),
            robot_type=str(scenario.policy.params.get("robot_type", "")),
            task_name=scenario.scenario_id,
        )

    def _connect(self) -> Any:
        if self._ws is None:
            import websockets.sync.client

            self._ws = websockets.sync.client.connect(
                self._url, max_size=None, open_timeout=30
            )
        return self._ws

    def reset(self) -> None:
        self.action_buffer.clear()

    def shutdown(self) -> None:
        if self._ws is not None:
            try:
                self._ws.close()
            finally:
                self._ws = None

    def act(self, observations: Observation, **kwargs) -> list[PolicyAction]:
        payload = {
            "method": "infer",
            "params": {
                "states": {
                    "joint_states": dict(observations.joint_positions),
                },
                "object_poses": {
                    object_id: {
                        "position_xyz": list(pose.position_xyz),
                        "quat_wxyz": list(pose.quat_wxyz),
                    }
                    for object_id, pose in observations.object_poses.items()
                },
                "prompt": str(kwargs.get("task_instruction", "")),
                "robot_type": self._robot_type,
                "task_name": self.task_name,
                "step_num": int(kwargs.get("step_num", 0)),
                "sim_time_s": observations.sim_time_s,
            },
        }
        ws = self._connect()
        ws.send(packb(payload))
        response = unpackb(ws.recv())
        return _parse_action_chunk(response)


def _parse_action_chunk(response: Any) -> list[PolicyAction]:
    if not isinstance(response, dict):
        raise VlaWsPolicyError(f"VLA server response must be a mapping, got {type(response)!r}.")
    joints = response.get("joints")
    if not isinstance(joints, dict):
        raise VlaWsPolicyError("VLA server response is missing the 'joints' mapping.")
    kind = str(joints.get("kind", VLA_WS_ACTION_KIND_JOINT_ABS))
    if kind != VLA_WS_ACTION_KIND_JOINT_ABS:
        raise VlaWsPolicyError(f"Unsupported action kind: {kind} (expected JOINT_ABS).")
    names = [str(name) for name in joints.get("names", [])]
    values = joints.get("values")
    if not names or values is None:
        raise VlaWsPolicyError("VLA server response 'joints' requires names and values.")
    attach = response.get("attach")
    detach = bool(response.get("detach", False))
    actions: list[PolicyAction] = []
    for row_index, row in enumerate(values):
        row_values = [float(v) for v in row]
        if len(row_values) != len(names):
            raise VlaWsPolicyError(
                f"Action chunk row {row_index} has {len(row_values)} values "
                f"for {len(names)} joints."
            )
        actions.append(
            PolicyAction(
                joint_targets=dict(zip(names, row_values)),
                # Attach/detach events apply to the first action of the chunk.
                attach_object=str(attach) if row_index == 0 and isinstance(attach, str) else None,
                detach=detach if row_index == 0 else False,
            )
        )
    if not actions:
        raise VlaWsPolicyError("VLA server returned an empty action chunk.")
    return actions
