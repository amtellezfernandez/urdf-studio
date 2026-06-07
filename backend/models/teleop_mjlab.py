from __future__ import annotations

import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.models.teleop_replay import TeleopReplayRecording
from backend.services.teleop_mjlab_params import (
    TELEOP_MJLAB_DEFAULT_MAX_JOINT_ACCELERATION_RAD_PER_SEC2,
    TELEOP_MJLAB_DEFAULT_MAX_JOINT_VELOCITY_RAD_PER_SEC,
    TELEOP_MJLAB_DEFAULT_MAX_SELF_COLLISION_DISTANCE_M,
    TELEOP_MJLAB_DEFAULT_MAX_TIMESTAMP_GAP_MS,
    TELEOP_MJLAB_DEFAULT_REQUIRE_SELF_COLLISION_CHECK,
    TELEOP_MJLAB_DEFAULT_LIVE_STEP_MS,
    TELEOP_MJLAB_ISSUE_SEVERITY_ERROR,
    TELEOP_MJLAB_ISSUE_SEVERITY_WARNING,
    TELEOP_MJLAB_LIVE_SCHEMA_VERSION,
    TELEOP_MJLAB_ROLLOUT_SCHEMA_VERSION,
    TELEOP_MJLAB_SCHEMA_VERSION,
    TELEOP_MJLAB_DEFAULT_ROLLOUT_STEP_MS,
    TELEOP_MJLAB_ZERO_METRIC,
)

TeleopMjlabIssueSeverity = Literal[
    TELEOP_MJLAB_ISSUE_SEVERITY_ERROR,
    TELEOP_MJLAB_ISSUE_SEVERITY_WARNING,
]
TeleopMjlabFrameMap = Literal["identity", "studio-y-up-to-z-up"]


class TeleopMjlabCamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class TeleopMjlabMotionThresholds(TeleopMjlabCamelModel):
    max_joint_velocity_rad_per_sec: float = Field(
        default=TELEOP_MJLAB_DEFAULT_MAX_JOINT_VELOCITY_RAD_PER_SEC,
        gt=TELEOP_MJLAB_ZERO_METRIC,
        alias="maxJointVelocityRadPerSec",
    )
    max_joint_acceleration_rad_per_sec2: float = Field(
        default=TELEOP_MJLAB_DEFAULT_MAX_JOINT_ACCELERATION_RAD_PER_SEC2,
        gt=TELEOP_MJLAB_ZERO_METRIC,
        alias="maxJointAccelerationRadPerSec2",
    )
    max_timestamp_gap_ms: float = Field(
        default=TELEOP_MJLAB_DEFAULT_MAX_TIMESTAMP_GAP_MS,
        gt=TELEOP_MJLAB_ZERO_METRIC,
        alias="maxTimestampGapMs",
    )
    require_self_collision_check: bool = Field(
        default=TELEOP_MJLAB_DEFAULT_REQUIRE_SELF_COLLISION_CHECK,
        alias="requireSelfCollisionCheck",
    )
    max_self_collision_distance_m: float = Field(
        default=TELEOP_MJLAB_DEFAULT_MAX_SELF_COLLISION_DISTANCE_M,
        ge=TELEOP_MJLAB_ZERO_METRIC,
        alias="maxSelfCollisionDistanceM",
    )

    @field_validator(
        "max_joint_velocity_rad_per_sec",
        "max_joint_acceleration_rad_per_sec2",
        "max_timestamp_gap_ms",
        "max_self_collision_distance_m",
    )
    @classmethod
    def _validate_finite_threshold(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("MJLab motion threshold must be finite.")
        return value


class TeleopMjlabRobotMeshFile(TeleopMjlabCamelModel):
    path: str = Field(..., min_length=1)
    base64_content: str = Field(..., min_length=1, alias="base64Content")
    mime_type: str | None = Field(default=None, alias="mimeType")


class TeleopMjlabRobotModel(TeleopMjlabCamelModel):
    name: str | None = None
    urdf_xml: str | None = Field(default=None, alias="urdfXml")
    urdf_base_path: str | None = Field(default=None, alias="urdfBasePath")
    package_roots: dict[str, list[str]] = Field(
        default_factory=dict,
        alias="packageRoots",
    )
    mesh_files: list[TeleopMjlabRobotMeshFile] = Field(
        default_factory=list,
        alias="meshFiles",
    )


class TeleopMjlabValidateRequest(TeleopMjlabCamelModel):
    recording: TeleopReplayRecording
    thresholds: TeleopMjlabMotionThresholds = Field(
        default_factory=TeleopMjlabMotionThresholds
    )
    robot_model: TeleopMjlabRobotModel | None = Field(
        default=None,
        alias="robotModel",
    )


class TeleopMjlabEndEffectorSample(TeleopMjlabCamelModel):
    sample_index: int = Field(..., ge=0, alias="sampleIndex")
    timestamp_ms: float = Field(..., ge=0, alias="timestampMs")
    position_xyz: tuple[float, float, float] = Field(..., alias="positionXyz")
    quat_wxyz: tuple[float, float, float, float] = Field(..., alias="quatWxyz")
    gripper_opening_m: float = Field(..., ge=0, alias="gripperOpeningM")

    @field_validator("timestamp_ms", "gripper_opening_m")
    @classmethod
    def _validate_finite_scalar(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("MJLab rollout scalar values must be finite.")
        return value

    @field_validator("position_xyz")
    @classmethod
    def _validate_position(cls, value: tuple[float, float, float]) -> tuple[float, float, float]:
        if not all(math.isfinite(component) for component in value):
            raise ValueError("MJLab end-effector position must contain finite numbers.")
        return value

    @field_validator("quat_wxyz")
    @classmethod
    def _validate_quat(
        cls,
        value: tuple[float, float, float, float],
    ) -> tuple[float, float, float, float]:
        if not all(math.isfinite(component) for component in value):
            raise ValueError("MJLab end-effector quaternion must contain finite numbers.")
        norm = math.sqrt(sum(component * component for component in value))
        if norm <= TELEOP_MJLAB_ZERO_METRIC:
            raise ValueError("MJLab end-effector quaternion must be non-zero.")
        return value


class TeleopMjlabRolloutRequest(TeleopMjlabCamelModel):
    recording: TeleopReplayRecording
    world_layout: dict[str, Any] = Field(..., alias="worldLayout")
    end_effector_samples: list[TeleopMjlabEndEffectorSample] = Field(
        default_factory=list,
        alias="endEffectorSamples",
    )
    frame_map: TeleopMjlabFrameMap = Field(
        default="studio-y-up-to-z-up",
        alias="frameMap",
    )
    include_mjcf: bool = Field(default=False, alias="includeMjcf")
    rollout_step_ms: float = Field(
        default=TELEOP_MJLAB_DEFAULT_ROLLOUT_STEP_MS,
        gt=0,
        le=50,
        alias="rolloutStepMs",
    )

    @field_validator("rollout_step_ms")
    @classmethod
    def _validate_rollout_step_ms(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("MJLab rollout step must be finite.")
        return value


class TeleopMjlabLiveStartRequest(TeleopMjlabCamelModel):
    world_layout: dict[str, Any] = Field(..., alias="worldLayout")
    initial_end_effector_sample: TeleopMjlabEndEffectorSample = Field(
        ...,
        alias="initialEndEffectorSample",
    )
    frame_map: TeleopMjlabFrameMap = Field(
        default="studio-y-up-to-z-up",
        alias="frameMap",
    )
    include_mjcf: bool = Field(default=False, alias="includeMjcf")
    step_ms: float = Field(
        default=TELEOP_MJLAB_DEFAULT_LIVE_STEP_MS,
        gt=0,
        le=50,
        alias="stepMs",
    )

    @field_validator("step_ms")
    @classmethod
    def _validate_step_ms(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("MJLab live step must be finite.")
        return value


class TeleopMjlabLiveStepRequest(TeleopMjlabCamelModel):
    session_id: str = Field(..., min_length=1, alias="sessionId")
    end_effector_sample: TeleopMjlabEndEffectorSample = Field(
        ...,
        alias="endEffectorSample",
    )


class TeleopMjlabRuntimeDependency(TeleopMjlabCamelModel):
    name: str
    available: bool


class TeleopMjlabRuntimeStatus(TeleopMjlabCamelModel):
    runtime_name: str = Field(..., alias="runtimeName")
    available: bool
    status: str
    dependencies: list[TeleopMjlabRuntimeDependency] = Field(default_factory=list)
    accelerator_dependencies: list[TeleopMjlabRuntimeDependency] = Field(
        default_factory=list,
        alias="acceleratorDependencies",
    )


class TeleopMjlabTrajectorySample(TeleopMjlabCamelModel):
    sample_index: int = Field(..., ge=0, alias="sampleIndex")
    timestamp_ms: float = Field(..., ge=0, alias="timestampMs")
    source: str
    joint_positions_rad: dict[str, float] = Field(..., alias="jointPositionsRad")


class TeleopMjlabMotionIssue(TeleopMjlabCamelModel):
    severity: TeleopMjlabIssueSeverity
    code: str
    reason: str
    sample_index: int | None = Field(default=None, ge=0, alias="sampleIndex")
    joint_name: str | None = Field(default=None, alias="jointName")
    link_names: list[str] = Field(default_factory=list, alias="linkNames")
    value: float | None = None
    limit: float | None = None


class TeleopMjlabRolloutObjectPose(TeleopMjlabCamelModel):
    object_id: str = Field(..., alias="objectId")
    name: str
    sim_name: str = Field(..., alias="simName")
    position_xyz: tuple[float, float, float] = Field(..., alias="positionXyz")
    quat_wxyz: tuple[float, float, float, float] = Field(..., alias="quatWxyz")


class TeleopMjlabRolloutContact(TeleopMjlabCamelModel):
    sample_index: int = Field(..., ge=0, alias="sampleIndex")
    object_id: str = Field(..., alias="objectId")
    geom_names: list[str] = Field(default_factory=list, alias="geomNames")
    body_names: list[str] = Field(default_factory=list, alias="bodyNames")
    distance_m: float = Field(..., alias="distanceM")
    with_gripper: bool = Field(..., alias="withGripper")


class TeleopMjlabRolloutFrame(TeleopMjlabCamelModel):
    sample_index: int = Field(..., ge=0, alias="sampleIndex")
    timestamp_ms: float = Field(..., ge=0, alias="timestampMs")
    joint_positions_rad: dict[str, float] = Field(
        default_factory=dict,
        alias="jointPositionsRad",
    )
    object_poses: list[TeleopMjlabRolloutObjectPose] = Field(
        default_factory=list,
        alias="objectPoses",
    )
    contacts: list[TeleopMjlabRolloutContact] = Field(default_factory=list)


class TeleopMjlabLiveStartResult(TeleopMjlabCamelModel):
    success: bool
    schema_version: str = Field(
        default=TELEOP_MJLAB_LIVE_SCHEMA_VERSION,
        alias="schemaVersion",
    )
    session_id: str | None = Field(default=None, alias="sessionId")
    runtime: TeleopMjlabRuntimeStatus
    frame_map: TeleopMjlabFrameMap = Field(..., alias="frameMap")
    dynamic_object_count: int = Field(..., ge=0, alias="dynamicObjectCount")
    step_ms: float = Field(..., gt=0, alias="stepMs")
    issues: list[TeleopMjlabMotionIssue] = Field(default_factory=list)
    frame: TeleopMjlabRolloutFrame | None = None
    world_warnings: list[str] = Field(default_factory=list, alias="worldWarnings")
    mjcf_xml: str | None = Field(default=None, alias="mjcfXml")
    manifest: dict[str, object] = Field(default_factory=dict)


class TeleopMjlabLiveStepResult(TeleopMjlabCamelModel):
    success: bool
    schema_version: str = Field(
        default=TELEOP_MJLAB_LIVE_SCHEMA_VERSION,
        alias="schemaVersion",
    )
    session_id: str = Field(..., alias="sessionId")
    frame_index: int = Field(..., ge=0, alias="frameIndex")
    contact_count: int = Field(..., ge=0, alias="contactCount")
    sim_step_count: int = Field(default=0, ge=0, alias="simStepCount")
    physics_step_wall_ms: float = Field(default=0.0, ge=0, alias="physicsStepWallMs")
    realtime_factor: float = Field(default=0.0, ge=0, alias="realtimeFactor")
    issues: list[TeleopMjlabMotionIssue] = Field(default_factory=list)
    frame: TeleopMjlabRolloutFrame | None = None


class TeleopMjlabLiveStopResult(TeleopMjlabCamelModel):
    success: bool
    schema_version: str = Field(
        default=TELEOP_MJLAB_LIVE_SCHEMA_VERSION,
        alias="schemaVersion",
    )
    session_id: str = Field(..., alias="sessionId")
    released: bool


class TeleopMjlabRolloutResult(TeleopMjlabCamelModel):
    success: bool
    schema_version: str = Field(
        default=TELEOP_MJLAB_ROLLOUT_SCHEMA_VERSION,
        alias="schemaVersion",
    )
    recording_id: str = Field(..., alias="recordingId")
    runtime: TeleopMjlabRuntimeStatus
    frame_count: int = Field(..., ge=0, alias="frameCount")
    dynamic_object_count: int = Field(..., ge=0, alias="dynamicObjectCount")
    contact_count: int = Field(..., ge=0, alias="contactCount")
    frame_map: TeleopMjlabFrameMap = Field(..., alias="frameMap")
    issues: list[TeleopMjlabMotionIssue] = Field(default_factory=list)
    trajectory: list[TeleopMjlabTrajectorySample] = Field(default_factory=list)
    frames: list[TeleopMjlabRolloutFrame] = Field(default_factory=list)
    world_warnings: list[str] = Field(default_factory=list, alias="worldWarnings")
    mjcf_xml: str | None = Field(default=None, alias="mjcfXml")
    manifest: dict[str, object] = Field(default_factory=dict)


class TeleopMjlabValidationResult(TeleopMjlabCamelModel):
    success: bool
    schema_version: str = Field(
        default=TELEOP_MJLAB_SCHEMA_VERSION,
        alias="schemaVersion",
    )
    recording_id: str = Field(..., alias="recordingId")
    runtime: TeleopMjlabRuntimeStatus
    sample_count: int = Field(..., ge=0, alias="sampleCount")
    trajectory_sample_count: int = Field(..., ge=0, alias="trajectorySampleCount")
    joint_names: list[str] = Field(default_factory=list, alias="jointNames")
    duration_ms: float = Field(..., ge=0, alias="durationMs")
    max_joint_velocity_rad_per_sec: float = Field(
        ...,
        ge=0,
        alias="maxJointVelocityRadPerSec",
    )
    max_joint_acceleration_rad_per_sec2: float = Field(
        ...,
        ge=0,
        alias="maxJointAccelerationRadPerSec2",
    )
    max_timestamp_gap_ms: float = Field(..., ge=0, alias="maxTimestampGapMs")
    self_collision_checked: bool = Field(..., alias="selfCollisionChecked")
    self_collision_sample_count: int = Field(
        ...,
        ge=0,
        alias="selfCollisionSampleCount",
    )
    self_collision_count: int = Field(..., ge=0, alias="selfCollisionCount")
    thresholds: TeleopMjlabMotionThresholds
    issues: list[TeleopMjlabMotionIssue] = Field(default_factory=list)
    trajectory: list[TeleopMjlabTrajectorySample] = Field(default_factory=list)
    manifest: dict[str, object] = Field(default_factory=dict)
