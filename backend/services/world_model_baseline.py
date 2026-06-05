from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any, Sequence

from backend.models.physical_state import WorldModelBaselineReport, WorldModelTrainingSample
from backend.services.physical_state_tokens import ENTITY_FEATURE_SCHEMA
from backend.services.world_model_dataset import validate_world_model_dataset_samples


BASELINE_SCHEMA_VERSION = "wsp-action-delta-baseline-v1"
DEFAULT_BASELINE_SEED = 17
DEFAULT_TRAIN_FRACTION = 0.67


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
    action_types = sorted({str(sample.action.action_type) for sample in ordered})
    if len(action_types) <= len(ordered) - 1:
        train_count = max(train_count, len(action_types))

    train_samples: list[WorldModelTrainingSample] = []
    selected_sample_ids: set[str] = set()
    for action_type in action_types:
        candidate = next(
            (
                sample
                for sample in ordered
                if str(sample.action.action_type) == action_type and sample.sample_id not in selected_sample_ids
            ),
            None,
        )
        if candidate is not None and len(train_samples) < train_count:
            train_samples.append(candidate)
            selected_sample_ids.add(candidate.sample_id)

    for sample in ordered:
        if len(train_samples) >= train_count:
            break
        if sample.sample_id in selected_sample_ids:
            continue
        train_samples.append(sample)
        selected_sample_ids.add(sample.sample_id)

    eval_samples = [sample for sample in ordered if sample.sample_id not in selected_sample_ids]
    return train_samples, eval_samples


def _entity_feature_rows(sample: WorldModelTrainingSample) -> list[tuple[str, list[float], list[float]]]:
    next_rows = dict(zip(sample.next_state_tokens.entity_ids, sample.next_state_tokens.continuous_features))
    rows: list[tuple[str, list[float], list[float]]] = []
    for entity_id, state_row in zip(sample.state_tokens.entity_ids, sample.state_tokens.continuous_features):
        next_row = next_rows.get(entity_id)
        if next_row is not None:
            rows.append((entity_id, state_row, next_row))
    return rows


def _zero_vector(feature_dim: int) -> list[float]:
    return [0.0 for _ in range(feature_dim)]


def _add_in_place(target: list[float], values: list[float]) -> None:
    for index, value in enumerate(values):
        target[index] += value


def _mean_vector(values: list[float], count: int) -> list[float]:
    if count <= 0:
        return list(values)
    return [value / count for value in values]


def _fit_action_delta_model(
    samples: Sequence[WorldModelTrainingSample],
    *,
    feature_dim: int,
) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    action_delta_sums: dict[str, list[float]] = {}
    action_delta_counts: dict[str, int] = {}
    global_delta_sum = _zero_vector(feature_dim)
    global_delta_count = 0

    for sample in samples:
        action_type = str(sample.action.action_type)
        action_delta_sums.setdefault(action_type, _zero_vector(feature_dim))
        action_delta_counts.setdefault(action_type, 0)
        for _entity_id, state_row, next_row in _entity_feature_rows(sample):
            delta = [next_value - state_value for state_value, next_value in zip(state_row, next_row)]
            _add_in_place(action_delta_sums[action_type], delta)
            action_delta_counts[action_type] += 1
            _add_in_place(global_delta_sum, delta)
            global_delta_count += 1

    if global_delta_count == 0:
        warnings.append("No matching entity ids were found between state and next-state tokens.")

    action_deltas = {
        action_type: _mean_vector(delta_sum, action_delta_counts[action_type])
        for action_type, delta_sum in sorted(action_delta_sums.items())
        if action_delta_counts[action_type] > 0
    }
    model = {
        "schema_version": BASELINE_SCHEMA_VERSION,
        "model_type": "action_delta_baseline",
        "feature_schema": list(ENTITY_FEATURE_SCHEMA),
        "global_delta": _mean_vector(global_delta_sum, global_delta_count),
        "action_deltas": action_deltas,
        "action_delta_counts": dict(sorted(action_delta_counts.items())),
    }
    return model, warnings


def _evaluate_action_delta_model(
    samples: Sequence[WorldModelTrainingSample],
    *,
    model: dict[str, Any],
    feature_dim: int,
) -> dict[str, Any]:
    absolute_error_sum = 0.0
    absolute_error_count = 0
    position_error_sum = 0.0
    position_error_count = 0
    max_absolute_error = 0.0
    matched_entity_count = 0
    fallback_action_types: set[str] = set()
    global_delta = model["global_delta"]
    action_deltas = model["action_deltas"]

    for sample in samples:
        action_type = str(sample.action.action_type)
        delta = action_deltas.get(action_type, global_delta)
        if action_type not in action_deltas:
            fallback_action_types.add(action_type)
        for _entity_id, state_row, next_row in _entity_feature_rows(sample):
            matched_entity_count += 1
            prediction = [state_value + delta[index] for index, state_value in enumerate(state_row)]
            for index, predicted_value in enumerate(prediction[:feature_dim]):
                absolute_error = abs(predicted_value - next_row[index])
                absolute_error_sum += absolute_error
                absolute_error_count += 1
                max_absolute_error = max(max_absolute_error, absolute_error)
                if index < 3:
                    position_error_sum += absolute_error
                    position_error_count += 1

    mean_absolute_error = (
        absolute_error_sum / absolute_error_count if absolute_error_count > 0 else None
    )
    position_mean_absolute_error_m = (
        position_error_sum / position_error_count if position_error_count > 0 else None
    )
    return {
        "matched_entity_count": matched_entity_count,
        "mean_absolute_error": mean_absolute_error,
        "position_mean_absolute_error_m": position_mean_absolute_error_m,
        "max_absolute_error": max_absolute_error if absolute_error_count > 0 else None,
        "fallback_action_types": sorted(fallback_action_types),
    }


def train_world_model_transition_baseline(
    samples: Sequence[WorldModelTrainingSample],
    *,
    dataset_id: str | None = None,
    train_fraction: float = DEFAULT_TRAIN_FRACTION,
    seed: int = DEFAULT_BASELINE_SEED,
    min_samples: int = 1,
    require_executable_and_rejected: bool = False,
    max_mean_absolute_error: float | None = None,
    max_position_mean_absolute_error_m: float | None = None,
) -> tuple[WorldModelBaselineReport, dict[str, Any]]:
    feature_dim = len(ENTITY_FEATURE_SCHEMA)
    errors: list[str] = []
    warnings: list[str] = []

    if not 0.0 < train_fraction <= 1.0:
        errors.append("train_fraction must be > 0 and <= 1.")

    readiness = validate_world_model_dataset_samples(
        samples,
        dataset_id=dataset_id,
        require_executable_and_rejected=require_executable_and_rejected,
    )
    if not readiness.ready:
        errors.extend(readiness.errors)
    warnings.extend(readiness.warnings)

    if len(samples) < min_samples:
        errors.append(f"Dataset contains {len(samples)} samples; expected at least {min_samples}.")

    train_samples, eval_samples = _split_samples(samples, train_fraction=train_fraction, seed=seed)
    model, model_warnings = _fit_action_delta_model(train_samples, feature_dim=feature_dim)
    warnings.extend(model_warnings)
    metrics = _evaluate_action_delta_model(eval_samples, model=model, feature_dim=feature_dim)

    mean_absolute_error = metrics["mean_absolute_error"]
    position_mean_absolute_error_m = metrics["position_mean_absolute_error_m"]
    max_absolute_error = metrics["max_absolute_error"]
    if mean_absolute_error is None:
        errors.append("No evaluable entity transitions were found.")
    elif not math.isfinite(mean_absolute_error):
        errors.append("Mean absolute error is not finite.")
    if position_mean_absolute_error_m is not None and not math.isfinite(position_mean_absolute_error_m):
        errors.append("Position mean absolute error is not finite.")

    if (
        max_mean_absolute_error is not None
        and mean_absolute_error is not None
        and mean_absolute_error > max_mean_absolute_error
    ):
        errors.append(
            f"Mean absolute error {mean_absolute_error:.6g} exceeds threshold {max_mean_absolute_error:.6g}."
        )
    if (
        max_position_mean_absolute_error_m is not None
        and position_mean_absolute_error_m is not None
        and position_mean_absolute_error_m > max_position_mean_absolute_error_m
    ):
        errors.append(
            "Position mean absolute error "
            f"{position_mean_absolute_error_m:.6g}m exceeds threshold "
            f"{max_position_mean_absolute_error_m:.6g}m."
        )

    model = {
        **model,
        "dataset_id": dataset_id,
        "train_fraction": train_fraction,
        "seed": seed,
        "train_sample_ids": [sample.sample_id for sample in train_samples],
        "eval_sample_ids": [sample.sample_id for sample in eval_samples],
    }
    action_type_count = len(model["action_deltas"])
    if metrics["fallback_action_types"]:
        warnings.append(
            "Evaluation used the global fallback delta for action types: "
            + ", ".join(metrics["fallback_action_types"])
        )

    report = WorldModelBaselineReport(
        success=len(errors) == 0,
        dataset_id=dataset_id,
        sample_count=len(samples),
        train_sample_count=len(train_samples),
        eval_sample_count=len(eval_samples),
        feature_dim=feature_dim,
        matched_entity_count=metrics["matched_entity_count"],
        action_type_count=action_type_count,
        mean_absolute_error=mean_absolute_error,
        position_mean_absolute_error_m=position_mean_absolute_error_m,
        max_absolute_error=max_absolute_error,
        errors=errors,
        warnings=warnings,
        metrics={
            "baseline_schema_version": BASELINE_SCHEMA_VERSION,
            "train_fraction": train_fraction,
            "seed": seed,
            "readiness": readiness.model_dump(mode="json"),
            "fallback_action_types": metrics["fallback_action_types"],
            "model_action_delta_counts": model["action_delta_counts"],
        },
    )
    return report, model


def write_world_model_baseline_artifacts(
    report: WorldModelBaselineReport,
    model: dict[str, Any],
    *,
    report_path: Path | None = None,
    model_path: Path | None = None,
) -> None:
    if report_path is not None:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(report.model_dump_json(indent=2) + "\n", encoding="utf-8")
    if model_path is not None:
        model_path.parent.mkdir(parents=True, exist_ok=True)
        model_path.write_text(
            json.dumps(model, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
