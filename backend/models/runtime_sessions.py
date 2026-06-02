from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


RuntimeProviderCapability = Literal[
    "observe",
    "record",
    "replay",
    "video",
    "logs",
    "frames",
    "commands",
]
RuntimeProviderStreamFormat = Literal["json", "arrow_ipc"]
RuntimeProviderSessionState = Literal["pending", "approved", "connected", "disconnected"]
RuntimeProviderRecordingState = Literal["idle", "recording"]


class RuntimeTelemetryChannelSnapshot(BaseModel):
    channel_id: str | int
    name: str = ""
    source_id: str = ""
    stream_kind: str | int
    drop_policy: str | None = None


class RuntimeTelemetryChannelsUpsertRequest(BaseModel):
    channels: list[RuntimeTelemetryChannelSnapshot] = Field(default_factory=list)


class RuntimeTelemetryChannelsResponse(BaseModel):
    channels: list[RuntimeTelemetryChannelSnapshot] = Field(default_factory=list)


class RuntimeVideoRefSnapshot(BaseModel):
    stream_id: str
    channel_name: str = ""
    source_id: str = ""
    codec: str = ""
    width: int = 0
    height: int = 0
    nominal_fps: int | float = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


class RuntimeVideoRefsUpsertRequest(BaseModel):
    video_refs: list[RuntimeVideoRefSnapshot] = Field(default_factory=list)


class RuntimeVideoRefsResponse(BaseModel):
    video_refs: list[RuntimeVideoRefSnapshot] = Field(default_factory=list)


class RuntimeTelemetryEnvelope(BaseModel):
    sequence: str | int | None = None
    channel_id: str | int | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class RuntimeTelemetryIngestRequest(BaseModel):
    active_transport: str | None = None
    envelopes: list[RuntimeTelemetryEnvelope] = Field(default_factory=list)


class RuntimeTelemetryFramesResponse(BaseModel):
    frames: list[dict[str, Any]] = Field(default_factory=list)


class RuntimeCommandRequest(BaseModel):
    command_type: str = "generic"
    payload: dict[str, Any] = Field(default_factory=dict)


class RuntimeSessionStatsResponse(BaseModel):
    active_transport: str | None = None
    total_ingested: int = 0
    total_dropped: int = 0
    drop_reasons: dict[str, int] = Field(default_factory=dict)
    total_buffered_bytes: int = 0
    total_buffered_messages: int = 0
    command_total: int = 0
    ack_total: int = 0
    channels: int = 0


class RuntimeProviderSessionRequest(BaseModel):
    provider_id: str
    provider_display_name: str = ""
    requested_capabilities: list[RuntimeProviderCapability] = Field(default_factory=list)
    preferred_formats: list[RuntimeProviderStreamFormat] = Field(default_factory=lambda: ["json"])
    connector_origin: str = ""
    connector_version: str = ""


class RuntimeProviderApprovalRequest(BaseModel):
    approved_capabilities: list[RuntimeProviderCapability] | None = None
    granted_formats: list[RuntimeProviderStreamFormat] | None = None


class RuntimeProviderAuditEventSnapshot(BaseModel):
    sequence: int
    occurred_at: str
    event_type: str
    actor: Literal["operator", "connector", "system"]
    message: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class RuntimeProviderRobotSource(BaseModel):
    source_type: Literal["inline_urdf", "github", "url"]
    uri: str | None = None
    urdf_xml: str | None = None
    sha256: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RuntimeProviderRobotDescriptionRequest(BaseModel):
    robot_id: str
    robot_display_name: str = ""
    source: RuntimeProviderRobotSource
    joint_names: list[str] = Field(default_factory=list)
    frame_names: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class RuntimeProviderSessionSnapshot(BaseModel):
    session_id: str
    state: RuntimeProviderSessionState
    provider_id: str
    provider_display_name: str = ""
    requested_capabilities: list[RuntimeProviderCapability] = Field(default_factory=list)
    approved_capabilities: list[RuntimeProviderCapability] = Field(default_factory=list)
    preferred_formats: list[RuntimeProviderStreamFormat] = Field(default_factory=list)
    granted_formats: list[RuntimeProviderStreamFormat] = Field(default_factory=list)
    connector_origin: str = ""
    connector_version: str = ""
    requested_at: str
    approved_at: str | None = None
    connected_at: str | None = None
    disconnected_at: str | None = None
    recording_state: RuntimeProviderRecordingState = "idle"
    recording_started_at: str | None = None
    recording_label: str | None = None
    requires_session_token: bool = False
    robot_id: str | None = None
    robot_display_name: str | None = None
    robot_description_available: bool = False
    audit_events: list[RuntimeProviderAuditEventSnapshot] = Field(default_factory=list)


class RuntimeProviderSessionRequestResponse(RuntimeProviderSessionSnapshot):
    connector_claim_token: str


class RuntimeProviderApprovalResponse(RuntimeProviderSessionSnapshot):
    session_token: str


class RuntimeProviderClaimRequest(BaseModel):
    connector_claim_token: str


class RuntimeProviderClaimResponse(BaseModel):
    state: RuntimeProviderSessionState
    session_token: str | None = None


class RuntimeProviderRecordingRequest(BaseModel):
    label: str = ""
