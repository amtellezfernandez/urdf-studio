from __future__ import annotations

import json
from pathlib import Path

from backend.models.collaboration import (
    CollaborationAccessUpdateRequest,
    CollaborationCapabilityIssueRequest,
    CollaborationCapabilityRevokeRequest,
    CollaborationEventRequest,
    CollaborationSessionCreateRequest,
)
from backend.services.collaboration import CollaborationService
from backend.services.collaboration_journal import (
    CollaborationFileJournal,
    collaboration_token_digest,
)
from backend.services.collaboration_params import (
    COLLABORATION_JOURNAL_EVENT_ACCESS_UPDATED,
    COLLABORATION_JOURNAL_EVENT_CAPABILITY_ISSUED,
    COLLABORATION_JOURNAL_EVENT_CAPABILITY_REVOKED,
    COLLABORATION_JOURNAL_EVENT_COLLABORATION_EVENT_ACCEPTED,
    COLLABORATION_JOURNAL_EVENT_SESSION_CREATED,
    COLLABORATION_JOURNAL_SCHEMA_VERSION,
)

TEST_CLIENT_SEQUENCE = 1


def _read_records(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_collaboration_file_journal_appends_replayable_records_without_bearer_tokens(
    tmp_path: Path,
) -> None:
    journal_path = tmp_path / "journals" / "collaboration.ndjson"
    service = CollaborationService(journal=CollaborationFileJournal(journal_path))

    created = service.create_session(
        CollaborationSessionCreateRequest(label="fleet-room-a")
    )
    issued_capability = service.issue_capability(
        created.session_id,
        CollaborationCapabilityIssueRequest(
            role="teleop_operator",
            allowed_transports=["moq"],
        ),
        session_token=created.owner_token,
    )
    event = service.record_event(
        created.session_id,
        CollaborationEventRequest(
            client_id="operator-a",
            event_type="urdf.patch",
            payload={
                "clientSequence": TEST_CLIENT_SEQUENCE,
                "patch": [{"op": "replace", "path": "/robot/name", "value": "atlas"}],
            },
        ),
        session_token=created.editor_token,
    )
    access_result = service.update_access(
        created.session_id,
        CollaborationAccessUpdateRequest(rotate_editor_token=True),
        session_token=created.owner_token,
    )
    service.revoke_capability(
        created.session_id,
        CollaborationCapabilityRevokeRequest(
            capability_token=issued_capability.capability_token,
        ),
        session_token=created.owner_token,
    )

    raw_journal = journal_path.read_text(encoding="utf-8")
    assert created.owner_token not in raw_journal
    assert created.session_token not in raw_journal
    assert created.editor_token not in raw_journal
    assert access_result.response.editor_token not in raw_journal
    assert issued_capability.capability_token not in raw_journal

    records = _read_records(journal_path)
    assert [record["event_type"] for record in records] == [
        COLLABORATION_JOURNAL_EVENT_SESSION_CREATED,
        COLLABORATION_JOURNAL_EVENT_CAPABILITY_ISSUED,
        COLLABORATION_JOURNAL_EVENT_COLLABORATION_EVENT_ACCEPTED,
        COLLABORATION_JOURNAL_EVENT_ACCESS_UPDATED,
        COLLABORATION_JOURNAL_EVENT_CAPABILITY_REVOKED,
    ]
    assert {record["schema_version"] for record in records} == {
        COLLABORATION_JOURNAL_SCHEMA_VERSION,
    }
    assert {record["session_id"] for record in records} == {created.session_id}

    issued_record = records[1]
    assert issued_record["details"] == {
        "allowed_transports": ["moq"],
        "capability_token_digest": collaboration_token_digest(
            issued_capability.capability_token,
        ),
        "expires_at": issued_capability.expires_at,
        "role": "teleop_operator",
    }

    accepted_event_record = records[2]
    assert accepted_event_record["details"] == {
        "client_id": event.client_id,
        "event_id": event.event_id,
        "event_type": event.event_type,
        "payload": event.payload,
        "server_received_at_ms": event.server_received_at_ms,
    }

    access_record = records[3]
    assert access_record["details"] == {
        "editors_enabled": True,
        "sharing_enabled": True,
        "revoked_peer_count": 0,
        "revoked_room_editor_capability_count": 0,
        "revoked_teleop_operator_capability_count": 1,
        "rotated_editor_token": True,
        "rotated_session_token": False,
    }

    revoked_record = records[4]
    assert revoked_record["details"] == {
        "capability_token_digest": collaboration_token_digest(
            issued_capability.capability_token,
        ),
        "revoked": False,
    }
