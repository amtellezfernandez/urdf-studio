from __future__ import annotations

import os
from pathlib import Path

from backend.models.scenario_service import ScenarioSummary
from backend.services.scenario_loader import (
    ScenarioLoadError,
    load_scenario,
    resolve_instruction,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIO_LIBRARY_ENV_VAR = "URDF_SCENARIO_LIBRARY_ROOT"


def scenario_library_root() -> Path:
    override = os.environ.get(SCENARIO_LIBRARY_ENV_VAR, "").strip()
    return Path(override) if override else _REPO_ROOT / "scenarios"


def list_scenarios() -> list[ScenarioSummary]:
    root = scenario_library_root()
    if not root.is_dir():
        return []
    summaries: list[ScenarioSummary] = []
    for scenario_file in sorted(root.glob("*/scenario.yaml")):
        summary = _summarize(scenario_file.parent)
        if summary is not None:
            summaries.append(summary)
    return summaries


def scenario_directory(scenario_id: str) -> Path:
    """Resolve a scenario id to its directory, guarding against traversal."""
    if not scenario_id or "/" in scenario_id or "\\" in scenario_id or scenario_id.startswith("."):
        raise ScenarioLoadError(f"Invalid scenario id: {scenario_id!r}")
    directory = scenario_library_root() / scenario_id
    if not (directory / "scenario.yaml").is_file():
        raise ScenarioLoadError(f"Scenario was not found: {scenario_id}")
    return directory


def _summarize(scenario_dir: Path) -> ScenarioSummary | None:
    try:
        scenario = load_scenario(scenario_dir)
        instruction = resolve_instruction(scenario)
    except ScenarioLoadError:
        return None
    default_sims = ["mujoco", "genesis"]
    return ScenarioSummary(
        scenario_id=scenario.scenario_id,
        title=scenario.title,
        task_family=scenario.task.family,
        instruction=instruction,
        world_package=scenario.world.package,
        default_sims=default_sims,
        episodes=scenario.evaluation.episodes,
        success_condition_count=len(scenario.success.all_of),
    )
