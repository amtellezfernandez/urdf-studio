from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Sequence

from backend.models.physical_state import (
    ActionToken,
    PhysicalRolloutTrace,
    WorldModelDatasetManifest,
    WorldModelDatasetReadinessReport,
    WorldModelTrainingSample,
)
from backend.services.executability_audit import audit_physical_rollout_trace
from backend.services.physical_state_tokens import (
    ACTION_TYPE_IDS,
    CONSTRAINT_TYPES,
    ENTITY_FEATURE_SCHEMA,
    ENTITY_TYPE_IDS,
    TOKEN_SCHEMA_VERSION,
    build_physical_token_sequence,
)


def _noop_action(frame_id: str) -> ActionToken:
    return ActionToken(
        action_id=f"{frame_id}:noop",
        action_type="noop",
    )


def _action_for_step(trace: PhysicalRolloutTrace, step_index: int) -> ActionToken:
    if trace.actions:
        return trace.actions[min(step_index, len(trace.actions) - 1)]
    return _noop_action(trace.frames[step_index].frame_id)


def _sample_id(trace_id: str, step_index: int, state_frame_id: str, action_id: str, next_frame_id: str) -> str:
    digest = hashlib.sha256(
        f"{trace_id}|{step_index}|{state_frame_id}|{action_id}|{next_frame_id}".encode("utf-8")
    ).hexdigest()
    return f"wsp-sample-{digest[:16]}"


def build_world_model_training_samples(
    trace: PhysicalRolloutTrace,
    *,
    correction_branch_id: str | None = None,
    simulator_exports: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> list[WorldModelTrainingSample]:
    samples: list[WorldModelTrainingSample] = []
    if len(trace.frames) < 2:
        return samples

    for step_index in range(len(trace.frames) - 1):
        state = trace.frames[step_index]
        next_state = trace.frames[step_index + 1]
        action = _action_for_step(trace, step_index)
        transition_trace = PhysicalRolloutTrace(
            trace_id=f"{trace.trace_id}:transition:{step_index}",
            frames=[state, next_state],
            actions=[action],
            metadata={
                **trace.metadata,
                "parent_trace_id": trace.trace_id,
                "transition_step_index": step_index,
            },
        )
        report = audit_physical_rollout_trace(transition_trace)
        samples.append(
            WorldModelTrainingSample(
                sample_id=_sample_id(
                    trace.trace_id,
                    step_index,
                    state.frame_id,
                    action.action_id,
                    next_state.frame_id,
                ),
                trace_id=trace.trace_id,
                step_index=step_index,
                state_frame_id=state.frame_id,
                next_state_frame_id=next_state.frame_id,
                action=action,
                state_tokens=build_physical_token_sequence(state, action),
                next_state_tokens=build_physical_token_sequence(next_state),
                executable=report.success,
                executability_decision=report.decision,
                executability_score=report.score,
                violation_count=report.reject_count + report.stop_count,
                correction_branch_id=correction_branch_id,
                simulator_exports=simulator_exports or {},
                metadata={
                    **(metadata or {}),
                    "source_trace_metadata": trace.metadata,
                    "audit_check_count": report.check_count,
                    "audit_warn_count": report.warn_count,
                },
            )
        )
    return samples


def build_world_model_dataset_manifest(
    samples: Sequence[WorldModelTrainingSample],
    *,
    dataset_id: str,
    output_path: Path | None = None,
    metadata: dict[str, Any] | None = None,
) -> WorldModelDatasetManifest:
    executable_count = sum(1 for sample in samples if sample.executable)
    source_trace_ids = sorted({sample.trace_id for sample in samples})
    return WorldModelDatasetManifest(
        dataset_id=dataset_id,
        sample_count=len(samples),
        executable_count=executable_count,
        rejected_count=len(samples) - executable_count,
        source_trace_ids=source_trace_ids,
        sample_schema_version="wsp-world-model-sample-v1",
        feature_schema=list(ENTITY_FEATURE_SCHEMA),
        entity_type_vocab=dict(ENTITY_TYPE_IDS),
        action_type_vocab=dict(ACTION_TYPE_IDS),
        constraint_types=list(CONSTRAINT_TYPES),
        output_path=str(output_path) if output_path is not None else None,
        metadata=metadata or {},
    )


def _sample_feature_errors(sample: WorldModelTrainingSample, *, feature_dim: int) -> list[str]:
    errors: list[str] = []
    for token_field in ("state_tokens", "next_state_tokens"):
        tokens = getattr(sample, token_field)
        rows = tokens.continuous_features
        if len(rows) != len(tokens.entity_ids):
            errors.append(
                f"{sample.sample_id}.{token_field} has {len(rows)} feature rows for {len(tokens.entity_ids)} entities."
            )
        for row_index, row in enumerate(rows):
            if len(row) != feature_dim:
                errors.append(
                    f"{sample.sample_id}.{token_field}.continuous_features[{row_index}] "
                    f"has dim {len(row)}; expected {feature_dim}."
                )
        metadata_schema = tokens.metadata.get("entity_feature_schema")
        if metadata_schema is not None and metadata_schema != list(ENTITY_FEATURE_SCHEMA):
            errors.append(f"{sample.sample_id}.{token_field} uses an unexpected entity feature schema.")
    if not sample.state_tokens.action_ids:
        errors.append(f"{sample.sample_id}.state_tokens has no action id.")
    return errors


def validate_world_model_dataset_samples(
    samples: Sequence[WorldModelTrainingSample],
    *,
    dataset_id: str | None = None,
    require_executable_and_rejected: bool = False,
    require_simulator_exports: bool = False,
) -> WorldModelDatasetReadinessReport:
    errors: list[str] = []
    warnings: list[str] = []
    feature_dim = len(ENTITY_FEATURE_SCHEMA)
    executable_count = sum(1 for sample in samples if sample.executable)
    rejected_count = len(samples) - executable_count

    if not samples:
        errors.append("Dataset contains no samples.")
    if require_executable_and_rejected and executable_count == 0:
        errors.append("Dataset contains no executable samples.")
    if require_executable_and_rejected and rejected_count == 0:
        errors.append("Dataset contains no rejected samples.")

    sample_ids = [sample.sample_id for sample in samples]
    duplicate_ids = sorted({sample_id for sample_id in sample_ids if sample_ids.count(sample_id) > 1})
    if duplicate_ids:
        errors.append(f"Duplicate sample ids: {', '.join(duplicate_ids)}")

    for sample in samples:
        if sample.schema_version != "wsp-world-model-sample-v1":
            errors.append(f"{sample.sample_id} has unsupported schema version: {sample.schema_version}")
        errors.extend(_sample_feature_errors(sample, feature_dim=feature_dim))
        if sample.action.action_type not in ACTION_TYPE_IDS:
            errors.append(f"{sample.sample_id} uses unknown action type: {sample.action.action_type}")
        if sample.executability_decision not in {"allow", "warn", "reject", "stop", "escalate"}:
            errors.append(f"{sample.sample_id} has invalid executability decision: {sample.executability_decision}")
        if require_simulator_exports and not sample.simulator_exports:
            warnings.append(f"{sample.sample_id} has no simulator export provenance.")

    return WorldModelDatasetReadinessReport(
        ready=not errors,
        dataset_id=dataset_id,
        sample_count=len(samples),
        executable_count=executable_count,
        rejected_count=rejected_count,
        feature_dim=feature_dim,
        errors=errors,
        warnings=warnings,
        metrics={
            "entity_feature_schema": list(ENTITY_FEATURE_SCHEMA),
            "entity_type_vocab_size": len(ENTITY_TYPE_IDS),
            "action_type_vocab_size": len(ACTION_TYPE_IDS),
            "constraint_type_count": len(CONSTRAINT_TYPES),
            "token_schema_version": TOKEN_SCHEMA_VERSION,
        },
    )


def load_world_model_dataset_jsonl(path: Path) -> list[WorldModelTrainingSample]:
    return [
        WorldModelTrainingSample.model_validate(json.loads(line))
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def write_world_model_dataset_jsonl(
    samples: Sequence[WorldModelTrainingSample],
    *,
    output_path: Path,
    dataset_id: str,
    manifest_path: Path | None = None,
    metadata: dict[str, Any] | None = None,
) -> WorldModelDatasetManifest:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        "".join(sample.model_dump_json() + "\n" for sample in samples),
        encoding="utf-8",
    )
    manifest = build_world_model_dataset_manifest(
        samples,
        dataset_id=dataset_id,
        output_path=output_path,
        metadata=metadata,
    )
    if manifest_path is not None:
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(manifest.model_dump_json(indent=2) + "\n", encoding="utf-8")
    return manifest
