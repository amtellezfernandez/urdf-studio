from __future__ import annotations

from datetime import datetime
from typing import Any, TypeAlias

from backend.models.attestation import (
    AttestationGatewayDecisionPayload,
    AttestationFinding,
    AttestationFindingSeverity,
    AttestationStatusUpsertRequest,
    AttestationTrustState,
)


ZraGatewayRecord: TypeAlias = dict[str, Any]
ZraGatewayComponentReport: TypeAlias = dict[str, Any]


_FAILURE_MESSAGES = {
    "invalid_proof": "Zero-knowledge proof verification failed.",
    "component_root_mismatch": "Observed hardware root does not match the enrolled baseline.",
    "component_report_root_mismatch": "Component report hash is inconsistent with the observed hardware set.",
    "component_class_mismatch": "Observed component class differs from the enrolled baseline.",
    "missing_strict": "A required enrolled component is missing.",
    "missing_optional": "An optional enrolled component is missing.",
    "missing_enrolled_component": "An enrolled component was not observed during attestation.",
    "unexpected_blocked_class": "Unexpected blocked hardware class detected.",
    "unexpected_allowed_class": "Unexpected but policy-allowed hardware class detected.",
    "unexpected_unknown_class": "Unexpected unknown hardware class detected.",
    "unexpected_component": "Unexpected hardware component detected.",
    "missing_verified_device_authentication": "Peripheral authentication failed or is missing.",
    "camera_sensor_missing": "Camera sensor no longer matches the enrolled profile.",
    "serial_controller_missing": "Motor serial controller is missing from the enrolled USB path.",
    "software_runtime_changed": "Attested runtime software no longer matches the enrolled profile.",
    "binding_not_provided": "Proof is present but no freshness binding was supplied.",
    "binding_inputs_incomplete": "Freshness binding data is incomplete.",
    "missing_binding_public_key": "Enrollment package is missing the binding verification key.",
    "binding_payload_mismatch": "Binding payload does not match the supplied proof, public signals, or artifact.",
    "invalid_binding_signature": "Binding signature verification failed.",
    "invalid_binding_timestamps": "Binding timestamps are invalid.",
    "binding_not_yet_valid": "Binding was issued in the future.",
    "binding_expired": "Binding freshness window expired.",
    "policy_warning": "Hardware policy produced a warning condition.",
    "verified": "Hardware and sensor baseline match the enrolled profile.",
}


def _component_specific_message(failure: ZraGatewayRecord) -> str | None:
    component = str(failure.get("component") or "")
    component_class = str(
        failure.get("component_class") or failure.get("observed_component_class") or ""
    )
    if component == "software_runtime_0" or component_class == "software-runtime":
        return _FAILURE_MESSAGES["software_runtime_changed"]
    if component == "uart_device_0" or component_class == "serial-controller":
        return _FAILURE_MESSAGES["serial_controller_missing"]
    return None


def _format_expected_serial_identity(component: ZraGatewayRecord) -> str | None:
    if not isinstance(component, dict):
        return None
    evidence = component.get("evidence") or {}
    if not isinstance(evidence, dict):
        return None
    usb_vendor = str(evidence.get("usb_vendor") or "").strip()
    usb_product = str(evidence.get("usb_product") or "").strip()
    usb_serial = str(evidence.get("usb_serial") or "").strip()
    requested_path = str(
        evidence.get("requested_path") or component.get("path") or ""
    ).strip()
    if not any([usb_vendor, usb_product, usb_serial, requested_path]):
        return None
    segments = []
    if requested_path:
        segments.append(f"path {requested_path}")
    if usb_vendor or usb_product:
        segments.append(f"VID:PID {usb_vendor or '????'}:{usb_product or '????'}")
    if usb_serial:
        segments.append(f"serial {usb_serial}")
    return ", ".join(segments)


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _record_field(record: ZraGatewayRecord, field_name: str) -> ZraGatewayRecord:
    value = record.get(field_name) or {}
    return value if isinstance(value, dict) else {}


def _record_list(record: ZraGatewayRecord, field_name: str) -> list[ZraGatewayRecord]:
    value = record.get(field_name) or []
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _component_report_entries(
    component_report: ZraGatewayComponentReport,
) -> list[ZraGatewayRecord]:
    if not isinstance(component_report, dict):
        return []
    return _record_list(_record_field(component_report, "engine_report"), "components")


def _infer_trust_state(
    decision: ZraGatewayRecord,
    binding_verification: ZraGatewayRecord,
) -> AttestationTrustState:
    status = decision.get("status")
    reason = decision.get("reason")
    if status == "accept":
        return AttestationTrustState.VERIFIED
    if reason in {
        "binding_expired",
        "binding_not_yet_valid",
        "binding_not_provided",
        "binding_inputs_incomplete",
    }:
        return AttestationTrustState.STALE
    if status == "degrade":
        return AttestationTrustState.STALE
    if status == "reject":
        return AttestationTrustState.FAILED
    if binding_verification.get("ok") is False:
        return AttestationTrustState.STALE
    return AttestationTrustState.INACTIVE


def _human_message(reason: str, failure: ZraGatewayRecord) -> str:
    base = _component_specific_message(failure) or _FAILURE_MESSAGES.get(
        reason, reason.replace("_", " ")
    )
    component = failure.get("component")
    component_class = failure.get("component_class") or failure.get("observed_component_class")
    if component and component_class:
        return f"{base} Component '{component}' ({component_class})."
    if component:
        return f"{base} Component '{component}'."
    if component_class:
        return f"{base} Class '{component_class}'."
    return base


def _findings_from_gateway(
    gateway_decision: AttestationGatewayDecisionPayload,
) -> list[AttestationFinding]:
    appraisal = _record_field(gateway_decision, "component_appraisal")
    decision = _record_field(gateway_decision, "decision")
    component_report = _record_field(gateway_decision, "component_report")
    findings: list[AttestationFinding] = []

    for failure in _record_list(appraisal, "failures"):
        reason = str(failure.get("reason") or "policy_failure")
        findings.append(
            AttestationFinding(
                finding_type=reason,
                severity=AttestationFindingSeverity.ALERT,
                message=_human_message(reason, failure),
                component_id=failure.get("component"),
                component_class=failure.get("component_class")
                or failure.get("observed_component_class"),
                evidence_source="component-policy",
            )
        )

    for warning in _record_list(appraisal, "warnings"):
        reason = str(warning.get("reason") or "policy_warning")
        findings.append(
            AttestationFinding(
                finding_type=reason,
                severity=AttestationFindingSeverity.WARN,
                message=_human_message(reason, warning),
                component_id=warning.get("component"),
                component_class=warning.get("component_class")
                or warning.get("observed_component_class"),
                evidence_source="component-policy",
            )
        )

    if not findings and decision.get("status") == "accept":
        findings.append(
            AttestationFinding(
                finding_type="verified",
                severity=AttestationFindingSeverity.INFO,
                message=_FAILURE_MESSAGES["verified"],
                evidence_source="zra-gateway",
            )
        )
    elif not findings and decision.get("reason"):
        reason = str(decision.get("reason"))
        severity = (
            AttestationFindingSeverity.WARN
            if reason
            in {
                "binding_expired",
                "binding_not_yet_valid",
                "binding_not_provided",
                "binding_inputs_incomplete",
            }
            else AttestationFindingSeverity.ALERT
        )
        findings.append(
            AttestationFinding(
                finding_type=reason,
                severity=severity,
                message=_FAILURE_MESSAGES.get(reason, reason.replace("_", " ")),
                evidence_source="zra-gateway",
            )
        )

    for component in _component_report_entries(component_report):
        component_class = str(component.get("component_class") or "")
        component_id = str(component.get("id") or "")
        evidence = component.get("evidence") or {}
        if component_class == "camera-pipeline" and isinstance(evidence, dict):
            confirmed = bool(evidence.get("confirmed_camera_sensor"))
            if confirmed:
                findings.append(
                    AttestationFinding(
                        finding_type="camera_sensor_verified",
                        severity=AttestationFindingSeverity.INFO,
                        message="Camera sensor attested and matched the enrolled profile.",
                        component_id=component_id or None,
                        component_class=component_class,
                        evidence_source="component-report",
                    )
                )
            else:
                findings.append(
                    AttestationFinding(
                        finding_type="camera_sensor_missing",
                        severity=AttestationFindingSeverity.WARN,
                        message="Camera pipeline was expected but no confirmed sensor was observed.",
                        component_id=component_id or None,
                        component_class=component_class,
                        evidence_source="component-report",
                    )
                )

    return findings


def _serial_controller_metadata(component_report: ZraGatewayComponentReport) -> dict[str, str]:
    for component in _component_report_entries(component_report):
        if str(component.get("component_class") or "") != "serial-controller":
            continue
        expected_identity = _format_expected_serial_identity(component)
        if expected_identity:
            return {"expected_serial_controller": expected_identity}
    return {}


def convert_zra_gateway_to_attestation(
    *,
    robot_id: str,
    gateway_decision: AttestationGatewayDecisionPayload,
) -> AttestationStatusUpsertRequest:
    decision = _record_field(gateway_decision, "decision")
    binding_verification = _record_field(gateway_decision, "binding_verification")
    proof_verification = _record_field(gateway_decision, "proof_verification")
    findings = _findings_from_gateway(gateway_decision)
    trust_state = _infer_trust_state(decision, binding_verification)
    expires_at = None
    binding = binding_verification.get("binding")
    if isinstance(binding, dict):
        expires_at = _parse_datetime(binding.get("expires_at"))

    reason_key = str(decision.get("reason") or "")
    appraisal = _record_field(gateway_decision, "component_appraisal")
    failures = _record_list(appraisal, "failures")
    first_failure = failures[0] if failures else {}
    component_reason = _component_specific_message(first_failure) if first_failure else None
    if component_reason:
        reason = component_reason
    elif findings and (
        not reason_key
        or reason_key in {"component_root_mismatch", "policy_failure", "unexpected_component"}
    ):
        reason = findings[0].message
    else:
        reason = _FAILURE_MESSAGES.get(
            reason_key,
            reason_key.replace("_", " ") if reason_key else None,
        )

    metadata = {
        "gateway_decision_status": str(decision.get("status") or ""),
        "gateway_decision_reason": reason_key,
        "profile_name": str(gateway_decision.get("profile_name") or ""),
        "policy_name": str(gateway_decision.get("policy_name") or ""),
        "proof_verification_output": str(proof_verification.get("output") or ""),
    }
    component_report = _record_field(gateway_decision, "component_report")
    has_camera_sensor = any(
        str(component.get("component_class") or "") == "camera-pipeline"
        and isinstance(component.get("evidence"), dict)
        and bool((component.get("evidence") or {}).get("confirmed_camera_sensor"))
        for component in _component_report_entries(component_report)
    )
    if has_camera_sensor:
        metadata["sensor_summary"] = "Camera sensor attested."
    metadata.update(_serial_controller_metadata(component_report))
    metadata = {key: value for key, value in metadata.items() if value}

    return AttestationStatusUpsertRequest(
        robot_id=robot_id,
        verifier="zra-gateway",
        trust_state=trust_state,
        expires_at=expires_at,
        reason=reason,
        findings=findings,
        proof_digest=binding.get("proof_digest") if isinstance(binding, dict) else None,
        public_digest=binding.get("public_digest") if isinstance(binding, dict) else None,
        metadata=metadata,
    )
