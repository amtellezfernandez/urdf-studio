from __future__ import annotations

import json
import subprocess
import sys

from backend.services.world_model_dataset import write_world_model_dataset_jsonl
from backend.services.wsp_failure_corpus import generate_wsp_failure_corpus_samples
from backend.services.wsp_policy_eval import POLICY_EVAL_SCHEMA_VERSION, evaluate_policy_regression
from backend.services.wsp_replay_label import replay_label_samples


def _samples(*, count: int, valid_ratio: float, seed: int):
    samples = generate_wsp_failure_corpus_samples(
        count=count,
        failure_modes="collision,contact,joint,battery,reachability",
        valid_ratio=valid_ratio,
        seed=seed,
    )
    return replay_label_samples(samples, targets="mujoco,genesis")


def test_policy_eval_blocks_invalid_rate_regression() -> None:
    baseline = _samples(count=100, valid_ratio=0.9, seed=101)
    candidate = _samples(count=100, valid_ratio=0.5, seed=102)

    report = evaluate_policy_regression(
        baseline_samples=baseline,
        candidate_samples=candidate,
        max_invalid_rate_increase=0.02,
    )

    assert report["ok"] is False
    assert report["schema_version"] == POLICY_EVAL_SCHEMA_VERSION
    assert report["recommendation"] == "block"
    assert report["candidate"]["invalid_rate"] > report["baseline"]["invalid_rate"]
    assert report["regression"]["invalid_rate_increase"] > 0.02


def test_policy_eval_cli_accepts_files_and_writes_report(tmp_path) -> None:
    baseline_path = tmp_path / "baseline.jsonl"
    candidate_path = tmp_path / "candidate.jsonl"
    output_path = tmp_path / "policy-eval.json"
    write_world_model_dataset_jsonl(
        _samples(count=80, valid_ratio=0.9, seed=111),
        output_path=baseline_path,
        dataset_id="policy-baseline",
    )
    write_world_model_dataset_jsonl(
        _samples(count=80, valid_ratio=0.5, seed=112),
        output_path=candidate_path,
        dataset_id="policy-candidate",
    )

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "backend.scripts.wsp_policy_eval",
            "--baseline",
            str(baseline_path),
            "--candidate",
            str(candidate_path),
            "--out",
            str(output_path),
            "--max-invalid-rate-increase",
            "0.02",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 1
    report = json.loads(output_path.read_text(encoding="utf-8"))
    assert report["recommendation"] == "block"
    assert report["regression"]["invalid_count_delta"] > 0
