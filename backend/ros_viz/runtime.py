from __future__ import annotations

from secrets import token_hex
from dataclasses import dataclass, field
from threading import Lock
from time import time, time_ns
from typing import Dict, List, Set
from uuid import uuid4

from backend.models.ros_viz import (
    RosVizClockControlRequest,
    RosVizClockMode,
    RosVizClockState,
    RosVizClockTick,
    RosVizDataSource,
    RosVizDiagnosticEvent,
    RosVizMarker,
    RosVizMarkerDelta,
    RosVizMarkerDeltaBatch,
    RosVizModeProfile,
    RosVizModeUpdateRequest,
    RosVizQosProfile,
    RosVizResolvedFramePose,
    RosVizResolvedFramePoseBatch,
    RosVizRuntimeCapabilities,
    RosVizSessionCreateRequest,
    RosVizSessionMode,
    RosVizSessionSnapshot,
    RosVizSessionStateResponse,
    RosVizStreamTicketResponse,
    RosVizSubscriptionRequest,
    RosVizSubscriptionResponse,
    RosVizTimeSource,
    RosVizTopicCatalogResponse,
    RosVizTopicInfo,
    RosVizTransportSource,
)
from backend.ros_viz.determinism import rolling_session_hash, resolved_pose_batch_hash
from backend.ros_viz.params import (
    DEFAULT_CLOCK_MODE,
    DEFAULT_DETERMINISTIC_MODE,
    DEFAULT_DIAGNOSTIC_CODE,
    DEFAULT_FIXED_FRAME,
    DEFAULT_FRAME_ID_BASE_LINK,
    DEFAULT_FRAME_ID_ELBOW,
    DEFAULT_FRAME_ID_TOOL0,
    DEFAULT_PARENT_BASE,
    DEFAULT_PARENT_WORLD,
    DEFAULT_PLAYBACK_RATE,
    DEFAULT_ROBOT_ID,
    DEFAULT_SUBSCRIBED_TOPIC_IDS,
    DETERMINISTIC_STRICT_EPOCH_NS,
    MARKER_ID_TOOL_SPHERE,
    MARKER_ID_TRAJECTORY_LINE,
    MARKER_NS_STATUS,
    MARKER_NS_TRAJECTORY,
    MARKER_TRAJECTORY_MAX_POINTS,
    ROSVIZ_SESSION_ID_HEX_LENGTH,
    ROSVIZ_SESSION_ID_PREFIX,
    ROSVIZ_STREAM_TICKET_BYTES,
    ROSVIZ_STREAM_TICKET_MAX_ACTIVE_PER_SESSION,
    ROSVIZ_STREAM_TICKET_TTL_MS,
    STREAM_FLAG_PAYLOAD_JSON,
    STREAM_FLAGS_NONE,
    STREAM_SEQUENCE_START,
    STREAM_SEQUENCE_STEP,
    STREAM_TICK_INTERVAL_NS,
    TOPIC_ID_CLOCK_TICK,
    TOPIC_ID_DIAGNOSTIC_EVENT,
    TOPIC_ID_JOINT_STATE_BATCH,
    TOPIC_ID_MARKER_DELTA_BATCH,
    TOPIC_ID_POINTCLOUD_CHUNK,
    TOPIC_ID_RESOLVED_FRAME_POSE_BATCH,
    TOPIC_ID_TF_EDGE_BATCH,
)
from backend.ros_viz.stream_framing import RosVizStreamFrameType, build_stream_frame


STATIC_TOOL_XYZ = [0.35, 0.0, 0.25]
STATIC_ELBOW_XYZ = [0.18, 0.0, 0.18]


def _now_ms() -> int:
    return int(time() * 1000)


def _serialize_model(model) -> bytes:
    return model.model_dump_json().encode("utf-8")


@dataclass(frozen=True)
class RosVizModeSpec:
    data_source: RosVizDataSource
    clock_mode: RosVizClockMode
    time_source: RosVizTimeSource
    transport_source: RosVizTransportSource
    is_playing: bool
    capabilities: RosVizRuntimeCapabilities


_MODE_SPECS: dict[RosVizSessionMode, RosVizModeSpec] = {
    "live_debug": RosVizModeSpec(
        data_source="live_ros",
        clock_mode="live",
        time_source="ros_clock",
        transport_source="ros_topics",
        is_playing=True,
        capabilities=RosVizRuntimeCapabilities(
            can_toggle_play=False,
            can_step=False,
            can_seek=False,
            can_set_playback_rate=False,
        ),
    ),
}


@dataclass
class RosVizSessionState:
    session_id: str
    fixed_frame: str
    created_at_ms: int
    updated_at_ms: int
    ros_domain_id: int | None = None
    deterministic_mode: str = DEFAULT_DETERMINISTIC_MODE
    mode_profile: RosVizModeProfile = "ros_debug"
    data_source: RosVizDataSource = "live_ros"
    session_mode: RosVizSessionMode = "live_debug"
    time_source: RosVizTimeSource = "ros_clock"
    transport_source: RosVizTransportSource = "ros_topics"
    clock_mode: RosVizClockMode = DEFAULT_CLOCK_MODE
    is_playing: bool = True
    playback_rate: float = DEFAULT_PLAYBACK_RATE
    capabilities: RosVizRuntimeCapabilities = field(default_factory=RosVizRuntimeCapabilities)
    next_sequence: int = STREAM_SEQUENCE_START
    subscribed_topic_ids: Set[int] = field(default_factory=lambda: set(DEFAULT_SUBSCRIBED_TOPIC_IDS))
    tick_index: int = 0
    deterministic_epoch_ns: int = field(default_factory=time_ns)
    deterministic_session_hash: str = ""
    tool_trail_xyz: list[list[float]] = field(default_factory=list)


@dataclass(frozen=True)
class RosVizStreamTicketState:
    ticket: str
    session_id: str
    client_host: str
    issued_request_id: str
    issued_at_ms: int
    expires_at_ms: int


class RosVizRuntime:
    def __init__(self) -> None:
        self._lock = Lock()
        self._sessions: Dict[str, RosVizSessionState] = {}
        self._stream_tickets: Dict[str, RosVizStreamTicketState] = {}
        self._topics = self._build_default_topics()

    def _build_default_topics(self) -> List[RosVizTopicInfo]:
        return [
            RosVizTopicInfo(
                topic_id=TOPIC_ID_TF_EDGE_BATCH,
                name="/tf",
                schema="tf2_msgs/TFMessage",
                encoding="json",
                qos=RosVizQosProfile(reliability="reliable", durability="volatile", history="keep_last", depth=100),
            ),
            RosVizTopicInfo(
                topic_id=TOPIC_ID_RESOLVED_FRAME_POSE_BATCH,
                name="/rosviz/resolved_tf",
                schema="urdf_studio/ResolvedFramePoseBatchV1",
                encoding="json",
                qos=RosVizQosProfile(reliability="reliable", durability="volatile", history="keep_last", depth=10),
            ),
            RosVizTopicInfo(
                topic_id=TOPIC_ID_MARKER_DELTA_BATCH,
                name="/visualization_marker_array",
                schema="urdf_studio/MarkerDeltaBatchV1",
                encoding="json",
                qos=RosVizQosProfile(reliability="reliable", durability="volatile", history="keep_last", depth=10),
            ),
            RosVizTopicInfo(
                topic_id=TOPIC_ID_POINTCLOUD_CHUNK,
                name="/point_cloud",
                schema="sensor_msgs/PointCloud2",
                encoding="json",
                qos=RosVizQosProfile(reliability="best_effort", durability="volatile", history="keep_last", depth=5),
            ),
            RosVizTopicInfo(
                topic_id=TOPIC_ID_JOINT_STATE_BATCH,
                name="/joint_states",
                schema="sensor_msgs/JointState",
                encoding="json",
                qos=RosVizQosProfile(reliability="reliable", durability="volatile", history="keep_last", depth=10),
            ),
            RosVizTopicInfo(
                topic_id=TOPIC_ID_CLOCK_TICK,
                name="/clock",
                schema="rosgraph_msgs/Clock",
                encoding="json",
                qos=RosVizQosProfile(reliability="reliable", durability="volatile", history="keep_last", depth=10),
            ),
            RosVizTopicInfo(
                topic_id=TOPIC_ID_DIAGNOSTIC_EVENT,
                name="/rosviz/diagnostic",
                schema="urdf_studio/DiagnosticEventV1",
                encoding="json",
                qos=RosVizQosProfile(reliability="reliable", durability="volatile", history="keep_last", depth=10),
            ),
        ]

    def _next_session_id(self) -> str:
        token = uuid4().hex[:ROSVIZ_SESSION_ID_HEX_LENGTH]
        return f"{ROSVIZ_SESSION_ID_PREFIX}-{token}"

    def _to_snapshot(self, session: RosVizSessionState) -> RosVizSessionSnapshot:
        return RosVizSessionSnapshot(
            session_id=session.session_id,
            created_at_ms=session.created_at_ms,
            updated_at_ms=session.updated_at_ms,
            fixed_frame=session.fixed_frame,
            ros_domain_id=session.ros_domain_id,
            deterministic_mode=session.deterministic_mode,
            mode_profile=session.mode_profile,
            data_source=session.data_source,
            session_mode=session.session_mode,
            topic_count=len(self._topics),
            next_sequence=session.next_sequence,
            deterministic_session_hash=session.deterministic_session_hash,
        )

    def _to_clock_state(self, session: RosVizSessionState) -> RosVizClockState:
        return RosVizClockState(
            session_id=session.session_id,
            mode=session.clock_mode,
            is_playing=session.is_playing,
            tick_index=session.tick_index,
            tick_ns=self._tick_time_ns(session),
            playback_rate=session.playback_rate,
            data_source=session.data_source,
            session_mode=session.session_mode,
            can_control=self._clock_can_control(session),
            updated_at_ms=session.updated_at_ms,
        )

    def _to_session_state(self, session: RosVizSessionState) -> RosVizSessionStateResponse:
        return RosVizSessionStateResponse(
            session_id=session.session_id,
            mode=session.session_mode,
            fixed_frame=session.fixed_frame,
            deterministic_mode=session.deterministic_mode,
            data_source=session.data_source,
            time_source=session.time_source,
            transport_source=session.transport_source,
            clock_mode=session.clock_mode,
            is_playing=session.is_playing,
            tick_index=session.tick_index,
            tick_ns=self._tick_time_ns(session),
            playback_rate=session.playback_rate,
            capabilities=session.capabilities,
            updated_at_ms=session.updated_at_ms,
        )

    def _normalize_data_source(self, req: RosVizSessionCreateRequest) -> RosVizDataSource:
        return req.data_source

    def _default_mode_for_source(self, _data_source: RosVizDataSource) -> RosVizSessionMode:
        return "live_debug"

    def _mode_spec(self, mode: RosVizSessionMode) -> RosVizModeSpec:
        return _MODE_SPECS[mode]

    def _clock_can_control(self, session: RosVizSessionState) -> bool:
        caps = session.capabilities
        return bool(
            caps.can_toggle_play
            or caps.can_step
            or caps.can_seek
            or caps.can_set_playback_rate
        )

    def _normalize_client_host(self, client_host: str | None) -> str:
        return (client_host or "").strip().lower()

    def _prune_expired_stream_tickets(self, now_ms: int) -> None:
        expired_ticket_ids = [
            ticket
            for ticket, ticket_state in self._stream_tickets.items()
            if ticket_state.expires_at_ms <= now_ms
        ]
        for ticket in expired_ticket_ids:
            self._stream_tickets.pop(ticket, None)

    def _trim_session_stream_tickets(self, session_id: str) -> None:
        session_tickets = [
            ticket_state
            for ticket_state in self._stream_tickets.values()
            if ticket_state.session_id == session_id
        ]
        session_tickets.sort(key=lambda ticket_state: ticket_state.issued_at_ms)
        overflow = len(session_tickets) - ROSVIZ_STREAM_TICKET_MAX_ACTIVE_PER_SESSION + 1
        if overflow <= 0:
            return
        for ticket_state in session_tickets[:overflow]:
            self._stream_tickets.pop(ticket_state.ticket, None)

    def _apply_mode_to_session(self, session: RosVizSessionState, mode: RosVizSessionMode) -> None:
        spec = self._mode_spec(mode)
        session.session_mode = mode
        session.data_source = spec.data_source
        session.clock_mode = spec.clock_mode
        session.time_source = spec.time_source
        session.transport_source = spec.transport_source
        session.is_playing = spec.is_playing
        session.capabilities = spec.capabilities.model_copy(deep=True)
        session.playback_rate = DEFAULT_PLAYBACK_RATE
        session.tick_index = 0
        session.tool_trail_xyz.clear()
        session.deterministic_session_hash = ""

    def create_session(self, req: RosVizSessionCreateRequest) -> RosVizSessionSnapshot:
        now_ms = _now_ms()
        fixed_frame = req.fixed_frame.strip() if req.fixed_frame else DEFAULT_FIXED_FRAME
        if not fixed_frame:
            raise ValueError("fixed_frame must not be empty.")

        deterministic_mode = req.deterministic_mode
        deterministic_epoch_ns = (
            DETERMINISTIC_STRICT_EPOCH_NS
            if deterministic_mode == "strict"
            else time_ns()
        )
        base_data_source = self._normalize_data_source(req)
        session_mode = req.session_mode or self._default_mode_for_source(base_data_source)

        session = RosVizSessionState(
            session_id=self._next_session_id(),
            fixed_frame=fixed_frame,
            ros_domain_id=req.ros_domain_id,
            deterministic_mode=deterministic_mode,
            mode_profile=req.mode_profile,
            created_at_ms=now_ms,
            updated_at_ms=now_ms,
            deterministic_epoch_ns=deterministic_epoch_ns,
        )
        self._apply_mode_to_session(session, session_mode)

        with self._lock:
            self._sessions[session.session_id] = session
            return self._to_snapshot(session)

    def issue_stream_ticket(
        self,
        session_id: str,
        *,
        client_host: str | None,
        request_id: str,
    ) -> RosVizStreamTicketResponse:
        now_ms = _now_ms()
        normalized_client_host = self._normalize_client_host(client_host)

        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise KeyError(f"Session '{session_id}' not found")

            self._prune_expired_stream_tickets(now_ms)
            self._trim_session_stream_tickets(session_id)

            ticket = token_hex(ROSVIZ_STREAM_TICKET_BYTES)
            expires_at_ms = now_ms + ROSVIZ_STREAM_TICKET_TTL_MS
            self._stream_tickets[ticket] = RosVizStreamTicketState(
                ticket=ticket,
                session_id=session.session_id,
                client_host=normalized_client_host,
                issued_request_id=request_id,
                issued_at_ms=now_ms,
                expires_at_ms=expires_at_ms,
            )
            return RosVizStreamTicketResponse(
                session_id=session.session_id,
                ticket=ticket,
                expires_at_ms=expires_at_ms,
            )

    def consume_stream_ticket(
        self,
        session_id: str,
        *,
        ticket: str,
        client_host: str | None,
    ) -> None:
        now_ms = _now_ms()
        normalized_client_host = self._normalize_client_host(client_host)

        with self._lock:
            self._prune_expired_stream_tickets(now_ms)

            ticket_state = self._stream_tickets.get(ticket)
            if ticket_state is None:
                raise PermissionError("ROS viz stream ticket is missing, expired, or already used.")
            if ticket_state.session_id != session_id:
                raise PermissionError("ROS viz stream ticket does not match the requested session.")
            if ticket_state.client_host != normalized_client_host:
                raise PermissionError("ROS viz stream ticket is not valid for this client.")

            self._stream_tickets.pop(ticket, None)

    def list_sessions(self) -> list[RosVizSessionSnapshot]:
        with self._lock:
            return [self._to_snapshot(session) for session in self._sessions.values()]

    def get_session(self, session_id: str) -> RosVizSessionSnapshot:
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise KeyError(f"Session '{session_id}' not found")
            return self._to_snapshot(session)

    def get_session_state(self, session_id: str) -> RosVizSessionStateResponse:
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise KeyError(f"Session '{session_id}' not found")
            return self._to_session_state(session)

    def update_session_mode(
        self,
        session_id: str,
        req: RosVizModeUpdateRequest,
    ) -> RosVizSessionStateResponse:
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise KeyError(f"Session '{session_id}' not found")

            self._apply_mode_to_session(session, req.mode)
            session.updated_at_ms = _now_ms()
            return self._to_session_state(session)

    def get_clock_state(self, session_id: str) -> RosVizClockState:
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise KeyError(f"Session '{session_id}' not found")
            return self._to_clock_state(session)

    def update_clock_control(self, session_id: str, req: RosVizClockControlRequest) -> RosVizClockState:
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise KeyError(f"Session '{session_id}' not found")

            if req.mode is not None:
                session.clock_mode = req.mode

            if req.is_playing is not None:
                if not session.capabilities.can_toggle_play:
                    raise ValueError(f"Session mode '{session.session_mode}' does not support play/pause control.")
                session.is_playing = req.is_playing

            if req.playback_rate is not None:
                if not session.capabilities.can_set_playback_rate:
                    raise ValueError(f"Session mode '{session.session_mode}' does not support playback-rate control.")
                session.playback_rate = req.playback_rate

            if req.seek_tick_index is not None:
                if not session.capabilities.can_seek:
                    raise ValueError(f"Session mode '{session.session_mode}' does not support timeline seek.")
                session.tick_index = req.seek_tick_index
                session.tool_trail_xyz.clear()
                session.deterministic_session_hash = ""

            if req.step_ticks > 0:
                if not session.capabilities.can_step:
                    raise ValueError(f"Session mode '{session.session_mode}' does not support stepping.")
                session.tick_index += req.step_ticks

            session.updated_at_ms = _now_ms()
            return self._to_clock_state(session)

    def list_topics(self, session_id: str) -> RosVizTopicCatalogResponse:
        with self._lock:
            if session_id not in self._sessions:
                raise KeyError(f"Session '{session_id}' not found")
            return RosVizTopicCatalogResponse(session_id=session_id, topics=list(self._topics))

    def update_subscriptions(
        self,
        session_id: str,
        req: RosVizSubscriptionRequest,
    ) -> RosVizSubscriptionResponse:
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise KeyError(f"Session '{session_id}' not found")

            valid_topic_ids = {topic.topic_id for topic in self._topics}
            requested_ids = set(req.topic_ids)
            unknown_ids = sorted(requested_ids.difference(valid_topic_ids))
            if unknown_ids:
                raise ValueError(f"Unknown topic IDs: {unknown_ids}")

            subscribed_ids = set(requested_ids)
            if req.include_clock:
                subscribed_ids.add(TOPIC_ID_CLOCK_TICK)
            session.subscribed_topic_ids = subscribed_ids
            session.updated_at_ms = _now_ms()

            return RosVizSubscriptionResponse(
                session_id=session_id,
                subscribed_topic_ids=sorted(subscribed_ids),
                include_clock=req.include_clock,
            )

    def _next_sequence(self, session: RosVizSessionState) -> int:
        seq = session.next_sequence
        session.next_sequence += STREAM_SEQUENCE_STEP
        return seq

    def _tick_time_ns(self, session: RosVizSessionState) -> int:
        return session.deterministic_epoch_ns + (session.tick_index * STREAM_TICK_INTERVAL_NS)

    def _tick_step_for_next_emit(self, session: RosVizSessionState) -> int:
        if session.is_playing:
            return max(1, int(round(session.playback_rate)))
        return 0

    def _resolve_link_poses(self, session: RosVizSessionState) -> tuple[list[float], list[float]]:
        return list(STATIC_TOOL_XYZ), list(STATIC_ELBOW_XYZ)

    def _append_tool_trail(self, session: RosVizSessionState, tool_xyz: list[float]) -> None:
        if session.tool_trail_xyz:
            last = session.tool_trail_xyz[-1]
            if all(abs(last[index] - tool_xyz[index]) < 1e-9 for index in range(3)):
                return
        session.tool_trail_xyz.append(list(tool_xyz))
        overflow = len(session.tool_trail_xyz) - MARKER_TRAJECTORY_MAX_POINTS
        if overflow > 0:
            del session.tool_trail_xyz[:overflow]

    def _build_resolved_pose_batch(
        self,
        session: RosVizSessionState,
        t_ns: int,
        tool_xyz: list[float],
        elbow_xyz: list[float],
    ) -> RosVizResolvedFramePoseBatch:
        poses = [
            RosVizResolvedFramePose(
                robot_id=DEFAULT_ROBOT_ID,
                frame_id=DEFAULT_FRAME_ID_BASE_LINK,
                parent_frame_id=DEFAULT_PARENT_WORLD,
                translation_xyz=[0.0, 0.0, 0.0],
                quaternion_xyzw=[0.0, 0.0, 0.0, 1.0],
            ),
            RosVizResolvedFramePose(
                robot_id=DEFAULT_ROBOT_ID,
                frame_id=DEFAULT_FRAME_ID_ELBOW,
                parent_frame_id=DEFAULT_PARENT_BASE,
                translation_xyz=elbow_xyz,
                quaternion_xyzw=[0.0, 0.0, 0.0, 1.0],
            ),
            RosVizResolvedFramePose(
                robot_id=DEFAULT_ROBOT_ID,
                frame_id=DEFAULT_FRAME_ID_TOOL0,
                parent_frame_id=DEFAULT_FRAME_ID_ELBOW,
                translation_xyz=tool_xyz,
                quaternion_xyzw=[0.0, 0.0, 0.0, 1.0],
            ),
        ]

        pose_hash = resolved_pose_batch_hash(
            fixed_frame=session.fixed_frame,
            t_ns=t_ns,
            poses=poses,
        )

        return RosVizResolvedFramePoseBatch(
            fixed_frame=session.fixed_frame,
            t_ns=t_ns,
            pose_hash=pose_hash,
            poses=poses,
        )

    def _build_marker_delta_batch(
        self,
        session: RosVizSessionState,
        t_ns: int,
        tool_xyz: list[float],
    ) -> RosVizMarkerDeltaBatch:
        self._append_tool_trail(session, tool_xyz)
        deltas: list[RosVizMarkerDelta] = [
            RosVizMarkerDelta(
                action="add_or_modify",
                namespace=MARKER_NS_TRAJECTORY,
                marker_id=MARKER_ID_TRAJECTORY_LINE,
                marker=RosVizMarker(
                    namespace=MARKER_NS_TRAJECTORY,
                    marker_id=MARKER_ID_TRAJECTORY_LINE,
                    frame_id=session.fixed_frame,
                    marker_type="line_strip",
                    scale_xyz=[0.01, 0.01, 0.01],
                    color_rgba=[0.12, 0.78, 1.0, 0.96],
                    points_xyz=list(session.tool_trail_xyz),
                    lifetime_ms=0,
                ),
            ),
            RosVizMarkerDelta(
                action="add_or_modify",
                namespace=MARKER_NS_STATUS,
                marker_id=MARKER_ID_TOOL_SPHERE,
                marker=RosVizMarker(
                    namespace=MARKER_NS_STATUS,
                    marker_id=MARKER_ID_TOOL_SPHERE,
                    frame_id=session.fixed_frame,
                    marker_type="sphere",
                    pose_position_xyz=tool_xyz,
                    scale_xyz=[0.025, 0.025, 0.025],
                    color_rgba=[1.0, 0.84, 0.15, 0.95],
                    lifetime_ms=0,
                ),
            ),
        ]
        return RosVizMarkerDeltaBatch(
            fixed_frame=session.fixed_frame,
            t_ns=t_ns,
            deltas=deltas,
        )

    def build_stream_frames(self, session_id: str) -> list[bytes]:
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise KeyError(f"Session '{session_id}' not found")

            tick_ns = self._tick_time_ns(session)
            tool_xyz, elbow_xyz = self._resolve_link_poses(session)
            frames: list[bytes] = []
            pose_hash = ""

            if TOPIC_ID_CLOCK_TICK in session.subscribed_topic_ids:
                clock_payload = _serialize_model(
                    RosVizClockTick(
                        mode=session.clock_mode,
                        t_ns=tick_ns,
                        tick_index=session.tick_index,
                    )
                )
                frames.append(
                    build_stream_frame(
                        RosVizStreamFrameType.CLOCK_TICK,
                        flags=STREAM_FLAG_PAYLOAD_JSON,
                        seq=self._next_sequence(session),
                        t_ns=tick_ns,
                        topic_id=TOPIC_ID_CLOCK_TICK,
                        payload=clock_payload,
                    )
                )

            if TOPIC_ID_RESOLVED_FRAME_POSE_BATCH in session.subscribed_topic_ids:
                resolved_batch = self._build_resolved_pose_batch(
                    session=session,
                    t_ns=tick_ns,
                    tool_xyz=tool_xyz,
                    elbow_xyz=elbow_xyz,
                )
                pose_hash = resolved_batch.pose_hash
                session.deterministic_session_hash = rolling_session_hash(
                    session.deterministic_session_hash,
                    resolved_batch.pose_hash,
                )
                frames.append(
                    build_stream_frame(
                        RosVizStreamFrameType.RESOLVED_FRAME_POSE_BATCH,
                        flags=STREAM_FLAG_PAYLOAD_JSON,
                        seq=self._next_sequence(session),
                        t_ns=tick_ns,
                        topic_id=TOPIC_ID_RESOLVED_FRAME_POSE_BATCH,
                        payload=_serialize_model(resolved_batch),
                    )
                )

            if TOPIC_ID_MARKER_DELTA_BATCH in session.subscribed_topic_ids:
                marker_batch = self._build_marker_delta_batch(
                    session=session,
                    t_ns=tick_ns,
                    tool_xyz=tool_xyz,
                )
                frames.append(
                    build_stream_frame(
                        RosVizStreamFrameType.MARKER_DELTA_BATCH,
                        flags=STREAM_FLAG_PAYLOAD_JSON,
                        seq=self._next_sequence(session),
                        t_ns=tick_ns,
                        topic_id=TOPIC_ID_MARKER_DELTA_BATCH,
                        payload=_serialize_model(marker_batch),
                    )
                )

            if TOPIC_ID_DIAGNOSTIC_EVENT in session.subscribed_topic_ids:
                diagnostics = RosVizDiagnosticEvent(
                    code=DEFAULT_DIAGNOSTIC_CODE,
                    severity="info",
                    message=f"ROS viz stream active; awaiting ROS data ({session.deterministic_mode}).",
                    details={
                        "deterministic_mode": session.deterministic_mode,
                        "mode_profile": session.mode_profile,
                        "mode": session.session_mode,
                        "data_source": session.data_source,
                        "time_source": session.time_source,
                        "transport_source": session.transport_source,
                        "clock_mode": session.clock_mode,
                        "is_playing": str(session.is_playing).lower(),
                        "playback_rate": f"{session.playback_rate:.2f}",
                        "tick_index": str(session.tick_index),
                        "pose_hash": pose_hash,
                        "session_hash": session.deterministic_session_hash,
                        "motion_source": "static_waiting_for_ros",
                    },
                )
                frames.append(
                    build_stream_frame(
                        RosVizStreamFrameType.DIAGNOSTIC_EVENT,
                        flags=STREAM_FLAG_PAYLOAD_JSON,
                        seq=self._next_sequence(session),
                        t_ns=tick_ns,
                        topic_id=TOPIC_ID_DIAGNOSTIC_EVENT,
                        payload=_serialize_model(diagnostics),
                    )
                )

            if not frames:
                frames.append(
                    build_stream_frame(
                        RosVizStreamFrameType.DIAGNOSTIC_EVENT,
                        flags=STREAM_FLAGS_NONE,
                        seq=self._next_sequence(session),
                        t_ns=tick_ns,
                        topic_id=TOPIC_ID_DIAGNOSTIC_EVENT,
                        payload=b"",
                    )
                )

            session.tick_index += self._tick_step_for_next_emit(session)
            session.updated_at_ms = _now_ms()
            return frames
