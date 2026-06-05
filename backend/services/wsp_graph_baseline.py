from __future__ import annotations

import hashlib
import json
import math
from collections import Counter
from pathlib import Path
from typing import Any, Sequence

import torch
from torch import nn

from backend.models.physical_state import WorldModelTrainingSample
from backend.services.physical_state_tokens import ACTION_TYPE_IDS, CONSTRAINT_TYPES, ENTITY_FEATURE_SCHEMA, ENTITY_TYPE_IDS
from backend.services.world_model_baseline import DEFAULT_BASELINE_SEED, DEFAULT_TRAIN_FRACTION
from backend.services.wsp_raw_baseline import _binary_metrics


WSP_GRAPH_BASELINE_SCHEMA_VERSION = "wsp-entity-graph-baseline-v1"
ACTION_PARAM_SCHEMA = (
    "delta_x_m",
    "delta_y_m",
    "delta_z_m",
    "max_force_n",
    "battery_cost",
    "min_battery_reserve",
)


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


def _safe_divide(numerator: int | float, denominator: int | float) -> float:
    return float(numerator) / float(denominator) if denominator else 0.0


def _action_param_vector(sample: WorldModelTrainingSample) -> list[float]:
    delta = sample.action.params.get("delta_xyz", [0.0, 0.0, 0.0])
    if not isinstance(delta, list) or len(delta) != 3:
        delta = [0.0, 0.0, 0.0]
    return [
        float(delta[0]),
        float(delta[1]),
        float(delta[2]),
        float(sample.action.params.get("max_force_n", 0.0)),
        float(sample.action.params.get("battery_cost", 0.0)),
        float(sample.action.params.get("min_battery_reserve", 0.0)),
    ]


def _constraint_vector(sample: WorldModelTrainingSample) -> list[float]:
    return [1.0 if sample.state_tokens.constraint_mask.get(constraint_type) else 0.0 for constraint_type in CONSTRAINT_TYPES]


def _failure_type(sample: WorldModelTrainingSample) -> str:
    return str(sample.metadata.get("failure_type", "unknown"))


def _mean_std(rows: Sequence[Sequence[float]], *, feature_count: int) -> tuple[list[float], list[float]]:
    if not rows:
        return [0.0 for _ in range(feature_count)], [1.0 for _ in range(feature_count)]
    means = [_safe_divide(sum(row[index] for row in rows), len(rows)) for index in range(feature_count)]
    stds: list[float] = []
    for index, mean in enumerate(means):
        variance = _safe_divide(sum((row[index] - mean) ** 2 for row in rows), len(rows))
        std = math.sqrt(variance)
        stds.append(std if std > 1e-9 else 1.0)
    return means, stds


def _normalize(row: Sequence[float], means: Sequence[float], stds: Sequence[float]) -> list[float]:
    return [(float(value) - means[index]) / stds[index] for index, value in enumerate(row)]


def _feature_stats(samples: Sequence[WorldModelTrainingSample]) -> dict[str, Any]:
    entity_rows = [
        row
        for sample in samples
        for row in sample.state_tokens.continuous_features
    ]
    action_rows = [_action_param_vector(sample) for sample in samples]
    entity_means, entity_stds = _mean_std(entity_rows, feature_count=len(ENTITY_FEATURE_SCHEMA))
    action_means, action_stds = _mean_std(action_rows, feature_count=len(ACTION_PARAM_SCHEMA))
    return {
        "entity_means": entity_means,
        "entity_stds": entity_stds,
        "action_means": action_means,
        "action_stds": action_stds,
    }


def _sample_tensors(
    samples: Sequence[WorldModelTrainingSample],
    *,
    stats: dict[str, Any],
    max_entities: int,
    failure_type_to_id: dict[str, int],
) -> dict[str, torch.Tensor]:
    entity_features: list[list[list[float]]] = []
    entity_types: list[list[int]] = []
    entity_mask: list[list[float]] = []
    delta_targets: list[list[list[float]]] = []
    action_types: list[int] = []
    action_params: list[list[float]] = []
    constraint_masks: list[list[float]] = []
    invalid_labels: list[float] = []
    failure_labels: list[int] = []

    for sample in samples:
        next_rows = dict(zip(sample.next_state_tokens.entity_ids, sample.next_state_tokens.continuous_features))
        sample_entity_features: list[list[float]] = []
        sample_entity_types: list[int] = []
        sample_entity_mask: list[float] = []
        sample_delta_targets: list[list[float]] = []
        for entity_id, entity_type, row in zip(
            sample.state_tokens.entity_ids,
            sample.state_tokens.entity_type_ids,
            sample.state_tokens.continuous_features,
        ):
            if len(sample_entity_features) >= max_entities:
                break
            next_row = next_rows.get(entity_id)
            if next_row is None:
                continue
            sample_entity_features.append(_normalize(row, stats["entity_means"], stats["entity_stds"]))
            sample_entity_types.append(int(entity_type))
            sample_entity_mask.append(1.0)
            sample_delta_targets.append([float(next_row[index] - row[index]) for index in range(3)])
        while len(sample_entity_features) < max_entities:
            sample_entity_features.append([0.0 for _ in ENTITY_FEATURE_SCHEMA])
            sample_entity_types.append(0)
            sample_entity_mask.append(0.0)
            sample_delta_targets.append([0.0, 0.0, 0.0])
        entity_features.append(sample_entity_features)
        entity_types.append(sample_entity_types)
        entity_mask.append(sample_entity_mask)
        delta_targets.append(sample_delta_targets)
        action_type = sample.state_tokens.action_ids[0] if sample.state_tokens.action_ids else ACTION_TYPE_IDS["custom"]
        action_types.append(int(action_type))
        action_params.append(_normalize(_action_param_vector(sample), stats["action_means"], stats["action_stds"]))
        constraint_masks.append(_constraint_vector(sample))
        invalid_labels.append(0.0 if sample.executable else 1.0)
        failure_labels.append(failure_type_to_id.get(_failure_type(sample), failure_type_to_id["unknown"]))

    return {
        "entity_features": torch.tensor(entity_features, dtype=torch.float32),
        "entity_types": torch.tensor(entity_types, dtype=torch.long),
        "entity_mask": torch.tensor(entity_mask, dtype=torch.float32),
        "delta_targets": torch.tensor(delta_targets, dtype=torch.float32),
        "action_types": torch.tensor(action_types, dtype=torch.long),
        "action_params": torch.tensor(action_params, dtype=torch.float32),
        "constraint_masks": torch.tensor(constraint_masks, dtype=torch.float32),
        "invalid_labels": torch.tensor(invalid_labels, dtype=torch.float32),
        "failure_labels": torch.tensor(failure_labels, dtype=torch.long),
    }


class WspEntityGraphBaseline(nn.Module):
    def __init__(
        self,
        *,
        entity_feature_dim: int,
        action_param_dim: int,
        constraint_dim: int,
        hidden_dim: int,
        failure_type_count: int,
    ) -> None:
        super().__init__()
        self.entity_type_embedding = nn.Embedding(max(ENTITY_TYPE_IDS.values()) + 1, 8)
        self.action_embedding = nn.Embedding(max(ACTION_TYPE_IDS.values()) + 1, 8)
        self.entity_encoder = nn.Sequential(
            nn.Linear(entity_feature_dim + 8, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
        )
        self.context_encoder = nn.Sequential(
            nn.Linear(hidden_dim + 8 + action_param_dim + constraint_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
        )
        self.delta_head = nn.Sequential(
            nn.Linear(hidden_dim * 2, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, 3),
        )
        self.invalid_head = nn.Linear(hidden_dim, 1)
        self.failure_head = nn.Linear(hidden_dim, failure_type_count)

    def forward(self, batch: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
        entity_type_features = self.entity_type_embedding(batch["entity_types"])
        entity_input = torch.cat([batch["entity_features"], entity_type_features], dim=-1)
        entity_embeddings = self.entity_encoder(entity_input)
        mask = batch["entity_mask"].unsqueeze(-1)
        graph_embedding = (entity_embeddings * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1.0)
        action_embedding = self.action_embedding(batch["action_types"])
        context_input = torch.cat(
            [graph_embedding, action_embedding, batch["action_params"], batch["constraint_masks"]],
            dim=-1,
        )
        context = self.context_encoder(context_input)
        expanded_context = context.unsqueeze(1).expand(-1, entity_embeddings.shape[1], -1)
        delta_prediction = self.delta_head(torch.cat([entity_embeddings, expanded_context], dim=-1))
        return {
            "delta": delta_prediction,
            "invalid_logits": self.invalid_head(context).squeeze(-1),
            "failure_logits": self.failure_head(context),
        }


def _masked_l1(
    prediction: torch.Tensor,
    target: torch.Tensor,
    mask: torch.Tensor,
) -> torch.Tensor:
    expanded_mask = mask.unsqueeze(-1)
    return (torch.abs(prediction - target) * expanded_mask).sum() / expanded_mask.sum().clamp(min=1.0)


def _evaluate(
    model: WspEntityGraphBaseline,
    batch: dict[str, torch.Tensor],
    *,
    failure_type_by_id: dict[int, str],
    threshold: float,
) -> dict[str, Any]:
    model.eval()
    with torch.no_grad():
        outputs = model(batch)
        invalid_scores = torch.sigmoid(outputs["invalid_logits"]).cpu().tolist()
        invalid_labels = [int(value) for value in batch["invalid_labels"].cpu().tolist()]
        invalid_metrics = _binary_metrics(invalid_labels, invalid_scores, threshold=threshold)
        delta_mae = _masked_l1(outputs["delta"], batch["delta_targets"], batch["entity_mask"]).item()
        delta_abs = torch.abs(outputs["delta"] - batch["delta_targets"]) * batch["entity_mask"].unsqueeze(-1)
        position_value_count = int(batch["entity_mask"].sum().item() * 3)
        max_delta_error = float(delta_abs.max().item()) if position_value_count else 0.0
        failure_predictions = torch.argmax(outputs["failure_logits"], dim=1).cpu().tolist()
        failure_targets = batch["failure_labels"].cpu().tolist()
    correct = 0
    evaluated = 0
    expected_counts: Counter[str] = Counter()
    predicted_counts: Counter[str] = Counter()
    for predicted_id, target_id in zip(failure_predictions, failure_targets):
        expected = failure_type_by_id[int(target_id)]
        if expected in {"none", "unknown"}:
            continue
        predicted = failure_type_by_id[int(predicted_id)]
        expected_counts[expected] += 1
        predicted_counts[predicted] += 1
        evaluated += 1
        if predicted == expected:
            correct += 1
    return {
        "invalid_action": invalid_metrics,
        "failure_type": {
            "accuracy": _safe_divide(correct, evaluated),
            "correct_count": correct,
            "evaluated_count": evaluated,
            "expected_counts": dict(sorted(expected_counts.items())),
            "predicted_counts": dict(sorted(predicted_counts.items())),
        },
        "next_state": {
            "position_mean_absolute_error_m": delta_mae,
            "position_max_absolute_error_m": max_delta_error,
            "matched_position_value_count": position_value_count,
        },
    }


def train_wsp_graph_baseline(
    train_samples: Sequence[WorldModelTrainingSample],
    *,
    eval_samples: Sequence[WorldModelTrainingSample] | None = None,
    dataset_id: str | None = None,
    train_fraction: float = DEFAULT_TRAIN_FRACTION,
    seed: int = DEFAULT_BASELINE_SEED,
    epochs: int = 250,
    learning_rate: float = 0.005,
    hidden_dim: int = 64,
    max_entities: int = 8,
    threshold: float = 0.5,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if eval_samples is None:
        train_samples, eval_samples = _split_samples(train_samples, train_fraction=train_fraction, seed=seed)
    errors: list[str] = []
    warnings: list[str] = []
    if len(train_samples) < 2:
        errors.append("Training dataset must contain at least two samples.")
    if not eval_samples:
        errors.append("Evaluation dataset contains no samples.")
    torch.manual_seed(seed)
    torch.set_num_threads(1)
    failure_types = sorted({_failure_type(sample) for sample in [*train_samples, *eval_samples]})
    if "unknown" not in failure_types:
        failure_types.append("unknown")
    failure_type_to_id = {failure_type: index for index, failure_type in enumerate(failure_types)}
    failure_type_by_id = {index: failure_type for failure_type, index in failure_type_to_id.items()}
    stats = _feature_stats(train_samples)
    train_batch = _sample_tensors(
        train_samples,
        stats=stats,
        max_entities=max_entities,
        failure_type_to_id=failure_type_to_id,
    )
    eval_batch = _sample_tensors(
        eval_samples,
        stats=stats,
        max_entities=max_entities,
        failure_type_to_id=failure_type_to_id,
    )
    model = WspEntityGraphBaseline(
        entity_feature_dim=len(ENTITY_FEATURE_SCHEMA),
        action_param_dim=len(ACTION_PARAM_SCHEMA),
        constraint_dim=len(CONSTRAINT_TYPES),
        hidden_dim=hidden_dim,
        failure_type_count=len(failure_type_to_id),
    )
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)
    bce = nn.BCEWithLogitsLoss()
    ce = nn.CrossEntropyLoss()
    loss_history: list[float] = []
    if not errors:
        for _epoch in range(epochs):
            model.train()
            optimizer.zero_grad()
            outputs = model(train_batch)
            delta_loss = _masked_l1(outputs["delta"], train_batch["delta_targets"], train_batch["entity_mask"])
            invalid_loss = bce(outputs["invalid_logits"], train_batch["invalid_labels"])
            failure_loss = ce(outputs["failure_logits"], train_batch["failure_labels"])
            loss = (10.0 * delta_loss) + invalid_loss + failure_loss
            loss.backward()
            optimizer.step()
            loss_history.append(float(loss.item()))
    metrics = _evaluate(model, eval_batch, failure_type_by_id=failure_type_by_id, threshold=threshold) if eval_samples else {}
    report = {
        "success": len(errors) == 0,
        "dataset_id": dataset_id,
        "schema_version": WSP_GRAPH_BASELINE_SCHEMA_VERSION,
        "model_type": "entity_graph_action_conditioned_baseline",
        "sample_count": len(train_samples) + len(eval_samples),
        "train_sample_count": len(train_samples),
        "eval_sample_count": len(eval_samples),
        "feature_dim": len(ENTITY_FEATURE_SCHEMA),
        "max_entities": max_entities,
        "errors": errors,
        "warnings": warnings,
        "metrics": {
            **metrics,
            "training": {
                "epochs": epochs,
                "learning_rate": learning_rate,
                "hidden_dim": hidden_dim,
                "initial_loss": loss_history[0] if loss_history else None,
                "final_loss": loss_history[-1] if loss_history else None,
            },
        },
    }
    artifact = {
        "schema_version": WSP_GRAPH_BASELINE_SCHEMA_VERSION,
        "model_type": "entity_graph_action_conditioned_baseline",
        "dataset_id": dataset_id,
        "feature_schema": list(ENTITY_FEATURE_SCHEMA),
        "action_param_schema": list(ACTION_PARAM_SCHEMA),
        "constraint_types": list(CONSTRAINT_TYPES),
        "entity_type_vocab": dict(ENTITY_TYPE_IDS),
        "action_type_vocab": dict(ACTION_TYPE_IDS),
        "failure_type_vocab": failure_type_to_id,
        "normalization": stats,
        "max_entities": max_entities,
        "hidden_dim": hidden_dim,
        "threshold": threshold,
        "state_dict": {
            name: tensor.detach().cpu().tolist()
            for name, tensor in model.state_dict().items()
        },
    }
    return report, artifact


def write_wsp_graph_baseline_artifacts(
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
