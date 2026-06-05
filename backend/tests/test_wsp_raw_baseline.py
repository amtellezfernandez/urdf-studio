from __future__ import annotations

import json
import subprocess
import sys

from backend.services.world_model_dataset import write_world_model_dataset_jsonl
from backend.services.wsp_failure_corpus import generate_wsp_failure_corpus_samples
from backend.services.wsp_raw_baseline import RAW_BASELINE_SCHEMA_VERSION, train_raw_log_baseline
from backend.services.wsp_replay_label import replay_label_samples


def _labeled_samples():
    samples = generate_wsp_failure_corpus_samples(
        count=80,
        failure_modes="collision,contact,joint,battery,reachability",
        valid_ratio=0.25,
        seed=29,
    )
    return replay_label_samples(samples, targets="mujoco,genesis")


def test_raw_log_baseline_reports_model_lift_metrics() -> None:
    report, model = train_raw_log_baseline(
        _labeled_samples(),
        dataset_id="raw-baseline-smoke",
        seed=7,
    )

    assert report["success"] is True
    assert report["schema_version"] == RAW_BASELINE_SCHEMA_VERSION
    assert model["schema_version"] == RAW_BASELINE_SCHEMA_VERSION
    assert report["sample_count"] == 80
    assert report["feature_dim"] == len(model["feature_schema"])
    invalid_metrics = report["metrics"]["invalid_action"]
    assert 0.0 <= invalid_metrics["auroc"] <= 1.0
    assert 0.0 <= invalid_metrics["unsafe_false_negative_rate"] <= 1.0
    assert report["metrics"]["failure_type"]["evaluated_count"] > 0
    assert report["metrics"]["next_state"]["position_mean_absolute_error_m"] >= 0.0


def test_train_raw_baseline_cli_writes_report_and_model(tmp_path) -> None:
    dataset_path = tmp_path / "labeled.jsonl"
    report_path = tmp_path / "raw-report.json"
    model_path = tmp_path / "raw-model.json"
    write_world_model_dataset_jsonl(
        _labeled_samples(),
        output_path=dataset_path,
        dataset_id="raw-baseline-cli",
    )

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "backend.scripts.wsp_train_raw_baseline",
            str(dataset_path),
            "--dataset-id",
            "raw-baseline-cli",
            "--out",
            str(report_path),
            "--model-out",
            str(model_path),
            "--min-auroc",
            "0.0",
            "--max-unsafe-fn-rate",
            "1.0",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
    report = json.loads(report_path.read_text(encoding="utf-8"))
    model = json.loads(model_path.read_text(encoding="utf-8"))
    assert report["success"] is True
    assert model["model_type"] == "raw_log_centroid_baseline"
