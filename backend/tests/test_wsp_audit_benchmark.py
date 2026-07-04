from __future__ import annotations

import json
import subprocess
import sys

from backend.services.world_model_dataset import write_world_model_dataset_jsonl
from backend.services.wsp_audit_benchmark import benchmark_audit_against_replay
from backend.services.wsp_failure_corpus import generate_wsp_failure_corpus_samples
from backend.services.wsp_replay_label import replay_label_samples


def _labeled_samples():
    samples = generate_wsp_failure_corpus_samples(
        count=40,
        failure_modes="collision,contact,joint,battery,reachability",
        valid_ratio=0.25,
        seed=19,
    )
    return replay_label_samples(samples, targets="mujoco,genesis")


def test_audit_benchmark_reports_detection_and_failure_type_metrics() -> None:
    report = benchmark_audit_against_replay(_labeled_samples())

    assert report["sample_count"] == 40
    assert report["confusion"]["true_positive_invalid"] == 30
    assert report["confusion"]["true_negative_valid"] == 10
    assert report["invalid_detection"]["precision"] == 1.0
    assert report["invalid_detection"]["recall"] == 1.0
    assert report["invalid_detection"]["false_reject_rate"] == 0.0
    assert report["failure_type"]["accuracy"] == 1.0
    assert report["simulator_agreement"]["agreement_rate"] == 1.0
    assert report["runtime"]["mean_ms_per_transition"] >= 0.0


def test_audit_benchmark_cli_writes_report_and_applies_thresholds(tmp_path) -> None:
    dataset_path = tmp_path / "labeled.jsonl"
    output_path = tmp_path / "benchmark.json"
    write_world_model_dataset_jsonl(
        _labeled_samples(),
        output_path=dataset_path,
        dataset_id="audit-benchmark-smoke",
    )

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "backend.scripts.wsp_benchmark_audit",
            str(dataset_path),
            "--out",
            str(output_path),
            "--min-precision",
            "0.9",
            "--min-recall",
            "0.8",
            "--max-false-reject-rate",
            "0.15",
            "--max-runtime-ms",
            "100",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
    report = json.loads(output_path.read_text(encoding="utf-8"))
    assert report["ok"] is True
    assert report["benchmark"]["invalid_detection"]["precision"] == 1.0
