"""The vendored Ader checker tree must run end-to-end against our APICore shim."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from backend.services.scenario_loader import load_scenario
from backend.services.scenario_runtime.ader_evaluation import (
    build_ader_evaluation,
    tick_ader_checkers,
)
from backend.services.scenario_runtime.vendor_loader import ensure_geniesim_on_path

REPO_ROOT = Path(__file__).resolve().parents[2]
EXAMPLE_SCENARIO_DIR = REPO_ROOT / "scenarios" / "carton_sorting_0001"

ensure_geniesim_on_path()

from geniesim_benchmark.app.controllers.api_core import APICore  # noqa: E402


class KinematicProbeBackend(APICore):
    """Pure-python APICore: a carton whose z can be scripted per test."""

    BIN_AABB = (0.36, 0.21, 0.72, 0.54, 0.39, 0.9)
    CARTON_HALF = 0.035

    def __init__(self, carton_z: float) -> None:
        self.carton_z = carton_z
        self.reset_count = 0

    def get_obj_world_pose_matrix(self, prim_path: str) -> np.ndarray:
        pose = np.eye(4)
        pose[:3, 3] = [0.45, 0.3, self.carton_z]
        return pose

    def get_obj_world_pose(self, prim_path: str):
        return np.array([0.45, 0.3, self.carton_z]), np.array([1.0, 0.0, 0.0, 0.0])

    def get_obj_aabb(self, prim_path: str):
        if "bin_a" in prim_path:
            return self.BIN_AABB
        half = self.CARTON_HALF
        return (0.42, 0.27, self.carton_z - half, 0.48, 0.33, self.carton_z + half)

    def get_obj_joint(self, prim_path: str) -> dict:
        return {"joint_positions": []}

    def get_joint_state_dict(self) -> dict[str, float]:
        return {}

    def reset(self) -> None:
        self.reset_count += 1


def test_success_detected_when_state_changes_mid_episode() -> None:
    scenario = load_scenario(EXAMPLE_SCENARIO_DIR)
    backend = KinematicProbeBackend(carton_z=0.5)
    evaluation = build_ader_evaluation(scenario, backend)

    done_tick = None
    for tick in range(300):
        if tick == 50:
            backend.carton_z = 0.79  # "placed" inside bin_a
        tick_ader_checkers(evaluation, sim_dt_s=0.1)
        if evaluation.has_done:
            done_tick = tick
            break

    assert done_tick is not None and done_tick >= 50
    progress = evaluation.progress_by_node()
    inside = next(value for key, value in progress.items() if key.startswith("Inside"))
    assert inside == {"SCORE": 1, "STATUS": "SUCCESS"}


def test_timeout_fires_when_success_never_reached() -> None:
    scenario = load_scenario(EXAMPLE_SCENARIO_DIR)
    backend = KinematicProbeBackend(carton_z=0.5)  # never enters the bin
    evaluation = build_ader_evaluation(scenario, backend)

    ticks = 0
    while not evaluation.has_done and ticks < 500:
        tick_ader_checkers(evaluation, sim_dt_s=0.1)
        ticks += 1

    # timeout_sim_seconds is 30 and each tick is 0.1s of sim time.
    assert evaluation.has_done
    assert 295 <= ticks <= 305
    progress = evaluation.progress_by_node()
    inside = next(value for key, value in progress.items() if key.startswith("Inside"))
    assert inside.get("SCORE") != 1


def test_immediate_success_completes_on_first_tick() -> None:
    scenario = load_scenario(EXAMPLE_SCENARIO_DIR)
    backend = KinematicProbeBackend(carton_z=0.79)  # already inside
    evaluation = build_ader_evaluation(scenario, backend)

    tick_ader_checkers(evaluation, sim_dt_s=0.1)
    tick_ader_checkers(evaluation, sim_dt_s=0.1)

    assert evaluation.has_done
