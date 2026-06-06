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
        stress_noise_rate=0.1,
    )

    assert summary["success"] is True
    assert summary["metrics"]["deterministic"]["ci_status"] == "BLOCK"
    assert summary["metrics"]["stress"]["audit_precision"] < 1.0
    assert summary["metrics"]["stress"]["mode"] == "synthetic_ambiguity_label_noise"
    assert summary["validation_mode"] == "phase_1_deterministic_verification"
    assert "production robustness claim" in summary["evidence_scope"]
    assert "deterministic verification" in summary["stage_script"]["safe_claim"]
    assert "real-world precision/recall" in summary["stage_script"]["do_not_claim"][0]
    assert summary["stress_test"]["mode"] == "synthetic_ambiguity_label_noise"
    assert summary["stress_test"]["audit_precision"] < 1.0
    assert "robotics data/eval compiler" in summary["claim"]
    assert len(summary["terminal_replay"]) == 5
    for artifact_path in summary["artifacts"].values():
        assert Path(artifact_path).exists()
