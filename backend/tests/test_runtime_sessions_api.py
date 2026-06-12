from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from backend.tests.asgi_test_client import AsgiTestClient

from backend.app import create_app
from backend.core.simulator_security import RUNTIME_SESSION_TOKEN_HEADER, SIMULATOR_TOKEN_HEADER
from backend.services.runtime_sessions import runtime_sessions_service
from backend.services.runtime_sessions_params import RUNTIME_SESSION_MAX_FRAME_BYTES

TEST_SIMULATOR_TOKEN = "sim-token"


@pytest.fixture(autouse=True)
def reset_runtime_sessions_service() -> None:
    runtime_sessions_service._sessions.clear()


def _patch_security_settings(token: str | None = TEST_SIMULATOR_TOKEN):
    return patch(
        "backend.core.simulator_security.settings",
        SimpleNamespace(simulator_api_token=token, cam_to_sim_proxy_token=None),
    )


def _operator_headers() -> dict[str, str]:
    return {
        SIMULATOR_TOKEN_HEADER: TEST_SIMULATOR_TOKEN,
    }


def test_runtime_session_endpoints_round_trip() -> None:
    client = AsgiTestClient(create_app())

    with _patch_security_settings():
        channels_response = client.post(
            "/runtime/sessions/default/telemetry/channels",
            headers=_operator_headers(),
            json={
                "channels": [
                    {
                        "channel_id": "joints",
                        "name": "joint-state",
                        "source_id": "robot-bridge",
                        "stream_kind": "JOINT_STATE_BATCH",
                    }
                ]
            },
        )
    assert channels_response.status_code == 200
    assert channels_response.json()["channels"][0]["channel_id"] == "joints"

    with _patch_security_settings():
        video_response = client.post(
            "/runtime/sessions/default/video_refs",
            headers=_operator_headers(),
            json={
                "video_refs": [
                    {
                        "stream_id": "cam-main",
                        "channel_name": "front-camera",
                        "source_id": "pi-camera",
                        "codec": "h264",
                        "width": 1280,
                        "height": 720,
                        "nominal_fps": 30,
                    }
                ]
            },
        )
    assert video_response.status_code == 200
    assert video_response.json()["video_refs"][0]["stream_id"] == "cam-main"

    with _patch_security_settings():
        ingest_response = client.post(
            "/runtime/sessions/default/telemetry/ingest",
            headers=_operator_headers(),
            json={
                "active_transport": "ws_binary",
                "envelopes": [{"sequence": 1, "channel_id": "joints", "payload": {"ok": True}}],
            },
        )
    assert ingest_response.status_code == 200
    assert ingest_response.json()["total_ingested"] == 1

    with _patch_security_settings():
        stats_response = client.get("/runtime/sessions/default/stats", headers=_operator_headers())
    assert stats_response.status_code == 200
    payload = stats_response.json()
    assert payload["active_transport"] == "ws_binary"
    assert payload["channels"] == 1


def test_runtime_session_reads_fail_closed_for_unknown_or_invalid_ids() -> None:
    client = AsgiTestClient(create_app())

    with _patch_security_settings():
        missing_response = client.get("/runtime/sessions/missing/stats", headers=_operator_headers())
    assert missing_response.status_code == 404
    assert "not found" in missing_response.json()["detail"].lower()

    with _patch_security_settings():
        invalid_response = client.get("/runtime/sessions/bad id/stats", headers=_operator_headers())
    assert invalid_response.status_code == 422
    assert "runtime session id" in invalid_response.json()["detail"].lower()


def test_runtime_video_refs_strip_query_auth_metadata() -> None:
    client = AsgiTestClient(create_app())

    with _patch_security_settings():
        video_response = client.post(
            "/runtime/sessions/default/video_refs",
            headers=_operator_headers(),
            json={
                "video_refs": [
                    {
                        "stream_id": "cam-main",
                        "channel_name": "front-camera",
                        "source_id": "pi-camera",
                        "codec": "h264",
                        "width": 1280,
                        "height": 720,
                        "nominal_fps": 30,
                        "metadata": {
                            "stream_base_url": "http://robot.local:8090/camera.jpg?token=secret&view=front",
                            "token_scheme": "query",
                        },
                    }
                ]
            },
        )

    assert video_response.status_code == 200
    metadata = video_response.json()["video_refs"][0]["metadata"]
    assert metadata["stream_base_url"] == "http://robot.local:8090/camera.jpg?view=front"
    assert metadata["security_warning"] == "insecure_query_auth_removed"
    assert "token_scheme" not in metadata


def test_runtime_telemetry_rejects_oversized_frames_with_drop_reason() -> None:
    client = AsgiTestClient(create_app())
    oversized_payload = "x" * (RUNTIME_SESSION_MAX_FRAME_BYTES + 1)

    with _patch_security_settings():
        ingest_response = client.post(
            "/runtime/sessions/default/telemetry/ingest",
            headers=_operator_headers(),
            json={
                "active_transport": "http_json_poll",
                "envelopes": [{"sequence": 1, "channel_id": "joints", "payload": {"blob": oversized_payload}}],
            },
        )

    assert ingest_response.status_code == 200
    payload = ingest_response.json()
    assert payload["total_dropped"] == 1
    assert payload["drop_reasons"]["frame_too_large"] == 1


def test_runtime_provider_session_lifecycle_round_trip() -> None:
    client = AsgiTestClient(create_app())

    with _patch_security_settings():
        request_response = client.post(
            "/runtime/sessions/provider-demo/provider",
            headers=_operator_headers(),
            json={
                "provider_id": "dora.local",
                "provider_display_name": "Dora Local",
                "requested_capabilities": ["observe", "record", "video"],
                "preferred_formats": ["json", "arrow_ipc"],
                "connector_origin": "localhost",
                "connector_version": "1.2.3",
            },
        )

    assert request_response.status_code == 200
    request_payload = request_response.json()
    assert request_payload["state"] == "pending"
    assert request_payload["requested_capabilities"] == ["observe", "record", "video"]
    assert request_payload["preferred_formats"] == ["json", "arrow_ipc"]
    assert request_payload["requires_session_token"] is False
    assert request_payload["audit_events"][0]["event_type"] == "requested"
    assert request_payload["connector_claim_token"]

    with _patch_security_settings():
        approval_response = client.post(
            "/runtime/sessions/provider-demo/provider/approve",
            headers=_operator_headers(),
            json={
                "approved_capabilities": ["observe", "record"],
                "granted_formats": ["json"],
            },
        )

    assert approval_response.status_code == 200
    approval_payload = approval_response.json()
    assert approval_payload["state"] == "approved"
    assert approval_payload["approved_capabilities"] == ["observe", "record"]
    assert approval_payload["granted_formats"] == ["json"]
    assert isinstance(approval_payload["session_token"], str)
    assert approval_payload["session_token"]

    with _patch_security_settings():
        claim_response = client.post(
            "/runtime/sessions/provider-demo/provider/claim",
            headers=_operator_headers(),
            json={"connector_claim_token": request_payload["connector_claim_token"]},
        )

    assert claim_response.status_code == 200
    assert claim_response.json()["state"] == "approved"
    assert claim_response.json()["session_token"] == approval_payload["session_token"]

    session_headers = {
        **_operator_headers(),
        RUNTIME_SESSION_TOKEN_HEADER: approval_payload["session_token"],
    }

    with _patch_security_settings():
        robot_response = client.post(
            "/runtime/sessions/provider-demo/provider/robot",
            headers=session_headers,
            json={
                "robot_id": "openarm/baguette",
                "robot_display_name": "Baguette Arm",
                "source": {
                    "source_type": "github",
                    "uri": "https://github.com/enactic/openarm_description",
                },
                "joint_names": ["joint_1", "joint_2"],
                "frame_names": ["base_link", "tool0"],
            },
        )

    assert robot_response.status_code == 200
    assert robot_response.json()["robot_id"] == "openarm/baguette"

    with _patch_security_settings():
        recording_start_response = client.post(
            "/runtime/sessions/provider-demo/provider/recording/start",
            headers=_operator_headers(),
            json={"label": "Live Observe"},
        )

    assert recording_start_response.status_code == 200
    assert recording_start_response.json()["recording_state"] == "recording"

    with _patch_security_settings():
        provider_response = client.get(
            "/runtime/sessions/provider-demo/provider",
            headers=_operator_headers(),
        )

    assert provider_response.status_code == 200
    provider_payload = provider_response.json()
    assert provider_payload["state"] == "connected"
    assert provider_payload["robot_description_available"] is True
    assert provider_payload["robot_id"] == "openarm/baguette"
    assert provider_payload["audit_events"][-1]["event_type"] == "recording_started"

    with _patch_security_settings():
        recording_stop_response = client.post(
            "/runtime/sessions/provider-demo/provider/recording/stop",
            headers=_operator_headers(),
            json={},
        )

    assert recording_stop_response.status_code == 200
    assert recording_stop_response.json()["recording_state"] == "idle"


def test_runtime_provider_approval_requires_scoped_token_for_post_approval_writes() -> None:
    client = AsgiTestClient(create_app())

    with _patch_security_settings():
        request_response = client.post(
            "/runtime/sessions/provider-lock/provider",
            headers=_operator_headers(),
            json={
                "provider_id": "dora.local",
                "requested_capabilities": ["observe"],
                "preferred_formats": ["json"],
            },
        )
        assert request_response.status_code == 200

    with _patch_security_settings():
        approval_response = client.post(
            "/runtime/sessions/provider-lock/provider/approve",
            headers=_operator_headers(),
            json={},
        )

    assert approval_response.status_code == 200
    session_token = approval_response.json()["session_token"]

    with _patch_security_settings():
        bad_claim_response = client.post(
            "/runtime/sessions/provider-lock/provider/claim",
            headers=_operator_headers(),
            json={"connector_claim_token": "wrong-token"},
        )

    assert bad_claim_response.status_code == 401

    with _patch_security_settings():
        blocked_response = client.post(
            "/runtime/sessions/provider-lock/telemetry/ingest",
            headers=_operator_headers(),
            json={
                "active_transport": "ws_json",
                "envelopes": [{"sequence": 1, "channel_id": "joint", "payload": {"ok": True}}],
            },
        )

    assert blocked_response.status_code == 401
    assert "runtime session token" in blocked_response.json()["detail"].lower()

    with _patch_security_settings():
        allowed_response = client.post(
            "/runtime/sessions/provider-lock/telemetry/ingest",
            headers={
                **_operator_headers(),
                RUNTIME_SESSION_TOKEN_HEADER: session_token,
            },
            json={
                "active_transport": "ws_json",
                "envelopes": [{"sequence": 1, "channel_id": "joint", "payload": {"ok": True}}],
            },
        )

    assert allowed_response.status_code == 200
    assert allowed_response.json()["total_ingested"] == 1
