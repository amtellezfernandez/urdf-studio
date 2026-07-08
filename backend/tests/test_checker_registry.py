"""Custom success checkers register and run without editing the vendored engine."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import yaml

from backend.services.scenario_loader import (
    compile_success_to_acts,
    load_scenario,
    supported_success_conditions,
)
from backend.services.scenario_runtime.ader_evaluation import (
    build_ader_evaluation,
    tick_ader_checkers,
)
from backend.services.scenario_runtime.checker_registry import (
    plugin_by_dsl_key,
    plugin_by_name,
    registered_checker_names,
)
from backend.services.scenario_runtime.vendor_loader import ensure_geniesim_on_path

REPO_ROOT = Path(__file__).resolve().parents[2]
CARTON_DIR = REPO_ROOT / "scenarios" / "carton_sorting_0001"

ensure_geniesim_on_path()
from geniesim_benchmark.app.controllers.api_core import APICore  # noqa: E402


class TwoObjectProbe(APICore):
    """Two objects whose separation a test scripts over time."""

    def __init__(self) -> None:
        self.positions = {
            "carton_1": np.array([0.0, 0.0, 0.0]),
            "bin_a": np.array([1.0, 0.0, 0.0]),
        }

    def _id(self, prim_path: str) -> str:
        return prim_path.rsplit("/", 1)[-1]

    def get_obj_world_pose_matrix(self, prim_path: str) -> np.ndarray:
        matrix = np.eye(4)
        matrix[:3, 3] = self.positions[self._id(prim_path)]
        return matrix

    def get_obj_world_pose(self, prim_path: str):
        return self.positions[self._id(prim_path)], np.array([1.0, 0.0, 0.0, 0.0])

    def get_obj_aabb(self, prim_path: str):
        p = self.positions[self._id(prim_path)]
        return (p[0] - 0.05, p[1] - 0.05, p[2] - 0.05, p[0] + 0.05, p[1] + 0.05, p[2] + 0.05)

    def get_obj_joint(self, prim_path: str) -> dict:
        return {"joint_positions": []}

    def get_joint_state_dict(self) -> dict[str, float]:
        return {}

    def reset(self) -> None:
        pass


def test_near_checker_is_registered() -> None:
    assert "near" in registered_checker_names()
    assert "near" in supported_success_conditions()
    assert plugin_by_name("near") is not None
    assert plugin_by_dsl_key("Near") is not None


def test_near_compiles_to_dsl() -> None:
    plugin = plugin_by_name("near")
    assert plugin is not None
    assert plugin.compile({"object": "carton_1", "reference": "bin_a", "distance_m": 0.2}) == (
        "carton_1|bin_a|0.2"
    )


def _scenario_with_near(tmp_path: Path):
    payload = yaml.safe_load((CARTON_DIR / "scenario.yaml").read_text(encoding="utf-8"))
    payload["success"] = {
        "all_of": [{"near": {"object": "carton_1", "reference": "bin_a", "distance_m": 0.2}}],
        "timeout_sim_seconds": 20,
    }
    for asset in ("carton-sorting.world-package.json", "gantry.urdf", "waypoints.json"):
        (tmp_path / asset).write_bytes((CARTON_DIR / asset).read_bytes())
    (tmp_path / "scenario.yaml").write_text(yaml.safe_dump(payload), encoding="utf-8")
    return load_scenario(tmp_path)


def test_near_scenario_compiles_through_loader(tmp_path: Path) -> None:
    scenario = _scenario_with_near(tmp_path)

    acts = compile_success_to_acts(scenario.success)

    assert acts == {
        "ActionSetWaitAny": [
            {"ActionSetWaitAll": [{"Near": "carton_1|bin_a|0.2"}]},
            {"Timeout": 20},
        ]
    }


def test_near_checker_runs_in_tree_without_vendored_edits(tmp_path: Path) -> None:
    scenario = _scenario_with_near(tmp_path)
    backend = TwoObjectProbe()
    evaluation = build_ader_evaluation(scenario, backend)

    # Objects start 1.0 m apart (> 0.2 threshold): not satisfied.
    tick_ader_checkers(evaluation, sim_dt_s=0.1)
    assert not evaluation.has_done

    # Bring the carton within range; the Near checker (registered, not vendored)
    # completes after its consecutive-frame requirement.
    backend.positions["carton_1"] = np.array([0.9, 0.0, 0.0])
    for _ in range(5):
        tick_ader_checkers(evaluation, sim_dt_s=0.1)
        if evaluation.has_done:
            break

    assert evaluation.has_done
    near_progress = next(
        value for key, value in evaluation.progress_by_node().items() if key.startswith("Near")
    )
    assert near_progress == {"SCORE": 1, "STATUS": "SUCCESS"}


def test_registry_parser_is_uninstalled_after_use(tmp_path: Path) -> None:
    # After building an evaluation, the vendored parse_action must be restored
    # (the patch is scoped to the parse), and unknown keys still raise.
    _scenario_with_near(tmp_path)
    from geniesim_benchmark.plugins.ader.action import action_parsing

    assert action_parsing.parse_action.__name__ != "wrapper"
    with pytest.raises(ValueError, match="Unknown action type"):
        action_parsing.parse_action({"NoSuchChecker": "x"}, [], object())
