from __future__ import annotations

from pathlib import Path

from backend.services.wsp_lab_demo import run_wsp_lab_demo


def test_lab_demo_builds_regression_artifacts(tmp_path: Path) -> None:
    summary = run_wsp_lab_demo(
        output_dir=tmp_path,
        count=120,
        policy_count=60,
        epochs=60,
        min_auroc_lift=-1.0,
        min_unsafe_fn_reduction=-1.0,
        require_wsp_position_mae_not_worse=False,
    )

    assert summary["success"] is True
    assert summary["metrics"]["ci_status"] == "BLOCK"
    assert "robotics data/eval infrastructure" in summary["claim"]
    assert len(summary["terminal_replay"]) == 5
    for artifact_path in summary["artifacts"].values():
        assert Path(artifact_path).exists()
