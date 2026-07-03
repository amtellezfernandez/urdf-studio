from __future__ import annotations

import pytest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.app import create_app
from backend.core.simulator_security import SIMULATOR_TOKEN_HEADER
from backend.services.collaboration import collaboration_service
from backend.services.collaboration_params import (
    COLLABORATION_ACCESS_PAUSED_MESSAGE,
    COLLABORATION_ACCESS_REVOKED_MESSAGE,
    COLLABORATION_SESSION_TOKEN_HEADER,
    COLLABORATION_WEBSOCKET_ACCESS_REVOKED_CLOSE_CODE,
    COLLABORATION_WEBSOCKET_CAPACITY_CLOSE_CODE,
    COLLABORATION_WEBSOCKET_PROTOCOL,
    COLLABORATION_WEBSOCKET_TOKEN_PROTOCOL_PREFIX,
    COLLABORATION_WEBSOCKET_UNAUTHORIZED_CLOSE_CODE,
)

TEST_SIMULATOR_TOKEN = "sim-token"
TEST_CLIENT_SEQUENCE = 1
TEST_NEXT_CLIENT_SEQUENCE = 2
TEST_ACCEPTED_EVENT_COUNT_AFTER_REPLAY = 2
TEST_RETAINED_EVENT_COUNT_AFTER_REPLAY = 2
TEST_REJECTED_EVENT_COUNT_AFTER_REPLAY = 1


@pytest.fixture(autouse=True)
def reset_collaboration_service() -> None:
    collaboration_service._sessions.clear()


def _patch_security_settings(token: str | None = TEST_SIMULATOR_TOKEN):
    return patch(
        "backend.core.simulator_security.settings",
        SimpleNamespace(simulator_api_token=token),
    )


def _operator_headers() -> dict[str, str]:
    return {
        SIMULATOR_TOKEN_HEADER: TEST_SIMULATOR_TOKEN,
    }


def _collaboration_headers(session_token: str) -> dict[str, str]:
    return {
        **_operator_headers(),
        COLLABORATION_SESSION_TOKEN_HEADER: session_token,
    }


def _collaboration_websocket_subprotocols(session_token: str) -> list[str]:
    return [
        COLLABORATION_WEBSOCKET_PROTOCOL,
        f"{COLLABORATION_WEBSOCKET_TOKEN_PROTOCOL_PREFIX}{session_token}",
    ]


def _create_session(client: TestClient) -> dict:
    response = client.post(
        "/collaboration/sessions",
        headers=_operator_headers(),
        json={"label": "Pair edit"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"].startswith("collab-")
    assert payload["session_token"]
    assert payload["editor_token"]
    assert payload["session_token"] != payload["editor_token"]
    assert set(payload) == {
        "session_id",
        "session_token",
        "editor_token",
        "owner_token",
        "label",
        "role",
        "editors_enabled",
        "sharing_enabled",
        "created_at",
        "updated_at",
        "peer_count",
        "event_count",
        "last_event_id",
    }
    return payload


def test_collaboration_session_create_and_event_history_round_trip() -> None:
    client = TestClient(create_app())
    with _patch_security_settings():
        created = _create_session(client)
    session_id = created["session_id"]
    viewer_headers = _collaboration_headers(created["session_token"])
    editor_headers = _collaboration_headers(created["editor_token"])

    with _patch_security_settings():
        blocked_response = client.get(
            f"/collaboration/sessions/{session_id}",
            headers=_operator_headers(),
        )
    assert blocked_response.status_code == 401

    with _patch_security_settings():
        snapshot_response = client.get(
            f"/collaboration/sessions/{session_id}", headers=viewer_headers
        )
    assert snapshot_response.status_code == 200
    assert snapshot_response.json()["label"] == "Pair edit"
    assert snapshot_response.json()["role"] == "viewer"

    event_payload = {
        "client_id": "editor-a",
        "event_type": "joint.value",
        "payload": {
            "clientSequence": TEST_CLIENT_SEQUENCE,
            "joint": "shoulder",
            "value": 0.42,
        },
    }
    with _patch_security_settings():
        viewer_event_response = client.post(
            f"/collaboration/sessions/{session_id}/events",
            headers=viewer_headers,
            json=event_payload,
        )
    assert viewer_event_response.status_code == 401

    with _patch_security_settings():
        event_response = client.post(
            f"/collaboration/sessions/{session_id}/events",
            headers=editor_headers,
            json=event_payload,
        )
    assert event_response.status_code == 200
    assert event_response.json()["event_id"] == 1

    with _patch_security_settings():
        events_response = client.get(
            f"/collaboration/sessions/{session_id}/events", headers=viewer_headers
        )
    assert events_response.status_code == 200
    assert events_response.json() == [event_response.json()]


def test_collaboration_rejects_replayed_client_sequences_and_reports_owner_stats() -> (
    None
):
    client = TestClient(create_app())
    with _patch_security_settings():
        created = _create_session(client)
    session_id = created["session_id"]
    editor_headers = {
        **_operator_headers(),
        COLLABORATION_SESSION_TOKEN_HEADER: created["editor_token"],
    }
    owner_headers = {
        **_operator_headers(),
        COLLABORATION_SESSION_TOKEN_HEADER: created["owner_token"],
    }

    first_event = {
        "client_id": "editor-a",
        "event_type": "urdf.patch",
        "payload": {"clientSequence": TEST_CLIENT_SEQUENCE, "kind": "urdf.patch.v1"},
    }
    with _patch_security_settings():
        first_response = client.post(
            f"/collaboration/sessions/{session_id}/events",
            headers=editor_headers,
            json=first_event,
        )
    assert first_response.status_code == 200

    with _patch_security_settings():
        replay_response = client.post(
            f"/collaboration/sessions/{session_id}/events",
            headers=editor_headers,
            json=first_event,
        )
    assert replay_response.status_code == 422
    assert "replay rejected" in replay_response.text

    with _patch_security_settings():
        next_response = client.post(
            f"/collaboration/sessions/{session_id}/events",
            headers=editor_headers,
            json={
                **first_event,
                "payload": {
                    "clientSequence": TEST_NEXT_CLIENT_SEQUENCE,
                    "kind": "urdf.patch.v1",
                },
            },
        )
    assert next_response.status_code == 200

    with _patch_security_settings():
        editor_stats_response = client.get(
            f"/collaboration/sessions/{session_id}/stats",
            headers=editor_headers,
        )
    assert editor_stats_response.status_code == 401

    with _patch_security_settings():
        owner_stats_response = client.get(
            f"/collaboration/sessions/{session_id}/stats",
            headers=owner_headers,
        )
    assert owner_stats_response.status_code == 200
    stats = owner_stats_response.json()
    assert stats["event_count"] == TEST_RETAINED_EVENT_COUNT_AFTER_REPLAY
    assert stats["retained_event_count"] == TEST_RETAINED_EVENT_COUNT_AFTER_REPLAY
    assert stats["accepted_event_count"] == TEST_ACCEPTED_EVENT_COUNT_AFTER_REPLAY
    assert stats["last_event_id"] == TEST_ACCEPTED_EVENT_COUNT_AFTER_REPLAY
    assert stats["rejected_event_count"] == TEST_REJECTED_EVENT_COUNT_AFTER_REPLAY
    assert (
        stats["replay_rejected_event_count"] == TEST_REJECTED_EVENT_COUNT_AFTER_REPLAY
    )
    assert stats["last_client_sequences"] == {"editor-a": TEST_NEXT_CLIENT_SEQUENCE}


def test_collaboration_owner_can_lock_and_rotate_guest_edit_access() -> None:
    client = TestClient(create_app())
    with _patch_security_settings():
        created = _create_session(client)
    session_id = created["session_id"]
    editor_token = created["editor_token"]
    owner_token = created["owner_token"]

    editor_headers = {
        **_operator_headers(),
        COLLABORATION_SESSION_TOKEN_HEADER: editor_token,
    }
    owner_headers = {
        **_operator_headers(),
        COLLABORATION_SESSION_TOKEN_HEADER: owner_token,
    }

    with _patch_security_settings():
        guest_lock_response = client.patch(
            f"/collaboration/sessions/{session_id}/access",
            headers=editor_headers,
            json={"editors_enabled": False},
        )
    assert guest_lock_response.status_code == 401

    with _patch_security_settings():
        lock_response = client.patch(
            f"/collaboration/sessions/{session_id}/access",
            headers=owner_headers,
            json={"editors_enabled": False},
        )
    assert lock_response.status_code == 200
    assert lock_response.json()["snapshot"]["editors_enabled"] is False

    with _patch_security_settings():
        blocked_event_response = client.post(
            f"/collaboration/sessions/{session_id}/events",
            headers=editor_headers,
            json={
                "client_id": "editor-a",
                "event_type": "urdf.snapshot",
                "payload": {},
            },
        )
    assert blocked_event_response.status_code == 401

    with _patch_security_settings():
        owner_event_response = client.post(
            f"/collaboration/sessions/{session_id}/events",
            headers=owner_headers,
            json={"client_id": "owner", "event_type": "urdf.snapshot", "payload": {}},
        )
    assert owner_event_response.status_code == 200

    with _patch_security_settings():
        rotate_response = client.patch(
            f"/collaboration/sessions/{session_id}/access",
            headers=owner_headers,
            json={"editors_enabled": True, "rotate_editor_token": True},
        )
    assert rotate_response.status_code == 200
    next_editor_token = rotate_response.json()["editor_token"]
    assert next_editor_token != editor_token

    with _patch_security_settings():
        old_token_response = client.post(
            f"/collaboration/sessions/{session_id}/events",
            headers=editor_headers,
            json={
                "client_id": "editor-a",
                "event_type": "urdf.snapshot",
                "payload": {},
            },
        )
    assert old_token_response.status_code == 401
    assert old_token_response.json()["detail"] == COLLABORATION_ACCESS_REVOKED_MESSAGE

    with _patch_security_settings():
        new_token_response = client.post(
            f"/collaboration/sessions/{session_id}/events",
            headers={
                **_operator_headers(),
                COLLABORATION_SESSION_TOKEN_HEADER: next_editor_token,
            },
            json={
                "client_id": "editor-b",
                "event_type": "urdf.snapshot",
                "payload": {},
            },
        )
    assert new_token_response.status_code == 200


def test_collaboration_owner_can_pause_and_resume_reusable_guest_links() -> None:
    client = TestClient(create_app())
    with _patch_security_settings():
        created = _create_session(client)
    session_id = created["session_id"]
    owner_headers = _collaboration_headers(created["owner_token"])
    viewer_headers = _collaboration_headers(created["session_token"])

    with _patch_security_settings():
        pause_response = client.patch(
            f"/collaboration/sessions/{session_id}/access",
            headers=owner_headers,
            json={"sharing_enabled": False},
        )
        blocked_viewer_response = client.get(
            f"/collaboration/sessions/{session_id}",
            headers=viewer_headers,
        )
        owner_snapshot_response = client.get(
            f"/collaboration/sessions/{session_id}",
            headers=owner_headers,
        )

    assert pause_response.status_code == 200
    assert pause_response.json()["snapshot"]["sharing_enabled"] is False
    assert blocked_viewer_response.status_code == 401
    assert (
        blocked_viewer_response.json()["detail"] == COLLABORATION_ACCESS_PAUSED_MESSAGE
    )
    assert owner_snapshot_response.status_code == 200
    assert owner_snapshot_response.json()["sharing_enabled"] is False

    with _patch_security_settings():
        resume_response = client.patch(
            f"/collaboration/sessions/{session_id}/access",
            headers=owner_headers,
            json={"sharing_enabled": True},
        )
        resumed_viewer_response = client.get(
            f"/collaboration/sessions/{session_id}",
            headers=viewer_headers,
        )

    assert resume_response.status_code == 200
    assert resume_response.json()["snapshot"]["sharing_enabled"] is True
    assert resumed_viewer_response.status_code == 200
    assert resumed_viewer_response.json()["role"] == "viewer"


def test_collaboration_rooms_do_not_cross_contaminate_tokens_or_events() -> None:
    client = TestClient(create_app())
    with _patch_security_settings():
        first_room = _create_session(client)
        second_room = _create_session(client)
    first_session_id = first_room["session_id"]
    second_session_id = second_room["session_id"]
    first_headers = _collaboration_headers(first_room["editor_token"])
    second_headers = _collaboration_headers(second_room["editor_token"])

    with _patch_security_settings():
        cross_read_response = client.get(
            f"/collaboration/sessions/{second_session_id}",
            headers=first_headers,
        )
        first_event_response = client.post(
            f"/collaboration/sessions/{first_session_id}/events",
            headers=first_headers,
            json={
                "client_id": "shared-editor",
                "event_type": "joint.value",
                "payload": {
                    "clientSequence": TEST_CLIENT_SEQUENCE,
                    "joint": "shoulder",
                },
            },
        )
        cross_write_response = client.post(
            f"/collaboration/sessions/{second_session_id}/events",
            headers=first_headers,
            json={
                "client_id": "shared-editor",
                "event_type": "joint.value",
                "payload": {
                    "clientSequence": TEST_NEXT_CLIENT_SEQUENCE,
                    "joint": "leak",
                },
            },
        )
        second_event_response = client.post(
            f"/collaboration/sessions/{second_session_id}/events",
            headers=second_headers,
            json={
                "client_id": "shared-editor",
                "event_type": "joint.value",
                "payload": {"clientSequence": TEST_CLIENT_SEQUENCE, "joint": "elbow"},
            },
        )
        first_events_response = client.get(
            f"/collaboration/sessions/{first_session_id}/events",
            headers=first_headers,
        )
        second_events_response = client.get(
            f"/collaboration/sessions/{second_session_id}/events",
            headers=second_headers,
        )

    assert cross_read_response.status_code == 401
    assert cross_write_response.status_code == 401
    assert first_event_response.status_code == 200
    assert second_event_response.status_code == 200
    assert first_events_response.json() == [first_event_response.json()]
    assert second_events_response.json() == [second_event_response.json()]

    with pytest.raises(WebSocketDisconnect) as disconnect_info:
        with client.websocket_connect(
            f"/ws/collaboration/{second_session_id}?client_id=shared-editor",
            subprotocols=_collaboration_websocket_subprotocols(
                first_room["editor_token"]
            ),
        ):
            pass

    assert disconnect_info.value.code == COLLABORATION_WEBSOCKET_UNAUTHORIZED_CLOSE_CODE


def test_collaboration_rejects_session_tokens_in_urls() -> None:
    client = TestClient(create_app())
    with _patch_security_settings():
        created = _create_session(client)
    session_id = created["session_id"]
    editor_token = created["editor_token"]

    with _patch_security_settings():
        http_response = client.get(
            f"/collaboration/sessions/{session_id}?token={editor_token}"
        )
    assert http_response.status_code == 401

    with pytest.raises(WebSocketDisconnect) as disconnect_info:
        with client.websocket_connect(
            f"/ws/collaboration/{session_id}?token={editor_token}&client_id=editor-a",
            subprotocols=[COLLABORATION_WEBSOCKET_PROTOCOL],
        ):
            pass

    assert disconnect_info.value.code == COLLABORATION_WEBSOCKET_UNAUTHORIZED_CLOSE_CODE


def test_collaboration_websocket_rejects_bad_token() -> None:
    client = TestClient(create_app())
    with _patch_security_settings():
        created = _create_session(client)

    with pytest.raises(WebSocketDisconnect) as disconnect_info:
        with client.websocket_connect(
            f"/ws/collaboration/{created['session_id']}?token=wrong&client_id=editor-a"
        ):
            pass

    assert disconnect_info.value.code == COLLABORATION_WEBSOCKET_UNAUTHORIZED_CLOSE_CODE


def test_collaboration_websocket_rejects_peer_capacity_overflow() -> None:
    client = TestClient(create_app())
    with _patch_security_settings():
        created = _create_session(client)
    session_id = created["session_id"]
    session_token = created["session_token"]

    with patch("backend.services.collaboration.COLLABORATION_MAX_PEERS_PER_SESSION", 1):
        with client.websocket_connect(
            f"/ws/collaboration/{session_id}?client_id=editor-a",
            subprotocols=_collaboration_websocket_subprotocols(session_token),
        ) as editor_socket:
            joined = editor_socket.receive_json()
            assert joined["type"] == "session.joined"

            with pytest.raises(WebSocketDisconnect) as disconnect_info:
                with client.websocket_connect(
                    f"/ws/collaboration/{session_id}?client_id=editor-b",
                    subprotocols=_collaboration_websocket_subprotocols(session_token),
                ):
                    pass

    assert disconnect_info.value.code == COLLABORATION_WEBSOCKET_CAPACITY_CLOSE_CODE


def test_collaboration_websocket_closes_guest_when_owner_pauses_sharing() -> None:
    client = TestClient(create_app())
    with _patch_security_settings():
        created = _create_session(client)
    session_id = created["session_id"]

    with client.websocket_connect(
        f"/ws/collaboration/{session_id}?client_id=viewer-a",
        subprotocols=_collaboration_websocket_subprotocols(created["session_token"]),
    ) as viewer_socket:
        joined = viewer_socket.receive_json()
        assert joined["type"] == "session.joined"
        assert joined["snapshot"]["sharing_enabled"] is True

        with _patch_security_settings():
            pause_response = client.patch(
                f"/collaboration/sessions/{session_id}/access",
                headers=_collaboration_headers(created["owner_token"]),
                json={"sharing_enabled": False},
            )
        assert pause_response.status_code == 200
        assert pause_response.json()["snapshot"]["peer_count"] == 0

        with pytest.raises(WebSocketDisconnect) as disconnect_info:
            viewer_socket.receive_json()

    assert (
        disconnect_info.value.code == COLLABORATION_WEBSOCKET_ACCESS_REVOKED_CLOSE_CODE
    )


def test_collaboration_websocket_closes_revoked_editor_after_token_rotation() -> None:
    client = TestClient(create_app())
    with _patch_security_settings():
        created = _create_session(client)
    session_id = created["session_id"]
    editor_token = created["editor_token"]
    owner_headers = {
        **_operator_headers(),
        COLLABORATION_SESSION_TOKEN_HEADER: created["owner_token"],
    }

    with client.websocket_connect(
        f"/ws/collaboration/{session_id}?client_id=editor-a",
        subprotocols=_collaboration_websocket_subprotocols(editor_token),
    ) as editor_socket:
        joined = editor_socket.receive_json()
        assert joined["type"] == "session.joined"
        assert joined["snapshot"]["peer_count"] == 1

        with _patch_security_settings():
            rotate_response = client.patch(
                f"/collaboration/sessions/{session_id}/access",
                headers=owner_headers,
                json={"editors_enabled": True, "rotate_editor_token": True},
            )
        assert rotate_response.status_code == 200
        assert rotate_response.json()["snapshot"]["peer_count"] == 0

        with pytest.raises(WebSocketDisconnect) as disconnect_info:
            editor_socket.receive_json()

    assert (
        disconnect_info.value.code == COLLABORATION_WEBSOCKET_ACCESS_REVOKED_CLOSE_CODE
    )


def test_collaboration_websocket_relays_events_to_connected_peer() -> None:
    client = TestClient(create_app())
    with _patch_security_settings():
        created = _create_session(client)
    session_id = created["session_id"]
    editor_token = created["editor_token"]

    with client.websocket_connect(
        f"/ws/collaboration/{session_id}?client_id=editor-a",
        subprotocols=_collaboration_websocket_subprotocols(editor_token),
    ) as editor_a:
        joined_a = editor_a.receive_json()
        assert joined_a["type"] == "session.joined"
        assert joined_a["snapshot"]["session_id"] == session_id

        with client.websocket_connect(
            f"/ws/collaboration/{session_id}?client_id=editor-b",
            subprotocols=_collaboration_websocket_subprotocols(editor_token),
        ) as editor_b:
            joined_b = editor_b.receive_json()
            assert joined_b["type"] == "session.joined"
            assert joined_b["recent_events"] == []

            editor_a.send_json(
                {
                    "client_id": "editor-a",
                    "event_type": "joint.value",
                    "payload": {"joint": "elbow", "value": 1.25},
                }
            )

            relayed_to_a = editor_a.receive_json()
            relayed_to_b = editor_b.receive_json()
            assert relayed_to_a == relayed_to_b
            assert relayed_to_b["type"] == "event"
            assert relayed_to_b["event"]["client_id"] == "editor-a"
            assert relayed_to_b["event"]["payload"] == {"joint": "elbow", "value": 1.25}
