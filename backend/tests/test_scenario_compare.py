from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from backend.services.scenario_compare import (
    build_comparison_report,
    format_comparison_table,
)
from backend.services.scenario_loader import load_scenario, load_scenario_world
from backend.services.scenario_runtime.randomization import sample_episode_manifests

REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIO_DIR = REPO_ROOT / "scenarios" / "carton_sorting_0001"


def _report(*, success: bool, carton_position, joints=None, stop_reason=None) -> dict:
    return {
        "success": success,
        "stop_reason": stop_reason or ("success" if success else "timeout"),
        "sim_time_s": 5.0 if success else 30.0,
        "grasp_attach_used": True,
        "final_object_poses": {
            "carton_1": {
                "position_xyz": list(carton_position),
                "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
            }
        },
        "final_joint_positions": joints or {"gantry_x": 0.45, "gantry_y": 0.3},
    }


def test_comparison_report_aggregates_and_diverges() -> None:
    report = build_comparison_report(
        scenario_id="carton_sorting_0001",
        per_sim_reports={
            "mujoco": [_report(success=True, carton_position=(0.45, 0.30, 0.795))],
            "genesis": [
                _report(
                    success=True,
                    carton_position=(0.45, 0.30, 0.805),
                    joints={"gantry_x": 0.46, "gantry_y": 0.3},
                )
            ],
        },
        per_sim_errors={"mujoco": [], "genesis": []},
    )

    assert report["backends"] == ["genesis", "mujoco"]
    assert report["summary"]["mujoco"]["success_rate"] == 1.0
    pair = report["divergence"]["genesis_vs_mujoco"]
    assert pair["success_agreement_rate"] == 1.0
    episode = pair["episodes"][0]
    assert episode["final_object_pose_delta"]["carton_1"]["position_m"] == pytest.approx(0.01)
    assert episode["final_joint_rmse_rad"] == pytest.approx(math.sqrt(0.01**2 / 2))
    assert "carton_sorting_0001" in format_comparison_table(report)


def _write_object_trace(path: Path, *, drift_per_step: float, n: int = 10) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        json.dumps(
            {
                "t_ms": step * 20,
                "stream": "objects",
                "state": {
                    "carton_1": {
                        "position_xyz": [0.45, 0.30 + drift_per_step * step, 0.80],
                        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                    }
                },
            }
        )
        for step in range(n)
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def test_comparison_attaches_trajectory_divergence_and_wall_time(tmp_path: Path) -> None:
    mujoco_report = _report(success=True, carton_position=(0.45, 0.30, 0.80))
    genesis_report = _report(success=True, carton_position=(0.45, 0.336, 0.80))
    mujoco_report["wall_time_s"] = 2.0
    genesis_report["wall_time_s"] = 6.0

    report = build_comparison_report(
        scenario_id="carton_sorting_0001",
        per_sim_reports={"mujoco": [mujoco_report], "genesis": [genesis_report]},
        per_sim_errors={"mujoco": [], "genesis": []},
        per_sim_trace_paths={
            "mujoco": [_write_object_trace(tmp_path / "mujoco/trace.ndjson", drift_per_step=0.0)],
            "genesis": [_write_object_trace(tmp_path / "genesis/trace.ndjson", drift_per_step=0.004)],
        },
    )

    assert report["summary"]["genesis"]["mean_wall_time_s"] == 6.0
    trajectory = report["divergence"]["genesis_vs_mujoco"]["episodes"][0]["trajectory"]
    assert trajectory["split"]["t_ms"] == 60  # crosses 1cm at step 3
    assert trajectory["object_position_delta_m"]["final"] == pytest.approx(0.036, abs=1e-6)


def test_comparison_without_traces_is_unchanged() -> None:
    report = build_comparison_report(
        scenario_id="carton_sorting_0001",
        per_sim_reports={
            "mujoco": [_report(success=True, carton_position=(0.45, 0.30, 0.795))],
            "genesis": [_report(success=True, carton_position=(0.45, 0.30, 0.805))],
        },
        per_sim_errors={"mujoco": [], "genesis": []},
    )
    episode = report["divergence"]["genesis_vs_mujoco"]["episodes"][0]
    assert "trajectory" not in episode
    assert report["summary"]["mujoco"]["mean_wall_time_s"] is None


def test_comparison_survives_one_sim_crashing() -> None:
    report = build_comparison_report(
        scenario_id="carton_sorting_0001",
        per_sim_reports={
            "mujoco": [_report(success=True, carton_position=(0.45, 0.3, 0.795))],
            "genesis": [None],
        },
        per_sim_errors={"mujoco": [], "genesis": ["genesis worker exited 1: boom"]},
    )

    assert report["summary"]["genesis"]["completed"] == 0
    pair = report["divergence"]["genesis_vs_mujoco"]
    assert pair["compared_episodes"] == 0
    assert pair["success_agreement_rate"] is None
    assert report["errors"]["genesis"] == ["genesis worker exited 1: boom"]


def test_comparison_flags_mismatched_controller_gains() -> None:
    mujoco_report = _report(success=True, carton_position=(0.45, 0.30, 0.795))
    genesis_report = _report(success=True, carton_position=(0.45, 0.30, 0.795))
    mujoco_report["environment"] = {
        "control_config": {
            "physics_timestep_s": 0.002,
            "gravity_z": -9.81,
            "joint_gains": {"gantry_x": {"kp": 60.0, "kv": 4.0}},
        }
    }
    genesis_report["environment"] = {
        "control_config": {
            "physics_timestep_s": 0.002,
            "gravity_z": -9.81,
            "joint_gains": {"gantry_x": {"kp": 600.0, "kv": 35.0}},
        }
    }

    report = build_comparison_report(
        scenario_id="carton_sorting_0001",
        per_sim_reports={"mujoco": [mujoco_report], "genesis": [genesis_report]},
        per_sim_errors={"mujoco": [], "genesis": []},
    )

    parity = report["divergence"]["genesis_vs_mujoco"]["dynamics_parity"]
    assert parity["matches"] is False
    fields = {mismatch["field"] for mismatch in parity["mismatches"]}
    assert fields == {"kp", "kv"}
    assert "WARNING" in format_comparison_table(report)


def test_comparison_omits_dynamics_parity_without_control_config() -> None:
    report = build_comparison_report(
        scenario_id="carton_sorting_0001",
        per_sim_reports={
            "mujoco": [_report(success=True, carton_position=(0.45, 0.30, 0.795))],
            "genesis": [_report(success=True, carton_position=(0.45, 0.30, 0.795))],
        },
        per_sim_errors={"mujoco": [], "genesis": []},
    )

    assert "dynamics_parity" not in report["divergence"]["genesis_vs_mujoco"]


def test_manifest_sampling_is_deterministic_and_region_clamped() -> None:
    scenario = load_scenario(SCENARIO_DIR)
    world = load_scenario_world(SCENARIO_DIR, scenario)

    first = sample_episode_manifests(scenario, world)
    second = sample_episode_manifests(scenario, world)

    assert [m.model_dump() for m in first] == [m.model_dump() for m in second]
    placement = first[0].object_placements["carton_1"]
    region = scenario.task.randomization.regions["table_top"]
    for value, low, high in zip(placement.position_xyz, region.aabb_min, region.aabb_max):
        assert low <= value <= high
    assert first[0].seed == scenario.evaluation.seeds[0]


def test_manifest_sampling_pads_missing_seeds() -> None:
    scenario = load_scenario(SCENARIO_DIR)
    world = load_scenario_world(SCENARIO_DIR, scenario)
    scenario = scenario.model_copy(
        update={"evaluation": scenario.evaluation.model_copy(update={"episodes": 3, "seeds": [7]})}
    )

    manifests = sample_episode_manifests(scenario, world)

    assert [m.seed for m in manifests] == [7, scenario.task.randomization.seed + 1,
                                           scenario.task.randomization.seed + 2]
    positions = {m.object_placements["carton_1"].position_xyz for m in manifests}
    assert len(positions) == 3  # different seeds -> different placements
