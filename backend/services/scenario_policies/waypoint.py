from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from backend.services.scenario_policies.base import PolicyAction, ScenarioPolicy
from backend.services.sim_backends.types import Observation


class WaypointPolicyError(ValueError):
    ...


@dataclass(frozen=True)
class Waypoint:
    time_s: float
    joints: dict[str, float]
    attach_object: str | None = None
    detach: bool = False


class WaypointPolicy(ScenarioPolicy):
    """Scripted joint-space waypoint policy with linear interpolation.

    Waypoints file format (JSON):
        {"waypoints": [
            {"time_s": 0.0, "joints": {"gantry_x": 0.0}},
            {"time_s": 2.0, "joints": {"gantry_x": 0.4}, "attach": "carton_1"},
            {"time_s": 4.0, "joints": {"gantry_x": 0.0}, "detach": true}
        ]}

    Joint targets interpolate linearly between waypoints on the control
    timeline. ``attach``/``detach`` events fire once when their waypoint time
    is reached (used with runtime.grasp_attach: weld).
    """

    def __init__(self, waypoints: list[Waypoint], control_hz: float) -> None:
        super().__init__()
        if not waypoints:
            raise WaypointPolicyError("Waypoint policy requires at least one waypoint.")
        self._waypoints = sorted(waypoints, key=lambda w: w.time_s)
        self._control_dt_s = 1.0 / control_hz
        self._fired_events: set[int] = set()

    @classmethod
    def from_params(cls, scenario, scenario_path) -> "WaypointPolicy":
        from backend.services.scenario_loader import resolve_scenario_asset_path

        waypoints_file = scenario.policy.params.get("waypoints_file")
        if not isinstance(waypoints_file, str) or not waypoints_file.strip():
            raise WaypointPolicyError("policy.params.waypoints_file is required.")
        path = resolve_scenario_asset_path(scenario_path, waypoints_file)
        return cls(_load_waypoints(path), control_hz=scenario.runtime.control_hz)

    def reset(self) -> None:
        self.action_buffer.clear()
        self._fired_events = set()

    def act(self, observations: Observation, **kwargs) -> list[PolicyAction]:
        step = int(kwargs.get("step_num", 0))
        t = step * self._control_dt_s
        joints = self._interpolate(t)
        attach_object: str | None = None
        detach = False
        for index, waypoint in enumerate(self._waypoints):
            if waypoint.time_s <= t and index not in self._fired_events:
                self._fired_events.add(index)
                if waypoint.attach_object is not None:
                    attach_object = waypoint.attach_object
                if waypoint.detach:
                    detach = True
        return [PolicyAction(joint_targets=joints, attach_object=attach_object, detach=detach)]

    def _interpolate(self, t: float) -> dict[str, float]:
        waypoints = self._waypoints
        if t <= waypoints[0].time_s:
            return dict(waypoints[0].joints)
        if t >= waypoints[-1].time_s:
            return dict(waypoints[-1].joints)
        for earlier, later in zip(waypoints, waypoints[1:]):
            if earlier.time_s <= t <= later.time_s:
                span = later.time_s - earlier.time_s
                alpha = 0.0 if span <= 0 else (t - earlier.time_s) / span
                joint_names = set(earlier.joints) | set(later.joints)
                return {
                    name: (1.0 - alpha) * earlier.joints.get(name, later.joints.get(name, 0.0))
                    + alpha * later.joints.get(name, earlier.joints.get(name, 0.0))
                    for name in joint_names
                }
        return dict(waypoints[-1].joints)


def _load_waypoints(path: Path) -> list[Waypoint]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise WaypointPolicyError(f"Waypoints file is not valid JSON: {path}") from exc
    raw_waypoints = payload.get("waypoints") if isinstance(payload, dict) else None
    if not isinstance(raw_waypoints, list) or not raw_waypoints:
        raise WaypointPolicyError(f"Waypoints file must contain a non-empty 'waypoints' list: {path}")
    waypoints: list[Waypoint] = []
    for index, entry in enumerate(raw_waypoints):
        if not isinstance(entry, dict):
            raise WaypointPolicyError(f"waypoints[{index}] must be an object.")
        try:
            time_s = float(entry["time_s"])
            joints = {str(k): float(v) for k, v in dict(entry.get("joints", {})).items()}
        except (KeyError, TypeError, ValueError) as exc:
            raise WaypointPolicyError(f"waypoints[{index}] is invalid: {exc}") from exc
        attach = entry.get("attach")
        waypoints.append(
            Waypoint(
                time_s=time_s,
                joints=joints,
                attach_object=str(attach) if isinstance(attach, str) and attach else None,
                detach=bool(entry.get("detach", False)),
            )
        )
    return waypoints
