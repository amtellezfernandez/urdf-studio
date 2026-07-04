from __future__ import annotations

import json
import subprocess
import sys

from backend.services.world_model_dataset import load_world_model_dataset_jsonl, validate_world_model_dataset_samples
from backend.services.wsp_failure_corpus import (
    CorpusNoiseConfig,
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


# ── CorpusNoiseConfig ──────────────────────────────────────────────────────


def test_corpus_noise_config_records_metadata() -> None:
    noise = CorpusNoiseConfig(calibration_drift_sigma_m=0.03, timestamp_jitter_ms=5.0)
    samples = generate_wsp_failure_corpus_samples(
        count=10,
        failure_modes="collision,joint",
        valid_ratio=0.5,
        seed=7,
        noise_config=noise,
    )
    assert len(samples) == 10
    for sample in samples:
        cfg = sample.metadata["corpus_noise_config"]
        assert cfg is not None
        assert cfg["calibration_drift_sigma_m"] == 0.03
        assert cfg["timestamp_jitter_ms"] == 5.0


def test_corpus_noise_missing_entities_never_drops_all() -> None:
    noise = CorpusNoiseConfig(missing_entity_rate=0.99)
    samples = generate_wsp_failure_corpus_samples(
        count=10,
        failure_modes="collision",
        valid_ratio=0.0,
        seed=7,
        noise_config=noise,
    )
    assert len(samples) == 10, "noise must not crash even at 0.99 drop rate"


def test_corpus_noise_contact_ambiguity_runs_without_error() -> None:
    noise = CorpusNoiseConfig(contact_ambiguity_rate=1.0)
    samples = generate_wsp_failure_corpus_samples(
        count=10,
        failure_modes="collision",
        valid_ratio=0.0,
        seed=42,
        noise_config=noise,
    )
    assert len(samples) == 10


def test_corpus_no_noise_config_leaves_metadata_none() -> None:
    samples = generate_wsp_failure_corpus_samples(count=5, failure_modes="collision", seed=1)
    for sample in samples:
        assert sample.metadata["corpus_noise_config"] is None
