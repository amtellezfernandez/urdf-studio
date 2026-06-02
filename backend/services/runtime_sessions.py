from __future__ import annotations

import hmac
import json
import secrets
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from backend.models.runtime_sessions import (
    RuntimeCommandRequest,
    RuntimeProviderApprovalRequest,
    RuntimeProviderApprovalResponse,
    RuntimeProviderAuditEventSnapshot,
    RuntimeProviderClaimRequest,
    RuntimeProviderClaimResponse,
    RuntimeProviderRecordingRequest,
    RuntimeProviderRobotDescriptionRequest,
    RuntimeProviderSessionRequest,
    RuntimeProviderSessionRequestResponse,
    RuntimeProviderSessionSnapshot,
    RuntimeSessionStatsResponse,
    RuntimeTelemetryChannelSnapshot,
    RuntimeTelemetryChannelsResponse,
    RuntimeTelemetryChannelsUpsertRequest,
    RuntimeTelemetryEnvelope,
    RuntimeTelemetryFramesResponse,
    RuntimeTelemetryIngestRequest,
    RuntimeVideoRefSnapshot,
    RuntimeVideoRefsResponse,
    RuntimeVideoRefsUpsertRequest,
)
from backend.services.runtime_sessions_params import (
    RUNTIME_PROVIDER_ALLOWED_CAPABILITIES,
    RUNTIME_PROVIDER_ALLOWED_STREAM_FORMATS,
    RUNTIME_PROVIDER_AUDIT_MAX_EVENTS,
    RUNTIME_PROVIDER_DISPLAY_NAME_MAX_CHARS,
    RUNTIME_PROVIDER_ID_MAX_CHARS,
    RUNTIME_PROVIDER_ID_PATTERN,
    RUNTIME_PROVIDER_LABEL_MAX_CHARS,
    RUNTIME_PROVIDER_ROBOT_ID_MAX_CHARS,
    RUNTIME_PROVIDER_ROBOT_ID_PATTERN,
    RUNTIME_PROVIDER_SESSION_TOKEN_BYTES,
    RUNTIME_SESSION_ID_MAX_CHARS,
    RUNTIME_SESSION_ID_PATTERN,
    RUNTIME_SESSION_MAX_BUFFERED_BYTES,
    RUNTIME_SESSION_MAX_FRAME_BYTES,
    RUNTIME_SESSIONS_MAX_ACTIVE,
    RUNTIME_SESSIONS_MAX_BUFFERED_FRAMES,
    RUNTIME_SESSIONS_MAX_CHANNELS,
    RUNTIME_SESSIONS_MAX_VIDEO_REFS,
    RUNTIME_VIDEO_REF_INSECURE_QUERY_KEYS,
    RUNTIME_VIDEO_REF_INSECURE_TOKEN_SCHEME,
    RUNTIME_VIDEO_REF_SECURITY_WARNING_KEY,
    RUNTIME_VIDEO_REF_STREAM_BASE_URL_KEY,
    RUNTIME_VIDEO_REF_TOKEN_SCHEME_KEY,
)

DROP_REASON_BUFFER_FULL = "buffer_full"
DROP_REASON_BUFFER_BUDGET = "buffer_budget"
DROP_REASON_FRAME_TOO_LARGE = "frame_too_large"
APPEND_FRAME_ACCEPTED = "accepted"
APPEND_FRAME_REJECTED = "rejected"
VIDEO_REF_WARNING_INSECURE_QUERY_AUTH = "insecure_query_auth_removed"
PROVIDER_STATE_PENDING = "pending"
PROVIDER_STATE_APPROVED = "approved"
PROVIDER_STATE_CONNECTED = "connected"
PROVIDER_STATE_DISCONNECTED = "disconnected"
PROVIDER_RECORDING_IDLE = "idle"
PROVIDER_RECORDING_ACTIVE = "recording"
PROVIDER_ACTOR_CONNECTOR = "connector"
PROVIDER_ACTOR_OPERATOR = "operator"
PROVIDER_ACTOR_SYSTEM = "system"
PROVIDER_EVENT_REQUESTED = "requested"
PROVIDER_EVENT_APPROVED = "approved"
PROVIDER_EVENT_CONNECTED = "connected"
PROVIDER_EVENT_DISCONNECTED = "disconnected"
PROVIDER_EVENT_RECORDING_STARTED = "recording_started"
PROVIDER_EVENT_RECORDING_STOPPED = "recording_stopped"
PROVIDER_EVENT_ROBOT_DESCRIBED = "robot_described"
PROVIDER_REQUIRED_TRANSPORT_FORMAT = "json"


class RuntimeSessionValidationError(ValueError):
    pass


class RuntimeSessionCapacityError(RuntimeError):
    pass


class RuntimeSessionAccessError(PermissionError):
    pass


class RuntimeProviderSessionStateError(RuntimeError):
    pass


@dataclass
class _RuntimeStoredFrame:
    payload: dict[str, Any]
    size_bytes: int


@dataclass
class _RuntimeProviderAuditEvent:
    sequence: int
    occurred_at: str
    event_type: str
    actor: str
    message: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class _RuntimeProviderSession:
    provider_id: str
    provider_display_name: str
    requested_capabilities: tuple[str, ...]
    approved_capabilities: tuple[str, ...]
    preferred_formats: tuple[str, ...]
    granted_formats: tuple[str, ...]
    connector_origin: str
    connector_version: str
    requested_at: str
    state: str = PROVIDER_STATE_PENDING
    approved_at: str | None = None
    connected_at: str | None = None
    disconnected_at: str | None = None
    session_token: str | None = None
    connector_claim_token: str | None = None
    recording_state: str = PROVIDER_RECORDING_IDLE
    recording_started_at: str | None = None
    recording_label: str | None = None
    robot_description: RuntimeProviderRobotDescriptionRequest | None = None
    audit_events: deque[_RuntimeProviderAuditEvent] = field(
        default_factory=lambda: deque(maxlen=RUNTIME_PROVIDER_AUDIT_MAX_EVENTS)
    )
    next_audit_sequence: int = 1


@dataclass
class _RuntimeSession:
    active_transport: str | None = None
    channels: dict[str, RuntimeTelemetryChannelSnapshot] = field(default_factory=dict)
    video_refs: dict[str, RuntimeVideoRefSnapshot] = field(default_factory=dict)
    frames: deque[_RuntimeStoredFrame] = field(
        default_factory=lambda: deque(maxlen=RUNTIME_SESSIONS_MAX_BUFFERED_FRAMES)
    )
    total_ingested: int = 0
    total_dropped: int = 0
    drop_reasons: dict[str, int] = field(default_factory=dict)
    total_buffered_bytes: int = 0
    total_buffered_messages: int = 0
    command_total: int = 0
    ack_total: int = 0
    provider_session: _RuntimeProviderSession | None = None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class RuntimeSessionsService:
    def __init__(self) -> None:
        self._lock = Lock()
        self._sessions: dict[str, _RuntimeSession] = {}

    def _validate_session_id(self, session_id: str) -> str:
        normalized = session_id.strip()
        if not normalized:
            raise RuntimeSessionValidationError("Runtime session ID is required.")
        if len(normalized) > RUNTIME_SESSION_ID_MAX_CHARS:
            raise RuntimeSessionValidationError(
                f"Runtime session ID must be at most {RUNTIME_SESSION_ID_MAX_CHARS} characters."
            )
        if not RUNTIME_SESSION_ID_PATTERN.fullmatch(normalized):
            raise RuntimeSessionValidationError(
                "Runtime session ID must start with an alphanumeric character and use only letters, numbers, '.', '_', ':', or '-'."
            )
        return normalized

    def _normalize_provider_identifier(self, value: str, *, label: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise RuntimeSessionValidationError(f"{label} is required.")
        if len(normalized) > RUNTIME_PROVIDER_ID_MAX_CHARS:
            raise RuntimeSessionValidationError(
                f"{label} must be at most {RUNTIME_PROVIDER_ID_MAX_CHARS} characters."
            )
        if not RUNTIME_PROVIDER_ID_PATTERN.fullmatch(normalized):
            raise RuntimeSessionValidationError(
                f"{label} must start with an alphanumeric character and use only letters, numbers, '.', '_', ':', or '-'."
            )
        return normalized

    def _normalize_robot_identifier(self, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise RuntimeSessionValidationError("Robot ID is required.")
        if len(normalized) > RUNTIME_PROVIDER_ROBOT_ID_MAX_CHARS:
            raise RuntimeSessionValidationError(
                f"Robot ID must be at most {RUNTIME_PROVIDER_ROBOT_ID_MAX_CHARS} characters."
            )
        if not RUNTIME_PROVIDER_ROBOT_ID_PATTERN.fullmatch(normalized):
            raise RuntimeSessionValidationError(
                "Robot ID must start with an alphanumeric character and use only letters, numbers, '.', '_', ':', '/', or '-'."
            )
        return normalized

    def _normalize_label(self, value: str, *, label: str, max_chars: int) -> str:
        normalized = value.strip()
        if len(normalized) > max_chars:
            raise RuntimeSessionValidationError(f"{label} must be at most {max_chars} characters.")
        return normalized

    def _normalize_choices(
        self,
        values: list[str],
        *,
        label: str,
        allowed: frozenset[str],
        required: bool,
        fallback: tuple[str, ...] = (),
    ) -> tuple[str, ...]:
        deduped: list[str] = []
        seen: set[str] = set()
        for raw in values:
            normalized = str(raw).strip().lower()
            if not normalized:
                continue
            if normalized not in allowed:
                raise RuntimeSessionValidationError(
                    f"Unsupported {label}: {normalized}. Allowed values: {', '.join(sorted(allowed))}."
                )
            if normalized in seen:
                continue
            seen.add(normalized)
            deduped.append(normalized)
        if not deduped:
            deduped = list(fallback)
        if required and not deduped:
            raise RuntimeSessionValidationError(f"At least one {label} is required.")
        return tuple(deduped)

    def _normalize_capabilities(self, values: list[str], *, required: bool) -> tuple[str, ...]:
        return self._normalize_choices(
            values,
            label="provider capability",
            allowed=RUNTIME_PROVIDER_ALLOWED_CAPABILITIES,
            required=required,
        )

    def _normalize_stream_formats(self, values: list[str], *, required: bool) -> tuple[str, ...]:
        return self._normalize_choices(
            values,
            label="stream format",
            allowed=RUNTIME_PROVIDER_ALLOWED_STREAM_FORMATS,
            required=required,
            fallback=(PROVIDER_REQUIRED_TRANSPORT_FORMAT,),
        )

    def _drop_count(self, session: _RuntimeSession, reason: str) -> None:
        session.total_dropped += 1
        session.drop_reasons[reason] = session.drop_reasons.get(reason, 0) + 1

    def _get_session(self, session_id: str) -> _RuntimeSession:
        normalized_session_id = self._validate_session_id(session_id)
        session = self._sessions.get(normalized_session_id)
        if session is None:
            raise KeyError(f"Runtime session '{normalized_session_id}' not found")
        return session

    def _get_or_create_session(self, session_id: str) -> _RuntimeSession:
        normalized_session_id = self._validate_session_id(session_id)
        session = self._sessions.get(normalized_session_id)
        if session is not None:
            return session
        if len(self._sessions) >= RUNTIME_SESSIONS_MAX_ACTIVE:
            raise RuntimeSessionCapacityError(
                f"Runtime session capacity exceeded ({RUNTIME_SESSIONS_MAX_ACTIVE} active sessions)."
            )
        session = _RuntimeSession()
        self._sessions[normalized_session_id] = session
        return session

    def _sanitize_video_ref_metadata(self, metadata: dict[str, Any]) -> dict[str, Any]:
        sanitized = dict(metadata)
        warnings: list[str] = []

        token_scheme = sanitized.get(RUNTIME_VIDEO_REF_TOKEN_SCHEME_KEY)
        if isinstance(token_scheme, str) and token_scheme.strip().lower() == RUNTIME_VIDEO_REF_INSECURE_TOKEN_SCHEME:
            sanitized.pop(RUNTIME_VIDEO_REF_TOKEN_SCHEME_KEY, None)
            warnings.append(VIDEO_REF_WARNING_INSECURE_QUERY_AUTH)

        stream_base_url = sanitized.get(RUNTIME_VIDEO_REF_STREAM_BASE_URL_KEY)
        if isinstance(stream_base_url, str) and stream_base_url.strip():
            try:
                parsed = urlsplit(stream_base_url)
                query_pairs = parse_qsl(parsed.query, keep_blank_values=True)
                filtered_pairs = [
                    (key, value)
                    for key, value in query_pairs
                    if key.strip().lower() not in RUNTIME_VIDEO_REF_INSECURE_QUERY_KEYS
                ]
                if len(filtered_pairs) != len(query_pairs):
                    warnings.append(VIDEO_REF_WARNING_INSECURE_QUERY_AUTH)
                sanitized[RUNTIME_VIDEO_REF_STREAM_BASE_URL_KEY] = urlunsplit(
                    (
                        parsed.scheme,
                        parsed.netloc,
                        parsed.path,
                        urlencode(filtered_pairs),
                        parsed.fragment,
                    )
                )
            except ValueError:
                pass

        if warnings:
            sanitized[RUNTIME_VIDEO_REF_SECURITY_WARNING_KEY] = ",".join(sorted(set(warnings)))

        return sanitized

    def _normalize_video_ref(self, video_ref: RuntimeVideoRefSnapshot) -> RuntimeVideoRefSnapshot:
        return video_ref.model_copy(
            update={
                "stream_id": video_ref.stream_id.strip(),
                "channel_name": video_ref.channel_name.strip(),
                "source_id": video_ref.source_id.strip(),
                "codec": video_ref.codec.strip(),
                "metadata": self._sanitize_video_ref_metadata(video_ref.metadata),
            }
        )

    def _normalize_robot_description(
        self,
        request: RuntimeProviderRobotDescriptionRequest,
    ) -> RuntimeProviderRobotDescriptionRequest:
        return request.model_copy(
            update={
                "robot_id": self._normalize_robot_identifier(request.robot_id),
                "robot_display_name": self._normalize_label(
                    request.robot_display_name,
                    label="Robot display name",
                    max_chars=RUNTIME_PROVIDER_DISPLAY_NAME_MAX_CHARS,
                ),
                "joint_names": [
                    joint_name.strip()
                    for joint_name in request.joint_names
                    if isinstance(joint_name, str) and joint_name.strip()
                ],
                "frame_names": [
                    frame_name.strip()
                    for frame_name in request.frame_names
                    if isinstance(frame_name, str) and frame_name.strip()
                ],
            }
        )

    def _reset_live_runtime_state(self, session: _RuntimeSession) -> None:
        session.active_transport = None
        session.channels.clear()
        session.video_refs.clear()
        session.frames.clear()
        session.total_ingested = 0
        session.total_dropped = 0
        session.drop_reasons.clear()
        session.total_buffered_bytes = 0
        session.total_buffered_messages = 0
        session.command_total = 0
        session.ack_total = 0

    def _append_provider_audit(
        self,
        provider_session: _RuntimeProviderSession,
        *,
        event_type: str,
        actor: str,
        message: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        provider_session.audit_events.append(
            _RuntimeProviderAuditEvent(
                sequence=provider_session.next_audit_sequence,
                occurred_at=_utc_now_iso(),
                event_type=event_type,
                actor=actor,
                message=message,
                metadata=dict(metadata or {}),
            )
        )
        provider_session.next_audit_sequence += 1

    def _provider_snapshot(
        self,
        session_id: str,
        provider_session: _RuntimeProviderSession,
    ) -> RuntimeProviderSessionSnapshot:
        robot_description = provider_session.robot_description
        return RuntimeProviderSessionSnapshot(
            session_id=session_id,
            state=provider_session.state,
            provider_id=provider_session.provider_id,
            provider_display_name=provider_session.provider_display_name,
            requested_capabilities=list(provider_session.requested_capabilities),
            approved_capabilities=list(provider_session.approved_capabilities),
            preferred_formats=list(provider_session.preferred_formats),
            granted_formats=list(provider_session.granted_formats),
            connector_origin=provider_session.connector_origin,
            connector_version=provider_session.connector_version,
            requested_at=provider_session.requested_at,
            approved_at=provider_session.approved_at,
            connected_at=provider_session.connected_at,
            disconnected_at=provider_session.disconnected_at,
            recording_state=provider_session.recording_state,
            recording_started_at=provider_session.recording_started_at,
            recording_label=provider_session.recording_label,
            requires_session_token=provider_session.session_token is not None,
            robot_id=robot_description.robot_id if robot_description else None,
            robot_display_name=robot_description.robot_display_name if robot_description else None,
            robot_description_available=robot_description is not None,
            audit_events=[
                RuntimeProviderAuditEventSnapshot(
                    sequence=event.sequence,
                    occurred_at=event.occurred_at,
                    event_type=event.event_type,
                    actor=event.actor,
                    message=event.message,
                    metadata=dict(event.metadata),
                )
                for event in provider_session.audit_events
            ],
        )

    def _require_provider_session(self, session: _RuntimeSession) -> _RuntimeProviderSession:
        provider_session = session.provider_session
        if provider_session is None:
            raise KeyError("Runtime provider session not found")
        return provider_session

    def _ensure_provider_subset(
        self,
        *,
        subset: tuple[str, ...],
        superset: tuple[str, ...],
        label: str,
    ) -> None:
        missing = [value for value in subset if value not in superset]
        if missing:
            raise RuntimeProviderSessionStateError(
                f"Approved {label} must be a subset of the requested values."
            )

    def _mark_provider_connected(self, provider_session: _RuntimeProviderSession) -> None:
        if provider_session.state == PROVIDER_STATE_CONNECTED:
            return
        provider_session.state = PROVIDER_STATE_CONNECTED
        provider_session.connected_at = _utc_now_iso()
        provider_session.disconnected_at = None
        self._append_provider_audit(
            provider_session,
            event_type=PROVIDER_EVENT_CONNECTED,
            actor=PROVIDER_ACTOR_SYSTEM,
            message="Provider session became active.",
        )

    def _require_provider_write_access(
        self,
        session: _RuntimeSession,
        *,
        session_token: str | None,
    ) -> None:
        provider_session = session.provider_session
        if provider_session is None or provider_session.session_token is None:
            return
        normalized_token = (session_token or "").strip()
        if normalized_token and hmac.compare_digest(normalized_token, provider_session.session_token):
            return
        raise RuntimeSessionAccessError(
            "Runtime session token required for provider-managed writes."
        )

    def _evict_frames_for_budget(self, session: _RuntimeSession, incoming_frame_size: int) -> str:
        if incoming_frame_size > RUNTIME_SESSION_MAX_FRAME_BYTES:
            self._drop_count(session, DROP_REASON_FRAME_TOO_LARGE)
            return APPEND_FRAME_REJECTED

        while session.frames and session.total_buffered_bytes + incoming_frame_size > RUNTIME_SESSION_MAX_BUFFERED_BYTES:
            evicted_frame = session.frames.popleft()
            session.total_buffered_bytes = max(0, session.total_buffered_bytes - evicted_frame.size_bytes)
            self._drop_count(session, DROP_REASON_BUFFER_BUDGET)

        if session.total_buffered_bytes + incoming_frame_size > RUNTIME_SESSION_MAX_BUFFERED_BYTES:
            self._drop_count(session, DROP_REASON_FRAME_TOO_LARGE)
            return APPEND_FRAME_REJECTED
        return APPEND_FRAME_ACCEPTED

    def _append_frame(self, session: _RuntimeSession, frame: dict[str, Any], *, frame_size: int) -> None:
        if self._evict_frames_for_budget(session, frame_size) != APPEND_FRAME_ACCEPTED:
            return

        if len(session.frames) == session.frames.maxlen:
            evicted_frame = session.frames.popleft()
            session.total_buffered_bytes = max(0, session.total_buffered_bytes - evicted_frame.size_bytes)
            self._drop_count(session, DROP_REASON_BUFFER_FULL)

        session.frames.append(_RuntimeStoredFrame(payload=frame, size_bytes=frame_size))
        session.total_buffered_bytes = min(
            session.total_buffered_bytes + frame_size,
            RUNTIME_SESSION_MAX_BUFFERED_BYTES,
        )
        session.total_buffered_messages = len(session.frames)

    def request_provider_session(
        self,
        session_id: str,
        request: RuntimeProviderSessionRequest,
    ) -> RuntimeProviderSessionRequestResponse:
        with self._lock:
            normalized_session_id = self._validate_session_id(session_id)
            session = self._get_or_create_session(normalized_session_id)
            requested_capabilities = self._normalize_capabilities(
                request.requested_capabilities,
                required=True,
            )
            preferred_formats = self._normalize_stream_formats(
                request.preferred_formats,
                required=True,
            )
            provider_session = _RuntimeProviderSession(
                provider_id=self._normalize_provider_identifier(request.provider_id, label="Provider ID"),
                provider_display_name=self._normalize_label(
                    request.provider_display_name,
                    label="Provider display name",
                    max_chars=RUNTIME_PROVIDER_DISPLAY_NAME_MAX_CHARS,
                ),
                requested_capabilities=requested_capabilities,
                approved_capabilities=tuple(),
                preferred_formats=preferred_formats,
                granted_formats=tuple(),
                connector_origin=self._normalize_label(
                    request.connector_origin,
                    label="Connector origin",
                    max_chars=RUNTIME_PROVIDER_DISPLAY_NAME_MAX_CHARS,
                ),
                connector_version=self._normalize_label(
                    request.connector_version,
                    label="Connector version",
                    max_chars=RUNTIME_PROVIDER_DISPLAY_NAME_MAX_CHARS,
                ),
                requested_at=_utc_now_iso(),
                connector_claim_token=secrets.token_urlsafe(RUNTIME_PROVIDER_SESSION_TOKEN_BYTES),
            )
            self._append_provider_audit(
                provider_session,
                event_type=PROVIDER_EVENT_REQUESTED,
                actor=PROVIDER_ACTOR_CONNECTOR,
                message="Provider session requested approval.",
                metadata={
                    "requested_capabilities": list(requested_capabilities),
                    "preferred_formats": list(preferred_formats),
                },
            )
            self._reset_live_runtime_state(session)
            session.provider_session = provider_session
            snapshot = self._provider_snapshot(normalized_session_id, provider_session)
            return RuntimeProviderSessionRequestResponse(
                **snapshot.model_dump(),
                connector_claim_token=provider_session.connector_claim_token or "",
            )

    def get_provider_session(self, session_id: str) -> RuntimeProviderSessionSnapshot:
        with self._lock:
            normalized_session_id = self._validate_session_id(session_id)
            session = self._get_session(normalized_session_id)
            provider_session = self._require_provider_session(session)
            return self._provider_snapshot(normalized_session_id, provider_session)

    def approve_provider_session(
        self,
        session_id: str,
        request: RuntimeProviderApprovalRequest,
    ) -> RuntimeProviderApprovalResponse:
        with self._lock:
            normalized_session_id = self._validate_session_id(session_id)
            session = self._get_session(normalized_session_id)
            provider_session = self._require_provider_session(session)
            approved_capabilities = (
                self._normalize_capabilities(request.approved_capabilities, required=True)
                if request.approved_capabilities is not None
                else provider_session.requested_capabilities
            )
            granted_formats = (
                self._normalize_stream_formats(request.granted_formats, required=True)
                if request.granted_formats is not None
                else provider_session.preferred_formats
            )
            self._ensure_provider_subset(
                subset=approved_capabilities,
                superset=provider_session.requested_capabilities,
                label="capabilities",
            )
            self._ensure_provider_subset(
                subset=granted_formats,
                superset=provider_session.preferred_formats,
                label="stream formats",
            )
            provider_session.approved_capabilities = approved_capabilities
            provider_session.granted_formats = granted_formats
            provider_session.session_token = secrets.token_urlsafe(RUNTIME_PROVIDER_SESSION_TOKEN_BYTES)
            provider_session.approved_at = _utc_now_iso()
            provider_session.state = PROVIDER_STATE_APPROVED
            provider_session.disconnected_at = None
            self._append_provider_audit(
                provider_session,
                event_type=PROVIDER_EVENT_APPROVED,
                actor=PROVIDER_ACTOR_OPERATOR,
                message="Provider session approved by the operator.",
                metadata={
                    "approved_capabilities": list(approved_capabilities),
                    "granted_formats": list(granted_formats),
                },
            )
            snapshot = self._provider_snapshot(normalized_session_id, provider_session)
            return RuntimeProviderApprovalResponse(
                **snapshot.model_dump(),
                session_token=provider_session.session_token,
            )

    def claim_provider_session_token(
        self,
        session_id: str,
        request: RuntimeProviderClaimRequest,
    ) -> RuntimeProviderClaimResponse:
        with self._lock:
            session = self._get_session(session_id)
            provider_session = self._require_provider_session(session)
            normalized_claim_token = request.connector_claim_token.strip()
            expected_claim_token = provider_session.connector_claim_token or ""
            if not normalized_claim_token or not hmac.compare_digest(
                normalized_claim_token,
                expected_claim_token,
            ):
                raise RuntimeSessionAccessError(
                    "Runtime provider claim token required for connector token exchange."
                )
            if provider_session.state == PROVIDER_STATE_PENDING:
                return RuntimeProviderClaimResponse(state=provider_session.state, session_token=None)
            return RuntimeProviderClaimResponse(
                state=provider_session.state,
                session_token=provider_session.session_token,
            )

    def disconnect_provider_session(self, session_id: str) -> RuntimeProviderSessionSnapshot:
        with self._lock:
            normalized_session_id = self._validate_session_id(session_id)
            session = self._get_session(normalized_session_id)
            provider_session = self._require_provider_session(session)
            provider_session.state = PROVIDER_STATE_DISCONNECTED
            provider_session.disconnected_at = _utc_now_iso()
            provider_session.recording_state = PROVIDER_RECORDING_IDLE
            provider_session.recording_started_at = None
            provider_session.recording_label = None
            self._append_provider_audit(
                provider_session,
                event_type=PROVIDER_EVENT_DISCONNECTED,
                actor=PROVIDER_ACTOR_OPERATOR,
                message="Provider session disconnected.",
            )
            return self._provider_snapshot(normalized_session_id, provider_session)

    def publish_provider_robot_description(
        self,
        session_id: str,
        request: RuntimeProviderRobotDescriptionRequest,
        *,
        session_token: str | None = None,
    ) -> RuntimeProviderRobotDescriptionRequest:
        with self._lock:
            session = self._get_session(session_id)
            self._require_provider_write_access(session, session_token=session_token)
            provider_session = self._require_provider_session(session)
            provider_session.robot_description = self._normalize_robot_description(request)
            self._mark_provider_connected(provider_session)
            self._append_provider_audit(
                provider_session,
                event_type=PROVIDER_EVENT_ROBOT_DESCRIBED,
                actor=PROVIDER_ACTOR_CONNECTOR,
                message="Provider published robot description.",
                metadata={
                    "robot_id": provider_session.robot_description.robot_id,
                    "source_type": provider_session.robot_description.source.source_type,
                },
            )
            return provider_session.robot_description

    def get_provider_robot_description(self, session_id: str) -> RuntimeProviderRobotDescriptionRequest:
        with self._lock:
            session = self._get_session(session_id)
            provider_session = self._require_provider_session(session)
            if provider_session.robot_description is None:
                raise KeyError("Runtime provider robot description not found")
            return provider_session.robot_description

    def start_provider_recording(
        self,
        session_id: str,
        request: RuntimeProviderRecordingRequest,
    ) -> RuntimeProviderSessionSnapshot:
        with self._lock:
            normalized_session_id = self._validate_session_id(session_id)
            session = self._get_session(normalized_session_id)
            provider_session = self._require_provider_session(session)
            if provider_session.state == PROVIDER_STATE_PENDING:
                raise RuntimeProviderSessionStateError(
                    "Approve the provider session before starting a recording."
                )
            provider_session.recording_state = PROVIDER_RECORDING_ACTIVE
            provider_session.recording_started_at = _utc_now_iso()
            provider_session.recording_label = self._normalize_label(
                request.label,
                label="Recording label",
                max_chars=RUNTIME_PROVIDER_LABEL_MAX_CHARS,
            ) or None
            self._append_provider_audit(
                provider_session,
                event_type=PROVIDER_EVENT_RECORDING_STARTED,
                actor=PROVIDER_ACTOR_OPERATOR,
                message="Provider recording started.",
                metadata={"label": provider_session.recording_label or ""},
            )
            return self._provider_snapshot(normalized_session_id, provider_session)

    def stop_provider_recording(self, session_id: str) -> RuntimeProviderSessionSnapshot:
        with self._lock:
            normalized_session_id = self._validate_session_id(session_id)
            session = self._get_session(normalized_session_id)
            provider_session = self._require_provider_session(session)
            if provider_session.recording_state != PROVIDER_RECORDING_ACTIVE:
                raise RuntimeProviderSessionStateError("Provider recording is not active.")
            provider_session.recording_state = PROVIDER_RECORDING_IDLE
            provider_session.recording_started_at = None
            self._append_provider_audit(
                provider_session,
                event_type=PROVIDER_EVENT_RECORDING_STOPPED,
                actor=PROVIDER_ACTOR_OPERATOR,
                message="Provider recording stopped.",
                metadata={"label": provider_session.recording_label or ""},
            )
            provider_session.recording_label = None
            return self._provider_snapshot(normalized_session_id, provider_session)

    def upsert_channels(
        self,
        session_id: str,
        request: RuntimeTelemetryChannelsUpsertRequest,
        *,
        session_token: str | None = None,
    ) -> RuntimeTelemetryChannelsResponse:
        with self._lock:
            session = self._get_or_create_session(session_id)
            self._require_provider_write_access(session, session_token=session_token)
            next_channels = dict(session.channels)
            for channel in request.channels:
                next_channels[str(channel.channel_id)] = channel
            if len(next_channels) > RUNTIME_SESSIONS_MAX_CHANNELS:
                raise RuntimeSessionCapacityError(
                    f"Runtime session channel capacity exceeded ({RUNTIME_SESSIONS_MAX_CHANNELS} channels)."
                )
            session.channels = next_channels
            if session.provider_session is not None:
                self._mark_provider_connected(session.provider_session)
            return RuntimeTelemetryChannelsResponse(channels=list(session.channels.values()))

    def list_channels(self, session_id: str) -> RuntimeTelemetryChannelsResponse:
        with self._lock:
            session = self._get_session(session_id)
            return RuntimeTelemetryChannelsResponse(channels=list(session.channels.values()))

    def upsert_video_refs(
        self,
        session_id: str,
        request: RuntimeVideoRefsUpsertRequest,
        *,
        session_token: str | None = None,
    ) -> RuntimeVideoRefsResponse:
        with self._lock:
            session = self._get_or_create_session(session_id)
            self._require_provider_write_access(session, session_token=session_token)
            next_video_refs = dict(session.video_refs)
            for video_ref in request.video_refs:
                normalized_video_ref = self._normalize_video_ref(video_ref)
                next_video_refs[normalized_video_ref.stream_id] = normalized_video_ref
            if len(next_video_refs) > RUNTIME_SESSIONS_MAX_VIDEO_REFS:
                raise RuntimeSessionCapacityError(
                    f"Runtime session video-ref capacity exceeded ({RUNTIME_SESSIONS_MAX_VIDEO_REFS} streams)."
                )
            session.video_refs = next_video_refs
            if session.provider_session is not None:
                self._mark_provider_connected(session.provider_session)
            return RuntimeVideoRefsResponse(video_refs=list(session.video_refs.values()))

    def list_video_refs(self, session_id: str) -> RuntimeVideoRefsResponse:
        with self._lock:
            session = self._get_session(session_id)
            return RuntimeVideoRefsResponse(video_refs=list(session.video_refs.values()))

    def _normalize_telemetry_envelope(self, envelope: RuntimeTelemetryEnvelope) -> dict[str, Any]:
        return envelope.model_dump(mode="json")

    def ingest_telemetry(
        self,
        session_id: str,
        request: RuntimeTelemetryIngestRequest,
        *,
        session_token: str | None = None,
    ) -> RuntimeSessionStatsResponse:
        with self._lock:
            session = self._get_or_create_session(session_id)
            self._require_provider_write_access(session, session_token=session_token)
            if request.active_transport:
                session.active_transport = request.active_transport.strip() or None
            for envelope in request.envelopes:
                frame = self._normalize_telemetry_envelope(envelope)
                frame_size = len(json.dumps(frame).encode("utf-8"))
                self._append_frame(session, frame, frame_size=frame_size)
                session.total_ingested += 1
            if session.provider_session is not None and request.envelopes:
                self._mark_provider_connected(session.provider_session)
            return self._stats_snapshot(session)

    def list_frames(self, session_id: str) -> RuntimeTelemetryFramesResponse:
        with self._lock:
            session = self._get_session(session_id)
            return RuntimeTelemetryFramesResponse(frames=[stored_frame.payload for stored_frame in session.frames])

    def ingest_command(self, session_id: str, _request: RuntimeCommandRequest) -> RuntimeSessionStatsResponse:
        with self._lock:
            session = self._get_or_create_session(session_id)
            session.command_total += 1
            session.ack_total += 1
            return self._stats_snapshot(session)

    def _stats_snapshot(self, session: _RuntimeSession) -> RuntimeSessionStatsResponse:
        return RuntimeSessionStatsResponse(
            active_transport=session.active_transport,
            total_ingested=session.total_ingested,
            total_dropped=session.total_dropped,
            drop_reasons=dict(session.drop_reasons),
            total_buffered_bytes=session.total_buffered_bytes,
            total_buffered_messages=session.total_buffered_messages,
            command_total=session.command_total,
            ack_total=session.ack_total,
            channels=len(session.channels),
        )

    def stats(self, session_id: str) -> RuntimeSessionStatsResponse:
        with self._lock:
            session = self._get_session(session_id)
            return self._stats_snapshot(session)


runtime_sessions_service = RuntimeSessionsService()
