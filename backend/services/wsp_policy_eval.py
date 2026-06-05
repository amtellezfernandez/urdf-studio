from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any, Sequence

from backend.models.physical_state import WorldModelTrainingSample
from backend.services.world_model_dataset import load_world_model_dataset_jsonl


POLICY_EVAL_SCHEMA_VERSION = "wsp-policy-regression-eval-v1"


def _safe_divide(numerator: int | float, denominator: int | float) -> float:
    return float(numerator) / float(denominator) if denominator else 0.0


def _dataset_paths(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    if path.is_dir():
        return sorted(candidate for candidate in path.rglob("*.jsonl") if candidate.is_file())
    raise ValueError(f"Dataset path does not exist: {path}")


def load_policy_eval_samples(path: Path) -> list[WorldModelTrainingSample]:
    samples: list[WorldModelTrainingSample] = []
    for dataset_path in _dataset_paths(path):
        samples.extend(load_world_model_dataset_jsonl(dataset_path))
    if not samples:
        raise ValueError(f"No WSP JSONL samples found under: {path}")
    return samples


def _is_invalid(sample: WorldModelTrainingSample) -> bool:
    replay_label = sample.metadata.get("sim_replay_label")
    if replay_label in {"pass", "fail"}:
        return replay_label == "fail"
    return not sample.executable


def _failure_type(sample: WorldModelTrainingSample) -> str:
    failure_type = str(sample.metadata.get("failure_type", "unknown"))
    if failure_type in {"none", "unknown"} and _is_invalid(sample):
        failed_checks = sample.metadata.get("failure_evidence", {}).get("failed_checks", [])
        if isinstance(failed_checks, list) and failed_checks:
            return str(failed_checks[0].get("check_id", "unknown")).split("_")[0]
    return failure_type


def summarize_policy_samples(samples: Sequence[WorldModelTrainingSample]) -> dict[str, Any]:
    invalid_samples = [sample for sample in samples if _is_invalid(sample)]
    failure_counts = Counter(_failure_type(sample) for sample in invalid_samples)
    replay_counts = Counter(str(sample.metadata.get("sim_replay_label", "not_replayed")) for sample in samples)
    return {
        "sample_count": len(samples),
        "invalid_count": len(invalid_samples),
        "valid_count": len(samples) - len(invalid_samples),
        "invalid_rate": _safe_divide(len(invalid_samples), len(samples)),
        "failure_type_counts": dict(sorted(failure_counts.items())),
        "replay_label_counts": dict(sorted(replay_counts.items())),
    }


def evaluate_policy_regression(
    *,
    baseline_samples: Sequence[WorldModelTrainingSample],
    candidate_samples: Sequence[WorldModelTrainingSample],
    max_invalid_rate_increase: float = 0.02,
    max_new_failure_cases: int = 0,
) -> dict[str, Any]:
    baseline = summarize_policy_samples(baseline_samples)
    candidate = summarize_policy_samples(candidate_samples)
    baseline_failure_counts = Counter(baseline["failure_type_counts"])
    candidate_failure_counts = Counter(candidate["failure_type_counts"])
    failure_deltas = {
        failure_type: candidate_failure_counts[failure_type] - baseline_failure_counts.get(failure_type, 0)
        for failure_type in sorted(set(baseline_failure_counts) | set(candidate_failure_counts))
    }
    new_failure_modes = {
        failure_type: count
        for failure_type, count in candidate_failure_counts.items()
        if count > 0 and baseline_failure_counts.get(failure_type, 0) == 0
    }
    invalid_rate_increase = candidate["invalid_rate"] - baseline["invalid_rate"]
    new_failure_case_count = sum(new_failure_modes.values())
    errors: list[str] = []
    if invalid_rate_increase > max_invalid_rate_increase:
        errors.append(
            "invalid rollout rate increased by "
            f"{invalid_rate_increase:.6g}, above threshold {max_invalid_rate_increase:.6g}."
        )
    if new_failure_case_count > max_new_failure_cases:
        errors.append(
            f"candidate introduced {new_failure_case_count} new failure cases, "
            f"above threshold {max_new_failure_cases}."
        )
    recommendation = "pass"
    if errors:
        recommendation = "block"
    elif invalid_rate_increase > 0:
        recommendation = "review"
    return {
        "ok": not errors,
        "schema_version": POLICY_EVAL_SCHEMA_VERSION,
        "recommendation": recommendation,
        "errors": errors,
        "baseline": baseline,
        "candidate": candidate,
        "regression": {
            "invalid_rate_increase": invalid_rate_increase,
            "invalid_count_delta": candidate["invalid_count"] - baseline["invalid_count"],
            "new_failure_case_count": new_failure_case_count,
            "new_failure_modes": dict(sorted(new_failure_modes.items())),
            "failure_type_deltas": failure_deltas,
        },
        "thresholds": {
            "max_invalid_rate_increase": max_invalid_rate_increase,
            "max_new_failure_cases": max_new_failure_cases,
        },
    }


def write_policy_eval_report(report: dict[str, Any], *, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
