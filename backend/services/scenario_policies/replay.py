from __future__ import annotations

import json
from pathlib import Path

from backend.services.scenario_policies.base import PolicyAction, ScenarioPolicy
from backend.services.sim_backends.types import Observation


class ReplayPolicyError(ValueError):
    ...


class ReplayPolicy(ScenarioPolicy):
    """Replays the robot_joints stream of a recorded episode trace.

    Input is a trace NDJSON file as written by the episode runner
    (WorldRolloutTraceRecord lines); each ``robot_joints`` record becomes one
    control-step action in recorded order.
    """

    def __init__(self, joint_targets_sequence: list[dict[str, float]]) -> None:
        super().__init__()
        if not joint_targets_sequence:
            raise ReplayPolicyError("Replay policy requires a non-empty joint sequence.")
        self._sequence = joint_targets_sequence
        self._cursor = 0

    @classmethod
    def from_params(cls, scenario, scenario_path) -> "ReplayPolicy":
        from backend.services.scenario_loader import resolve_scenario_asset_path

        trace_file = scenario.policy.params.get("trace_file")
        if not isinstance(trace_file, str) or not trace_file.strip():
            raise ReplayPolicyError("policy.params.trace_file is required.")
        path = resolve_scenario_asset_path(scenario_path, trace_file)
        return cls(_load_joint_sequence(path))

    def reset(self) -> None:
        self.action_buffer.clear()
        self._cursor = 0

    def act(self, observations: Observation, **kwargs) -> list[PolicyAction]:
        if self._cursor >= len(self._sequence):
            return [PolicyAction(joint_targets=dict(self._sequence[-1]))]
        action = PolicyAction(joint_targets=dict(self._sequence[self._cursor]))
        self._cursor += 1
        return [action]


def _load_joint_sequence(path: Path) -> list[dict[str, float]]:
    sequence: list[dict[str, float]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ReplayPolicyError(f"{path}:{line_number} is not valid JSON") from exc
        if record.get("stream") != "robot_joints":
            continue
        joints = record.get("state", {}).get("joint_positions")
        if isinstance(joints, dict) and joints:
            sequence.append({str(k): float(v) for k, v in joints.items()})
    if not sequence:
        raise ReplayPolicyError(f"No robot_joints records found in trace: {path}")
    return sequence
