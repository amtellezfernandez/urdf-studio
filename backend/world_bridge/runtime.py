from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from threading import Lock
from time import time
from typing import Deque, Dict, List, Set
from uuid import uuid4

from backend.services.attestation import attestation_status_store
from backend.world_bridge.params import (
    COMMAND_SEQUENCE_START,
    COMMAND_SEQUENCE_STEP,
    EVENT_ID_PREFIX,
    MAX_ACTIVE_SESSIONS,
    MAX_CAMERAS_PER_SESSION,
    MAX_EVENTS_PER_SESSION,
    MAX_JOINTS_PER_COMMAND,
    MAX_TRACKED_EXTERNAL_SESSIONS,
    MAX_TRANSITIONS_PER_SESSION,
    SESSION_ID_HEX_LENGTH,
    SESSION_ID_PREFIX,
    TRANSITION_ID_PREFIX,
    WORLD_BRIDGE_SESSION_IDLE_TTL_MS,
)
from backend.world_bridge.readiness import evaluate_world_bridge_readiness
from backend.world_bridge.types import (
    WorldBridgeCommandAck,
    WorldBridgeEvent,
    WorldBridgeEventType,
    WorldBridgeJointCommandRequest,
    WorldBridgeReadinessMetrics,
    WorldBridgeReadinessResponse,
    WorldBridgeRolloutMode,
    WorldBridgeScenarioTimeUpdateRequest,
    WorldBridgeSessionCreateRequest,
    WorldBridgeSessionSnapshot,
    WorldBridgeStatusResponse,
    WorldBridgeTransitionRecord,
    WorldBridgeTransitionType,
)


def _now_ms() -> int:
    return int(time() * 1000)


def _clamp_scenario_time(time_ms: int, duration_ms: int) -> int:
    if time_ms < 0:
        return 0
    if time_ms > duration_ms:
        return duration_ms
    return time_ms


@dataclass
class WorldBridgeSessionState:
    session_id: str
    robot_name: str
    urdf_sha256: str | None
    camera_ids: List[str]
    scenario_duration_ms: int
    created_at_ms: int
    updated_at_ms: int
    scenario_time_ms: int = 0
    last_command_sequence: int = 0
    event_counter: int = 0
    transition_counter: int = 0
    joint_state: Dict[str, float] = field(default_factory=dict)
    recent_events: Deque[WorldBridgeEvent] = field(
        default_factory=lambda: deque(maxlen=MAX_EVENTS_PER_SESSION)
    )
    recent_transitions: Deque[WorldBridgeTransitionRecord] = field(
        default_factory=lambda: deque(maxlen=MAX_TRANSITIONS_PER_SESSION)
    )


@dataclass
class WorldBridgeReadinessState:
    total_sessions: int = 0
    total_joint_commands: int = 0
    total_scenario_time_updates: int = 0
    total_transitions: int = 0
    counterfactual_transition_count: int = 0
    live_rollout_transition_count: int = 0
    robot_names: Set[str] = field(default_factory=set)
    planner_ids: Set[str] = field(default_factory=set)
    task_ids: Set[str] = field(default_factory=set)
    adapter_ids: Set[str] = field(default_factory=set)
    external_robot_by_session_id: Dict[str, str] = field(default_factory=dict)


class WorldBridgeRuntime:
    def __init__(self) -> None:
        self._lock = Lock()
        self._sessions: Dict[str, WorldBridgeSessionState] = {}
        self._readiness = WorldBridgeReadinessState()

    def _prune_idle_sessions_locked(self, now_ms: int) -> None:
        expired_session_ids = [
            session_id
            for session_id, session in self._sessions.items()
            if now_ms - session.updated_at_ms > WORLD_BRIDGE_SESSION_IDLE_TTL_MS
        ]
        for session_id in expired_session_ids:
            self._sessions.pop(session_id, None)

    def _remember_external_session_locked(self, session_id: str, robot_name: str) -> None:
        if session_id in self._readiness.external_robot_by_session_id:
            self._readiness.external_robot_by_session_id.pop(session_id, None)
        self._readiness.external_robot_by_session_id[session_id] = robot_name
        while len(self._readiness.external_robot_by_session_id) > MAX_TRACKED_EXTERNAL_SESSIONS:
            oldest_session_id = next(iter(self._readiness.external_robot_by_session_id))
            self._readiness.external_robot_by_session_id.pop(oldest_session_id, None)

    def _next_session_id(self) -> str:
        token = uuid4().hex[:SESSION_ID_HEX_LENGTH]
        return f"{SESSION_ID_PREFIX}-{token}"

    def _append_event(
        self,
        session: WorldBridgeSessionState,
        event_type: WorldBridgeEventType,
        payload: Dict[str, object],
        timestamp_ms: int,
    ) -> None:
        session.event_counter += 1
        event = WorldBridgeEvent(
            event_id=f"{EVENT_ID_PREFIX}-{session.session_id}-{session.event_counter}",
            session_id=session.session_id,
            type=event_type,
            timestamp_ms=timestamp_ms,
            payload=payload,
        )
        session.recent_events.append(event)

    def _append_transition(
        self,
        *,
        session: WorldBridgeSessionState,
        transition_type: WorldBridgeTransitionType,
        source: str,
        sequence_id: int | None,
        planner_id: str | None,
        task_id: str | None,
        adapter_id: str | None,
        rollout_mode: WorldBridgeRolloutMode,
        scenario_time_before_ms: int,
        scenario_time_after_ms: int,
        joint_state_before: Dict[str, float],
        action_joint_positions: Dict[str, float],
        joint_state_after: Dict[str, float],
        timestamp_ms: int,
    ) -> None:
        session.transition_counter += 1
        transition = WorldBridgeTransitionRecord(
            transition_id=(
                f"{TRANSITION_ID_PREFIX}-{session.session_id}-{session.transition_counter}"
            ),
            session_id=session.session_id,
            type=transition_type,
            timestamp_ms=timestamp_ms,
            source=source,
            sequence_id=sequence_id,
            planner_id=planner_id,
            task_id=task_id,
            adapter_id=adapter_id,
            rollout_mode=rollout_mode,
            scenario_time_before_ms=scenario_time_before_ms,
            scenario_time_after_ms=scenario_time_after_ms,
            joint_state_before=joint_state_before,
            action_joint_positions=action_joint_positions,
            joint_state_after=joint_state_after,
        )
        session.recent_transitions.append(transition)

    def _record_identity(
        self,
        *,
        robot_name: str | None = None,
        planner_id: str | None = None,
        task_id: str | None = None,
        adapter_id: str | None = None,
    ) -> None:
        if robot_name:
            self._readiness.robot_names.add(robot_name)
        if planner_id:
            self._readiness.planner_ids.add(planner_id)
        if task_id:
            self._readiness.task_ids.add(task_id)
        if adapter_id:
            self._readiness.adapter_ids.add(adapter_id)

    def _record_rollout_mode(
        self,
        *,
        rollout_mode: WorldBridgeRolloutMode,
        transition_count: int = 1,
    ) -> None:
        if rollout_mode == WorldBridgeRolloutMode.COUNTERFACTUAL:
            self._readiness.counterfactual_transition_count += transition_count
        if rollout_mode == WorldBridgeRolloutMode.LIVE:
            self._readiness.live_rollout_transition_count += transition_count

    def _record_session_creation(
        self,
        *,
        robot_name: str,
        planner_id: str | None,
        task_id: str | None,
        adapter_id: str | None,
    ) -> None:
        self._readiness.total_sessions += 1
        self._record_identity(
            robot_name=robot_name,
            planner_id=planner_id,
            task_id=task_id,
            adapter_id=adapter_id,
        )

    def _record_joint_command(
        self,
        *,
        robot_name: str,
        planner_id: str | None,
        task_id: str | None,
        adapter_id: str | None,
        rollout_mode: WorldBridgeRolloutMode,
    ) -> None:
        self._readiness.total_joint_commands += 1
        self._readiness.total_transitions += 1
        self._record_identity(
            robot_name=robot_name,
            planner_id=planner_id,
            task_id=task_id,
            adapter_id=adapter_id,
        )
        self._record_rollout_mode(rollout_mode=rollout_mode)

    def _record_scenario_time_update(
        self,
        *,
        robot_name: str,
        planner_id: str | None,
        task_id: str | None,
        adapter_id: str | None,
        rollout_mode: WorldBridgeRolloutMode,
    ) -> None:
        self._readiness.total_scenario_time_updates += 1
        self._readiness.total_transitions += 1
        self._record_identity(
            robot_name=robot_name,
            planner_id=planner_id,
            task_id=task_id,
            adapter_id=adapter_id,
        )
        self._record_rollout_mode(rollout_mode=rollout_mode)

    def _to_readiness_metrics(self) -> WorldBridgeReadinessMetrics:
        return WorldBridgeReadinessMetrics(
            total_sessions=self._readiness.total_sessions,
            total_joint_commands=self._readiness.total_joint_commands,
            total_scenario_time_updates=self._readiness.total_scenario_time_updates,
            total_transitions=self._readiness.total_transitions,
            unique_robot_count=len(self._readiness.robot_names),
            unique_planner_count=len(self._readiness.planner_ids),
            unique_task_count=len(self._readiness.task_ids),
            unique_adapter_count=len(self._readiness.adapter_ids),
            counterfactual_transition_count=(
                self._readiness.counterfactual_transition_count
            ),
            live_rollout_transition_count=self._readiness.live_rollout_transition_count,
        )

    def _to_snapshot(
        self,
        session: WorldBridgeSessionState,
        *,
        include_trace: bool,
    ) -> WorldBridgeSessionSnapshot:
        return WorldBridgeSessionSnapshot(
            session_id=session.session_id,
            robot_name=session.robot_name,
            urdf_sha256=session.urdf_sha256,
            camera_ids=list(session.camera_ids),
            created_at_ms=session.created_at_ms,
            updated_at_ms=session.updated_at_ms,
            scenario_duration_ms=session.scenario_duration_ms,
            scenario_time_ms=session.scenario_time_ms,
            joint_state=dict(session.joint_state),
            last_command_sequence=session.last_command_sequence,
            recent_events=list(session.recent_events) if include_trace else [],
            recent_transitions=list(session.recent_transitions) if include_trace else [],
            attestation=attestation_status_store.summary(session.robot_name),
        )

    def _resolve_sequence(
        self, session: WorldBridgeSessionState, requested_sequence: int | None
    ) -> int:
        if requested_sequence is None:
            return (
                COMMAND_SEQUENCE_START
                if session.last_command_sequence == 0
                else session.last_command_sequence + COMMAND_SEQUENCE_STEP
            )
        if requested_sequence <= session.last_command_sequence:
            return session.last_command_sequence + COMMAND_SEQUENCE_STEP
        return requested_sequence

    def get_status(self) -> WorldBridgeStatusResponse:
        with self._lock:
            self._prune_idle_sessions_locked(_now_ms())
            return WorldBridgeStatusResponse(active_sessions=len(self._sessions))

    def get_readiness(self) -> WorldBridgeReadinessResponse:
        with self._lock:
            return evaluate_world_bridge_readiness(self._to_readiness_metrics())

    def record_external_session_create(
        self,
        req: WorldBridgeSessionCreateRequest,
        *,
        session_id: str | None = None,
    ) -> None:
        with self._lock:
            self._record_session_creation(
                robot_name=req.robot_name,
                planner_id=req.planner_id,
                task_id=req.task_id,
                adapter_id=req.adapter_id,
            )
            if session_id:
                self._remember_external_session_locked(session_id, req.robot_name)

    def record_external_joint_command(
        self,
        *,
        session_id: str,
        robot_name: str | None,
        req: WorldBridgeJointCommandRequest,
    ) -> None:
        with self._lock:
            resolved_robot_name = robot_name
            if resolved_robot_name is None:
                resolved_robot_name = self._readiness.external_robot_by_session_id.get(
                    session_id
                )
            self._record_joint_command(
                robot_name=resolved_robot_name or "",
                planner_id=req.planner_id,
                task_id=req.task_id,
                adapter_id=req.adapter_id,
                rollout_mode=req.rollout_mode,
            )

    def record_external_scenario_time_update(
        self,
        *,
        session_id: str,
        robot_name: str | None,
        req: WorldBridgeScenarioTimeUpdateRequest,
    ) -> None:
        with self._lock:
            resolved_robot_name = robot_name
            if resolved_robot_name is None:
                resolved_robot_name = self._readiness.external_robot_by_session_id.get(
                    session_id
                )
            self._record_scenario_time_update(
                robot_name=resolved_robot_name or "",
                planner_id=req.planner_id,
                task_id=req.task_id,
                adapter_id=req.adapter_id,
                rollout_mode=req.rollout_mode,
            )

    def resolve_robot_name(self, session_id: str) -> str | None:
        with self._lock:
            self._prune_idle_sessions_locked(_now_ms())
            session = self._sessions.get(session_id)
            if session is not None:
                return session.robot_name
            return self._readiness.external_robot_by_session_id.get(session_id)

    def list_sessions(
        self,
        *,
        include_trace: bool = False,
    ) -> List[WorldBridgeSessionSnapshot]:
        with self._lock:
            self._prune_idle_sessions_locked(_now_ms())
            return [
                self._to_snapshot(session, include_trace=include_trace)
                for session in self._sessions.values()
            ]

    def create_session(
        self, req: WorldBridgeSessionCreateRequest
    ) -> WorldBridgeSessionSnapshot:
        if len(req.camera_ids) > MAX_CAMERAS_PER_SESSION:
            raise ValueError(
                f"camera_ids exceeded max size: {len(req.camera_ids)} > {MAX_CAMERAS_PER_SESSION}"
            )

        with self._lock:
            now_ms = _now_ms()
            self._prune_idle_sessions_locked(now_ms)
            if len(self._sessions) >= MAX_ACTIVE_SESSIONS:
                raise ValueError(
                    "active world-bridge sessions exceeded configured capacity: "
                    f"{len(self._sessions)} >= {MAX_ACTIVE_SESSIONS}"
                )
            session = WorldBridgeSessionState(
                session_id=self._next_session_id(),
                robot_name=req.robot_name,
                urdf_sha256=req.urdf_sha256,
                camera_ids=list(req.camera_ids),
                scenario_duration_ms=req.scenario_duration_ms,
                created_at_ms=now_ms,
                updated_at_ms=now_ms,
            )
            self._append_event(
                session=session,
                event_type=WorldBridgeEventType.SESSION_CREATED,
                payload={
                    "robot_name": req.robot_name,
                    "camera_count": len(req.camera_ids),
                    "scenario_duration_ms": req.scenario_duration_ms,
                },
                timestamp_ms=now_ms,
            )
            self._record_session_creation(
                robot_name=req.robot_name,
                planner_id=req.planner_id,
                task_id=req.task_id,
                adapter_id=req.adapter_id,
            )
            self._sessions[session.session_id] = session
            return self._to_snapshot(session, include_trace=True)

    def get_session(
        self,
        session_id: str,
        *,
        include_trace: bool = True,
    ) -> WorldBridgeSessionSnapshot:
        with self._lock:
            self._prune_idle_sessions_locked(_now_ms())
            session = self._sessions.get(session_id)
            if session is None:
                raise KeyError(f"unknown session: {session_id}")
            return self._to_snapshot(session, include_trace=include_trace)

    def apply_joint_command(
        self, session_id: str, req: WorldBridgeJointCommandRequest
    ) -> WorldBridgeCommandAck:
        if len(req.joint_positions) > MAX_JOINTS_PER_COMMAND:
            raise ValueError(
                "joint command exceeds max joints per command: "
                f"{len(req.joint_positions)} > {MAX_JOINTS_PER_COMMAND}"
            )

        with self._lock:
            self._prune_idle_sessions_locked(_now_ms())
            session = self._sessions.get(session_id)
            if session is None:
                raise KeyError(f"unknown session: {session_id}")

            now_ms = _now_ms()
            scenario_time_before_ms = session.scenario_time_ms
            joint_state_before = dict(session.joint_state)
            if req.command_time_ms is not None:
                session.scenario_time_ms = _clamp_scenario_time(
                    req.command_time_ms, session.scenario_duration_ms
                )

            sequence = self._resolve_sequence(session, req.sequence_id)
            session.last_command_sequence = sequence
            session.joint_state.update(req.joint_positions)
            session.updated_at_ms = now_ms
            self._append_event(
                session=session,
                event_type=WorldBridgeEventType.JOINT_COMMAND_APPLIED,
                payload={
                    "source": req.source,
                    "sequence_id": sequence,
                    "joint_count": len(req.joint_positions),
                    "scenario_time_ms": session.scenario_time_ms,
                },
                timestamp_ms=now_ms,
            )
            self._append_transition(
                session=session,
                transition_type=WorldBridgeTransitionType.JOINT_COMMAND,
                source=req.source,
                sequence_id=sequence,
                planner_id=req.planner_id,
                task_id=req.task_id,
                adapter_id=req.adapter_id,
                rollout_mode=req.rollout_mode,
                scenario_time_before_ms=scenario_time_before_ms,
                scenario_time_after_ms=session.scenario_time_ms,
                joint_state_before=joint_state_before,
                action_joint_positions=dict(req.joint_positions),
                joint_state_after=dict(session.joint_state),
                timestamp_ms=now_ms,
            )
            self._record_joint_command(
                robot_name=session.robot_name,
                planner_id=req.planner_id,
                task_id=req.task_id,
                adapter_id=req.adapter_id,
                rollout_mode=req.rollout_mode,
            )
            return WorldBridgeCommandAck(
                session_id=session.session_id,
                accepted=True,
                applied_joint_count=len(req.joint_positions),
                scenario_time_ms=session.scenario_time_ms,
                command_sequence=sequence,
            )

    def update_scenario_time(
        self, session_id: str, req: WorldBridgeScenarioTimeUpdateRequest
    ) -> WorldBridgeSessionSnapshot:
        with self._lock:
            self._prune_idle_sessions_locked(_now_ms())
            session = self._sessions.get(session_id)
            if session is None:
                raise KeyError(f"unknown session: {session_id}")
            now_ms = _now_ms()
            scenario_time_before_ms = session.scenario_time_ms
            joint_state_before = dict(session.joint_state)
            session.scenario_time_ms = _clamp_scenario_time(
                req.scenario_time_ms, session.scenario_duration_ms
            )
            session.updated_at_ms = now_ms
            self._append_event(
                session=session,
                event_type=WorldBridgeEventType.SCENARIO_TIME_UPDATED,
                payload={
                    "source": req.source,
                    "scenario_time_ms": session.scenario_time_ms
                },
                timestamp_ms=now_ms,
            )
            self._append_transition(
                session=session,
                transition_type=WorldBridgeTransitionType.SCENARIO_TIME_UPDATE,
                source=req.source,
                sequence_id=None,
                planner_id=req.planner_id,
                task_id=req.task_id,
                adapter_id=req.adapter_id,
                rollout_mode=req.rollout_mode,
                scenario_time_before_ms=scenario_time_before_ms,
                scenario_time_after_ms=session.scenario_time_ms,
                joint_state_before=joint_state_before,
                action_joint_positions={},
                joint_state_after=dict(session.joint_state),
                timestamp_ms=now_ms,
            )
            self._record_scenario_time_update(
                robot_name=session.robot_name,
                planner_id=req.planner_id,
                task_id=req.task_id,
                adapter_id=req.adapter_id,
                rollout_mode=req.rollout_mode,
            )
            return self._to_snapshot(session, include_trace=True)
