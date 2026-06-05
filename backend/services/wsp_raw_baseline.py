from __future__ import annotations

import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Sequence

from backend.models.physical_state import PhysicalStateFrame, WorldModelTrainingSample
from backend.services.world_model_baseline import DEFAULT_BASELINE_SEED, DEFAULT_TRAIN_FRACTION


RAW_BASELINE_SCHEMA_VERSION = "wsp-raw-log-baseline-v1"

RAW_FEATURE_SCHEMA = (
    "action_delta_x_m",
    "action_delta_y_m",
    "action_delta_z_m",
    "action_max_force_n",
    "action_battery_cost",
    "action_min_battery_reserve",
    "entity_count",
    "robot_x_m",
    "robot_y_m",
    "robot_z_m",
    "robot_battery_fraction",
    "object_x_m",
    "object_y_m",
    "object_z_m",
    "object_mass_kg",
    "object_friction",
    "dock_x_m",
    "dock_y_m",
    "dock_z_m",
    "obstacle_count",
    "mean_entity_x_m",
    "mean_entity_y_m",
    "mean_entity_z_m",
)


def _safe_divide(numerator: int | float, denominator: int | float) -> float:
    return float(numerator) / float(denominator) if denominator else 0.0


def _stable_order(samples: Sequence[WorldModelTrainingSample], *, seed: int) -> list[WorldModelTrainingSample]:
    return sorted(
        samples,
        key=lambda sample: hashlib.sha256(f"{seed}:{sample.sample_id}".encode("utf-8")).hexdigest(),
    )


def _split_samples(
    samples: Sequence[WorldModelTrainingSample],
    *,
    train_fraction: float,
    seed: int,
) -> tuple[list[WorldModelTrainingSample], list[WorldModelTrainingSample]]:
    ordered = _stable_order(samples, seed=seed)
    if len(ordered) <= 1:
        return ordered, ordered
    train_count = round(len(ordered) * train_fraction)
    train_count = max(1, min(len(ordered) - 1, train_count))
    return ordered[:train_count], ordered[train_count:]


def _frame_from_sample(sample: WorldModelTrainingSample, *, next_state: bool = False) -> PhysicalStateFrame:
    tokens = sample.next_state_tokens if next_state else sample.state_tokens
    snapshot = tokens.metadata.get("frame_snapshot")
    if not isinstance(snapshot, dict):
        raise ValueError(f"{sample.sample_id} does not contain a frame_snapshot.")
    return PhysicalStateFrame.model_validate(snapshot)


def _entity_by_id(frame: PhysicalStateFrame, entity_id: str | None) -> Any | None:
    if entity_id is None:
        return None
    for entity in frame.entities:
        if entity.entity_id == entity_id:
            return entity
    return None


def _first_entity_by_type(frame: PhysicalStateFrame, entity_type: str) -> Any | None:
    for entity in frame.entities:
        if entity.entity_type == entity_type:
            return entity
    return None


def _position(entity: Any | None) -> list[float]:
    return list(entity.position_xyz) if entity is not None else [0.0, 0.0, 0.0]


def _raw_feature_vector(sample: WorldModelTrainingSample) -> list[float]:
    frame = _frame_from_sample(sample)
    action = sample.action
    delta = action.params.get("delta_xyz", [0.0, 0.0, 0.0])
    if not isinstance(delta, list) or len(delta) != 3:
        delta = [0.0, 0.0, 0.0]
    robot = _entity_by_id(frame, action.actor_id) or _first_entity_by_type(frame, "robot")
    action_object = _entity_by_id(frame, action.object_id) or _first_entity_by_type(frame, "pallet")
    dock = _entity_by_id(frame, action.destination_id) or _first_entity_by_type(frame, "dock")
    obstacle_count = sum(1 for entity in frame.entities if entity.entity_type == "object")
    entity_count = len(frame.entities)
    mean_position = [
        _safe_divide(sum(entity.position_xyz[index] for entity in frame.entities), entity_count)
        for index in range(3)
    ] if entity_count else [0.0, 0.0, 0.0]
    robot_position = _position(robot)
    object_position = _position(action_object)
    dock_position = _position(dock)
    return [
        float(delta[0]),
        float(delta[1]),
        float(delta[2]),
        float(action.params.get("max_force_n", 0.0)),
        float(action.params.get("battery_cost", 0.0)),
        float(action.params.get("min_battery_reserve", 0.0)),
        float(entity_count),
        *robot_position,
        float(robot.battery or 0.0) if robot is not None else 0.0,
        *object_position,
        float(action_object.mass_kg or 0.0) if action_object is not None else 0.0,
        float(action_object.friction or 0.0) if action_object is not None else 0.0,
        *dock_position,
        float(obstacle_count),
        *mean_position,
    ]


def _mean_std(rows: Sequence[list[float]]) -> tuple[list[float], list[float]]:
    if not rows:
        return [0.0 for _ in RAW_FEATURE_SCHEMA], [1.0 for _ in RAW_FEATURE_SCHEMA]
    feature_count = len(rows[0])
    means = [_safe_divide(sum(row[index] for row in rows), len(rows)) for index in range(feature_count)]
    stds: list[float] = []
    for index, mean in enumerate(means):
        variance = _safe_divide(sum((row[index] - mean) ** 2 for row in rows), len(rows))
        std = math.sqrt(variance)
        stds.append(std if std > 1e-9 else 1.0)
    return means, stds


def _normalize(row: list[float], means: Sequence[float], stds: Sequence[float]) -> list[float]:
    return [(value - means[index]) / stds[index] for index, value in enumerate(row)]


def _centroid(rows: Sequence[list[float]]) -> list[float]:
    if not rows:
        return [0.0 for _ in RAW_FEATURE_SCHEMA]
    return [_safe_divide(sum(row[index] for row in rows), len(rows)) for index in range(len(rows[0]))]


def _squared_distance(left: Sequence[float], right: Sequence[float]) -> float:
    return sum((left[index] - right[index]) ** 2 for index in range(len(left)))


def _sigmoid(value: float) -> float:
    if value >= 50:
        return 1.0
    if value <= -50:
        return 0.0
    return 1.0 / (1.0 + math.exp(-value))


def _invalid_probability(row: list[float], model: dict[str, Any]) -> float:
    normalized = _normalize(row, model["feature_means"], model["feature_stds"])
    valid_centroid = model["valid_centroid"]
    invalid_centroid = model["invalid_centroid"]
    prior = float(model["invalid_prior"])
    if model["valid_count"] == 0 or model["invalid_count"] == 0:
        return prior
    valid_distance = _squared_distance(normalized, valid_centroid)
    invalid_distance = _squared_distance(normalized, invalid_centroid)
    return _sigmoid((valid_distance - invalid_distance) + math.log((prior + 1e-6) / (1.0 - prior + 1e-6)))


def _binary_metrics(labels: Sequence[int], scores: Sequence[float], *, threshold: float) -> dict[str, Any]:
    true_positive = false_positive = true_negative = false_negative = 0
    for label, score in zip(labels, scores):
        predicted = score >= threshold
        if predicted and label:
            true_positive += 1
        elif predicted and not label:
            false_positive += 1
        elif not predicted and label:
            false_negative += 1
        else:
            true_negative += 1
    precision = _safe_divide(true_positive, true_positive + false_positive)
    recall = _safe_divide(true_positive, true_positive + false_negative)
    f1 = _safe_divide(2 * precision * recall, precision + recall)
    positives = [score for label, score in zip(labels, scores) if label]
    negatives = [score for label, score in zip(labels, scores) if not label]
    pair_count = len(positives) * len(negatives)
    wins = 0.0
    for positive_score in positives:
        for negative_score in negatives:
            if positive_score > negative_score:
                wins += 1.0
            elif positive_score == negative_score:
                wins += 0.5
    return {
        "threshold": threshold,
        "auroc": _safe_divide(wins, pair_count),
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "unsafe_false_negative_rate": _safe_divide(false_negative, true_positive + false_negative),
        "false_reject_rate": _safe_divide(false_positive, false_positive + true_negative),
        "confusion": {
            "true_positive_invalid": true_positive,
            "false_positive_invalid": false_positive,
            "true_negative_valid": true_negative,
            "false_negative_invalid": false_negative,
        },
    }


def _matched_entity_position_rows(sample: WorldModelTrainingSample) -> list[tuple[str, str, list[float], list[float]]]:
    state = _frame_from_sample(sample)
    next_state = _frame_from_sample(sample, next_state=True)
    next_entities = {entity.entity_id: entity for entity in next_state.entities}
    rows: list[tuple[str, str, list[float], list[float]]] = []
    for entity in state.entities:
        next_entity = next_entities.get(entity.entity_id)
        if next_entity is not None:
            rows.append((entity.entity_id, str(entity.entity_type), list(entity.position_xyz), list(next_entity.position_xyz)))
    return rows


def _fit_position_delta_model(samples: Sequence[WorldModelTrainingSample]) -> dict[str, Any]:
    delta_sums: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    delta_counts: Counter[str] = Counter()
    global_sum = [0.0, 0.0, 0.0]
    global_count = 0
    for sample in samples:
        for _entity_id, entity_type, position, next_position in _matched_entity_position_rows(sample):
            delta = [next_position[index] - position[index] for index in range(3)]
            key = f"{sample.action.action_type}:{entity_type}"
            for index in range(3):
                delta_sums[key][index] += delta[index]
                global_sum[index] += delta[index]
            delta_counts[key] += 1
            global_count += 1
    return {
        "global_delta_xyz": [_safe_divide(value, global_count) for value in global_sum],
        "entity_action_delta_xyz": {
            key: [_safe_divide(value, delta_counts[key]) for value in delta]
            for key, delta in sorted(delta_sums.items())
            if delta_counts[key] > 0
        },
        "entity_action_delta_counts": dict(sorted(delta_counts.items())),
    }


def _evaluate_position_delta_model(
    samples: Sequence[WorldModelTrainingSample],
    *,
    model: dict[str, Any],
) -> dict[str, Any]:
    absolute_error_sum = 0.0
    absolute_error_count = 0
    max_absolute_error = 0.0
    fallback_count = 0
    for sample in samples:
        for _entity_id, entity_type, position, next_position in _matched_entity_position_rows(sample):
            key = f"{sample.action.action_type}:{entity_type}"
            delta = model["entity_action_delta_xyz"].get(key)
            if delta is None:
                delta = model["global_delta_xyz"]
                fallback_count += 1
            prediction = [position[index] + delta[index] for index in range(3)]
            for index, predicted in enumerate(prediction):
                error = abs(predicted - next_position[index])
                absolute_error_sum += error
                absolute_error_count += 1
                max_absolute_error = max(max_absolute_error, error)
    return {
        "position_mean_absolute_error_m": _safe_divide(absolute_error_sum, absolute_error_count),
        "position_max_absolute_error_m": max_absolute_error if absolute_error_count else 0.0,
        "matched_position_value_count": absolute_error_count,
        "fallback_entity_count": fallback_count,
    }


def _fit_failure_type_centroids(
    samples: Sequence[WorldModelTrainingSample],
    *,
    means: Sequence[float],
    stds: Sequence[float],
) -> dict[str, list[float]]:
    grouped: dict[str, list[list[float]]] = defaultdict(list)
    for sample in samples:
        failure_type = str(sample.metadata.get("failure_type", "unknown"))
        if failure_type in {"none", "unknown"}:
            continue
        grouped[failure_type].append(_normalize(_raw_feature_vector(sample), means, stds))
    return {failure_type: _centroid(rows) for failure_type, rows in sorted(grouped.items())}


def _predict_failure_type(row: list[float], model: dict[str, Any]) -> str:
    centroids = model["failure_type_centroids"]
    if not centroids:
        return "unknown"
    normalized = _normalize(row, model["feature_means"], model["feature_stds"])
    return min(
        centroids,
        key=lambda failure_type: _squared_distance(normalized, centroids[failure_type]),
    )


def _evaluate_failure_type(samples: Sequence[WorldModelTrainingSample], *, model: dict[str, Any]) -> dict[str, Any]:
    correct = 0
    evaluated = 0
    expected_counts: Counter[str] = Counter()
    predicted_counts: Counter[str] = Counter()
    for sample in samples:
        expected = str(sample.metadata.get("failure_type", "unknown"))
        if expected in {"none", "unknown"}:
            continue
        predicted = _predict_failure_type(_raw_feature_vector(sample), model)
        expected_counts[expected] += 1
        predicted_counts[predicted] += 1
        evaluated += 1
        if predicted == expected:
            correct += 1
    return {
        "accuracy": _safe_divide(correct, evaluated),
        "correct_count": correct,
        "evaluated_count": evaluated,
        "expected_counts": dict(sorted(expected_counts.items())),
        "predicted_counts": dict(sorted(predicted_counts.items())),
    }


def train_raw_log_baseline(
    samples: Sequence[WorldModelTrainingSample],
    *,
    dataset_id: str | None = None,
    train_fraction: float = DEFAULT_TRAIN_FRACTION,
    seed: int = DEFAULT_BASELINE_SEED,
    threshold: float = 0.5,
    min_samples: int = 2,
) -> tuple[dict[str, Any], dict[str, Any]]:
    errors: list[str] = []
    warnings: list[str] = []
    if len(samples) < min_samples:
        errors.append(f"Dataset contains {len(samples)} samples; expected at least {min_samples}.")
    if not 0.0 < train_fraction <= 1.0:
        errors.append("train_fraction must be > 0 and <= 1.")
    train_samples, eval_samples = _split_samples(samples, train_fraction=train_fraction, seed=seed)
    train_rows = [_raw_feature_vector(sample) for sample in train_samples]
    feature_means, feature_stds = _mean_std(train_rows)
    normalized_train_rows = [_normalize(row, feature_means, feature_stds) for row in train_rows]
    valid_rows = [row for row, sample in zip(normalized_train_rows, train_samples) if sample.executable]
    invalid_rows = [row for row, sample in zip(normalized_train_rows, train_samples) if not sample.executable]
    invalid_prior = _safe_divide(len(invalid_rows), len(train_samples))
    model = {
        "schema_version": RAW_BASELINE_SCHEMA_VERSION,
        "model_type": "raw_log_centroid_baseline",
        "dataset_id": dataset_id,
        "feature_schema": list(RAW_FEATURE_SCHEMA),
        "feature_means": feature_means,
        "feature_stds": feature_stds,
        "valid_centroid": _centroid(valid_rows),
        "invalid_centroid": _centroid(invalid_rows),
        "valid_count": len(valid_rows),
        "invalid_count": len(invalid_rows),
        "invalid_prior": invalid_prior,
        "failure_type_centroids": _fit_failure_type_centroids(train_samples, means=feature_means, stds=feature_stds),
        "position_delta_model": _fit_position_delta_model(train_samples),
        "train_fraction": train_fraction,
        "seed": seed,
        "threshold": threshold,
        "train_sample_ids": [sample.sample_id for sample in train_samples],
        "eval_sample_ids": [sample.sample_id for sample in eval_samples],
    }
    if not valid_rows:
        warnings.append("Training split contains no executable samples; invalid classifier falls back to prior.")
    if not invalid_rows:
        warnings.append("Training split contains no invalid samples; invalid classifier falls back to prior.")
    eval_labels = [0 if sample.executable else 1 for sample in eval_samples]
    eval_scores = [_invalid_probability(_raw_feature_vector(sample), model) for sample in eval_samples]
    invalid_metrics = _binary_metrics(eval_labels, eval_scores, threshold=threshold)
    position_metrics = _evaluate_position_delta_model(eval_samples, model=model["position_delta_model"])
    failure_type_metrics = _evaluate_failure_type(eval_samples, model=model)
    report = {
        "success": len(errors) == 0,
        "dataset_id": dataset_id,
        "schema_version": RAW_BASELINE_SCHEMA_VERSION,
        "model_type": "raw_log_centroid_baseline",
        "sample_count": len(samples),
        "train_sample_count": len(train_samples),
        "eval_sample_count": len(eval_samples),
        "feature_dim": len(RAW_FEATURE_SCHEMA),
        "errors": errors,
        "warnings": warnings,
        "metrics": {
            "invalid_action": invalid_metrics,
            "failure_type": failure_type_metrics,
            "next_state": position_metrics,
            "train_label_counts": {
                "executable": len(valid_rows),
                "invalid": len(invalid_rows),
            },
        },
    }
    return report, model


def write_raw_log_baseline_artifacts(
    report: dict[str, Any],
    model: dict[str, Any],
    *,
    report_path: Path | None = None,
    model_path: Path | None = None,
) -> None:
    if report_path is not None:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if model_path is not None:
        model_path.parent.mkdir(parents=True, exist_ok=True)
        model_path.write_text(json.dumps(model, indent=2, sort_keys=True) + "\n", encoding="utf-8")
