from __future__ import annotations

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
    assert summary["export"]["success"] is True
    assert summary["export"]["mujoco"]["success"] is True
    assert summary["export"]["mujoco"]["smoke_passed"] is True
    assert summary["export"]["genesis"]["success"] is True
    if summary["export"]["genesis"]["smoke_passed"]:
        assert summary["export"]["genesis"]["metrics"]["genesis_entity_count"] >= 4
    else:
        assert summary["export"]["genesis"]["error"] is None

    for artifact_path in summary["artifacts"].values():
        assert Path(artifact_path).exists()
