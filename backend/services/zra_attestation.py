from __future__ import annotations

from datetime import datetime
from typing import TypeAlias

from backend.models.attestation import (
    AttestationGatewayDecisionPayload,
    AttestationFinding,
    AttestationFindingSeverity,
    AttestationStatusUpsertRequest,
    AttestationTrustState,
)
from backend.models.json_payload import JsonObject, JsonValue


ZraGatewayRecord: TypeAlias = JsonObject
ZraGatewayComponentReport: TypeAlias = JsonObject


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


def _string_field(record: ZraGatewayRecord, field_name: str) -> str:
    value = record.get(field_name)
    return value if isinstance(value, str) else ""


def _first_string_field(record: ZraGatewayRecord, *field_names: str) -> str:
    for field_name in field_names:
        value = _string_field(record, field_name)
        if value:
            return value
    return ""


def _optional_string_field(record: ZraGatewayRecord, *field_names: str) -> str | None:
    value = _first_string_field(record, *field_names)
    return value or None


def _boolean_field(record: ZraGatewayRecord, field_name: str) -> bool:
    value = record.get(field_name)
    return value if isinstance(value, bool) else False


def _component_specific_message(failure: ZraGatewayRecord) -> str | None:
    component = _string_field(failure, "component")
    component_class = _first_string_field(
        failure, "component_class", "observed_component_class"
    )
    if component == "software_runtime_0" or component_class == "software-runtime":
        return _FAILURE_MESSAGES["software_runtime_changed"]
    if component == "uart_device_0" or component_class == "serial-controller":
        return _FAILURE_MESSAGES["serial_controller_missing"]
    return None


def _format_expected_serial_identity(component: ZraGatewayRecord) -> str | None:
    evidence = _record_field(component, "evidence")
    usb_vendor = _string_field(evidence, "usb_vendor").strip()
    usb_product = _string_field(evidence, "usb_product").strip()
    usb_serial = _string_field(evidence, "usb_serial").strip()
    requested_path = (
        _string_field(evidence, "requested_path") or _string_field(component, "path")
    ).strip()
    if not any([usb_vendor, usb_product, usb_serial, requested_path]):
        return None
    segments: list[str] = []
    if requested_path:
        segments.append(f"path {requested_path}")
    if usb_vendor or usb_product:
        segments.append(f"VID:PID {usb_vendor or '????'}:{usb_product or '????'}")
    if usb_serial:
        segments.append(f"serial {usb_serial}")
    return ", ".join(segments)


def _parse_datetime(value: JsonValue) -> datetime | None:
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
    status = _string_field(decision, "status")
    reason = _string_field(decision, "reason")
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
    component = _optional_string_field(failure, "component")
    component_class = _optional_string_field(
        failure, "component_class", "observed_component_class"
    )
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
        reason = _string_field(failure, "reason") or "policy_failure"
        findings.append(
            AttestationFinding(
                finding_type=reason,
                severity=AttestationFindingSeverity.ALERT,
                message=_human_message(reason, failure),
                component_id=_optional_string_field(failure, "component"),
                component_class=_optional_string_field(
                    failure, "component_class", "observed_component_class"
                ),
                evidence_source="component-policy",
            )
        )

    for warning in _record_list(appraisal, "warnings"):
        reason = _string_field(warning, "reason") or "policy_warning"
        findings.append(
            AttestationFinding(
                finding_type=reason,
                severity=AttestationFindingSeverity.WARN,
                message=_human_message(reason, warning),
                component_id=_optional_string_field(warning, "component"),
                component_class=_optional_string_field(
                    warning, "component_class", "observed_component_class"
                ),
                evidence_source="component-policy",
            )
        )

    decision_status = _string_field(decision, "status")
    decision_reason = _string_field(decision, "reason")
    if not findings and decision_status == "accept":
        findings.append(
            AttestationFinding(
                finding_type="verified",
                severity=AttestationFindingSeverity.INFO,
                message=_FAILURE_MESSAGES["verified"],
                evidence_source="zra-gateway",
            )
        )
    elif not findings and decision_reason:
        reason = decision_reason
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
        component_class = _string_field(component, "component_class")
        component_id = _optional_string_field(component, "id")
        evidence = _record_field(component, "evidence")
        if component_class == "camera-pipeline":
            confirmed = _boolean_field(evidence, "confirmed_camera_sensor")
            if confirmed:
                findings.append(
                    AttestationFinding(
                        finding_type="camera_sensor_verified",
                        severity=AttestationFindingSeverity.INFO,
                        message="Camera sensor attested and matched the enrolled profile.",
                        component_id=component_id,
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
                        component_id=component_id,
                        component_class=component_class,
                        evidence_source="component-report",
                    )
                )

    return findings


def _serial_controller_metadata(component_report: ZraGatewayComponentReport) -> dict[str, str]:
    for component in _component_report_entries(component_report):
        if _string_field(component, "component_class") != "serial-controller":
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
    binding = _record_field(binding_verification, "binding")
    expires_at = _parse_datetime(binding.get("expires_at"))

    reason_key = _string_field(decision, "reason")
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
        "gateway_decision_status": _string_field(decision, "status"),
        "gateway_decision_reason": reason_key,
        "profile_name": _string_field(gateway_decision, "profile_name"),
        "policy_name": _string_field(gateway_decision, "policy_name"),
        "proof_verification_output": _string_field(proof_verification, "output"),
    }
    component_report = _record_field(gateway_decision, "component_report")
    has_camera_sensor = any(
        _string_field(component, "component_class") == "camera-pipeline"
        and _boolean_field(_record_field(component, "evidence"), "confirmed_camera_sensor")
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
        proof_digest=_optional_string_field(binding, "proof_digest"),
        public_digest=_optional_string_field(binding, "public_digest"),
        metadata=metadata,
    )
