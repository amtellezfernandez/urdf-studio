from __future__ import annotations

from backend.models.attestation import AttestationTrustState
from backend.services.zra_attestation import convert_zra_gateway_to_attestation


def test_convert_accept_gateway_decision_to_verified_attestation() -> None:
    converted = convert_zra_gateway_to_attestation(
        robot_id="my_kiwi",
        gateway_decision={
            "profile_name": "pi-industrial-edge",
            "policy_name": "industrial-strict",
            "proof_verification": {"ok": True, "output": "OK"},
            "binding_verification": {
                "ok": True,
                "binding": {
                    "expires_at": "2026-03-08T00:30:00Z",
                    "proof_digest": "0xproof",
                    "public_digest": "0xpublic",
                },
            },
            "component_appraisal": {
                "failures": [],
                "warnings": [],
            },
            "decision": {
                "status": "accept",
                "reason": "verified",
                "failures": [],
                "warnings": [],
            },
        },
    )

    assert converted.robot_id == "my_kiwi"
    assert converted.trust_state == AttestationTrustState.VERIFIED
    assert converted.verifier == "zra-gateway"
    assert converted.proof_digest == "0xproof"
    assert converted.findings[0].finding_type == "verified"


def test_convert_reject_gateway_decision_to_failed_attestation() -> None:
    converted = convert_zra_gateway_to_attestation(
        robot_id="my_kiwi",
        gateway_decision={
            "proof_verification": {"ok": True, "output": "OK"},
            "binding_verification": {"ok": True, "binding": {}},
            "component_appraisal": {
                "failures": [
                    {
                        "reason": "unexpected_blocked_class",
                        "component": "usb_storage_0",
                        "component_class": "usb-storage",
                    }
                ],
                "warnings": [],
            },
            "decision": {
                "status": "reject",
                "reason": "unexpected_blocked_class",
                "failures": [],
                "warnings": [],
            },
        },
    )

    assert converted.trust_state == AttestationTrustState.FAILED
    assert converted.reason == "Unexpected blocked hardware class detected."
    assert converted.findings[0].severity.value == "alert"
    assert "usb_storage_0" in converted.findings[0].message


def test_convert_expired_binding_to_stale_attestation() -> None:
    converted = convert_zra_gateway_to_attestation(
        robot_id="my_kiwi",
        gateway_decision={
            "proof_verification": {"ok": True, "output": "OK"},
            "binding_verification": {"ok": False, "reason": "binding_expired"},
            "component_appraisal": {"failures": [], "warnings": []},
            "decision": {
                "status": "reject",
                "reason": "binding_expired",
                "failures": [],
                "warnings": [],
            },
        },
    )

    assert converted.trust_state == AttestationTrustState.STALE
    assert converted.reason == "Binding freshness window expired."


def test_convert_camera_sensor_drift_to_failed_attestation() -> None:
    converted = convert_zra_gateway_to_attestation(
        robot_id="my_kiwi",
        gateway_decision={
            "proof_verification": {"ok": False, "output": "proof generation failed"},
            "binding_verification": {"ok": False, "reason": "binding_not_provided"},
            "component_appraisal": {
                "failures": [
                    {
                        "reason": "camera_sensor_missing",
                        "component": "camera_pipeline_0",
                        "component_class": "camera-pipeline",
                    }
                ],
                "warnings": [],
            },
            "component_report": {
                "engine_report": {
                    "components": [
                        {
                            "id": "camera_pipeline_0",
                            "component_class": "camera-pipeline",
                            "evidence": {"confirmed_camera_sensor": False},
                        }
                    ]
                }
            },
            "decision": {
                "status": "reject",
                "reason": "camera_sensor_missing",
                "failures": [],
                "warnings": [],
            },
        },
    )

    assert converted.trust_state == AttestationTrustState.FAILED
    assert converted.reason == "Camera sensor no longer matches the enrolled profile."
    assert converted.findings[0].finding_type == "camera_sensor_missing"


def test_convert_missing_serial_controller_to_actionable_attestation() -> None:
    converted = convert_zra_gateway_to_attestation(
        robot_id="my_kiwi",
        gateway_decision={
            "proof_verification": {"ok": False, "output": "proof generation failed"},
            "binding_verification": {"ok": False, "reason": "binding_not_provided"},
            "component_appraisal": {
                "failures": [
                    {
                        "reason": "missing_enrolled_component",
                        "component": "uart_device_0",
                        "component_class": "serial-controller",
                    }
                ],
                "warnings": [],
            },
            "component_report": {
                "engine_report": {
                    "components": [
                        {
                            "id": "uart_device_0",
                            "component_class": "serial-controller",
                            "path": "/dev/ttyACM0",
                            "evidence": {
                                "requested_path": "/dev/ttyACM0",
                                "usb_vendor": "1a86",
                                "usb_product": "55d3",
                                "usb_serial": "5AAF263566",
                            },
                        }
                    ]
                }
            },
            "decision": {
                "status": "reject",
                "reason": "missing_enrolled_component",
                "failures": [],
                "warnings": [],
            },
        },
    )

    assert converted.trust_state == AttestationTrustState.FAILED
    assert converted.reason == "Motor serial controller is missing from the enrolled USB path."
    assert converted.findings[0].finding_type == "missing_enrolled_component"
    assert converted.metadata["expected_serial_controller"] == "path /dev/ttyACM0, VID:PID 1a86:55d3, serial 5AAF263566"


def test_convert_malformed_nested_gateway_sections_to_safe_attestation() -> None:
    converted = convert_zra_gateway_to_attestation(
        robot_id="my_kiwi",
        gateway_decision={
            "proof_verification": "malformed",
            "binding_verification": "malformed",
            "component_appraisal": {
                "failures": ["malformed"],
                "warnings": {"malformed": True},
            },
            "component_report": {"engine_report": "malformed"},
            "decision": {
                "status": "reject",
                "reason": "binding_expired",
            },
        },
    )

    assert converted.trust_state == AttestationTrustState.STALE
    assert converted.reason == "Binding freshness window expired."
    assert converted.findings[0].finding_type == "binding_expired"
