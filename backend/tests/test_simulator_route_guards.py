from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.app import app
from backend.core.request_audit import REQUEST_ID_HEADER, SECURITY_AUDIT_LOGGER_NAME
from backend.core.simulator_security import HTTP_UNAUTHORIZED, SIMULATOR_TOKEN_HEADER
from backend.services.collaboration_params import COLLABORATION_SESSION_TOKEN_HEADER
from backend.ros_viz.params import ROSVIZ_STREAM_SUBPROTOCOL, ROSVIZ_STREAM_TICKET_SUBPROTOCOL_PREFIX


TEST_SIMULATOR_TOKEN = "sim-token"
TEST_OPERATOR_ONLY_PATHS = (
    "/world-bridge/status",
    "/runtime/sessions/demo/stats",
    "/attestation/status",
    "/ilu-session/demo-session",
)


def _patch_security_settings(token: str | None):
    return patch(
        "backend.core.simulator_security.settings",
        SimpleNamespace(simulator_api_token=token, cam_to_sim_proxy_token=None),
    )


def _ros_viz_ticket_subprotocol(ticket: str) -> str:
    return f"{ROSVIZ_STREAM_TICKET_SUBPROTOCOL_PREFIX}{ticket}"


def test_health_allows_remote_requests_without_operator_access() -> None:
    client = TestClient(app)
    with _patch_security_settings(None):
        response = client.get("/health", headers={REQUEST_ID_HEADER: "health-audit-1"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert response.headers[REQUEST_ID_HEADER] == "health-audit-1"


def test_collaboration_room_routes_use_collaboration_token_guard_not_operator_guard() -> None:
    client = TestClient(app)
    with _patch_security_settings(TEST_SIMULATOR_TOKEN):
        created_response = client.post(
            "/collaboration/sessions",
            headers={SIMULATOR_TOKEN_HEADER: TEST_SIMULATOR_TOKEN},
            json={"label": "team-room"},
        )
    assert created_response.status_code == 200
    created = created_response.json()

    with _patch_security_settings(None):
        create_without_operator_response = client.post(
            "/collaboration/sessions",
            json={"label": "blocked"},
        )
    assert create_without_operator_response.status_code == 403
    assert "Remote simulator access is disabled" in create_without_operator_response.json()["detail"]

    with _patch_security_settings(None):
        missing_room_token_response = client.get(f"/collaboration/sessions/{created['session_id']}")
    assert missing_room_token_response.status_code == 401
    assert "Collaboration session token is required" in missing_room_token_response.json()["detail"]

    with _patch_security_settings(None):
        room_token_response = client.get(
            f"/collaboration/sessions/{created['session_id']}",
            headers={COLLABORATION_SESSION_TOKEN_HEADER: created["editor_token"]},
        )
    assert room_token_response.status_code == 200

    with _patch_security_settings(None):
        issue_capability_response = client.post(
            f"/collaboration/sessions/{created['session_id']}/capabilities",
            headers={COLLABORATION_SESSION_TOKEN_HEADER: created["owner_token"]},
            json={"role": "room_editor", "allowed_transports": ["websocket"]},
        )
    assert issue_capability_response.status_code == 200
    capability_token = issue_capability_response.json()["capability_token"]

    with _patch_security_settings(None):
        verify_capability_without_operator_response = client.post(
            f"/collaboration/sessions/{created['session_id']}/capabilities/verify",
            json={"capability_token": capability_token},
        )
    assert verify_capability_without_operator_response.status_code == 403

    with _patch_security_settings(None):
        revoke_capability_response = client.post(
            f"/collaboration/sessions/{created['session_id']}/capabilities/revoke",
            headers={COLLABORATION_SESSION_TOKEN_HEADER: created["owner_token"]},
            json={"capability_token": capability_token},
        )
    assert revoke_capability_response.status_code == 200


def test_collaboration_room_token_does_not_grant_operator_or_host_route_access() -> None:
    client = TestClient(app)
    with _patch_security_settings(TEST_SIMULATOR_TOKEN):
        created_response = client.post(
            "/collaboration/sessions",
            headers={SIMULATOR_TOKEN_HEADER: TEST_SIMULATOR_TOKEN},
            json={"label": "host-containment"},
        )
    assert created_response.status_code == 200
    collaboration_headers = {
        COLLABORATION_SESSION_TOKEN_HEADER: created_response.json()["editor_token"],
    }

    for path in TEST_OPERATOR_ONLY_PATHS:
        with _patch_security_settings(TEST_SIMULATOR_TOKEN):
            response = client.get(path, headers=collaboration_headers)
        assert response.status_code == HTTP_UNAUTHORIZED, path
        assert "Simulator API token required" in response.json()["detail"]


def test_world_bridge_status_rejects_remote_requests_without_operator_access() -> None:
    client = TestClient(app)
    with _patch_security_settings(None):
        response = client.get("/world-bridge/status", headers={REQUEST_ID_HEADER: "deny-world-1"})

    assert response.status_code == 403
    assert "Remote simulator access is disabled" in response.json()["detail"]
    assert response.headers[REQUEST_ID_HEADER] == "deny-world-1"


def test_runtime_session_stats_reject_remote_requests_without_operator_access() -> None:
    client = TestClient(app)
    with _patch_security_settings(None):
        response = client.get("/runtime/sessions/demo/stats")

    assert response.status_code == 403
    assert "Remote simulator access is disabled" in response.json()["detail"]


def test_attestation_status_rejects_remote_requests_without_operator_access() -> None:
    client = TestClient(app)
    with _patch_security_settings(None):
        response = client.get("/attestation/status")

    assert response.status_code == 403
    assert "Remote simulator access is disabled" in response.json()["detail"]


def test_ilu_session_rejects_remote_requests_before_session_lookup_without_operator_access() -> None:
    client = TestClient(app)
    with _patch_security_settings(None):
        response = client.get("/ilu-session/demo-session")

    assert response.status_code == 403
    assert "Remote simulator access is disabled" in response.json()["detail"]


def test_ilu_session_returns_not_found_after_operator_auth() -> None:
    client = TestClient(app)
    with _patch_security_settings(TEST_SIMULATOR_TOKEN):
        response = client.get(
            "/ilu-session/demo-session",
            headers={SIMULATOR_TOKEN_HEADER: TEST_SIMULATOR_TOKEN},
        )

    assert response.status_code == 404
    assert "ilu session not found" in response.json()["detail"]


def test_world_registry_capabilities_allows_remote_requests_with_operator_token() -> None:
    client = TestClient(app)
    with _patch_security_settings(TEST_SIMULATOR_TOKEN):
        response = client.get(
            "/worlds/packages/capabilities",
            headers={
                SIMULATOR_TOKEN_HEADER: TEST_SIMULATOR_TOKEN,
                REQUEST_ID_HEADER: "allow-world-registry-1",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["available"] is True
    assert response.headers[REQUEST_ID_HEADER] == "allow-world-registry-1"


def test_denied_operator_route_emits_security_audit_log(caplog: pytest.LogCaptureFixture) -> None:
    client = TestClient(app)
    with _patch_security_settings(None), caplog.at_level("WARNING", logger=SECURITY_AUDIT_LOGGER_NAME):
        response = client.get("/attestation/status", headers={REQUEST_ID_HEADER: "audit-denied-1"})

    assert response.status_code == 403
    assert any(
        "security.http request_id=audit-denied-1" in record.message and "decision=denied" in record.message
        for record in caplog.records
    )


def test_allowed_operator_route_emits_security_audit_log(caplog: pytest.LogCaptureFixture) -> None:
    client = TestClient(app)
    with _patch_security_settings(TEST_SIMULATOR_TOKEN), caplog.at_level(
        "INFO", logger=SECURITY_AUDIT_LOGGER_NAME
    ):
        response = client.get(
            "/world-bridge/status",
            headers={
                SIMULATOR_TOKEN_HEADER: TEST_SIMULATOR_TOKEN,
                REQUEST_ID_HEADER: "audit-allowed-1",
            },
        )

    assert response.status_code == 200
    assert any(
        "security.http request_id=audit-allowed-1" in record.message and "decision=allowed" in record.message
        for record in caplog.records
    )


def test_ros_viz_stream_ticket_endpoint_requires_operator_access() -> None:
    client = TestClient(app)
    with _patch_security_settings(None):
        response = client.post("/ros-viz/sessions/demo-session/stream-ticket")

    assert response.status_code == 403
    assert "Remote simulator access is disabled" in response.json()["detail"]


def test_ros_viz_websocket_rejects_missing_stream_ticket() -> None:
    client = TestClient(app)
    with _patch_security_settings(TEST_SIMULATOR_TOKEN), pytest.raises(WebSocketDisconnect) as disconnect_info:
        with client.websocket_connect(
            "/ws/ros-viz/demo-session",
            subprotocols=[ROSVIZ_STREAM_SUBPROTOCOL],
        ):
            pass

    assert disconnect_info.value.code == 4401


def test_ros_viz_websocket_accepts_single_use_stream_ticket() -> None:
    client = TestClient(app)
    with _patch_security_settings(TEST_SIMULATOR_TOKEN):
        session_response = client.post(
            "/ros-viz/sessions",
            headers={SIMULATOR_TOKEN_HEADER: TEST_SIMULATOR_TOKEN},
            json={},
        )
        assert session_response.status_code == 200
        session_id = session_response.json()["session_id"]

        ticket_response = client.post(
            f"/ros-viz/sessions/{session_id}/stream-ticket",
            headers={
                SIMULATOR_TOKEN_HEADER: TEST_SIMULATOR_TOKEN,
                REQUEST_ID_HEADER: "rosviz-ticket-1",
            },
        )
        assert ticket_response.status_code == 200
        ticket = ticket_response.json()["ticket"]

        with client.websocket_connect(
            f"/ws/ros-viz/{session_id}",
            headers={REQUEST_ID_HEADER: "rosviz-ws-1"},
            subprotocols=[ROSVIZ_STREAM_SUBPROTOCOL, _ros_viz_ticket_subprotocol(ticket)],
        ):
            pass

        with pytest.raises(WebSocketDisconnect) as disconnect_info:
            with client.websocket_connect(
                f"/ws/ros-viz/{session_id}",
                headers={REQUEST_ID_HEADER: "rosviz-ws-2"},
                subprotocols=[ROSVIZ_STREAM_SUBPROTOCOL, _ros_viz_ticket_subprotocol(ticket)],
            ):
                pass

    assert disconnect_info.value.code == 4401
