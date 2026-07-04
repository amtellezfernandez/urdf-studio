from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, TypeAlias

from pydantic import BaseModel, Field, field_validator

from backend.models.world_scene_package import WorldScenePackageManifest
from backend.services.world_rollout_params import (
    WORLD_ROLLOUT_CAMPAIGN_SCHEMA_VERSION,
    WORLD_ROLLOUT_CHECKER_PROFILE_SCHEMA_VERSION,
    WORLD_ROLLOUT_DECISIONS,
    WORLD_ROLLOUT_DECISION_ESCALATE,
    WORLD_ROLLOUT_DECISION_REJECT,
    WORLD_ROLLOUT_DECISION_STOP,
    WORLD_ROLLOUT_DECISION_WARN,
    WORLD_ROLLOUT_DEFAULT_RUNNER_KIND,
    WORLD_ROLLOUT_MAX_ARTIFACT_REFS,
    WORLD_ROLLOUT_MAX_DECISION_RECORDS,
    WORLD_ROLLOUT_MAX_MODULE_SPECS,
    WORLD_ROLLOUT_MAX_NDJSON_BYTES,
    WORLD_ROLLOUT_MAX_TRACE_RECORDS,
)
from backend.services.world_scene_package_params import SHA256_HEX_LENGTH

WorldRolloutPayload: TypeAlias = dict[str, Any]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class WorldRolloutJobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class WorldRolloutArtifactRef(BaseModel):
    kind: str = Field(..., min_length=1)
    uri: str = Field(..., min_length=1)
    digest_sha256: str | None = Field(
        default=None,
        min_length=SHA256_HEX_LENGTH,
        max_length=SHA256_HEX_LENGTH,
        pattern="^[a-fA-F0-9]{64}$",
    )
    metadata: WorldRolloutPayload = Field(default_factory=dict)


class WorldRolloutModuleSpec(BaseModel):
    module_id: str = Field(..., min_length=1)
    tier: str = Field(..., min_length=1)
    role: str = Field(..., min_length=1)
    trigger: str | None = None
    latency_budget_ms: float | None = Field(default=None, gt=0)
    params: WorldRolloutPayload = Field(default_factory=dict)


class WorldRolloutCheckerProfile(BaseModel):
    schema_version: str = Field(default=WORLD_ROLLOUT_CHECKER_PROFILE_SCHEMA_VERSION)
    profile_id: str = Field(..., min_length=1)
    target_id: str = Field(..., min_length=1)
    description: str | None = None
    params: WorldRolloutPayload = Field(default_factory=dict)
    modules: list[WorldRolloutModuleSpec] = Field(
        default_factory=list,
        max_length=WORLD_ROLLOUT_MAX_MODULE_SPECS,
    )
    artifacts: list[WorldRolloutArtifactRef] = Field(
        default_factory=list,
        max_length=WORLD_ROLLOUT_MAX_ARTIFACT_REFS,
    )

    @field_validator("schema_version")
    @classmethod
    def _validate_schema_version(cls, value: str) -> str:
        if value != WORLD_ROLLOUT_CHECKER_PROFILE_SCHEMA_VERSION:
            raise ValueError(
                f"schema_version must be {WORLD_ROLLOUT_CHECKER_PROFILE_SCHEMA_VERSION}"
            )
        return value


class WorldRolloutPackageRef(BaseModel):
    package_id: str = Field(..., min_length=1)
    version: str = Field(..., min_length=1)
    digest_sha256: str | None = Field(
        default=None,
        min_length=SHA256_HEX_LENGTH,
        max_length=SHA256_HEX_LENGTH,
        pattern="^[a-fA-F0-9]{64}$",
    )


class WorldRolloutRunnerSpec(BaseModel):
    kind: str = Field(default=WORLD_ROLLOUT_DEFAULT_RUNNER_KIND, min_length=1)
    tool: str | None = None
    params: WorldRolloutPayload = Field(default_factory=dict)


class WorldRolloutCampaignManifest(BaseModel):
    schema_version: str = Field(default=WORLD_ROLLOUT_CAMPAIGN_SCHEMA_VERSION)
    campaign_id: str = Field(..., min_length=1)
    created_at: datetime = Field(default_factory=_utc_now)
    world_package: WorldRolloutPackageRef
    checker_profile: WorldRolloutCheckerProfile
    rollout_params: WorldRolloutPayload = Field(default_factory=dict)
    runner: WorldRolloutRunnerSpec = Field(default_factory=WorldRolloutRunnerSpec)
    artifacts: list[WorldRolloutArtifactRef] = Field(
        default_factory=list,
        max_length=WORLD_ROLLOUT_MAX_ARTIFACT_REFS,
    )

    @field_validator("schema_version")
    @classmethod
    def _validate_schema_version(cls, value: str) -> str:
        if value != WORLD_ROLLOUT_CAMPAIGN_SCHEMA_VERSION:
            raise ValueError(f"schema_version must be {WORLD_ROLLOUT_CAMPAIGN_SCHEMA_VERSION}")
        return value


class WorldRolloutTraceRecord(BaseModel):
    t_ms: int = Field(..., ge=0)
    stream: str = Field(default="state", min_length=1)
    module_id: str | None = None
    tier: str | None = None
    state: WorldRolloutPayload = Field(default_factory=dict)
    semantic_outputs: WorldRolloutPayload = Field(default_factory=dict)
    metadata: WorldRolloutPayload = Field(default_factory=dict)


class WorldRolloutDecisionRecord(BaseModel):
    t_ms: int | None = Field(default=None, ge=0)
    module_id: str | None = None
    tier: str | None = None
    subject_ref: str | None = None
    decision: str
    rule_id: str = Field(..., min_length=1)
    message: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    metrics: WorldRolloutPayload = Field(default_factory=dict)
    semantic_outputs: WorldRolloutPayload = Field(default_factory=dict)
    metadata: WorldRolloutPayload = Field(default_factory=dict)

    @field_validator("decision")
    @classmethod
    def _validate_decision(cls, value: str) -> str:
        if value not in WORLD_ROLLOUT_DECISIONS:
            raise ValueError(
                "decision must be allow, warn, reject, stop, or escalate."
            )
        return value


class WorldRolloutJobCreateRequest(BaseModel):
    world_package: WorldScenePackageManifest
    checker_profile: WorldRolloutCheckerProfile
    campaign_id: str | None = Field(default=None, min_length=1)
    rollout_params: WorldRolloutPayload = Field(default_factory=dict)
    runner_params: WorldRolloutPayload = Field(default_factory=dict)


class WorldRolloutJobResponse(BaseModel):
    job_id: str
    status: WorldRolloutJobStatus
    created_at: datetime
    updated_at: datetime
    campaign: WorldRolloutCampaignManifest
    output_manifest_path: str | None = None
    trace_record_count: int = 0
    decision_count: int = 0
    reject_count: int = 0
    warn_count: int = 0
    stop_count: int = 0
    escalation_count: int = 0
    error: str | None = None
    stdout: str | None = None
    stderr: str | None = None


class WorldRolloutImportRequest(BaseModel):
    campaign: WorldRolloutCampaignManifest
    trace_ndjson: str = Field(default="")
    decisions_ndjson: str = Field(default="")

    @field_validator("trace_ndjson", "decisions_ndjson")
    @classmethod
    def _validate_ndjson_size(cls, value: str) -> str:
        if len(value.encode("utf-8")) > WORLD_ROLLOUT_MAX_NDJSON_BYTES:
            raise ValueError("NDJSON payload exceeds the world rollout import limit.")
        return value


class WorldRolloutImportResponse(BaseModel):
    campaign: WorldRolloutCampaignManifest
    trace_records: list[WorldRolloutTraceRecord] = Field(
        default_factory=list,
        max_length=WORLD_ROLLOUT_MAX_TRACE_RECORDS,
    )
    decisions: list[WorldRolloutDecisionRecord] = Field(
        default_factory=list,
        max_length=WORLD_ROLLOUT_MAX_DECISION_RECORDS,
    )
    trace_record_count: int
    decision_count: int
    reject_count: int
    warn_count: int
    stop_count: int
    escalation_count: int
