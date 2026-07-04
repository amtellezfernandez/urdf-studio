from __future__ import annotations

from typing import Literal, TypeAlias

from pydantic import BaseModel, Field

from backend.models.json_payload import JsonObject

CollaborationSessionRole = Literal["owner", "editor", "viewer"]
CollaborationEventPayload: TypeAlias = JsonObject
CollaborationJournalDetails: TypeAlias = JsonObject


class CollaborationSessionCreateRequest(BaseModel):
    label: str = ""


class CollaborationSessionSnapshot(BaseModel):
    session_id: str
    label: str = ""
    role: CollaborationSessionRole = "editor"
    editors_enabled: bool = True
    sharing_enabled: bool = True
    created_at: str
    updated_at: str
    peer_count: int = 0
    event_count: int = 0
    last_event_id: int = 0


class CollaborationSessionStats(BaseModel):
    session_id: str
    peer_count: int = 0
    event_count: int = 0
    retained_event_count: int = 0
    accepted_event_count: int = 0
    last_event_id: int = 0
    rejected_event_count: int = 0
    replay_rejected_event_count: int = 0
    last_client_sequences: dict[str, int] = Field(default_factory=dict)
    updated_at: str


class CollaborationSessionCreateResponse(CollaborationSessionSnapshot):
    session_token: str
    editor_token: str
    owner_token: str


class CollaborationAccessUpdateRequest(BaseModel):
    editors_enabled: bool | None = None
    sharing_enabled: bool | None = None
    rotate_editor_token: bool = False
    rotate_session_token: bool = False


class CollaborationAccessUpdateResponse(BaseModel):
    snapshot: CollaborationSessionSnapshot
    session_token: str
    editor_token: str


class CollaborationEventRequest(BaseModel):
    client_id: str = ""
    event_type: str
    payload: CollaborationEventPayload = Field(default_factory=dict)


class CollaborationEventSnapshot(BaseModel):
    event_id: int
    session_id: str
    client_id: str
    event_type: str
    payload: CollaborationEventPayload = Field(default_factory=dict)
    occurred_at: str
    server_received_at_ms: int


class CollaborationSessionJoinMessage(BaseModel):
    type: Literal["session.joined"] = "session.joined"
    snapshot: CollaborationSessionSnapshot
    recent_events: list[CollaborationEventSnapshot] = Field(default_factory=list)


class CollaborationEventMessage(BaseModel):
    type: Literal["event"] = "event"
    event: CollaborationEventSnapshot


class CollaborationErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    message: str
