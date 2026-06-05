from __future__ import annotations

import random
from collections import Counter
from typing import Any, Sequence

from backend.models.physical_state import (
    ActionToken,
    ConstraintToken,
    PhysicalEntity,
    PhysicalRolloutTrace,
    PhysicalStateFrame,
    WorldModelTrainingSample,
)
from backend.services.executability_audit import audit_physical_rollout_trace
from backend.services.world_model_dataset import build_world_model_training_samples


DEFAULT_FAILURE_CORPUS_SEED = 41
DEFAULT_VALID_RATIO = 0.25

FAILURE_MODE_ALIASES = {
    "collision": "collision",
    "contact": "contact_instability",
    "contact_instability": "contact_instability",
    "insufficient_force": "insufficient_force",
    "object_slip": "object_slip",
    "battery": "battery_infeasible",
    "battery_infeasible": "battery_infeasible",
    "dock": "dock_capacity",
    "dock_capacity": "dock_capacity",
    "joint": "joint_limit_violation",
    "joint_limit": "joint_limit_violation",
    "joint_limit_violation": "joint_limit_violation",
    "reachability": "unreachable_target",
    "unreachable_target": "unreachable_target",
    "calibration": "missing_entity_or_bad_calibration",
    "missing_entity": "missing_entity_or_bad_calibration",
    "missing_entity_or_bad_calibration": "missing_entity_or_bad_calibration",
    "scale": "bad_scale_missing_geometry",
    "bad_scale_missing_geometry": "bad_scale_missing_geometry",
}

DEFAULT_FAILURE_MODES = (
    "collision",
    "contact_instability",
    "joint_limit_violation",
    "unreachable_target",
    "insufficient_force",
    "battery_infeasible",
    "object_slip",
    "dock_capacity",
    "missing_entity_or_bad_calibration",
    "bad_scale_missing_geometry",
)


def normalize_failure_modes(raw_modes: Sequence[str] | str | None) -> list[str]:
    if raw_modes is None:
        return list(DEFAULT_FAILURE_MODES)
    if isinstance(raw_modes, str):
        raw_values = [value.strip() for value in raw_modes.split(",")]
    else:
        raw_values = [value.strip() for value in raw_modes]
    modes: list[str] = []
    for raw_mode in raw_values:
        if not raw_mode:
            continue
        mode = FAILURE_MODE_ALIASES.get(raw_mode)
        if mode is None:
            raise ValueError(f"Unsupported failure mode: {raw_mode}")
        if mode not in modes:
            modes.append(mode)
    return modes or list(DEFAULT_FAILURE_MODES)


def _entity(
    entity_id: str,
    entity_type: str,
    position_xyz: list[float],
    size_xyz: list[float] | None,
    *,
    geometry_type: str = "box",
    mass_kg: float | None = None,
    friction: float | None = None,
    battery: float | None = None,
    movable: bool = True,
    metadata: dict[str, Any] | None = None,
) -> PhysicalEntity:
    return PhysicalEntity(
        entity_id=entity_id,
        entity_type=entity_type,  # type: ignore[arg-type]
        geometry_type=geometry_type,  # type: ignore[arg-type]
        position_xyz=position_xyz,
        size_xyz=size_xyz,
        mass_kg=mass_kg,
        friction=friction,
        battery=battery,
        movable=movable,
        metadata=metadata or {},
    )


def _base_entities(index: int, *, mode: str, jitter_x: float) -> list[PhysicalEntity]:
    robot_battery = 0.82
    if mode == "battery_infeasible":
        robot_battery = 0.12
    dock_status = "occupied" if mode == "dock_capacity" else "free"
    reserved_by = "robot_other" if mode == "dock_capacity" else None
    pallet_mass = 30.0
    pallet_friction = 0.25
    if mode in {"contact_instability", "insufficient_force", "object_slip"}:
        pallet_mass = 140.0
        pallet_friction = 0.38
    entities = [
        _entity(
            f"robot_{index:05d}",
            "robot",
            [jitter_x, 0.0, 0.1],
            [0.2, 0.2, 0.2],
            battery=robot_battery,
        ),
        _entity(
            f"pallet_{index:05d}",
            "pallet",
            [1.0 + jitter_x, 0.0, 0.1],
            [0.35, 0.35, 0.2],
            mass_kg=pallet_mass,
            friction=pallet_friction,
        ),
        _entity(
            f"dock_{index:05d}",
            "dock",
            [2.0 + jitter_x, 0.0, 0.1],
            [0.45, 0.45, 0.2],
            movable=False,
            metadata={"dock_status": dock_status, "reserved_by": reserved_by},
        ),
    ]
    if mode == "collision":
        entities.append(
            _entity(
                f"obstacle_{index:05d}",
                "object",
                [1.25 + jitter_x, 0.0, 0.1],
                [0.35, 0.35, 0.2],
                movable=False,
            )
        )
    elif mode == "bad_scale_missing_geometry":
        entities.append(
            _entity(
                f"uncalibrated_box_{index:05d}",
                "object",
                [1.7 + jitter_x, 0.0, 0.1],
                None,
                metadata={"calibration_status": "missing_size"},
            )
        )
    return entities


def _copy_entity(entity: PhysicalEntity) -> PhysicalEntity:
    return entity.model_copy(deep=True)


def _constraints(index: int, *, mode: str) -> list[ConstraintToken]:
    if mode == "joint_limit_violation":
        return [
            ConstraintToken(
                constraint_id=f"joint_limit_{index:05d}",
                constraint_type="joint_limit",
                subject_id=f"robot_{index:05d}",
                target_entity_ids=[f"robot_{index:05d}"],
                params={
                    "joint_name": "shoulder_pan",
                    "position": 2.4,
                    "lower": -1.57,
                    "upper": 1.57,
                },
            )
        ]
    if mode == "unreachable_target":
        return [
            ConstraintToken(
                constraint_id=f"reachability_{index:05d}",
                constraint_type="reachability",
                subject_id=f"robot_{index:05d}",
                target_entity_ids=[f"dock_{index:05d}"],
                params={"max_distance_m": 0.6},
            )
        ]
    return []


def _action(index: int, *, mode: str) -> ActionToken:
    actor_id = f"robot_{index:05d}"
    if mode == "missing_entity_or_bad_calibration":
        actor_id = f"missing_robot_{index:05d}"
    max_force = 280.0
    delta_xyz = [0.08, 0.0, 0.0]
    if mode == "collision":
        delta_xyz = [0.25, 0.0, 0.0]
    elif mode == "contact_instability":
        max_force = 80.0
        delta_xyz = [0.45, 0.0, 0.0]
    elif mode == "insufficient_force":
        max_force = 90.0
        delta_xyz = [0.25, 0.0, 0.0]
    elif mode == "object_slip":
        max_force = 110.0
        delta_xyz = [0.6, 0.0, 0.0]
    battery_cost = 0.05
    if mode == "battery_infeasible":
        battery_cost = 0.08
    return ActionToken(
        action_id=f"push_{index:05d}",
        action_type="push",
        actor_id=actor_id,
        object_id=f"pallet_{index:05d}",
        destination_id=f"dock_{index:05d}",
        duration_ms=1000,
        params={
            "delta_xyz": delta_xyz,
            "max_force_n": max_force,
            "battery_cost": battery_cost,
            "min_battery_reserve": 0.1,
        },
    )


def _build_trace(index: int, *, mode: str, rng: random.Random) -> PhysicalRolloutTrace:
    jitter_x = round(rng.uniform(-0.05, 0.05), 5)
    entities_t = _base_entities(index, mode=mode, jitter_x=jitter_x)
    action = _action(index, mode=mode)
    delta = action.params["delta_xyz"]
    entities_next = [_copy_entity(entity) for entity in entities_t]
    for entity in entities_next:
        if entity.entity_id == f"pallet_{index:05d}":
            entity.position_xyz = [
                entity.position_xyz[0] + float(delta[0]),
                entity.position_xyz[1] + float(delta[1]),
                entity.position_xyz[2] + float(delta[2]),
            ]
            entity.velocity_xyz = [float(delta[0]), float(delta[1]), float(delta[2])]
        elif entity.entity_id == f"robot_{index:05d}":
            entity.position_xyz = [
                entity.position_xyz[0] + float(delta[0]) * 0.25,
                entity.position_xyz[1] + float(delta[1]) * 0.25,
                entity.position_xyz[2] + float(delta[2]) * 0.25,
            ]
            entity.velocity_xyz = [float(delta[0]) * 0.25, float(delta[1]) * 0.25, float(delta[2]) * 0.25]
    constraints = _constraints(index, mode=mode)
    frame_t = PhysicalStateFrame(
        frame_id=f"wsp-failure-corpus-{index:05d}:0",
        t_ms=index * 1000,
        frame_convention="studio-y-up",
        entities=entities_t,
        constraints=constraints,
        metadata={
            "source_kind": "wsp_failure_corpus",
            "failure_type": "none" if mode == "valid" else mode,
            "expected_executable": mode == "valid",
        },
    )
    frame_next = PhysicalStateFrame(
        frame_id=f"wsp-failure-corpus-{index:05d}:1",
        t_ms=(index * 1000) + 500,
        frame_convention="studio-y-up",
        entities=entities_next,
        constraints=constraints,
        metadata={
            "source_kind": "wsp_failure_corpus",
            "failure_type": "none" if mode == "valid" else mode,
            "expected_executable": mode == "valid",
        },
    )
    return PhysicalRolloutTrace(
        trace_id=f"wsp-failure-corpus-{index:05d}-{mode}",
        frames=[frame_t, frame_next],
        actions=[action],
        metadata={
            "source_kind": "wsp_failure_corpus",
            "scenario_index": index,
            "failure_type": "none" if mode == "valid" else mode,
            "expected_executable": mode == "valid",
        },
    )


def _failed_check_evidence(trace: PhysicalRolloutTrace) -> dict[str, Any]:
    report = audit_physical_rollout_trace(trace)
    failed_checks = [
        {
            "check_id": check.check_id,
            "decision": check.decision,
            "subject_ref": check.subject_ref,
            "metrics": check.metrics,
        }
        for check in report.checks
        if check.decision in {"reject", "stop"}
    ]
    return {
        "wsp_audit_label": report.decision,
        "wsp_audit_score": report.score,
        "failed_checks": failed_checks,
    }


def _mode_schedule(
    *,
    count: int,
    failure_modes: Sequence[str],
    valid_ratio: float,
    rng: random.Random,
) -> list[str]:
    valid_count = round(count * valid_ratio)
    valid_count = min(max(valid_count, 0), count)
    invalid_count = count - valid_count
    modes = ["valid" for _ in range(valid_count)]
    if invalid_count > 0:
        modes.extend(failure_modes[index % len(failure_modes)] for index in range(invalid_count))
    rng.shuffle(modes)
    return modes


def generate_wsp_failure_corpus_samples(
    *,
    count: int,
    failure_modes: Sequence[str] | str | None = None,
    valid_ratio: float = DEFAULT_VALID_RATIO,
    seed: int = DEFAULT_FAILURE_CORPUS_SEED,
) -> list[WorldModelTrainingSample]:
    if count < 1:
        raise ValueError("count must be >= 1.")
    if not 0.0 <= valid_ratio <= 1.0:
        raise ValueError("valid_ratio must be between 0 and 1.")
    normalized_modes = normalize_failure_modes(failure_modes)
    rng = random.Random(seed)
    samples: list[WorldModelTrainingSample] = []
    for index, mode in enumerate(
        _mode_schedule(count=count, failure_modes=normalized_modes, valid_ratio=valid_ratio, rng=rng)
    ):
        trace = _build_trace(index, mode=mode, rng=rng)
        evidence = _failed_check_evidence(trace)
        sample = build_world_model_training_samples(
            trace,
            metadata={
                "split": "failure_corpus",
                "source": "synthetic_rigid_body",
                "scenario_index": index,
                "failure_type": "none" if mode == "valid" else mode,
                "expected_executable": mode == "valid",
                "sim_replay_label": "not_replayed",
                "failure_evidence": evidence,
                "generator_seed": seed,
            },
        )[0]
        samples.append(sample)
    return samples


def summarize_wsp_failure_corpus(samples: Sequence[WorldModelTrainingSample]) -> dict[str, Any]:
    failure_counts = Counter(str(sample.metadata.get("failure_type", "unknown")) for sample in samples)
    decision_counts = Counter(sample.executability_decision for sample in samples)
    executable_count = sum(1 for sample in samples if sample.executable)
    expected_invalid_count = sum(1 for sample in samples if sample.metadata.get("expected_executable") is False)
    detected_invalid_count = sum(1 for sample in samples if not sample.executable)
    return {
        "sample_count": len(samples),
        "executable_count": executable_count,
        "rejected_count": len(samples) - executable_count,
        "expected_invalid_count": expected_invalid_count,
        "detected_invalid_count": detected_invalid_count,
        "failure_type_counts": dict(sorted(failure_counts.items())),
        "executability_decision_counts": dict(sorted(decision_counts.items())),
    }
