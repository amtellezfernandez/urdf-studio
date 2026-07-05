from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from pathlib import Path

from backend.tests.asgi_test_client import AsgiTestClient
import pytest

from backend.app import create_app
from backend.models.attestation import (
    AttestationFindingSeverity,
    AttestationTrustState,
    utc_now,
)
from backend.services.attestation import attestation_status_store


TEST_ROBOT_ID = "my_kiwi"
TEST_PROOF_DIGEST = "0xabc123"
LOCAL_TEST_CLIENT = ("127.0.0.1", 50000)


def _local_client() -> AsgiTestClient:
    return AsgiTestClient(create_app(), client=LOCAL_TEST_CLIENT)


def test_attestation_status_round_trip() -> None:
    client = _local_client()
    expires_at = (utc_now() + timedelta(minutes=5)).isoformat()
    response = client.post(
        "/attestation/status",
        json={
            "robot_id": TEST_ROBOT_ID,
            "verifier": "zra",
            "trust_state": AttestationTrustState.VERIFIED.value,
            "expires_at": expires_at,
            "proof_digest": TEST_PROOF_DIGEST,
            "findings": [
                {
                    "finding_type": "usb_inventory",
                    "severity": AttestationFindingSeverity.INFO.value,
                    "message": "All enrolled components match baseline.",
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["robot_id"] == TEST_ROBOT_ID
    assert payload["effective_trust_state"] == AttestationTrustState.VERIFIED.value
    assert payload["control_allowed"] is True
    assert payload["proof_digest"] == TEST_PROOF_DIGEST
    assert "baseline" in payload["status_explanation"].lower() or payload["status_explanation"]
    assert "allowed" in payload["control_explanation"].lower()

    summary = client.get(f"/attestation/summary/{TEST_ROBOT_ID}")
    assert summary.status_code == 200
    summary_payload = summary.json()
    assert summary_payload["robot_id"] == TEST_ROBOT_ID
    assert summary_payload["control_allowed"] is True
    assert summary_payload["top_finding"] == "All enrolled components match baseline."


def test_attestation_summary_marks_expired_verification_as_stale() -> None:
    client = _local_client()
    expired_at = (utc_now() - timedelta(seconds=30)).isoformat()

    response = client.post(
        "/attestation/status",
        json={
            "robot_id": "stale_bot",
            "verifier": "zra",
            "trust_state": AttestationTrustState.VERIFIED.value,
            "expires_at": expired_at,
            "reason": "Session binding expired.",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["effective_trust_state"] == AttestationTrustState.STALE.value
    assert payload["control_allowed"] is False


def test_allow_connection_override_enables_control_temporarily() -> None:
    client = _local_client()
    response = client.post(
        "/attestation/status",
        json={
            "robot_id": "override_bot",
            "verifier": "zra",
            "trust_state": AttestationTrustState.FAILED.value,
            "reason": "Unexpected USB device inserted.",
            "findings": [
                {
                    "finding_type": "usb_inventory",
                    "severity": AttestationFindingSeverity.ALERT.value,
                    "message": "Unexpected USB storage device detected on bus 1-1.2.",
                }
            ],
        },
    )
    assert response.status_code == 200
    assert response.json()["control_allowed"] is False

    override_response = client.post(
        "/attestation/status/override_bot/allow",
        json={"ttl_seconds": 120, "reason": "Operator approved demo connection."},
    )
    assert override_response.status_code == 200
    payload = override_response.json()
    assert payload["control_allowed"] is True
    assert payload["override_active"] is True
    assert "override" in payload["control_explanation"].lower()


def test_import_zra_gateway_decision_converts_automatically() -> None:
    client = _local_client()
    response = client.post(
        "/attestation/import/zra-gateway",
        json={
            "robot_id": "gateway_bot",
            "gateway_decision": {
                "profile_name": "pi-industrial-edge",
                "policy_name": "industrial-strict",
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
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["robot_id"] == "gateway_bot"
    assert payload["trust_state"] == AttestationTrustState.STALE.value
    assert payload["verifier"] == "zra-gateway"


def test_orchestrator_status_endpoint_reports_state(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.services import zra_orchestrator

    client = _local_client()
    monkeypatch.setattr(
        zra_orchestrator,
        "settings",
        replace(
            zra_orchestrator.settings,
            zra_orchestrator_enabled=True,
            zra_orchestrator_poll_interval_seconds=15,
            zra_orchestrator_inactive_after_seconds=60,
        ),
    )
    monkeypatch.setattr(
        "backend.services.zra_orchestrator.zra_orchestrator_service._devices",
        [],
    )

    response = client.get("/attestation/orchestrator/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["enabled"] is True
    assert payload["poll_interval_seconds"] == 15
    assert payload["inactive_after_seconds"] == 60
    assert payload["devices"] == []


def test_orchestrator_status_endpoint_ignores_invalid_devices_file(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    from backend.services import zra_orchestrator

    devices_path = tmp_path / "devices.json"
    devices_path.write_bytes(b"\xff\xfe\x00")
    client = _local_client()
    monkeypatch.setattr(
        zra_orchestrator,
        "settings",
        replace(
            zra_orchestrator.settings,
            zra_orchestrator_enabled=True,
            zra_orchestrator_devices_path=str(devices_path),
            zra_orchestrator_poll_interval_seconds=15,
            zra_orchestrator_inactive_after_seconds=60,
        ),
    )
    monkeypatch.setattr(
        "backend.services.zra_orchestrator.zra_orchestrator_service._devices",
        [],
    )

    response = client.get("/attestation/orchestrator/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["enabled"] is True
    assert payload["device_count"] == 0
    assert payload["devices"] == []


def test_pull_zra_gateway_decision_uses_existing_converter(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _local_client()

    def _fake_fetch(_request: object) -> dict:
        return {
            "profile_name": "pi-industrial-edge",
            "policy_name": "industrial-strict",
            "proof_verification": {"ok": True, "output": "OK"},
            "binding_verification": {
                "ok": True,
                "binding": {
                    "expires_at": (utc_now() + timedelta(minutes=5)).isoformat(),
                    "proof_digest": TEST_PROOF_DIGEST,
                },
            },
            "component_appraisal": {"failures": [], "warnings": []},
            "decision": {
                "status": "accept",
                "reason": "verified",
                "failures": [],
                "warnings": [],
            },
        }

    monkeypatch.setattr("backend.api.attestation.fetch_zra_gateway_decision", _fake_fetch)

    response = client.post(
        "/attestation/pull/zra-gateway",
        json={"robot_id": "pull_bot"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["robot_id"] == "pull_bot"
    assert payload["effective_trust_state"] == AttestationTrustState.VERIFIED.value
    assert payload["control_allowed"] is True
    assert payload["proof_digest"] == TEST_PROOF_DIGEST


def teardown_function() -> None:
    attestation_status_store._statuses.clear()
