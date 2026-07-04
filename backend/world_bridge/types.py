from __future__ import annotations

import math
from enum import Enum
from typing import TypeAlias

from pydantic import BaseModel, Field, field_validator

from backend.models.attestation import AttestationSummary
from backend.world_bridge.params import (
    DEFAULT_SCENARIO_DURATION_MS,
    MAX_CAMERAS_PER_SESSION,
    MAX_EVENTS_PER_SESSION,
    MAX_JOINTS_PER_COMMAND,
    MAX_SCENARIO_DURATION_MS,
    MIN_SCENARIO_DURATION_MS,
    TRANSITION_CONTRACT_VERSION,
    WORLD_BRIDGE_RUNTIME_MODE,
    WORLD_BRIDGE_SERVICE_NAME,
)

WorldBridgeEventPayload: TypeAlias = dict[str, object]


class WorldBridgeEventType(str, Enum):
    SESSION_CREATED = "session.created"
    JOINT_COMMAND_APPLIED = "joint_command.applied"
    SCENARIO_TIME_UPDATED = "scenario_time.updated"


class WorldBridgeTransitionType(str, Enum):
    JOINT_COMMAND = "transition.joint_command"
    SCENARIO_TIME_UPDATE = "transition.scenario_time_update"


class WorldBridgeRolloutMode(str, Enum):
    UNSPECIFIED = "unspecified"
    LIVE = "live"
    COUNTERFACTUAL = "counterfactual"


class WorldBridgeReadinessDecision(str, Enum):
    NO_GO = "no-go"
    WATCH = "watch"
    GO = "go"


class WorldBridgeEvent(BaseModel):
    event_id: str
    session_id: str
    type: WorldBridgeEventType
    timestamp_ms: int
    payload: WorldBridgeEventPayload = Field(default_factory=dict)


class WorldBridgeTransitionRecord(BaseModel):
    transition_id: str
    session_id: str
    type: WorldBridgeTransitionType
    timestamp_ms: int
    source: str
    sequence_id: int | None = None
    planner_id: str | None = None
    task_id: str | None = None
    adapter_id: str | None = None
    rollout_mode: WorldBridgeRolloutMode = WorldBridgeRolloutMode.UNSPECIFIED
    scenario_time_before_ms: int
    scenario_time_after_ms: int
    joint_state_before: dict[str, float] = Field(default_factory=dict)
    action_joint_positions: dict[str, float] = Field(default_factory=dict)
    joint_state_after: dict[str, float] = Field(default_factory=dict)


class WorldBridgeSessionCreateRequest(BaseModel):
    robot_name: str = Field(..., min_length=1, description="Robot identifier in URDF Studio.")
    urdf_sha256: str | None = Field(default=None, description="Optional URDF digest for reproducibility.")
    camera_ids: list[str] = Field(
        default_factory=list,
        max_length=MAX_CAMERAS_PER_SESSION,
        description="Optional camera ids to track in the session.",
    )
    planner_id: str | None = Field(
        default=None, min_length=1, description="Optional planner identifier for readiness telemetry."
    )
    task_id: str | None = Field(
        default=None, min_length=1, description="Optional task identifier for readiness telemetry."
    )
    adapter_id: str | None = Field(
        default=None, min_length=1, description="Optional adapter identifier for readiness telemetry."
    )
    scenario_duration_ms: int = Field(
        default=DEFAULT_SCENARIO_DURATION_MS,
        ge=MIN_SCENARIO_DURATION_MS,
        le=MAX_SCENARIO_DURATION_MS,
        description="Scenario duration for timeline clamping/looping bounds.",
    )


class WorldBridgeSessionSnapshot(BaseModel):
    session_id: str
    robot_name: str
    urdf_sha256: str | None = None
    camera_ids: list[str]
    created_at_ms: int
    updated_at_ms: int
    scenario_duration_ms: int
    scenario_time_ms: int
    joint_state: dict[str, float]
    last_command_sequence: int
    recent_events: list[WorldBridgeEvent]
    recent_transitions: list[WorldBridgeTransitionRecord]
    attestation: AttestationSummary | None = None


class WorldBridgeJointCommandRequest(BaseModel):
    joint_positions: dict[str, float] = Field(
        default_factory=dict,
        max_length=MAX_JOINTS_PER_COMMAND,
        description="Joint target map joint_name -> position.",
    )
    source: str = Field(default="urdf-studio", description="Publisher name for traceability.")
    planner_id: str | None = Field(
        default=None, min_length=1, description="Optional planner identifier for readiness telemetry."
    )
    task_id: str | None = Field(
        default=None, min_length=1, description="Optional task identifier for readiness telemetry."
    )
    adapter_id: str | None = Field(
        default=None, min_length=1, description="Optional adapter identifier for readiness telemetry."
    )
    rollout_mode: WorldBridgeRolloutMode = Field(
        default=WorldBridgeRolloutMode.UNSPECIFIED,
        description="Execution mode hint used for readiness telemetry.",
    )
    sequence_id: int | None = Field(
        default=None, ge=1, description="Optional command sequence. Runtime enforces monotonic ordering."
    )
    command_time_ms: int | None = Field(
        default=None,
        ge=0,
        description="Optional scenario time associated with this command.",
    )

    @field_validator("joint_positions")
    @classmethod
    def _validate_finite_joint_positions(cls, value: dict[str, float]) -> dict[str, float]:
        for joint_name, joint_position in value.items():
            if not math.isfinite(joint_position):
                raise ValueError(f"joint_positions[{joint_name!r}] must be finite.")
        return value


class WorldBridgeScenarioTimeUpdateRequest(BaseModel):
    source: str = Field(default="urdf-studio", description="Publisher name for traceability.")
    planner_id: str | None = Field(
        default=None, min_length=1, description="Optional planner identifier for readiness telemetry."
    )
    task_id: str | None = Field(
        default=None, min_length=1, description="Optional task identifier for readiness telemetry."
    )
    adapter_id: str | None = Field(
        default=None, min_length=1, description="Optional adapter identifier for readiness telemetry."
    )
    rollout_mode: WorldBridgeRolloutMode = Field(
        default=WorldBridgeRolloutMode.UNSPECIFIED,
        description="Execution mode hint used for readiness telemetry.",
    )
    scenario_time_ms: int = Field(..., ge=0, description="Absolute scenario time in milliseconds.")


class WorldBridgeCommandAck(BaseModel):
    session_id: str
    accepted: bool
    applied_joint_count: int
    scenario_time_ms: int
    command_sequence: int


class WorldBridgeStatusResponse(BaseModel):
    service: str = Field(default=WORLD_BRIDGE_SERVICE_NAME)
    runtime_mode: str = Field(default=WORLD_BRIDGE_RUNTIME_MODE)
    active_sessions: int
    max_events_per_session: int = Field(default=MAX_EVENTS_PER_SESSION)
    default_scenario_duration_ms: int = Field(default=DEFAULT_SCENARIO_DURATION_MS)
    transition_contract_version: str = Field(default=TRANSITION_CONTRACT_VERSION)


class WorldBridgeReadinessMetrics(BaseModel):
    total_sessions: int
    total_joint_commands: int
    total_scenario_time_updates: int
    total_transitions: int
    unique_robot_count: int
    unique_planner_count: int
    unique_task_count: int
    unique_adapter_count: int
    counterfactual_transition_count: int
    live_rollout_transition_count: int


class WorldBridgeReadinessResponse(BaseModel):
    decision: WorldBridgeReadinessDecision
    checks_passed: list[str] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)
    metrics: WorldBridgeReadinessMetrics
