from __future__ import annotations

import os
import re
from pathlib import Path

from backend.models.scenario_service import ScenarioSummary
from backend.services.scenario_loader import (
    ScenarioLoadError,
    load_scenario,
    resolve_instruction,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIO_LIBRARY_ENV_VAR = "URDF_SCENARIO_LIBRARY_ROOT"
USER_SCENARIO_LIBRARY_ENV_VAR = "URDF_USER_SCENARIO_LIBRARY_ROOT"

_SCENARIO_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]*$")


def scenario_library_root() -> Path:
    """Read-only shipped scenario library (repo scenarios/ by default)."""
    override = os.environ.get(SCENARIO_LIBRARY_ENV_VAR, "").strip()
    return Path(override) if override else _REPO_ROOT / "scenarios"


def user_scenario_library_root() -> Path:
    """Writable library for scenarios authored in the app."""
    override = os.environ.get(USER_SCENARIO_LIBRARY_ENV_VAR, "").strip()
    return Path(override) if override else Path.home() / ".urdf-studio" / "scenarios"


def _scenario_roots() -> list[Path]:
    """User root first so authored scenarios shadow shipped ones on id clash."""
    return [user_scenario_library_root(), scenario_library_root()]


def is_valid_scenario_id(scenario_id: str) -> bool:
    return bool(_SCENARIO_ID_PATTERN.match(scenario_id))


def list_scenarios() -> list[ScenarioSummary]:
    summaries: dict[str, ScenarioSummary] = {}
    # Iterate shipped first, then user, so user entries overwrite shipped ones.
    for root in reversed(_scenario_roots()):
        if not root.is_dir():
            continue
        for scenario_file in sorted(root.glob("*/scenario.yaml")):
            summary = _summarize(scenario_file.parent)
            if summary is not None:
                summaries[summary.scenario_id] = summary
    return sorted(summaries.values(), key=lambda entry: entry.scenario_id)


def scenario_directory(scenario_id: str) -> Path:
    """Resolve a scenario id to its directory, guarding against traversal.

    The writable user library is searched first so authored scenarios shadow
    shipped ones with the same id.
    """
    if not is_valid_scenario_id(scenario_id):
        raise ScenarioLoadError(f"Invalid scenario id: {scenario_id!r}")
    for root in _scenario_roots():
        directory = root / scenario_id
        if (directory / "scenario.yaml").is_file():
            return directory
    raise ScenarioLoadError(f"Scenario was not found: {scenario_id}")


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
