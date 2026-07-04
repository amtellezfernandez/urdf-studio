from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from threading import Lock

from backend.models.attestation import (
    AttestationFinding,
    AttestationFindingSeverity,
    AttestationOverrideRequest,
    AttestationScanTriggerRequest,
    AttestationStatusResponse,
    AttestationStatusUpsertRequest,
    AttestationSummary,
    AttestationTrustState,
    utc_now,
)


def _effective_trust_state(
    trust_state: AttestationTrustState,
    expires_at: datetime | None,
) -> AttestationTrustState:
    if trust_state == AttestationTrustState.VERIFIED and expires_at is not None:
        if expires_at <= utc_now():
            return AttestationTrustState.STALE
    return trust_state


def _control_allowed(effective_trust_state: AttestationTrustState) -> bool:
    return effective_trust_state == AttestationTrustState.VERIFIED


def _top_finding_message(payload: AttestationStatusUpsertRequest) -> str | None:
    alert_findings = [
        finding.message
        for finding in payload.findings
        if finding.severity == AttestationFindingSeverity.ALERT
    ]
    if alert_findings:
        return alert_findings[0]
    if payload.findings:
        return payload.findings[0].message
    return None


def _alert_prefix(message: str, effective_state: AttestationTrustState) -> str:
    if effective_state == AttestationTrustState.VERIFIED:
        return message
    if message.upper().startswith("ALERT"):
        return message
    return f"ALERT: {message}"


def _status_explanation(
    payload: AttestationStatusUpsertRequest,
    effective_state: AttestationTrustState,
) -> str:
    top_finding = _top_finding_message(payload)
    if effective_state == AttestationTrustState.VERIFIED:
        return (
            payload.reason
            or top_finding
            or "Hardware and sensor baseline match the enrolled profile."
        )
    if effective_state == AttestationTrustState.STALE:
        return _alert_prefix(
            payload.reason or "Attestation was previously valid but the freshness window expired.",
            effective_state,
        )
    if effective_state == AttestationTrustState.FAILED:
        return _alert_prefix(
            payload.reason or top_finding or "Attestation failed policy evaluation.",
            effective_state,
        )
    return _alert_prefix(
        payload.reason or "No recent attestation has been published for this robot.",
        effective_state,
    )


def _control_explanation(
    effective_state: AttestationTrustState,
    override_active: bool,
    override_reason: str | None,
) -> str:
    if override_active:
        if override_reason:
            return f"Operator override is active. {override_reason}"
        return "Operator override is active. Connection is allowed temporarily."
    if effective_state == AttestationTrustState.VERIFIED:
        return "Connection allowed because the enrolled hardware profile is verified."
    if effective_state == AttestationTrustState.STALE:
        return "ALERT: Connection blocked because the attestation freshness window expired."
    if effective_state == AttestationTrustState.FAILED:
        return "ALERT: Connection blocked because attestation policy checks failed."
    return "ALERT: Connection blocked because no attestation is available yet."


@dataclass
class _StoredAttestationStatus:
    payload: AttestationStatusUpsertRequest
    updated_at: datetime
    override_expires_at: datetime | None = None
    override_reason: str | None = None


class AttestationStatusStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._statuses: dict[str, _StoredAttestationStatus] = {}

    def upsert(self, request: AttestationStatusUpsertRequest) -> AttestationStatusResponse:
        with self._lock:
            stored = _StoredAttestationStatus(
                payload=request,
                updated_at=utc_now(),
            )
            self._statuses[request.robot_id] = stored
            return self._to_response(stored)

    def get(self, robot_id: str) -> AttestationStatusResponse | None:
        with self._lock:
            stored = self._statuses.get(robot_id)
            if stored is None:
                return None
            return self._to_response(stored)

    def list(self) -> list[AttestationStatusResponse]:
        with self._lock:
            return [
                self._to_response(stored)
                for _, stored in sorted(self._statuses.items(), key=lambda item: item[0])
            ]

    def summary(self, robot_id: str) -> AttestationSummary | None:
        with self._lock:
            stored = self._statuses.get(robot_id)
            if stored is None:
                return None
            return self._to_summary(stored)

    def allow_connection(
        self,
        robot_id: str,
        request: AttestationOverrideRequest,
    ) -> AttestationStatusResponse | None:
        with self._lock:
            stored = self._statuses.get(robot_id)
            if stored is None:
                return None
            now = utc_now()
            stored.override_expires_at = now + timedelta(seconds=request.ttl_seconds)
            stored.override_reason = request.reason
            stored.updated_at = now
            return self._to_response(stored)

    def mark_scan_triggered(
        self,
        robot_id: str,
        request: AttestationScanTriggerRequest,
    ) -> AttestationStatusResponse | None:
        with self._lock:
            stored = self._statuses.get(robot_id)
            now = utc_now()
            if stored is None:
                stored = _StoredAttestationStatus(
                    payload=AttestationStatusUpsertRequest(
                        robot_id=robot_id,
                        verifier="zra-gateway",
                        trust_state=AttestationTrustState.INACTIVE,
                        reason=request.reason,
                        findings=[
                            AttestationFinding(
                                finding_type="scan_triggered",
                                severity=AttestationFindingSeverity.WARN,
                                message=request.reason,
                                evidence_source=request.source,
                            )
                        ],
                    ),
                    updated_at=now,
                )
                self._statuses[robot_id] = stored
            metadata = dict(stored.payload.metadata)
            metadata["scan_state"] = "triggered"
            metadata["scan_reason"] = request.reason
            metadata["scan_source"] = request.source
            metadata["scan_triggered_at"] = now.isoformat()
            stored.payload = stored.payload.model_copy(update={"metadata": metadata})
            stored.updated_at = now
            return self._to_response(stored)

    def _to_response(
        self,
        stored: _StoredAttestationStatus,
    ) -> AttestationStatusResponse:
        payload = stored.payload
        effective_state = _effective_trust_state(payload.trust_state, payload.expires_at)
        override_active = (
            stored.override_expires_at is not None and stored.override_expires_at > utc_now()
        )
        control_allowed = override_active or _control_allowed(effective_state)
        return AttestationStatusResponse(
            robot_id=payload.robot_id,
            verifier=payload.verifier,
            trust_state=payload.trust_state,
            effective_trust_state=effective_state,
            control_allowed=control_allowed,
            status_explanation=_status_explanation(payload, effective_state),
            control_explanation=_control_explanation(
                effective_state, override_active, stored.override_reason
            ),
            override_active=override_active,
            override_reason=stored.override_reason,
            override_expires_at=stored.override_expires_at,
            last_verified_at=payload.last_verified_at,
            expires_at=payload.expires_at,
            reason=payload.reason,
            findings=payload.findings,
            proof_digest=payload.proof_digest,
            public_digest=payload.public_digest,
            metadata=payload.metadata,
            updated_at=stored.updated_at,
        )

    def _to_summary(self, stored: _StoredAttestationStatus) -> AttestationSummary:
        response = self._to_response(stored)
        alert_findings = [
            finding for finding in response.findings if finding.severity == AttestationFindingSeverity.ALERT
        ]
        top_finding = _top_finding_message(stored.payload)
        return AttestationSummary(
            robot_id=response.robot_id,
            effective_trust_state=response.effective_trust_state,
            control_allowed=response.control_allowed,
            status_explanation=response.status_explanation,
            control_explanation=response.control_explanation,
            override_active=response.override_active,
            override_reason=response.override_reason,
            override_expires_at=response.override_expires_at,
            reason=response.reason,
            finding_count=len(response.findings),
            alert_count=len(alert_findings),
            top_finding=top_finding,
            updated_at=response.updated_at,
            expires_at=response.expires_at,
        )


attestation_status_store = AttestationStatusStore()
