from __future__ import annotations

import json
import secrets
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock

from fastapi import WebSocket

from backend.services.collaboration_journal import (
    CollaborationJournal,
    build_collaboration_journal_from_env,
    collaboration_token_digest,
)
from backend.models.collaboration import (
    CollaborationAccessUpdateRequest,
    CollaborationAccessUpdateResponse,
    CollaborationEventPayload,
    CollaborationEventRequest,
    CollaborationEventSnapshot,
    CollaborationJournalDetails,
    CollaborationSessionCreateRequest,
    CollaborationSessionCreateResponse,
    CollaborationSessionRole,
    CollaborationSessionSnapshot,
    CollaborationSessionStats,
)
from backend.services.collaboration_params import (
    COLLABORATION_ACCESS_PAUSED_MESSAGE,
    COLLABORATION_ACCESS_REVOKED_MESSAGE,
    COLLABORATION_CLIENT_SEQUENCE_FIELD,
    COLLABORATION_CLIENT_SEQUENCE_MAX,
    COLLABORATION_CLIENT_SEQUENCE_MIN,
    COLLABORATION_COUNTER_INCREMENT,
    COLLABORATION_CLIENT_ID_BYTES,
    COLLABORATION_CLIENT_ID_MAX_CHARS,
    COLLABORATION_CLIENT_ID_PATTERN,
    COLLABORATION_EVENT_PAYLOAD_MAX_BYTES,
    COLLABORATION_EVENT_TYPE_MAX_CHARS,
    COLLABORATION_EVENT_TYPE_PATTERN,
    COLLABORATION_INITIAL_EVENT_ID,
    COLLABORATION_IDLE_TTL_MS,
    COLLABORATION_JOURNAL_EVENT_ACCESS_UPDATED,
    COLLABORATION_JOURNAL_EVENT_COLLABORATION_EVENT_ACCEPTED,
    COLLABORATION_JOURNAL_EVENT_SESSION_CREATED,
    COLLABORATION_LABEL_MAX_CHARS,
    COLLABORATION_MAX_ACTIVE_SESSIONS,
    COLLABORATION_MAX_EVENTS_PER_SESSION,
    COLLABORATION_MAX_PEERS_PER_SESSION,
    COLLABORATION_SESSION_ID_BYTES,
    COLLABORATION_SESSION_TOKEN_BYTES,
    COLLABORATION_WEBSOCKET_ACCESS_REVOKED_REASON,
)


class CollaborationValidationError(ValueError):
    ...


class CollaborationAccessError(PermissionError):
    ...


class CollaborationCapacityError(RuntimeError):
    ...


@dataclass(frozen=True)
class CollaborationPeerDisconnect:
    peer_id: str
    websocket: WebSocket
    reason: str


@dataclass(frozen=True)
class CollaborationAccessUpdateResult:
    response: CollaborationAccessUpdateResponse
    revoked_peers: tuple[CollaborationPeerDisconnect, ...] = ()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _token_urlsafe(bytes_count: int) -> str:
    return secrets.token_urlsafe(bytes_count)


@dataclass
class _CollaborationPeer:
    websocket: WebSocket
    role: CollaborationSessionRole
    session_token: str


@dataclass
class _CollaborationSession:
    session_id: str
    session_token: str
    editor_token: str
    owner_token: str
    label: str
    created_at: str
    updated_at: str
    last_seen_ms: int
    editors_enabled: bool = True
    sharing_enabled: bool = True
    revoked_session_token_digests: set[str] = field(default_factory=set)
    revoked_editor_token_digests: set[str] = field(default_factory=set)
    events: deque[CollaborationEventSnapshot] = field(
        default_factory=lambda: deque(maxlen=COLLABORATION_MAX_EVENTS_PER_SESSION)
    )
    peers: dict[str, _CollaborationPeer] = field(default_factory=dict)
    last_client_sequences: dict[str, int] = field(default_factory=dict)
    rejected_event_count: int = 0
    replay_rejected_event_count: int = 0
    next_event_id: int = COLLABORATION_INITIAL_EVENT_ID


class CollaborationService:
    def __init__(self, journal: CollaborationJournal | None = None) -> None:
        self._lock = Lock()
        self._journal = journal or build_collaboration_journal_from_env()
        self._sessions: dict[str, _CollaborationSession] = {}

    def _append_journal_record(
        self,
        *,
        event_type: str,
        session_id: str,
        occurred_at: str,
        details: CollaborationJournalDetails,
    ) -> None:
        self._journal.append(
            event_type=event_type,
            session_id=session_id,
            occurred_at=occurred_at,
            details=details,
        )

    def _prune_idle_sessions_locked(self, now_ms: int) -> None:
        expired_session_ids = [
            session_id
            for session_id, session in self._sessions.items()
            if not session.peers
            and now_ms - session.last_seen_ms > COLLABORATION_IDLE_TTL_MS
        ]
        for session_id in expired_session_ids:
            self._sessions.pop(session_id, None)

    def _normalize_label(self, value: str) -> str:
        normalized = value.strip()
        if len(normalized) > COLLABORATION_LABEL_MAX_CHARS:
            raise CollaborationValidationError(
                f"Collaboration session label must be at most {COLLABORATION_LABEL_MAX_CHARS} characters."
            )
        return normalized

    def _normalize_client_id(self, value: str | None) -> str:
        normalized = (value or "").strip()
        if not normalized:
            return f"client-{_token_urlsafe(COLLABORATION_CLIENT_ID_BYTES)}"
        if len(normalized) > COLLABORATION_CLIENT_ID_MAX_CHARS:
            raise CollaborationValidationError(
                f"Collaboration client ID must be at most {COLLABORATION_CLIENT_ID_MAX_CHARS} characters."
            )
        if not COLLABORATION_CLIENT_ID_PATTERN.fullmatch(normalized):
            raise CollaborationValidationError(
                "Collaboration client ID must start with an alphanumeric character and use only letters, numbers, '.', '_', ':', or '-'."
            )
        return normalized

    def _normalize_event_type(self, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise CollaborationValidationError("Collaboration event type is required.")
        if len(normalized) > COLLABORATION_EVENT_TYPE_MAX_CHARS:
            raise CollaborationValidationError(
                f"Collaboration event type must be at most {COLLABORATION_EVENT_TYPE_MAX_CHARS} characters."
            )
        if not COLLABORATION_EVENT_TYPE_PATTERN.fullmatch(normalized):
            raise CollaborationValidationError(
                "Collaboration event type must start with a letter and use only letters, numbers, '.', '_', ':', or '-'."
            )
        return normalized

    def _validate_payload_size(
        self, payload: CollaborationEventPayload
    ) -> CollaborationEventPayload:
        try:
            encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise CollaborationValidationError(
                "Collaboration event payload must be JSON serializable."
            ) from exc
        if len(encoded) > COLLABORATION_EVENT_PAYLOAD_MAX_BYTES:
            raise CollaborationValidationError(
                f"Collaboration event payload must be at most {COLLABORATION_EVENT_PAYLOAD_MAX_BYTES} bytes."
            )
        return payload

    def _client_sequence(self, payload: CollaborationEventPayload) -> int | None:
        if COLLABORATION_CLIENT_SEQUENCE_FIELD not in payload:
            return None
        value = payload[COLLABORATION_CLIENT_SEQUENCE_FIELD]
        if not isinstance(value, int) or isinstance(value, bool):
            raise CollaborationValidationError(
                "Collaboration client sequence must be an integer."
            )
        if (
            value < COLLABORATION_CLIENT_SEQUENCE_MIN
            or value > COLLABORATION_CLIENT_SEQUENCE_MAX
        ):
            raise CollaborationValidationError(
                f"Collaboration client sequence must be between {COLLABORATION_CLIENT_SEQUENCE_MIN} and {COLLABORATION_CLIENT_SEQUENCE_MAX}."
            )
        return value

    def _require_fresh_client_sequence_locked(
        self,
        session: _CollaborationSession,
        *,
        client_id: str,
        payload: CollaborationEventPayload,
    ) -> None:
        try:
            client_sequence = self._client_sequence(payload)
        except CollaborationValidationError:
            session.rejected_event_count += COLLABORATION_COUNTER_INCREMENT
            raise
        if client_sequence is None:
            return
        last_sequence = session.last_client_sequences.get(client_id)
        if last_sequence is not None and client_sequence <= last_sequence:
            session.rejected_event_count += COLLABORATION_COUNTER_INCREMENT
            session.replay_rejected_event_count += COLLABORATION_COUNTER_INCREMENT
            raise CollaborationValidationError(
                f"Collaboration event replay rejected for client {client_id}: sequence {client_sequence} must be greater than {last_sequence}."
            )
        session.last_client_sequences[client_id] = client_sequence

    def _get_session_locked(self, session_id: str) -> _CollaborationSession:
        session = self._sessions.get(session_id.strip())
        if session is None:
            raise KeyError(f"unknown collaboration session: {session_id}")
        return session

    def _normalize_session_token(self, session_token: str | None) -> str:
        return (session_token or "").strip()

    def _token_digest(self, token: str) -> str:
        return collaboration_token_digest(token)

    def _require_session_access(
        self,
        session: _CollaborationSession,
        session_token: str | None,
    ) -> CollaborationSessionRole:
        normalized = self._normalize_session_token(session_token)
        if not normalized:
            raise CollaborationAccessError("Collaboration session token is required.")
        if secrets.compare_digest(normalized, session.owner_token):
            return "owner"
        normalized_digest = self._token_digest(normalized)
        if (
            normalized_digest in session.revoked_session_token_digests
            or normalized_digest in session.revoked_editor_token_digests
        ):
            raise CollaborationAccessError(COLLABORATION_ACCESS_REVOKED_MESSAGE)
        if secrets.compare_digest(normalized, session.editor_token):
            if not session.sharing_enabled:
                raise CollaborationAccessError(COLLABORATION_ACCESS_PAUSED_MESSAGE)
            if not session.editors_enabled:
                raise CollaborationAccessError(
                    "Collaboration editing is locked by the owner."
                )
            return "editor"
        if secrets.compare_digest(normalized, session.session_token):
            if not session.sharing_enabled:
                raise CollaborationAccessError(COLLABORATION_ACCESS_PAUSED_MESSAGE)
            return "viewer"
        raise CollaborationAccessError("Collaboration session token is required.")

    def _require_owner_access(
        self, session: _CollaborationSession, session_token: str | None
    ) -> None:
        normalized = self._normalize_session_token(session_token)
        if not normalized or not secrets.compare_digest(
            normalized, session.owner_token
        ):
            raise CollaborationAccessError("Collaboration owner token is required.")

    def verify_owner_token(self, session_id: str, *, session_token: str | None) -> bool:
        now_ms = _now_ms()
        with self._lock:
            self._prune_idle_sessions_locked(now_ms)
            session = self._sessions.get(session_id.strip())
            if session is None:
                return False
            try:
                self._require_owner_access(session, session_token)
            except CollaborationAccessError:
                return False
            session.last_seen_ms = now_ms
            return True

    def _pop_inaccessible_guest_peers_locked(
        self,
        session: _CollaborationSession,
    ) -> tuple[CollaborationPeerDisconnect, ...]:
        revoked_peers: list[CollaborationPeerDisconnect] = []
        for peer_id, peer in list(session.peers.items()):
            if peer.role == "owner":
                continue
            editor_token_revoked = peer.role == "editor" and not secrets.compare_digest(
                peer.session_token,
                session.editor_token,
            )
            viewer_token_revoked = peer.role == "viewer" and not secrets.compare_digest(
                peer.session_token,
                session.session_token,
            )
            editor_locked = peer.role == "editor" and not session.editors_enabled
            if (
                not session.sharing_enabled
                or editor_locked
                or editor_token_revoked
                or viewer_token_revoked
            ):
                if not session.sharing_enabled:
                    reason = COLLABORATION_ACCESS_PAUSED_MESSAGE
                elif editor_token_revoked or viewer_token_revoked:
                    reason = COLLABORATION_ACCESS_REVOKED_MESSAGE
                else:
                    reason = COLLABORATION_WEBSOCKET_ACCESS_REVOKED_REASON
                session.peers.pop(peer_id, None)
                revoked_peers.append(
                    CollaborationPeerDisconnect(
                        peer_id=peer_id,
                        websocket=peer.websocket,
                        reason=reason,
                    )
                )
        return tuple(revoked_peers)

    def _snapshot_locked(
        self,
        session: _CollaborationSession,
        role: CollaborationSessionRole = "editor",
    ) -> CollaborationSessionSnapshot:
        return CollaborationSessionSnapshot(
            session_id=session.session_id,
            label=session.label,
            role=role,
            editors_enabled=session.editors_enabled,
            sharing_enabled=session.sharing_enabled,
            created_at=session.created_at,
            updated_at=session.updated_at,
            peer_count=len(session.peers),
            event_count=len(session.events),
            last_event_id=session.next_event_id - COLLABORATION_COUNTER_INCREMENT,
        )

    def _stats_locked(
        self, session: _CollaborationSession
    ) -> CollaborationSessionStats:
        retained_event_count = len(session.events)
        accepted_event_count = session.next_event_id - COLLABORATION_INITIAL_EVENT_ID
        return CollaborationSessionStats(
            session_id=session.session_id,
            peer_count=len(session.peers),
            event_count=retained_event_count,
            retained_event_count=retained_event_count,
            accepted_event_count=accepted_event_count,
            last_event_id=session.next_event_id - COLLABORATION_COUNTER_INCREMENT,
            rejected_event_count=session.rejected_event_count,
            replay_rejected_event_count=session.replay_rejected_event_count,
            last_client_sequences=dict(session.last_client_sequences),
            updated_at=session.updated_at,
        )

    def create_session(
        self, request: CollaborationSessionCreateRequest
    ) -> CollaborationSessionCreateResponse:
        now_ms = _now_ms()
        label = self._normalize_label(request.label)
        with self._lock:
            self._prune_idle_sessions_locked(now_ms)
            if len(self._sessions) >= COLLABORATION_MAX_ACTIVE_SESSIONS:
                raise CollaborationCapacityError(
                    "Active collaboration session capacity exceeded."
                )
            session_id = f"collab-{_token_urlsafe(COLLABORATION_SESSION_ID_BYTES)}"
            while session_id in self._sessions:
                session_id = f"collab-{_token_urlsafe(COLLABORATION_SESSION_ID_BYTES)}"
            session_token = _token_urlsafe(COLLABORATION_SESSION_TOKEN_BYTES)
            editor_token = _token_urlsafe(COLLABORATION_SESSION_TOKEN_BYTES)
            owner_token = _token_urlsafe(COLLABORATION_SESSION_TOKEN_BYTES)
            now_iso = _utc_now_iso()
            session = _CollaborationSession(
                session_id=session_id,
                session_token=session_token,
                editor_token=editor_token,
                owner_token=owner_token,
                label=label,
                created_at=now_iso,
                updated_at=now_iso,
                last_seen_ms=now_ms,
            )
            self._sessions[session_id] = session
            snapshot = self._snapshot_locked(session, role="owner")

        self._append_journal_record(
            event_type=COLLABORATION_JOURNAL_EVENT_SESSION_CREATED,
            session_id=session_id,
            occurred_at=now_iso,
            details={"label": label},
        )
        return CollaborationSessionCreateResponse(
            **snapshot.model_dump(),
            session_token=session_token,
            editor_token=editor_token,
            owner_token=owner_token,
        )

    def get_session(
        self, session_id: str, *, session_token: str | None
    ) -> CollaborationSessionSnapshot:
        now_ms = _now_ms()
        with self._lock:
            self._prune_idle_sessions_locked(now_ms)
            session = self._get_session_locked(session_id)
            role = self._require_session_access(session, session_token)
            session.last_seen_ms = now_ms
            return self._snapshot_locked(session, role=role)

    def recent_events(
        self, session_id: str, *, session_token: str | None
    ) -> list[CollaborationEventSnapshot]:
        now_ms = _now_ms()
        with self._lock:
            self._prune_idle_sessions_locked(now_ms)
            session = self._get_session_locked(session_id)
            self._require_session_access(session, session_token)
            session.last_seen_ms = now_ms
            return list(session.events)

    def session_stats(
        self, session_id: str, *, session_token: str | None
    ) -> CollaborationSessionStats:
        now_ms = _now_ms()
        with self._lock:
            self._prune_idle_sessions_locked(now_ms)
            session = self._get_session_locked(session_id)
            self._require_owner_access(session, session_token)
            session.last_seen_ms = now_ms
            return self._stats_locked(session)

    def update_access(
        self,
        session_id: str,
        request: CollaborationAccessUpdateRequest,
        *,
        session_token: str | None,
    ) -> CollaborationAccessUpdateResult:
        now_ms = _now_ms()
        with self._lock:
            self._prune_idle_sessions_locked(now_ms)
            session = self._get_session_locked(session_id)
            self._require_owner_access(session, session_token)
            if request.editors_enabled is not None:
                session.editors_enabled = request.editors_enabled
            if request.sharing_enabled is not None:
                session.sharing_enabled = request.sharing_enabled
            if request.rotate_session_token:
                session.revoked_session_token_digests.add(
                    self._token_digest(session.session_token)
                )
                session.session_token = _token_urlsafe(
                    COLLABORATION_SESSION_TOKEN_BYTES
                )
            if request.rotate_editor_token:
                session.revoked_editor_token_digests.add(
                    self._token_digest(session.editor_token)
                )
                session.editor_token = _token_urlsafe(COLLABORATION_SESSION_TOKEN_BYTES)
            revoked_peers = self._pop_inaccessible_guest_peers_locked(session)
            session.updated_at = _utc_now_iso()
            session.last_seen_ms = now_ms
            snapshot = self._snapshot_locked(session, role="owner")
            result = CollaborationAccessUpdateResult(
                response=CollaborationAccessUpdateResponse(
                    snapshot=snapshot,
                    session_token=session.session_token,
                    editor_token=session.editor_token,
                ),
                revoked_peers=revoked_peers,
            )
            journal_session_id = session.session_id
            journal_occurred_at = session.updated_at
            journal_details = {
                "editors_enabled": session.editors_enabled,
                "sharing_enabled": session.sharing_enabled,
                "rotated_editor_token": request.rotate_editor_token,
                "rotated_session_token": request.rotate_session_token,
                "revoked_peer_count": len(revoked_peers),
            }

        self._append_journal_record(
            event_type=COLLABORATION_JOURNAL_EVENT_ACCESS_UPDATED,
            session_id=journal_session_id,
            occurred_at=journal_occurred_at,
            details=journal_details,
        )
        return result

    def record_event(
        self,
        session_id: str,
        request: CollaborationEventRequest,
        *,
        session_token: str | None,
    ) -> CollaborationEventSnapshot:
        now_ms = _now_ms()
        event_type = self._normalize_event_type(request.event_type)
        client_id = self._normalize_client_id(request.client_id)
        payload = self._validate_payload_size(request.payload)
        with self._lock:
            self._prune_idle_sessions_locked(now_ms)
            session = self._get_session_locked(session_id)
            role = self._require_session_access(session, session_token)
            if role == "viewer":
                session.rejected_event_count += 1
                raise CollaborationAccessError(
                    "Collaboration read-only links cannot publish events."
                )
            self._require_fresh_client_sequence_locked(
                session,
                client_id=client_id,
                payload=payload,
            )
            event = CollaborationEventSnapshot(
                event_id=session.next_event_id,
                session_id=session.session_id,
                client_id=client_id,
                event_type=event_type,
                payload=payload,
                occurred_at=_utc_now_iso(),
                server_received_at_ms=now_ms,
            )
            session.next_event_id += 1
            session.updated_at = event.occurred_at
            session.last_seen_ms = now_ms
            session.events.append(event)

        self._append_journal_record(
            event_type=COLLABORATION_JOURNAL_EVENT_COLLABORATION_EVENT_ACCEPTED,
            session_id=event.session_id,
            occurred_at=event.occurred_at,
            details={
                "event_id": event.event_id,
                "client_id": event.client_id,
                "event_type": event.event_type,
                "payload": event.payload,
                "server_received_at_ms": event.server_received_at_ms,
            },
        )
        return event

    def connect_peer(
        self,
        session_id: str,
        *,
        session_token: str | None,
        client_id: str | None,
        websocket: WebSocket,
    ) -> tuple[str, CollaborationSessionSnapshot, list[CollaborationEventSnapshot]]:
        now_ms = _now_ms()
        normalized_client_id = self._normalize_client_id(client_id)
        with self._lock:
            self._prune_idle_sessions_locked(now_ms)
            session = self._get_session_locked(session_id)
            role = self._require_session_access(session, session_token)
            if len(session.peers) >= COLLABORATION_MAX_PEERS_PER_SESSION:
                raise CollaborationCapacityError(
                    "Collaboration session peer capacity exceeded."
                )
            normalized_token = self._normalize_session_token(session_token)
            peer_id = normalized_client_id
            if peer_id in session.peers:
                peer_id = f"{normalized_client_id}:{_token_urlsafe(COLLABORATION_CLIENT_ID_BYTES)}"
            session.peers[peer_id] = _CollaborationPeer(
                websocket=websocket,
                role=role,
                session_token=normalized_token,
            )
            session.last_seen_ms = now_ms
            snapshot = self._snapshot_locked(session, role=role)
            events = list(session.events)
            return peer_id, snapshot, events

    def disconnect_peer(self, session_id: str, peer_id: str) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return
            session.peers.pop(peer_id, None)
            session.last_seen_ms = _now_ms()

    def list_peer_websockets(self, session_id: str) -> list[tuple[str, WebSocket]]:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return []
            return [
                (peer_id, peer.websocket) for peer_id, peer in session.peers.items()
            ]


collaboration_service = CollaborationService()
