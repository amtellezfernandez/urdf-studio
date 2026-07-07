"""End-to-end scenario episodes on the in-process MuJoCo backend."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

pytest.importorskip("mujoco")

from backend.models.scenario import EpisodeManifest, EpisodeObjectPlacement
from backend.models.world_rollouts import WorldRolloutDecisionRecord, WorldRolloutTraceRecord
from backend.services.scenario_loader import load_scenario
from backend.services.scenario_runtime.episode_runner import run_episode
from backend.services.sim_backends.mujoco_backend import build_mujoco_backend

REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIO_DIR = REPO_ROOT / "scenarios" / "carton_sorting_0001"


def _manifest(*, carton_position: tuple[float, float, float]) -> EpisodeManifest:
    return EpisodeManifest(
        scenario_id="carton_sorting_0001",
        episode_index=0,
        seed=0,
        object_placements={
            "carton_1": EpisodeObjectPlacement(
                position_xyz=carton_position,
                rotation_rpy_rad=(0.0, 0.0, 0.2),
            )
        },
        init_joint_positions={},
    )


def _run(tmp_path: Path, manifest: EpisodeManifest):
    scenario = load_scenario(SCENARIO_DIR)
    backend = build_mujoco_backend(scenario, SCENARIO_DIR)
    return run_episode(
        scenario=scenario,
        manifest=manifest,
        backend=backend,
        output_dir=tmp_path,
    )


def test_carton_dropped_above_bin_succeeds(tmp_path: Path) -> None:
    result = _run(tmp_path, _manifest(carton_position=(0.45, 0.3, 1.0)))

    assert result.success is True
    assert result.stop_reason == "success"
    assert result.backend_id == "mujoco"
    assert 0.0 < result.sim_time_s < 5.0
    inside = next(
        value for key, value in result.checker_progress.items() if key.startswith("Inside")
    )
    assert inside == {"SCORE": 1, "STATUS": "SUCCESS"}
    carton_z = result.final_object_poses["carton_1"]["position_xyz"][2]
    assert 0.72 < carton_z < 0.83


def test_carton_far_from_bin_times_out(tmp_path: Path) -> None:
    result = _run(tmp_path, _manifest(carton_position=(0.4, -0.15, 0.8)))

    assert result.success is False
    assert result.stop_reason == "timeout"
    # timeout_sim_seconds=30 at control_hz=50 -> 1500 steps max; timeout wins.
    assert result.sim_time_s == pytest.approx(30.0, abs=0.5)


def test_episode_artifacts_parse_as_world_rollout_records(tmp_path: Path) -> None:
    result = _run(tmp_path, _manifest(carton_position=(0.45, 0.3, 1.0)))

    trace_lines = (tmp_path / "trace.ndjson").read_text(encoding="utf-8").splitlines()
    decision_lines = (tmp_path / "decisions.ndjson").read_text(encoding="utf-8").splitlines()
    assert trace_lines and decision_lines
    streams = set()
    for line in trace_lines:
        record = WorldRolloutTraceRecord.model_validate(json.loads(line))
        streams.add(record.stream)
    assert streams == {"robot_joints", "objects"}
    decisions = [
        WorldRolloutDecisionRecord.model_validate(json.loads(line)) for line in decision_lines
    ]
    assert decisions[-1].decision == "allow"
    assert decisions[-1].rule_id.startswith("scenario/inside[")
    assert result.artifacts["trace_ndjson"]["record_count"] == len(trace_lines)
    assert result.artifacts["decisions_ndjson"]["record_count"] == len(decision_lines)
