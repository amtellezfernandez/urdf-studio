from __future__ import annotations

import json
from pathlib import Path

from backend.services.wsp_demo_pipeline import (
    DEFAULT_WSP_DEMO_SCENE_PATH,
    run_wsp_demo_pipeline,
)


def test_wsp_demo_pipeline_writes_full_claim_artifacts(tmp_path) -> None:
    summary = run_wsp_demo_pipeline(
        scene_path=DEFAULT_WSP_DEMO_SCENE_PATH,
        output_dir=tmp_path,
    )

    assert summary["ok"] is True
    assert summary["compile"]["entity_count"] >= 4
    assert summary["rollout"]["frame_count"] == 3
    assert summary["audit"]["success"] is False
    assert summary["audit"]["decision"] == "reject"
    assert summary["repair"]["branch_count"] >= 1
    assert summary["repair"]["selected_branch_id"] == "stop_and_replan"
    assert summary["dataset"]["sample_count"] >= 3
    assert summary["dataset"]["executable_count"] >= 1
    assert summary["dataset"]["rejected_count"] >= 1
    assert summary["dataset"]["schema_version"] == "wsp-world-model-dataset-v1"
    assert summary["export"]["success"] is True
    assert summary["export"]["mujoco"]["success"] is True
    assert summary["export"]["mujoco"]["smoke_passed"] is True
    assert summary["export"]["mujoco"]["metrics"]["mujoco_max_position_error_m"] <= 1e-6
    assert summary["export"]["mujoco"]["metrics"]["mujoco_max_size_error_m"] <= 1e-6
    assert summary["export"]["mujoco"]["metrics"]["mujoco_collision_mismatch_count"] == 0
    assert summary["export"]["genesis"]["success"] is True
    if summary["export"]["genesis"]["smoke_passed"]:
        assert summary["export"]["genesis"]["metrics"]["genesis_entity_count"] >= 4
        assert summary["export"]["genesis"]["metrics"]["genesis_max_position_error_m"] <= 1e-6
        assert summary["export"]["genesis"]["metrics"]["genesis_max_size_error_m"] <= 1e-6
        assert summary["export"]["genesis"]["metrics"]["genesis_collision_mismatch_count"] == 0
    else:
        assert summary["export"]["genesis"]["error"] is None

    for artifact_path in summary["artifacts"].values():
        assert Path(artifact_path).exists()

    sample_rows = [
        json.loads(line)
        for line in Path(summary["artifacts"]["world_model_samples"]).read_text(encoding="utf-8").splitlines()
    ]
    assert len(sample_rows) == summary["dataset"]["sample_count"]
    assert {row["task"] for row in sample_rows} == {"action_conditioned_next_state"}
    assert any(row["executable"] is False for row in sample_rows)
    assert any(row["executable"] is True for row in sample_rows)
    assert all(row["state_tokens"]["text_tokens"] for row in sample_rows)
    assert all(row["action"]["action_id"] for row in sample_rows)
    assert all(row["next_state_tokens"]["continuous_features"] for row in sample_rows)
