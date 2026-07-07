from backend.services.scenario_policies.base import PolicyAction, ScenarioPolicy
from backend.services.scenario_policies.replay import ReplayPolicy
from backend.services.scenario_policies.waypoint import WaypointPolicy

__all__ = [
    "PolicyAction",
    "ScenarioPolicy",
    "ReplayPolicy",
    "WaypointPolicy",
    "build_scenario_policy",
]


def build_scenario_policy(scenario, scenario_path):
    """Instantiate the policy configured on a scenario document (or None)."""
    kind = scenario.policy.kind
    if kind == "none":
        return None
    if kind == "waypoint":
        return WaypointPolicy.from_params(scenario, scenario_path)
    if kind == "replay":
        return ReplayPolicy.from_params(scenario, scenario_path)
    if kind == "vla_ws":
        from backend.services.scenario_policies.vla_ws import VlaWsPolicy

        return VlaWsPolicy.from_params(scenario, scenario_path)
    raise ValueError(f"Unsupported policy kind: {kind}")
