from __future__ import annotations

import math
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


PhysicalEntityType = Literal[
    "robot",
    "object",
    "pallet",
    "dock",
    "lane",
    "zone",
    "surface",
    "target",
    "camera",
    "human",
    "tool",
    "unknown",
]
PhysicalGeometryType = Literal["box", "sphere", "cylinder", "point", "mesh", "unknown"]
PhysicalRelationType = Literal[
    "near",
    "contacts",
    "supports",
    "blocks",
    "attached",
    "contains",
    "reserved_for",
    "approaches",
    "unknown",
]
PhysicalActionType = Literal[
    "noop",
    "navigate",
    "translate",
    "push",
    "pick",
    "place",
    "move_object",
    "reserve_dock",
    "wait",
    "handoff_to_human",
    "inspect",
    "replan",
    "set_pose",
    "custom",
]
PhysicalConstraintType = Literal[
    "collision",
    "joint_limit",
    "contact",
    "contact_stability",
    "reachability",
    "battery",
    "capacity",
    "deadline",
    "temperature",
    "dock_availability",
    "scale",
    "frame",
    "custom",
]
ExecutabilityDecision = Literal["allow", "warn", "reject", "stop", "escalate"]


def _finite_vector(value: list[float], *, length: int, field_name: str) -> list[float]:
    if len(value) != length:
        raise ValueError(f"{field_name} must contain {length} values.")
    for component in value:
        if not math.isfinite(float(component)):
            raise ValueError(f"{field_name} components must be finite.")
    return [float(component) for component in value]


class PhysicalEntity(BaseModel):
    entity_id: str = Field(..., min_length=1)
    entity_type: PhysicalEntityType = "unknown"
    label: str | None = None
    geometry_type: PhysicalGeometryType = "unknown"
    position_xyz: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0])
    quat_wxyz: list[float] = Field(default_factory=lambda: [1.0, 0.0, 0.0, 0.0])
    size_xyz: list[float] | None = None
    velocity_xyz: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0])
    mass_kg: float | None = Field(default=None, gt=0)
    friction: float | None = Field(default=None, ge=0)
    battery: float | None = Field(default=None, ge=0, le=1)
    movable: bool = True
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    source_ref: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("position_xyz", "velocity_xyz")
    @classmethod
    def _validate_vector3(cls, value: list[float]) -> list[float]:
        return _finite_vector(value, length=3, field_name="vector3")

    @field_validator("quat_wxyz")
    @classmethod
    def _validate_quaternion(cls, value: list[float]) -> list[float]:
        return _finite_vector(value, length=4, field_name="quat_wxyz")

    @field_validator("size_xyz")
    @classmethod
    def _validate_size(cls, value: list[float] | None) -> list[float] | None:
        if value is None:
            return value
        parsed = _finite_vector(value, length=3, field_name="size_xyz")
        if any(component <= 0 for component in parsed):
            raise ValueError("size_xyz components must be > 0.")
        return parsed


class PhysicalRelation(BaseModel):
    source_id: str = Field(..., min_length=1)
    target_id: str = Field(..., min_length=1)
    relation_type: PhysicalRelationType = "unknown"
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ConstraintToken(BaseModel):
    constraint_id: str = Field(..., min_length=1)
    constraint_type: PhysicalConstraintType
    subject_id: str | None = None
    target_entity_ids: list[str] = Field(default_factory=list)
    severity: Literal["info", "warning", "hard"] = "hard"
    params: dict[str, Any] = Field(default_factory=dict)


class ActionToken(BaseModel):
    action_id: str = Field(..., min_length=1)
    action_type: PhysicalActionType
    actor_id: str | None = None
    object_id: str | None = None
    target_id: str | None = None
    destination_id: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    start_time_ms: int | None = Field(default=None, ge=0)
    duration_ms: int | None = Field(default=None, ge=0)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class PhysicalStateFrame(BaseModel):
    frame_id: str = Field(..., min_length=1)
    t_ms: int = Field(..., ge=0)
    frame_convention: str = Field(default="studio-y-up", min_length=1)
    entities: list[PhysicalEntity] = Field(default_factory=list)
    relations: list[PhysicalRelation] = Field(default_factory=list)
    constraints: list[ConstraintToken] = Field(default_factory=list)
    source_refs: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate_entity_refs(self) -> "PhysicalStateFrame":
        entity_ids = [entity.entity_id for entity in self.entities]
        duplicate_ids = sorted({entity_id for entity_id in entity_ids if entity_ids.count(entity_id) > 1})
        if duplicate_ids:
            raise ValueError(f"Duplicate physical entity ids: {', '.join(duplicate_ids)}")
        known_ids = set(entity_ids)
        for relation in self.relations:
            if relation.source_id not in known_ids:
                raise ValueError(f"Relation source does not exist: {relation.source_id}")
            if relation.target_id not in known_ids:
                raise ValueError(f"Relation target does not exist: {relation.target_id}")
        for constraint in self.constraints:
            if constraint.subject_id is not None and constraint.subject_id not in known_ids:
                raise ValueError(f"Constraint subject does not exist: {constraint.subject_id}")
            for target_entity_id in constraint.target_entity_ids:
                if target_entity_id not in known_ids:
                    raise ValueError(f"Constraint target does not exist: {target_entity_id}")
        return self


class PhysicalTokenSequence(BaseModel):
    frame_id: str
    text_tokens: list[str] = Field(default_factory=list)
    entity_ids: list[str] = Field(default_factory=list)
    entity_type_ids: list[int] = Field(default_factory=list)
    action_ids: list[int] = Field(default_factory=list)
    continuous_features: list[list[float]] = Field(default_factory=list)
    relation_edges: list[dict[str, Any]] = Field(default_factory=list)
    constraint_mask: dict[str, bool] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class StateActionSample(BaseModel):
    state: PhysicalStateFrame
    action: ActionToken


class PhysicalRolloutTrace(BaseModel):
    trace_id: str = Field(..., min_length=1)
    frames: list[PhysicalStateFrame] = Field(default_factory=list)
    actions: list[ActionToken] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExecutabilityCheckResult(BaseModel):
    check_id: str = Field(..., min_length=1)
    passed: bool
    decision: ExecutabilityDecision
    subject_ref: str | None = None
    message: str
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    metrics: dict[str, Any] = Field(default_factory=dict)


class CorrectionBranch(BaseModel):
    branch_id: str = Field(..., min_length=1)
    parent_trace_id: str | None = None
    label: str
    action: ActionToken | None = None
    proposed_actions: list[ActionToken] = Field(default_factory=list)
    expected_decision: ExecutabilityDecision
    expected_executability_score: float = Field(default=0.0, ge=0.0, le=1.0)
    expected_cost: float = Field(default=0.0, ge=0.0)
    risk_score: float = Field(ge=0.0, le=1.0)
    training_value: Literal["low", "medium", "high"]
    rationale: str
    tradeoffs: dict[str, Any] = Field(default_factory=dict)


class ExecutabilityReport(BaseModel):
    success: bool
    decision: ExecutabilityDecision
    score: float = Field(default=1.0, ge=0.0, le=1.0)
    check_count: int
    reject_count: int
    warn_count: int
    stop_count: int
    checks: list[ExecutabilityCheckResult] = Field(default_factory=list)
    correction_branches: list[CorrectionBranch] = Field(default_factory=list)
    metrics: dict[str, Any] = Field(default_factory=dict)


class PhysicalCompilerOutput(BaseModel):
    frame: PhysicalStateFrame
    tokens: PhysicalTokenSequence


class RepairPlan(BaseModel):
    trace_id: str
    source_decision: ExecutabilityDecision
    original_score: float = Field(ge=0.0, le=1.0)
    branches: list[CorrectionBranch] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SimulatorExportState(BaseModel):
    success: bool
    target: Literal["mujoco", "genesis"]
    branch_id: str | None = None
    output_path: str | None = None
    smoke_passed: bool
    error: str | None = None
    warnings: list[str] = Field(default_factory=list)
    metrics: dict[str, Any] = Field(default_factory=dict)
