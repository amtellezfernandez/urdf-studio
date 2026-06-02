from __future__ import annotations

import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.models.robot_gateway import RobotGatewayControlMode
from backend.services.teleop_replay_params import (
    TELEOP_REPLAY_DEFAULT_JOINT_TOLERANCE_RAD,
    TELEOP_REPLAY_MIN_JOINT_TOLERANCE_RAD,
    TELEOP_REPLAY_TIMING_MODE_LOGICAL,
    TELEOP_REPLAY_ZERO_MILLISECONDS,
)

TeleopReplayCommandKind = Literal[
    "twist",
    "stop",
    "estop",
    "joint_jog",
    "joint_targets",
]
TeleopReplayStateCaptureStatus = Literal["captured", "state_unavailable"]


class TeleopReplayCamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class TeleopReplayGatewayStateSnapshot(TeleopReplayCamelModel):
    robot_id: str = Field(..., min_length=1, alias="robotId")
    adapter_id: str = Field(default="", alias="adapterId")
    profile_id: str = Field(..., min_length=1, alias="profileId")
    sequence: int = Field(default=0, ge=0)
    source_ts_ms: int = Field(default=0, ge=0, alias="sourceTsMs")
    mode: RobotGatewayControlMode = "manual"
    estop: bool = False
    heartbeat_ok: bool = Field(default=True, alias="heartbeatOk")
    joint_positions_rad: dict[str, float] = Field(
        default_factory=dict,
        alias="jointPositionsRad",
    )
    gripper_positions_rad: dict[str, float] = Field(
        default_factory=dict,
        alias="gripperPositionsRad",
    )

    @field_validator("joint_positions_rad", "gripper_positions_rad")
    @classmethod
    def _validate_joint_positions(cls, value: dict[str, float]) -> dict[str, float]:
        for joint_name, joint_value in value.items():
            if not joint_name.strip():
                raise ValueError("joint name must be non-empty.")
            if not math.isfinite(joint_value):
                raise ValueError(f"joint value for {joint_name!r} must be finite.")
        return value


class TeleopReplayCommand(TeleopReplayCamelModel):
    kind: TeleopReplayCommandKind
    twist: dict[str, float] | None = None
    joint_jog: dict[str, Any] | None = Field(default=None, alias="jointJog")
    joint_targets: dict[str, float] | None = Field(default=None, alias="jointTargets")

    @field_validator("joint_targets")
    @classmethod
    def _validate_joint_targets(
        cls,
        value: dict[str, float] | None,
    ) -> dict[str, float] | None:
        if value is None:
            return value
        for joint_name, joint_value in value.items():
            if not joint_name.strip():
                raise ValueError("joint target name must be non-empty.")
            if not math.isfinite(joint_value):
                raise ValueError(f"joint target for {joint_name!r} must be finite.")
        return value


class TeleopReplayCommandMetadata(BaseModel):
    command_kind: TeleopReplayCommandKind
    sequence: int = Field(default=0, ge=0)
    source_ts_ms: int = Field(default=0, ge=0)


class TeleopReplayRecordingSample(TeleopReplayCamelModel):
    schema_version: str = Field(..., min_length=1, alias="schemaVersion")
    sample_index: int = Field(..., ge=0, alias="sampleIndex")
    command: TeleopReplayCommand
    metadata: TeleopReplayCommandMetadata
    recorded_at_ms: int = Field(..., ge=0, alias="recordedAtMs")
    context: dict[str, Any] = Field(default_factory=dict)
    state_capture_status: TeleopReplayStateCaptureStatus = Field(
        default="state_unavailable",
        alias="stateCaptureStatus",
    )
    pre_command_state: TeleopReplayGatewayStateSnapshot | None = Field(
        default=None,
        alias="preCommandState",
    )
    post_command_state: TeleopReplayGatewayStateSnapshot | None = Field(
        default=None,
        alias="postCommandState",
    )


class TeleopReplayRecording(TeleopReplayCamelModel):
    schema_version: str = Field(..., min_length=1, alias="schemaVersion")
    recording_id: str = Field(..., min_length=1, alias="recordingId")
    task_language: str = Field(default="teleoperate the robot", alias="taskLanguage")
    started_at_ms: int = Field(..., ge=0, alias="startedAtMs")
    ended_at_ms: int = Field(..., ge=0, alias="endedAtMs")
    samples: list[TeleopReplayRecordingSample] = Field(default_factory=list)
    dropped_sample_count: int = Field(default=0, ge=0, alias="droppedSampleCount")
    duration_ms: int = Field(default=0, ge=0, alias="durationMs")
    sample_count: int = Field(default=0, ge=0, alias="sampleCount")


class TeleopReplayValidateRequest(TeleopReplayCamelModel):
    recording: TeleopReplayRecording
    joint_tolerance_rad: float = Field(
        default=TELEOP_REPLAY_DEFAULT_JOINT_TOLERANCE_RAD,
        gt=TELEOP_REPLAY_MIN_JOINT_TOLERANCE_RAD,
        alias="jointToleranceRad",
    )

    @field_validator("joint_tolerance_rad")
    @classmethod
    def _validate_tolerance(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("joint tolerance must be finite.")
        return value


class TeleopReplayExportRequest(TeleopReplayValidateRequest):
    output_dir: str | None = Field(default=None, alias="outputDir")
    robot_model: dict[str, Any] | None = Field(default=None, alias="robotModel")


class TeleopReplaySampleResult(TeleopReplayCamelModel):
    sample_index: int = Field(..., alias="sampleIndex")
    command_kind: TeleopReplayCommandKind = Field(..., alias="commandKind")
    accepted: bool
    max_joint_error_rad: float = Field(..., alias="maxJointErrorRad")
    scheduled_time_ms: float = Field(
        default=TELEOP_REPLAY_ZERO_MILLISECONDS,
        ge=TELEOP_REPLAY_ZERO_MILLISECONDS,
        alias="scheduledTimeMs",
    )
    scheduled_delay_ms: float = Field(
        default=TELEOP_REPLAY_ZERO_MILLISECONDS,
        ge=TELEOP_REPLAY_ZERO_MILLISECONDS,
        alias="scheduledDelayMs",
    )
    reason: str = ""


class TeleopReplayValidationResult(TeleopReplayCamelModel):
    success: bool
    recording_id: str = Field(..., alias="recordingId")
    sample_count: int = Field(..., alias="sampleCount")
    replayed_sample_count: int = Field(..., alias="replayedSampleCount")
    max_joint_error_rad: float = Field(..., alias="maxJointErrorRad")
    joint_tolerance_rad: float = Field(..., alias="jointToleranceRad")
    timing_mode: str = Field(
        default=TELEOP_REPLAY_TIMING_MODE_LOGICAL,
        alias="timingMode",
    )
    scheduled_duration_ms: float = Field(
        default=TELEOP_REPLAY_ZERO_MILLISECONDS,
        ge=TELEOP_REPLAY_ZERO_MILLISECONDS,
        alias="scheduledDurationMs",
    )
    scheduled_sleep_ms: float = Field(
        default=TELEOP_REPLAY_ZERO_MILLISECONDS,
        ge=TELEOP_REPLAY_ZERO_MILLISECONDS,
        alias="scheduledSleepMs",
    )
    max_scheduled_delay_ms: float = Field(
        default=TELEOP_REPLAY_ZERO_MILLISECONDS,
        ge=TELEOP_REPLAY_ZERO_MILLISECONDS,
        alias="maxScheduledDelayMs",
    )
    sample_results: list[TeleopReplaySampleResult] = Field(
        default_factory=list,
        alias="sampleResults",
    )


class TeleopReplayExportResult(TeleopReplayValidationResult):
    output_path: str = Field(..., alias="outputPath")
    dataset_path: str = Field(..., alias="datasetPath")
    artifact_paths: list[str] = Field(default_factory=list, alias="artifactPaths")
    mjlab_validation: dict[str, Any] | None = Field(
        default=None,
        alias="mjlabValidation",
    )
