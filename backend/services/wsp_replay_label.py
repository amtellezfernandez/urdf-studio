from __future__ import annotations

import time
from typing import Any, Sequence

from backend.models.physical_state import PhysicalRolloutTrace, PhysicalStateFrame, WorldModelTrainingSample
from backend.services.simulator_export import (
    export_rollout_trace_to_genesis_scene,
    export_rollout_trace_to_mujoco_mjcf,
)


DEFAULT_REPLAY_TARGETS = ("mujoco", "genesis")


def normalize_replay_targets(raw_targets: Sequence[str] | str | None) -> list[str]:
    if raw_targets is None:
        return list(DEFAULT_REPLAY_TARGETS)
    values = [value.strip().lower() for value in raw_targets.split(",")] if isinstance(raw_targets, str) else [
        value.strip().lower() for value in raw_targets
    ]
    targets: list[str] = []
    for value in values:
        if not value:
            continue
        if value not in {"mujoco", "genesis"}:
            raise ValueError(f"Unsupported replay target: {value}")
        if value not in targets:
            targets.append(value)
    return targets or list(DEFAULT_REPLAY_TARGETS)


def transition_trace_from_sample(sample: WorldModelTrainingSample) -> PhysicalRolloutTrace:
    state_snapshot = sample.state_tokens.metadata.get("frame_snapshot")
    next_state_snapshot = sample.next_state_tokens.metadata.get("frame_snapshot")
    if not isinstance(state_snapshot, dict) or not isinstance(next_state_snapshot, dict):
        raise ValueError(f"{sample.sample_id} does not contain frame snapshots for replay labeling.")
    return PhysicalRolloutTrace(
        trace_id=f"{sample.trace_id}:sample:{sample.step_index}:replay",
        frames=[
            PhysicalStateFrame.model_validate(state_snapshot),
            PhysicalStateFrame.model_validate(next_state_snapshot),
        ],
        actions=[sample.action],
        metadata={
            "source_sample_id": sample.sample_id,
            "source_trace_id": sample.trace_id,
            "step_index": sample.step_index,
        },
    )


def _replay_target(trace: PhysicalRolloutTrace, target: str, *, smoke_load: bool) -> dict[str, Any]:
    started = time.perf_counter()
    if target == "mujoco":
        _payload, status = export_rollout_trace_to_mujoco_mjcf(trace, smoke_load=smoke_load)
    elif target == "genesis":
        _payload, status = export_rollout_trace_to_genesis_scene(trace, smoke_load=smoke_load)
    else:
        raise ValueError(f"Unsupported replay target: {target}")
    runtime_ms = (time.perf_counter() - started) * 1000.0
    return {
        "target": target,
        "label": "pass" if status.success else "fail",
        "success": status.success,
        "smoke_passed": status.smoke_passed,
        "error": status.error,
        "warnings": list(status.warnings),
        "runtime_ms": runtime_ms,
        "smoke_load_requested": smoke_load,
        "metrics": status.metrics,
    }


def replay_label_sample(
    sample: WorldModelTrainingSample,
    *,
    targets: Sequence[str] | str | None = None,
    smoke_load: bool = False,
) -> WorldModelTrainingSample:
    normalized_targets = normalize_replay_targets(targets)
    trace = transition_trace_from_sample(sample)
    target_results = {target: _replay_target(trace, target, smoke_load=smoke_load) for target in normalized_targets}
    pass_count = sum(1 for result in target_results.values() if result["label"] == "pass")
    fail_count = len(target_results) - pass_count
    replay_label = "pass" if fail_count == 0 else "fail"
    audit_label = "pass" if sample.executable else "fail"
    replay_metadata = {
        "targets": target_results,
        "label": replay_label,
        "pass_count": pass_count,
        "fail_count": fail_count,
        "audit_label": audit_label,
        "audit_replay_agree": replay_label == audit_label,
        "smoke_load_requested": smoke_load,
        "runtime_ms": sum(result["runtime_ms"] for result in target_results.values()),
    }
    return sample.model_copy(
        deep=True,
        update={
            "simulator_exports": {
                **sample.simulator_exports,
                **{target: target_results[target] for target in normalized_targets},
            },
            "metadata": {
                **sample.metadata,
                "sim_replay_label": replay_label,
                "sim_replay": replay_metadata,
            },
        },
    )


def replay_label_samples(
    samples: Sequence[WorldModelTrainingSample],
    *,
    targets: Sequence[str] | str | None = None,
    smoke_load: bool = False,
) -> list[WorldModelTrainingSample]:
    normalized_targets = normalize_replay_targets(targets)
    return [replay_label_sample(sample, targets=normalized_targets, smoke_load=smoke_load) for sample in samples]


def replay_label_samples_with_stepping(
    samples: Sequence[WorldModelTrainingSample],
    *,
    targets: Sequence[str] | str | None = None,
    stepping_executable: str | None = None,
) -> list[WorldModelTrainingSample]:
    """Label samples using a real physics stepping loop (not export-oracle mode).

    Blocked: requires an external simulator CLI that can actually step physics frames.
    Pass stepping_executable=/path/to/sim-cli when a physics binary is available.
    Until then, fall back to export-oracle via replay_label_samples().
    """
    if stepping_executable is None:
        raise NotImplementedError(
            "Simulator stepping requires a physics simulator binary. "
            "Set stepping_executable='/path/to/sim-cli' or use "
            "replay_label_samples() for export-oracle labels."
        )
    raise NotImplementedError(
        f"Stepping via {stepping_executable!r} is not yet implemented. "
        "This hook is reserved for when a real physics CLI is available."
    )


def summarize_replay_labeled_samples(samples: Sequence[WorldModelTrainingSample]) -> dict[str, Any]:
    pass_count = sum(1 for sample in samples if sample.metadata.get("sim_replay_label") == "pass")
    fail_count = sum(1 for sample in samples if sample.metadata.get("sim_replay_label") == "fail")
    agreement_count = sum(1 for sample in samples if sample.metadata.get("sim_replay", {}).get("audit_replay_agree") is True)
    runtime_ms_values = [
        float(sample.metadata.get("sim_replay", {}).get("runtime_ms", 0.0))
        for sample in samples
        if isinstance(sample.metadata.get("sim_replay", {}).get("runtime_ms"), int | float)
    ]
    target_counts: dict[str, dict[str, int]] = {}
    for sample in samples:
        target_results = sample.metadata.get("sim_replay", {}).get("targets", {})
        if not isinstance(target_results, dict):
            continue
        for target, result in target_results.items():
            if not isinstance(result, dict):
                continue
            target_counts.setdefault(target, {"pass": 0, "fail": 0})
            label = "pass" if result.get("label") == "pass" else "fail"
            target_counts[target][label] += 1
    return {
        "sample_count": len(samples),
        "pass_count": pass_count,
        "fail_count": fail_count,
        "audit_replay_agreement_count": agreement_count,
        "audit_replay_agreement_rate": agreement_count / len(samples) if samples else 0.0,
        "mean_runtime_ms": sum(runtime_ms_values) / len(runtime_ms_values) if runtime_ms_values else 0.0,
        "target_counts": target_counts,
    }
