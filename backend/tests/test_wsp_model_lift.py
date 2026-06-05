from __future__ import annotations

import json
import subprocess
import sys

from backend.services.wsp_model_lift import MODEL_LIFT_SCHEMA_VERSION, compare_raw_vs_wsp_model_lift


def _report(*, auroc: float, unsafe_fn: float, failure_accuracy: float, position_mae: float):
    return {
        "schema_version": "test-report",
        "model_type": "test",
        "sample_count": 100,
        "eval_sample_count": 30,
        "metrics": {
            "invalid_action": {
                "auroc": auroc,
                "unsafe_false_negative_rate": unsafe_fn,
            },
            "failure_type": {
                "accuracy": failure_accuracy,
            },
            "next_state": {
                "position_mean_absolute_error_m": position_mae,
            },
        },
    }


def test_model_lift_comparison_reports_relative_improvements() -> None:
    report = compare_raw_vs_wsp_model_lift(
        raw_report=_report(auroc=0.82, unsafe_fn=0.36, failure_accuracy=0.8, position_mae=0.015),
        wsp_report=_report(auroc=1.0, unsafe_fn=0.0, failure_accuracy=1.0, position_mae=0.005),
        min_auroc_lift=0.1,
        min_unsafe_fn_reduction=0.2,
        require_wsp_position_mae_not_worse=True,
    )

    assert report["ok"] is True
    assert report["schema_version"] == MODEL_LIFT_SCHEMA_VERSION
    assert report["relative_improvement"]["invalid_action_auroc_lift"] > 0.1
    assert report["relative_improvement"]["unsafe_false_negative_rate_reduction"] > 0.2
    assert report["relative_improvement"]["position_mae_reduction_m"] > 0.0


def test_compare_model_lift_cli_applies_thresholds(tmp_path) -> None:
    raw_report_path = tmp_path / "raw.json"
    wsp_report_path = tmp_path / "wsp.json"
    output_path = tmp_path / "lift.json"
    raw_report_path.write_text(
        json.dumps(_report(auroc=0.82, unsafe_fn=0.36, failure_accuracy=0.8, position_mae=0.015)),
        encoding="utf-8",
    )
    wsp_report_path.write_text(
        json.dumps(_report(auroc=1.0, unsafe_fn=0.0, failure_accuracy=1.0, position_mae=0.005)),
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "backend.scripts.wsp_compare_model_lift",
            "--raw-report",
            str(raw_report_path),
            "--wsp-report",
            str(wsp_report_path),
            "--out",
            str(output_path),
            "--min-auroc-lift",
            "0.1",
            "--min-unsafe-fn-reduction",
            "0.2",
            "--require-wsp-position-mae-not-worse",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
    report = json.loads(output_path.read_text(encoding="utf-8"))
    assert report["ok"] is True
