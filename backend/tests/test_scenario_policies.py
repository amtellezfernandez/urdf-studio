from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.services.scenario_policies.base import PolicyAction
from backend.services.scenario_policies.replay import ReplayPolicy, ReplayPolicyError
from backend.services.scenario_policies.waypoint import (
    Waypoint,
    WaypointPolicy,
    WaypointPolicyError,
    _load_waypoints,
)
from backend.services.sim_backends.types import Observation


def _observation() -> Observation:
    return Observation(sim_time_s=0.0)


def test_waypoint_interpolation_is_linear() -> None:
    policy = WaypointPolicy(
        [
            Waypoint(time_s=0.0, joints={"j": 0.0}),
            Waypoint(time_s=1.0, joints={"j": 1.0}),
        ],
        control_hz=10.0,
    )
    policy.reset()

    values = [
        policy.next_action(_observation(), step=step, instruction="").joint_targets["j"]
        for step in range(0, 11)
    ]

    assert values[0] == pytest.approx(0.0)
    assert values[5] == pytest.approx(0.5)
    assert values[10] == pytest.approx(1.0)


def test_waypoint_attach_and_detach_fire_once() -> None:
    policy = WaypointPolicy(
        [
            Waypoint(time_s=0.0, joints={"j": 0.0}),
            Waypoint(time_s=0.2, joints={"j": 0.2}, attach_object="carton_1"),
            Waypoint(time_s=0.4, joints={"j": 0.4}, detach=True),
        ],
        control_hz=10.0,
    )
    policy.reset()

    actions: list[PolicyAction] = [
        policy.next_action(_observation(), step=step, instruction="") for step in range(0, 8)
    ]

    attaches = [a.attach_object for a in actions if a.attach_object]
    detaches = [a for a in actions if a.detach]
    assert attaches == ["carton_1"]
    assert len(detaches) == 1


def test_waypoint_reset_rearms_events() -> None:
    policy = WaypointPolicy(
        [Waypoint(time_s=0.0, joints={}, attach_object="carton_1")],
        control_hz=10.0,
    )
    policy.reset()
    first = policy.next_action(_observation(), step=1, instruction="")
    policy.reset()
    second = policy.next_action(_observation(), step=1, instruction="")

    assert first.attach_object == "carton_1"
    assert second.attach_object == "carton_1"


def test_waypoints_file_validation(tmp_path: Path) -> None:
    path = tmp_path / "waypoints.json"
    path.write_text(json.dumps({"waypoints": []}), encoding="utf-8")
    with pytest.raises(WaypointPolicyError, match="non-empty"):
        _load_waypoints(path)


def test_replay_policy_replays_trace_joint_stream(tmp_path: Path) -> None:
    trace = tmp_path / "trace.ndjson"
    lines = [
        {"t_ms": 20, "stream": "robot_joints", "state": {"joint_positions": {"j": 0.1}}},
        {"t_ms": 40, "stream": "objects", "state": {}},
        {"t_ms": 40, "stream": "robot_joints", "state": {"joint_positions": {"j": 0.2}}},
    ]
    trace.write_text("\n".join(json.dumps(line) for line in lines), encoding="utf-8")

    policy = ReplayPolicy(_sequence(trace))
    policy.reset()

    first = policy.next_action(_observation(), step=1, instruction="")
    second = policy.next_action(_observation(), step=2, instruction="")
    third = policy.next_action(_observation(), step=3, instruction="")

    assert first.joint_targets == {"j": 0.1}
    assert second.joint_targets == {"j": 0.2}
    assert third.joint_targets == {"j": 0.2}  # holds last targets


def _sequence(path: Path):
    from backend.services.scenario_policies.replay import _load_joint_sequence

    return _load_joint_sequence(path)


def test_replay_policy_rejects_traces_without_joint_stream(tmp_path: Path) -> None:
    trace = tmp_path / "trace.ndjson"
    trace.write_text(json.dumps({"t_ms": 0, "stream": "objects", "state": {}}), encoding="utf-8")

    with pytest.raises(ReplayPolicyError, match="No robot_joints records"):
        _sequence(trace)
