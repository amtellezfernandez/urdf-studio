from __future__ import annotations

import json
import subprocess
import sys

from backend.services.world_model_dataset import (
    load_world_model_dataset_jsonl,
    validate_world_model_dataset_samples,
    write_world_model_dataset_jsonl,
)
from backend.services.wsp_failure_corpus import generate_wsp_failure_corpus_samples
from backend.services.wsp_replay_label import replay_label_samples, summarize_replay_labeled_samples


def test_replay_labels_attach_simulator_outcomes_to_samples() -> None:
    samples = generate_wsp_failure_corpus_samples(
        count=20,
        failure_modes="collision,contact,joint,battery,reachability",
        valid_ratio=0.25,
        seed=11,
    )

    labeled_samples = replay_label_samples(samples, targets="mujoco,genesis")
    summary = summarize_replay_labeled_samples(labeled_samples)

    assert len(labeled_samples) == 20
    assert summary["pass_count"] > 0
    assert summary["fail_count"] > 0
    assert summary["audit_replay_agreement_rate"] == 1.0
    assert summary["target_counts"]["mujoco"]["pass"] > 0
    assert summary["target_counts"]["mujoco"]["fail"] > 0
    assert summary["target_counts"]["genesis"]["pass"] > 0
    assert summary["target_counts"]["genesis"]["fail"] > 0
    assert all(sample.metadata["sim_replay"]["audit_replay_agree"] is True for sample in labeled_samples)
    assert all(sample.metadata["sim_replay"]["smoke_load_requested"] is False for sample in labeled_samples)
    assert all("mujoco" in sample.simulator_exports for sample in labeled_samples)
    assert all("genesis" in sample.simulator_exports for sample in labeled_samples)
    assert validate_world_model_dataset_samples(labeled_samples, require_executable_and_rejected=True).ready is True


def test_replay_label_cli_writes_labeled_jsonl(tmp_path) -> None:
    samples = generate_wsp_failure_corpus_samples(
        count=12,
        failure_modes="collision,contact,joint,battery,reachability",
        valid_ratio=0.25,
        seed=13,
    )
    input_path = tmp_path / "corpus.jsonl"
    output_path = tmp_path / "corpus_labeled.jsonl"
    summary_path = tmp_path / "replay_summary.json"
    write_world_model_dataset_jsonl(
        samples,
        output_path=input_path,
        dataset_id="replay-label-cli-smoke",
    )

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "backend.scripts.wsp_replay_label",
            str(input_path),
            "--sim",
            "mujoco,genesis",
            "--out",
            str(output_path),
            "--summary-out",
            str(summary_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
    cli_summary = json.loads(result.stdout)
    labeled_samples = load_world_model_dataset_jsonl(output_path)
    assert cli_summary["ok"] is True
    assert cli_summary["smoke_load_requested"] is False
    assert cli_summary["replay"]["sample_count"] == 12
    assert output_path.exists()
    assert summary_path.exists()
    assert len(labeled_samples) == 12
    assert all(sample.metadata["sim_replay_label"] in {"pass", "fail"} for sample in labeled_samples)
