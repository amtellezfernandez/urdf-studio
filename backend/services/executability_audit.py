from __future__ import annotations

import math

from backend.models.physical_state import (
    ActionToken,
    CorrectionBranch,
    ExecutabilityCheckResult,
    ExecutabilityReport,
    PhysicalEntity,
    PhysicalRolloutTrace,
    PhysicalStateFrame,
)


QUATERNION_NORM_TOLERANCE = 1e-3
DEFAULT_COLLISION_MARGIN_M = 0.0
DEFAULT_CONTACT_FRICTION = 0.35
DEFAULT_PUSH_DURATION_MS = 1000
DEFAULT_BATTERY_RESERVE = 0.1


def _check(
    check_id: str,
    passed: bool,
    decision: str,
    message: str,
    *,
    subject_ref: str | None = None,
    metrics: dict | None = None,
) -> ExecutabilityCheckResult:
    return ExecutabilityCheckResult(
        check_id=check_id,
        passed=passed,
        decision=decision,  # type: ignore[arg-type]
        subject_ref=subject_ref,
        message=message,
        metrics=metrics or {},
    )


def _entity_radius(entity: PhysicalEntity) -> tuple[float, float, float] | None:
    if entity.size_xyz is None or entity.geometry_type in {"point", "unknown"}:
        return None
    return (entity.size_xyz[0] / 2.0, entity.size_xyz[1] / 2.0, entity.size_xyz[2] / 2.0)


def _aabb_overlap_depth(a: PhysicalEntity, b: PhysicalEntity) -> float:
    radius_a = _entity_radius(a)
    radius_b = _entity_radius(b)
    if radius_a is None or radius_b is None:
        return 0.0
    overlap_by_axis = []
    for axis in range(3):
        center_delta = abs(a.position_xyz[axis] - b.position_xyz[axis])
        overlap_by_axis.append(radius_a[axis] + radius_b[axis] - center_delta)
    if any(overlap <= 0 for overlap in overlap_by_axis):
        return 0.0
    return min(overlap_by_axis)


def _collision_enabled(entity: PhysicalEntity) -> bool:
    return entity.metadata.get("collision", True) is not False and entity.metadata.get("is_hidden") is not True


def _relation_allows_contact(frame: PhysicalStateFrame, source_id: str, target_id: str) -> bool:
    allowed_types = {"contacts", "supports", "attached"}
    for relation in frame.relations:
        if relation.relation_type not in allowed_types:
            continue
        pair = {relation.source_id, relation.target_id}
        if pair == {source_id, target_id}:
            return True
    return False


def _audit_entity_geometry(frame: PhysicalStateFrame) -> list[ExecutabilityCheckResult]:
    checks: list[ExecutabilityCheckResult] = []
    for entity in frame.entities:
        quat_norm = math.sqrt(sum(component * component for component in entity.quat_wxyz))
        quat_ok = abs(quat_norm - 1.0) <= QUATERNION_NORM_TOLERANCE
        checks.append(
            _check(
                "entity_quaternion_unit_norm",
                quat_ok,
                "allow" if quat_ok else "warn",
                "Entity quaternion is unit length." if quat_ok else "Entity quaternion is not unit length.",
                subject_ref=entity.entity_id,
                metrics={"quat_norm": quat_norm},
            )
        )
        if entity.geometry_type in {"box", "sphere", "cylinder", "mesh"}:
            has_size = entity.size_xyz is not None and all(component > 0 for component in entity.size_xyz)
            checks.append(
                _check(
                    "entity_positive_size",
                    has_size,
                    "allow" if has_size else "reject",
                    "Entity has positive metric size." if has_size else "Entity is missing positive metric size.",
                    subject_ref=entity.entity_id,
                )
            )
    return checks


def _audit_action_refs(frame: PhysicalStateFrame, actions: list[ActionToken]) -> list[ExecutabilityCheckResult]:
    known_ids = {entity.entity_id for entity in frame.entities}
    checks: list[ExecutabilityCheckResult] = []
    for action in actions:
        for role, entity_id in (
            ("actor", action.actor_id),
            ("object", action.object_id),
            ("target", action.target_id),
            ("destination", action.destination_id),
        ):
            if entity_id is None:
                continue
            exists = entity_id in known_ids
            checks.append(
                _check(
                    "action_entity_ref_exists",
                    exists,
                    "allow" if exists else "reject",
                    f"Action {role} reference exists." if exists else f"Action {role} reference is missing.",
                    subject_ref=f"{action.action_id}:{role}:{entity_id}",
                )
            )
    return checks


def _entity_by_id(frame: PhysicalStateFrame, entity_id: str | None) -> PhysicalEntity | None:
    if entity_id is None:
        return None
    return next((entity for entity in frame.entities if entity.entity_id == entity_id), None)


def _vector_norm(values: object) -> float:
    if not isinstance(values, list | tuple):
        return 0.0
    try:
        return math.sqrt(sum(float(component) * float(component) for component in values))
    except (TypeError, ValueError):
        return 0.0


def _audit_push_contact_stability(frame: PhysicalStateFrame, actions: list[ActionToken]) -> list[ExecutabilityCheckResult]:
    checks: list[ExecutabilityCheckResult] = []
    for action in actions:
        if action.action_type != "push":
            continue
        target = _entity_by_id(frame, action.object_id)
        if target is None:
            continue
        mass_kg = target.mass_kg
        available_force = action.params.get("max_force_n")
        if not isinstance(mass_kg, int | float) or not isinstance(available_force, int | float):
            checks.append(
                _check(
                    "contact_stability",
                    False,
                    "warn",
                    "Push contact stability cannot be proven without object mass and max force.",
                    subject_ref=f"{action.action_id}:{action.object_id}",
                )
            )
            continue
        friction = target.friction if target.friction is not None else DEFAULT_CONTACT_FRICTION
        duration_s = max(
            ((action.duration_ms or DEFAULT_PUSH_DURATION_MS) / 1000.0),
            1e-3,
        )
        delta_m = _vector_norm(action.params.get("delta_xyz"))
        acceleration = (2.0 * delta_m) / (duration_s * duration_s)
        required_force = float(mass_kg) * ((9.81 * friction) + acceleration)
        passed = required_force <= float(available_force)
        checks.append(
            _check(
                "contact_stability",
                passed,
                "allow" if passed else "reject",
                "Push contact force is stable." if passed else "Predicted push exceeds stable contact force.",
                subject_ref=f"{action.action_id}:{action.object_id}",
                metrics={
                    "mass_kg": float(mass_kg),
                    "friction": friction,
                    "delta_m": delta_m,
                    "duration_s": duration_s,
                    "required_force_n": required_force,
                    "available_force_n": float(available_force),
                    "force_margin_n": float(available_force) - required_force,
                },
            )
        )
    return checks


def _audit_battery(frame: PhysicalStateFrame, actions: list[ActionToken]) -> list[ExecutabilityCheckResult]:
    checks: list[ExecutabilityCheckResult] = []
    for action in actions:
        actor = _entity_by_id(frame, action.actor_id)
        if actor is None or actor.battery is None:
            continue
        reserve = float(action.params.get("min_battery_reserve", DEFAULT_BATTERY_RESERVE))
        expected_cost = float(action.params.get("battery_cost", 0.0))
        remaining = actor.battery - expected_cost
        passed = remaining >= reserve
        checks.append(
            _check(
                "battery_reserve",
                passed,
                "allow" if passed else "reject",
                "Battery reserve is sufficient." if passed else "Action violates battery reserve.",
                subject_ref=f"{action.action_id}:{actor.entity_id}",
                metrics={
                    "battery": actor.battery,
                    "battery_cost": expected_cost,
                    "remaining_battery": remaining,
                    "min_battery_reserve": reserve,
                },
            )
        )
    return checks


def _audit_dock_availability(frame: PhysicalStateFrame, actions: list[ActionToken]) -> list[ExecutabilityCheckResult]:
    checks: list[ExecutabilityCheckResult] = []
    for action in actions:
        if action.action_type not in {"reserve_dock", "push", "navigate", "place"}:
            continue
        dock = _entity_by_id(frame, action.destination_id or action.target_id)
        if dock is None or dock.entity_type != "dock":
            continue
        status = str(dock.metadata.get("dock_status", "free"))
        reserved_by = dock.metadata.get("reserved_by")
        passed = status in {"free", "available"} or reserved_by == action.actor_id
        checks.append(
            _check(
                "dock_availability",
                passed,
                "allow" if passed else "reject",
                "Dock is available for the action." if passed else "Dock is not available for the action.",
                subject_ref=f"{action.action_id}:{dock.entity_id}",
                metrics={"dock_status": status, "reserved_by": reserved_by, "actor_id": action.actor_id},
            )
        )
    return checks


def _audit_collision_clearance(frame: PhysicalStateFrame, margin_m: float) -> list[ExecutabilityCheckResult]:
    checks: list[ExecutabilityCheckResult] = []
    collision_entities = [entity for entity in frame.entities if _collision_enabled(entity)]
    for left_index, left in enumerate(collision_entities):
        for right in collision_entities[left_index + 1:]:
            depth = _aabb_overlap_depth(left, right)
            contact_allowed = _relation_allows_contact(frame, left.entity_id, right.entity_id)
            passed = depth <= margin_m or contact_allowed
            decision = "allow" if passed else "reject"
            if depth > margin_m and contact_allowed:
                decision = "warn"
            checks.append(
                _check(
                    "collision_clearance",
                    passed,
                    decision,
                    "Collision clearance is valid." if passed else "Collision geometry overlaps without contact relation.",
                    subject_ref=f"{left.entity_id}<->{right.entity_id}",
                    metrics={"overlap_depth_m": depth, "margin_m": margin_m, "contact_allowed": contact_allowed},
                )
            )
    return checks


def _summarize(checks: list[ExecutabilityCheckResult]) -> tuple[str, int, int, int]:
    stop_count = sum(1 for check in checks if check.decision == "stop")
    reject_count = sum(1 for check in checks if check.decision == "reject")
    warn_count = sum(1 for check in checks if check.decision == "warn")
    if stop_count:
        return "stop", reject_count, warn_count, stop_count
    if reject_count:
        return "reject", reject_count, warn_count, stop_count
    if warn_count:
        return "warn", reject_count, warn_count, stop_count
    return "allow", reject_count, warn_count, stop_count


def _build_correction_branches(decision: str, actions: list[ActionToken]) -> list[CorrectionBranch]:
    if decision not in {"reject", "stop"}:
        return []
    original = actions[0] if actions else None
    return [
        CorrectionBranch(
            branch_id="reduce_delta_and_retry",
            label="Reduce action delta and retry",
            action=original.model_copy(update={"action_id": f"{original.action_id}_reduced"}) if original else None,
            expected_decision="warn",
            risk_score=0.35,
            training_value="medium",
            rationale="A smaller transition creates a nearby failure-boundary sample for post-training.",
        ),
        CorrectionBranch(
            branch_id="request_replan",
            label="Request geometric replan",
            action=None,
            expected_decision="allow",
            risk_score=0.18,
            training_value="high",
            rationale="The original rollout violates hard physical checks and should branch before export.",
        ),
    ]


def audit_physical_state_frame(
    frame: PhysicalStateFrame,
    *,
    actions: list[ActionToken] | None = None,
    collision_margin_m: float = DEFAULT_COLLISION_MARGIN_M,
) -> ExecutabilityReport:
    action_list = actions or []
    checks = [
        *_audit_entity_geometry(frame),
        *_audit_action_refs(frame, action_list),
        *_audit_push_contact_stability(frame, action_list),
        *_audit_battery(frame, action_list),
        *_audit_dock_availability(frame, action_list),
        *_audit_collision_clearance(frame, collision_margin_m),
    ]
    decision, reject_count, warn_count, stop_count = _summarize(checks)
    score = max(0.0, 1.0 - (reject_count * 0.25) - (warn_count * 0.05) - (stop_count * 0.5))
    return ExecutabilityReport(
        success=decision == "allow",
        decision=decision,  # type: ignore[arg-type]
        score=score,
        check_count=len(checks),
        reject_count=reject_count,
        warn_count=warn_count,
        stop_count=stop_count,
        checks=checks,
        correction_branches=_build_correction_branches(decision, action_list),
        metrics={
            "entity_count": len(frame.entities),
            "action_count": len(action_list),
            "collision_margin_m": collision_margin_m,
        },
    )


def audit_physical_rollout_trace(
    trace: PhysicalRolloutTrace,
    *,
    collision_margin_m: float = DEFAULT_COLLISION_MARGIN_M,
) -> ExecutabilityReport:
    checks: list[ExecutabilityCheckResult] = []
    for frame in trace.frames:
        frame_report = audit_physical_state_frame(
            frame,
            actions=trace.actions,
            collision_margin_m=collision_margin_m,
        )
        for check in frame_report.checks:
            checks.append(
                check.model_copy(
                    update={
                        "check_id": f"{check.check_id}@{frame.t_ms}",
                        "metrics": {**check.metrics, "frame_id": frame.frame_id, "t_ms": frame.t_ms},
                    }
                )
            )
    decision, reject_count, warn_count, stop_count = _summarize(checks)
    score = max(0.0, 1.0 - (reject_count * 0.25) - (warn_count * 0.05) - (stop_count * 0.5))
    return ExecutabilityReport(
        success=decision == "allow",
        decision=decision,  # type: ignore[arg-type]
        score=score,
        check_count=len(checks),
        reject_count=reject_count,
        warn_count=warn_count,
        stop_count=stop_count,
        checks=checks,
        correction_branches=_build_correction_branches(decision, trace.actions),
        metrics={
            "trace_id": trace.trace_id,
            "frame_count": len(trace.frames),
            "action_count": len(trace.actions),
            "collision_margin_m": collision_margin_m,
        },
    )
