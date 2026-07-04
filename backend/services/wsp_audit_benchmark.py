from __future__ import annotations

from collections import Counter
from typing import Any, Sequence

from backend.models.physical_state import WorldModelTrainingSample


FAILURE_TYPE_BY_CHECK_PREFIX = {
    "collision_clearance": "collision",
    "contact_stability": "contact_instability",
    "battery_reserve": "battery_infeasible",
    "joint_limit": "joint_limit_violation",
    "reachability": "unreachable_target",
    "dock_availability": "dock_capacity",
    "action_entity_ref_exists": "missing_entity_or_bad_calibration",
    "entity_positive_size": "bad_scale_missing_geometry",
}


def _safe_divide(numerator: int | float, denominator: int | float) -> float:
    return float(numerator) / float(denominator) if denominator else 0.0


def predict_failure_type_from_sample(sample: WorldModelTrainingSample) -> str:
    failed_checks = sample.metadata.get("failure_evidence", {}).get("failed_checks", [])
    if not isinstance(failed_checks, list):
        return "none"
    predicted: list[str] = []
    for failed_check in failed_checks:
        if not isinstance(failed_check, dict):
            continue
        check_id = str(failed_check.get("check_id", ""))
        for prefix, failure_type in FAILURE_TYPE_BY_CHECK_PREFIX.items():
            if check_id.startswith(prefix):
                predicted.append(failure_type)
                break
    if not predicted:
        return "none"
    return Counter(predicted).most_common(1)[0][0]


def _target_labels(sample: WorldModelTrainingSample) -> list[str]:
    targets = sample.metadata.get("sim_replay", {}).get("targets", {})
    if not isinstance(targets, dict):
        return []
    labels: list[str] = []
    for result in targets.values():
        if isinstance(result, dict) and result.get("label") in {"pass", "fail"}:
            labels.append(str(result["label"]))
    return labels


def benchmark_audit_against_replay(samples: Sequence[WorldModelTrainingSample]) -> dict[str, Any]:
    true_positive = 0
    false_positive = 0
    true_negative = 0
    false_negative = 0
    failure_type_correct = 0
    failure_type_count = 0
    simulator_agreement_count = 0
    runtime_ms_values: list[float] = []
    expected_failure_counts: Counter[str] = Counter()
    predicted_failure_counts: Counter[str] = Counter()

    for sample in samples:
        replay_label = sample.metadata.get("sim_replay_label")
        if replay_label not in {"pass", "fail"}:
            continue
        audit_invalid = not sample.executable
        replay_invalid = replay_label == "fail"
        if audit_invalid and replay_invalid:
            true_positive += 1
        elif audit_invalid and not replay_invalid:
            false_positive += 1
        elif not audit_invalid and replay_invalid:
            false_negative += 1
        else:
            true_negative += 1

        expected_failure_type = str(sample.metadata.get("failure_type", "unknown"))
        predicted_failure_type = predict_failure_type_from_sample(sample)
        expected_failure_counts[expected_failure_type] += 1
        predicted_failure_counts[predicted_failure_type] += 1
        if replay_invalid and expected_failure_type not in {"none", "unknown"}:
            failure_type_count += 1
            if predicted_failure_type == expected_failure_type:
                failure_type_correct += 1

        labels = _target_labels(sample)
        if labels and len(set(labels)) == 1:
            simulator_agreement_count += 1
        runtime = sample.metadata.get("sim_replay", {}).get("runtime_ms")
        if isinstance(runtime, int | float):
            runtime_ms_values.append(float(runtime))

    invalid_precision = _safe_divide(true_positive, true_positive + false_positive)
    invalid_recall = _safe_divide(true_positive, true_positive + false_negative)
    invalid_f1 = _safe_divide(2 * invalid_precision * invalid_recall, invalid_precision + invalid_recall)
    false_reject_rate = _safe_divide(false_positive, false_positive + true_negative)
    false_negative_rate = _safe_divide(false_negative, false_negative + true_positive)
    sample_count = true_positive + false_positive + true_negative + false_negative
    return {
        "sample_count": sample_count,
        "confusion": {
            "true_positive_invalid": true_positive,
            "false_positive_invalid": false_positive,
            "true_negative_valid": true_negative,
            "false_negative_invalid": false_negative,
        },
        "invalid_detection": {
            "precision": invalid_precision,
            "recall": invalid_recall,
            "f1": invalid_f1,
            "false_reject_rate": false_reject_rate,
            "false_negative_rate": false_negative_rate,
        },
        "failure_type": {
            "accuracy": _safe_divide(failure_type_correct, failure_type_count),
            "correct_count": failure_type_correct,
            "evaluated_count": failure_type_count,
            "expected_counts": dict(sorted(expected_failure_counts.items())),
            "predicted_counts": dict(sorted(predicted_failure_counts.items())),
        },
        "runtime": {
            "mean_ms_per_transition": (
                sum(runtime_ms_values) / len(runtime_ms_values) if runtime_ms_values else 0.0
            ),
            "max_ms_per_transition": max(runtime_ms_values) if runtime_ms_values else 0.0,
        },
        "simulator_agreement": {
            "agreement_count": simulator_agreement_count,
            "agreement_rate": _safe_divide(simulator_agreement_count, sample_count),
        },
    }
