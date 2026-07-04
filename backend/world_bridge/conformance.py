from __future__ import annotations

from dataclasses import dataclass, field

from backend.world_bridge.event_codec import worldd_event_type_from_world_bridge
from backend.world_bridge.conformance_params import (
    CONFORMANCE_CAMERA_IDS,
    CONFORMANCE_COMMAND_SEQUENCE_ID,
    CONFORMANCE_COMMAND_SOURCE,
    CONFORMANCE_JOINT_POSITIONS_RAD,
    CONFORMANCE_ROBOT_NAME,
    CONFORMANCE_SCENARIO_DURATION_MS,
    CONFORMANCE_SCENARIO_TIME_MS,
)
from backend.world_bridge.params import (
    DEFAULT_SCENARIO_DURATION_MS,
    MAX_EVENTS_PER_SESSION,
    WORLDD_RUNTIME_MODE,
    WORLDD_SERVICE_NAME,
)
from backend.world_bridge.runtime import WorldBridgeRuntime
from backend.world_bridge.types import (
    WorldBridgeCommandAck,
    WorldBridgeEventType,
    WorldBridgeJointCommandRequest,
    WorldBridgeScenarioTimeUpdateRequest,
    WorldBridgeSessionCreateRequest,
    WorldBridgeSessionSnapshot,
)
from backend.world_bridge.worldd_client import (
    WORLDD_SCHEMA_VERSION,
    WorlddJsonObject,
    WorlddJsonResponse,
    WorlddClient,
    WorlddHttpError,
    WorlddUnavailableError,
    parse_worldd_ack_payload,
    parse_worldd_session_payload,
    parse_worldd_status_payload,
)

NANOSECONDS_PER_MILLISECOND = 1_000_000


@dataclass
class WorldBridgeConformanceResult:
    passed: bool
    checks: list[str] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return (
            f"passed={self.passed} checks={len(self.checks)} failures={len(self.failures)}"
        )


def _ms_to_ns(timestamp_ms: int) -> int:
    return timestamp_ms * NANOSECONDS_PER_MILLISECOND


def _to_worldd_event_payload(event: WorlddJsonObject) -> WorlddJsonObject:
    event_type = worldd_event_type_from_world_bridge(WorldBridgeEventType(event["type"]))
    if event_type is None:
        raise ValueError(f"Unsupported event type for conformance: {event['type']}")
    return {
        "schema_version": WORLDD_SCHEMA_VERSION,
        "event_id": event["event_id"],
        "session_id": event["session_id"],
        "event_type": event_type,
        "timestamp_ns": _ms_to_ns(event["timestamp_ms"]),
        "payload": event["payload"],
    }


def _to_worldd_session_payload(snapshot: WorldBridgeSessionSnapshot) -> WorlddJsonObject:
    snapshot_payload = snapshot.model_dump(mode="python")
    recent_events = [
        _to_worldd_event_payload(event) for event in snapshot_payload["recent_events"]
    ]
    recent_transitions = [
        _to_worldd_transition_payload(transition)
        for transition in snapshot_payload["recent_transitions"]
    ]
    return {
        "schema_version": WORLDD_SCHEMA_VERSION,
        "session_id": snapshot_payload["session_id"],
        "robot_name": snapshot_payload["robot_name"],
        "urdf_sha256": snapshot_payload["urdf_sha256"],
        "camera_ids": snapshot_payload["camera_ids"],
        "created_at_ns": _ms_to_ns(snapshot_payload["created_at_ms"]),
        "updated_at_ns": _ms_to_ns(snapshot_payload["updated_at_ms"]),
        "scenario_duration_ms": snapshot_payload["scenario_duration_ms"],
        "scenario_time_ms": snapshot_payload["scenario_time_ms"],
        "joint_state_rad": snapshot_payload["joint_state"],
        "last_command_sequence": snapshot_payload["last_command_sequence"],
        "recent_events": recent_events,
        "recent_transitions": recent_transitions,
    }


def _to_worldd_transition_payload(transition: WorlddJsonObject) -> WorlddJsonObject:
    return {
        "schema_version": WORLDD_SCHEMA_VERSION,
        "transition_id": transition["transition_id"],
        "session_id": transition["session_id"],
        "transition_type": transition["type"],
        "timestamp_ns": _ms_to_ns(transition["timestamp_ms"]),
        "source": transition["source"],
        "sequence_id": transition["sequence_id"],
        "planner_id": transition["planner_id"],
        "task_id": transition["task_id"],
        "adapter_id": transition["adapter_id"],
        "rollout_mode": transition["rollout_mode"],
        "scenario_time_before_ms": transition["scenario_time_before_ms"],
        "scenario_time_after_ms": transition["scenario_time_after_ms"],
        "joint_state_before_rad": transition["joint_state_before"],
        "action_joint_positions_rad": transition["action_joint_positions"],
        "joint_state_after_rad": transition["joint_state_after"],
    }


def _to_worldd_ack_payload(ack: WorldBridgeCommandAck) -> WorlddJsonObject:
    ack_payload = ack.model_dump(mode="python")
    return {
        "schema_version": WORLDD_SCHEMA_VERSION,
        "session_id": ack_payload["session_id"],
        "accepted": ack_payload["accepted"],
        "applied_joint_count": ack_payload["applied_joint_count"],
        "scenario_time_ms": ack_payload["scenario_time_ms"],
        "command_sequence": ack_payload["command_sequence"],
    }


def _snapshot_contract(snapshot: WorldBridgeSessionSnapshot) -> WorlddJsonObject:
    payload = snapshot.model_dump(mode="python")
    return {
        "robot_name": payload["robot_name"],
        "urdf_sha256": payload["urdf_sha256"],
        "camera_ids": payload["camera_ids"],
        "scenario_duration_ms": payload["scenario_duration_ms"],
        "scenario_time_ms": payload["scenario_time_ms"],
        "joint_state": payload["joint_state"],
        "last_command_sequence": payload["last_command_sequence"],
        "event_types": [str(event["type"]) for event in payload["recent_events"]],
        "transition_types": [
            str(transition["type"]) for transition in payload["recent_transitions"]
        ],
    }


def _ack_contract(ack: WorldBridgeCommandAck) -> WorlddJsonObject:
    payload = ack.model_dump(mode="python")
    return {
        "accepted": payload["accepted"],
        "applied_joint_count": payload["applied_joint_count"],
        "scenario_time_ms": payload["scenario_time_ms"],
        "command_sequence": payload["command_sequence"],
    }


def _record(
    result: WorldBridgeConformanceResult,
    condition: bool,
    success_message: str,
    failure_message: str,
) -> None:
    if condition:
        result.checks.append(success_message)
        return
    result.failures.append(failure_message)


def _worldd_request_json(
    client: WorlddClient,
    method: str,
    path: str,
    payload: WorlddJsonObject | None = None,
) -> WorlddJsonResponse:
    return client.request_json(method, path, payload=payload)


def _worldd_get_status(client: WorlddClient):
    payload = _worldd_request_json(client, "GET", "/world-bridge/status")
    if not isinstance(payload, dict):
        raise ValueError("worldd status payload is not an object")
    return parse_worldd_status_payload(payload, strict=True)


def _worldd_create_session(
    client: WorlddClient, req: WorldBridgeSessionCreateRequest
) -> WorldBridgeSessionSnapshot:
    payload = _worldd_request_json(
        client,
        "POST",
        "/world-bridge/sessions",
        payload={
            "schema_version": WORLDD_SCHEMA_VERSION,
            "robot_name": req.robot_name,
            "urdf_sha256": req.urdf_sha256,
            "camera_ids": req.camera_ids,
            "scenario_duration_ms": req.scenario_duration_ms,
        },
    )
    if not isinstance(payload, dict):
        raise ValueError("worldd create_session payload is not an object")
    return parse_worldd_session_payload(payload, strict=True)


def _worldd_get_session(client: WorlddClient, session_id: str) -> WorldBridgeSessionSnapshot:
    payload = _worldd_request_json(client, "GET", f"/world-bridge/sessions/{session_id}")
    if not isinstance(payload, dict):
        raise ValueError("worldd get_session payload is not an object")
    return parse_worldd_session_payload(payload, strict=True)


def _worldd_list_sessions(client: WorlddClient) -> list[WorldBridgeSessionSnapshot]:
    payload = _worldd_request_json(client, "GET", "/world-bridge/sessions")
    if not isinstance(payload, list):
        raise ValueError("worldd list_sessions payload is not a list")
    snapshots: list[WorldBridgeSessionSnapshot] = []
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError("worldd list_sessions item is not an object")
        snapshots.append(parse_worldd_session_payload(item, strict=True))
    return snapshots


def _worldd_apply_joint_command(
    client: WorlddClient, session_id: str, req: WorldBridgeJointCommandRequest
) -> WorldBridgeCommandAck:
    payload = _worldd_request_json(
        client,
        "POST",
        f"/world-bridge/sessions/{session_id}/joint-command",
        payload={
            "schema_version": WORLDD_SCHEMA_VERSION,
            "joint_positions_rad": req.joint_positions,
            "source": req.source,
            "sequence_id": req.sequence_id,
            "command_time_ms": req.command_time_ms,
        },
    )
    if not isinstance(payload, dict):
        raise ValueError("worldd joint_command payload is not an object")
    return parse_worldd_ack_payload(payload, strict=True)


def _worldd_update_scenario_time(
    client: WorlddClient, session_id: str, req: WorldBridgeScenarioTimeUpdateRequest
) -> WorldBridgeSessionSnapshot:
    payload = _worldd_request_json(
        client,
        "POST",
        f"/world-bridge/sessions/{session_id}/scenario-time",
        payload={
            "schema_version": WORLDD_SCHEMA_VERSION,
            "scenario_time_ms": req.scenario_time_ms,
        },
    )
    if not isinstance(payload, dict):
        raise ValueError("worldd scenario_time payload is not an object")
    return parse_worldd_session_payload(payload, strict=True)


def _build_default_create_request() -> WorldBridgeSessionCreateRequest:
    return WorldBridgeSessionCreateRequest(
        robot_name=CONFORMANCE_ROBOT_NAME,
        camera_ids=CONFORMANCE_CAMERA_IDS,
        scenario_duration_ms=CONFORMANCE_SCENARIO_DURATION_MS,
    )


def _build_default_joint_request() -> WorldBridgeJointCommandRequest:
    return WorldBridgeJointCommandRequest(
        joint_positions=CONFORMANCE_JOINT_POSITIONS_RAD,
        source=CONFORMANCE_COMMAND_SOURCE,
        sequence_id=CONFORMANCE_COMMAND_SEQUENCE_ID,
        command_time_ms=CONFORMANCE_SCENARIO_TIME_MS,
    )


def _build_default_scenario_time_request() -> WorldBridgeScenarioTimeUpdateRequest:
    return WorldBridgeScenarioTimeUpdateRequest(scenario_time_ms=CONFORMANCE_SCENARIO_TIME_MS)


def run_world_bridge_conformance() -> WorldBridgeConformanceResult:
    """Schema/translation conformance between worldd payloads and Python models."""
    result = WorldBridgeConformanceResult(passed=True)
    runtime = WorldBridgeRuntime()

    runtime_status = runtime.get_status()
    parsed_status = parse_worldd_status_payload(
        {
            "schema_version": WORLDD_SCHEMA_VERSION,
            "service": WORLDD_SERVICE_NAME,
            "runtime_mode": WORLDD_RUNTIME_MODE,
            "active_sessions": runtime_status.active_sessions,
            "max_events_per_session": runtime_status.max_events_per_session,
            "default_scenario_duration_ms": runtime_status.default_scenario_duration_ms,
        },
        strict=True,
    )
    _record(
        result,
        parsed_status.active_sessions == runtime_status.active_sessions,
        "status.active_sessions parity",
        "status.active_sessions mismatch",
    )
    _record(
        result,
        parsed_status.max_events_per_session == MAX_EVENTS_PER_SESSION,
        "status.max_events_per_session parity",
        "status.max_events_per_session mismatch",
    )
    _record(
        result,
        parsed_status.default_scenario_duration_ms == DEFAULT_SCENARIO_DURATION_MS,
        "status.default_scenario_duration_ms parity",
        "status.default_scenario_duration_ms mismatch",
    )

    created_session = runtime.create_session(req=_build_default_create_request())
    parsed_created = parse_worldd_session_payload(
        _to_worldd_session_payload(created_session),
        strict=True,
    )
    _record(
        result,
        parsed_created.model_dump(mode="python") == created_session.model_dump(mode="python"),
        "create_session snapshot parity",
        "create_session snapshot mismatch",
    )

    ack = runtime.apply_joint_command(
        session_id=created_session.session_id,
        req=_build_default_joint_request(),
    )
    parsed_ack = parse_worldd_ack_payload(_to_worldd_ack_payload(ack), strict=True)
    _record(
        result,
        parsed_ack.model_dump(mode="python") == ack.model_dump(mode="python"),
        "joint_command ack parity",
        "joint_command ack mismatch",
    )

    updated_session = runtime.update_scenario_time(
        session_id=created_session.session_id,
        req=_build_default_scenario_time_request(),
    )
    parsed_updated = parse_worldd_session_payload(
        _to_worldd_session_payload(updated_session),
        strict=True,
    )
    _record(
        result,
        parsed_updated.model_dump(mode="python") == updated_session.model_dump(mode="python"),
        "scenario_time snapshot parity",
        "scenario_time snapshot mismatch",
    )

    listed_sessions = runtime.list_sessions()
    listed_payload = [_to_worldd_session_payload(session) for session in listed_sessions]
    parsed_listed = [
        parse_worldd_session_payload(item, strict=True) for item in listed_payload
    ]
    _record(
        result,
        [item.model_dump(mode="python") for item in parsed_listed]
        == [item.model_dump(mode="python") for item in listed_sessions],
        "list_sessions parity",
        "list_sessions mismatch",
    )

    result.passed = len(result.failures) == 0
    return result


def run_world_bridge_live_conformance(
    *,
    worldd_host: str,
    worldd_port: int,
    worldd_timeout_ms: int,
) -> WorldBridgeConformanceResult:
    """Live parity check between Python runtime and running worldd."""
    result = WorldBridgeConformanceResult(passed=True)
    runtime = WorldBridgeRuntime()
    worldd = WorlddClient(host=worldd_host, port=worldd_port, timeout_ms=worldd_timeout_ms)

    try:
        py_status = runtime.get_status()
        worldd_status = _worldd_get_status(worldd)
    except (WorlddUnavailableError, WorlddHttpError, ValueError) as exc:
        result.failures.append(f"live status check failed: {exc}")
        result.passed = False
        return result

    _record(
        result,
        worldd_status.max_events_per_session == py_status.max_events_per_session,
        "live status.max_events_per_session parity",
        "live status.max_events_per_session mismatch",
    )
    _record(
        result,
        worldd_status.default_scenario_duration_ms == py_status.default_scenario_duration_ms,
        "live status.default_scenario_duration_ms parity",
        "live status.default_scenario_duration_ms mismatch",
    )

    create_req = _build_default_create_request()
    joint_req = _build_default_joint_request()
    scenario_req = _build_default_scenario_time_request()

    try:
        py_created = runtime.create_session(create_req)
        worldd_created = _worldd_create_session(worldd, create_req)
        _record(
            result,
            _snapshot_contract(py_created) == _snapshot_contract(worldd_created),
            "live create_session parity",
            "live create_session mismatch",
        )

        py_ack = runtime.apply_joint_command(py_created.session_id, joint_req)
        worldd_ack = _worldd_apply_joint_command(worldd, worldd_created.session_id, joint_req)
        _record(
            result,
            _ack_contract(py_ack) == _ack_contract(worldd_ack),
            "live joint_command parity",
            "live joint_command mismatch",
        )

        py_updated = runtime.update_scenario_time(py_created.session_id, scenario_req)
        worldd_updated = _worldd_update_scenario_time(
            worldd, worldd_created.session_id, scenario_req
        )
        _record(
            result,
            _snapshot_contract(py_updated) == _snapshot_contract(worldd_updated),
            "live scenario_time parity",
            "live scenario_time mismatch",
        )

        py_get = runtime.get_session(py_created.session_id)
        worldd_get = _worldd_get_session(worldd, worldd_created.session_id)
        _record(
            result,
            _snapshot_contract(py_get) == _snapshot_contract(worldd_get),
            "live get_session parity",
            "live get_session mismatch",
        )

        py_ids = {session.session_id for session in runtime.list_sessions()}
        worldd_ids = {session.session_id for session in _worldd_list_sessions(worldd)}
        _record(
            result,
            py_created.session_id in py_ids,
            "live list_sessions includes python session",
            "live list_sessions missing python session",
        )
        _record(
            result,
            worldd_created.session_id in worldd_ids,
            "live list_sessions includes worldd session",
            "live list_sessions missing worldd session",
        )
    except (WorlddUnavailableError, WorlddHttpError, ValueError) as exc:
        result.failures.append(f"live request failed: {exc}")

    result.passed = len(result.failures) == 0
    return result
