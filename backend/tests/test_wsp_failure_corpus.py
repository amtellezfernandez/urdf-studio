from __future__ import annotations

import json
import subprocess
import sys

from backend.services.world_model_dataset import load_world_model_dataset_jsonl, validate_world_model_dataset_samples
from backend.services.wsp_failure_corpus import (
    generate_wsp_failure_corpus_samples,
    normalize_failure_modes,
    summarize_wsp_failure_corpus,
)


def test_failure_corpus_normalizes_requested_aliases() -> None:
    modes = normalize_failure_modes("collision,contact,joint,battery,reachability")

    assert modes == [
        "collision",
        "contact_instability",
        "joint_limit_violation",
        "battery_infeasible",
        "unreachable_target",
    ]


def test_failure_corpus_generates_model_ready_labeled_samples() -> None:
    samples = generate_wsp_failure_corpus_samples(
        count=80,
        failure_modes="collision,contact,joint,battery,reachability",
        valid_ratio=0.25,
        seed=7,
    )
    report = validate_world_model_dataset_samples(
        samples,
        dataset_id="failure-corpus-smoke",
        require_executable_and_rejected=True,
    )
    summary = summarize_wsp_failure_corpus(samples)

    assert len(samples) == 80
    assert report.ready is True
    assert report.errors == []
    assert summary["executable_count"] > 0
    assert summary["rejected_count"] > 0
    assert summary["failure_type_counts"]["none"] == 20
    assert summary["failure_type_counts"]["joint_limit_violation"] > 0
    assert summary["failure_type_counts"]["unreachable_target"] > 0
    assert all(sample.metadata["source"] == "synthetic_rigid_body" for sample in samples)
    assert all(sample.metadata["sim_replay_label"] == "not_replayed" for sample in samples)
    assert any(
        failed_check["check_id"].startswith("joint_limit")
        for sample in samples
        for failed_check in sample.metadata["failure_evidence"]["failed_checks"]
    )
    assert any(
        failed_check["check_id"].startswith("reachability")
        for sample in samples
        for failed_check in sample.metadata["failure_evidence"]["failed_checks"]
    )


def test_generate_corpus_cli_writes_jsonl_manifest_and_summary(tmp_path) -> None:
    output_path = tmp_path / "wsp_failure_corpus.jsonl"
    manifest_path = tmp_path / "wsp_failure_corpus_manifest.json"
    summary_path = tmp_path / "wsp_failure_corpus_summary.json"

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "backend.scripts.wsp_generate_corpus",
            "--count",
            "30",
            "--failure-modes",
            "collision,contact,joint,battery,reachability",
            "--out",
            str(output_path),
            "--manifest-out",
            str(manifest_path),
            "--summary-out",
            str(summary_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
    stdout_summary = json.loads(result.stdout)
    samples = load_world_model_dataset_jsonl(output_path)
    assert output_path.exists()
    assert manifest_path.exists()
    assert summary_path.exists()
    assert stdout_summary["ok"] is True
    assert stdout_summary["corpus"]["sample_count"] == 30
    assert len(samples) == 30
    assert validate_world_model_dataset_samples(samples, require_executable_and_rejected=True).ready is True
