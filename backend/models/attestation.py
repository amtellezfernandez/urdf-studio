from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import TypeAlias

from pydantic import BaseModel, Field

from backend.models.json_payload import JsonObject

AttestationGatewayDecisionPayload: TypeAlias = JsonObject


class AttestationTrustState(str, Enum):
    VERIFIED = "verified"
    STALE = "stale"
    FAILED = "failed"
    INACTIVE = "inactive"


class AttestationFindingSeverity(str, Enum):
    INFO = "info"
    WARN = "warn"
    ALERT = "alert"


class AttestationFinding(BaseModel):
    finding_type: str = Field(..., min_length=1)
    severity: AttestationFindingSeverity
    message: str = Field(..., min_length=1)
    component_id: str | None = None
    component_class: str | None = None
    evidence_source: str | None = None


class AttestationStatusUpsertRequest(BaseModel):
    robot_id: str = Field(..., min_length=1)
    verifier: str = Field(default="zra", min_length=1)
    trust_state: AttestationTrustState
    last_verified_at: datetime | None = None
    expires_at: datetime | None = None
    reason: str | None = None
    findings: list[AttestationFinding] = Field(default_factory=list)
    proof_digest: str | None = None
    public_digest: str | None = None
    metadata: dict[str, str] = Field(default_factory=dict)


class AttestationStatusResponse(BaseModel):
    robot_id: str
    verifier: str
    trust_state: AttestationTrustState
    effective_trust_state: AttestationTrustState
    control_allowed: bool
    status_explanation: str
    control_explanation: str
    override_active: bool = False
    override_reason: str | None = None
    override_expires_at: datetime | None = None
    last_verified_at: datetime | None = None
    expires_at: datetime | None = None
    reason: str | None = None
    findings: list[AttestationFinding] = Field(default_factory=list)
    proof_digest: str | None = None
    public_digest: str | None = None
    metadata: dict[str, str] = Field(default_factory=dict)
    updated_at: datetime


class AttestationSummary(BaseModel):
    robot_id: str
    effective_trust_state: AttestationTrustState
    control_allowed: bool
    status_explanation: str
    control_explanation: str
    override_active: bool = False
    override_reason: str | None = None
    override_expires_at: datetime | None = None
    reason: str | None = None
    finding_count: int = 0
    alert_count: int = 0
    top_finding: str | None = None
    updated_at: datetime
    expires_at: datetime | None = None


class AttestationOverrideRequest(BaseModel):
    ttl_seconds: int = Field(default=300, ge=1, le=3600)
    reason: str = Field(default="Operator approved demo connection.", min_length=1)


class AttestationScanTriggerRequest(BaseModel):
    reason: str = Field(default="Attestation scan started.", min_length=1)
    source: str = Field(default="publisher", min_length=1)


class ZraGatewayImportRequest(BaseModel):
    robot_id: str = Field(..., min_length=1)
    gateway_decision: AttestationGatewayDecisionPayload


class ZraGatewayPullRequest(BaseModel):
    robot_id: str = Field(..., min_length=1)
    ssh_host: str | None = None
    ssh_user: str | None = None
    ssh_password: str | None = None
    remote_gateway_path: str | None = None
    local_gateway_path: str | None = None
    timeout_seconds: int = Field(default=10, ge=1, le=120)


class ZraOrchestratorDeviceStatus(BaseModel):
    robot_id: str
    enabled: bool
    last_poll_at: datetime | None = None
    last_success_at: datetime | None = None
    last_error: str | None = None
    consecutive_failures: int = 0
    current_state: AttestationTrustState = AttestationTrustState.INACTIVE


class ZraOrchestratorStatusResponse(BaseModel):
    enabled: bool
    poll_interval_seconds: int
    inactive_after_seconds: int
    device_count: int = 0
    devices: list[ZraOrchestratorDeviceStatus] = Field(default_factory=list)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
