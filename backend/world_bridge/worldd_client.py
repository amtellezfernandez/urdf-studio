from __future__ import annotations

import json
import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import TypeAlias
from urllib import error, request

from backend.world_bridge.event_codec import world_bridge_event_type_from_worldd
from backend.world_bridge.params import (
    TRANSITION_CONTRACT_VERSION,
    WORLDD_RUNTIME_MODE,
    WORLDD_SERVICE_NAME,
)
from backend.world_bridge.types import (
    WorldBridgeCommandAck,
    WorldBridgeEvent,
    WorldBridgeJointCommandRequest,
    WorldBridgeRolloutMode,
    WorldBridgeScenarioTimeUpdateRequest,
    WorldBridgeSessionCreateRequest,
    WorldBridgeSessionSnapshot,
    WorldBridgeStatusResponse,
    WorldBridgeTransitionRecord,
    WorldBridgeTransitionType,
)

WORLDD_SCHEMA_VERSION = "1"
NANOSECONDS_PER_MILLISECOND = 1_000_000
WorlddPayload: TypeAlias = Mapping[str, object]
WorlddJsonObject: TypeAlias = dict[str, object]
WorlddJsonResponse: TypeAlias = WorlddJsonObject | list[WorlddJsonObject]


def _safe_int(
    value: object,
    default_value: int = 0,
    *,
    strict: bool = False,
    field_name: str = "value",
) -> int:
    if isinstance(value, bool):
        if strict:
            raise ValueError(f"Invalid integer for {field_name}: {value!r}")
        return default_value
    try:
        return int(value)
    except (TypeError, ValueError):
        if strict:
            raise ValueError(f"Invalid integer for {field_name}: {value!r}")
        return default_value


def _safe_bool(
    value: object,
    default_value: bool = False,
    *,
    strict: bool = False,
    field_name: str = "value",
) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value in (0, 1):
            return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1"}:
            return True
        if normalized in {"false", "0"}:
            return False
    if strict:
        raise ValueError(f"Invalid boolean for {field_name}: {value!r}")
    return default_value


def _safe_float(
    value: object,
    default_value: float = 0.0,
    *,
    strict: bool = False,
    field_name: str = "value",
) -> float:
    if isinstance(value, bool):
        if strict:
            raise ValueError(f"Invalid float for {field_name}: {value!r}")
        return default_value
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        if strict:
            raise ValueError(f"Invalid float for {field_name}: {value!r}")
        return default_value
    if strict and not math.isfinite(parsed):
        raise ValueError(f"Non-finite float for {field_name}: {value!r}")
    return parsed


def _ns_to_ms(
    timestamp_ns: int | float | None,
    *,
    strict: bool = False,
    field_name: str = "timestamp_ns",
) -> int:
    if timestamp_ns is None:
        if strict:
            raise ValueError(f"Missing required timestamp field: {field_name}")
        return 0
    parsed_ns = _safe_int(
        timestamp_ns,
        strict=strict,
        field_name=field_name,
    )
    return parsed_ns // NANOSECONDS_PER_MILLISECOND


def _as_str_list(
    value: object,
    *,
    strict: bool = False,
    field_name: str = "value",
) -> list[str]:
    if not isinstance(value, list):
        if strict:
            raise ValueError(f"Expected list for {field_name}, received {type(value).__name__}")
        return []
    items = [str(item) for item in value]
    if strict and any(item == "" for item in items):
        raise ValueError(f"Empty string entry in {field_name}")
    return items


def _as_str_float_map(
    value: object,
    *,
    strict: bool = False,
    field_name: str = "value",
) -> dict[str, float]:
    if not isinstance(value, dict):
        if strict:
            raise ValueError(
                f"Expected object for {field_name}, received {type(value).__name__}"
            )
        return {}
    result: dict[str, float] = {}
    for key, raw in value.items():
        key_str = str(key)
        result[key_str] = _safe_float(
            raw,
            strict=strict,
            field_name=f"{field_name}.{key_str}",
        )
    return result


def _safe_str(
    value: object,
    default_value: str = "",
    *,
    strict: bool = False,
    field_name: str = "value",
    allow_empty: bool = False,
) -> str:
    if isinstance(value, str):
        parsed = value
    elif value is None:
        parsed = ""
    elif strict:
        raise ValueError(f"Expected string for {field_name}, received {type(value).__name__}")
    else:
        parsed = str(value)

    if not allow_empty and parsed.strip() == "":
        if strict:
            raise ValueError(f"Missing required string for {field_name}")
        return default_value
    return parsed


def parse_worldd_status_payload(
    payload: WorlddPayload,
    *,
    strict: bool = False,
) -> WorldBridgeStatusResponse:
    return WorldBridgeStatusResponse(
        service=_safe_str(
            payload.get("service"),
            WORLDD_SERVICE_NAME,
            strict=strict,
            field_name="service",
        ),
        runtime_mode=_safe_str(
            payload.get("runtime_mode"),
            WORLDD_RUNTIME_MODE,
            strict=strict,
            field_name="runtime_mode",
        ),
        active_sessions=_safe_int(
            payload.get("active_sessions"),
            0,
            strict=strict,
            field_name="active_sessions",
        ),
        max_events_per_session=_safe_int(
            payload.get("max_events_per_session"),
            0,
            strict=strict,
            field_name="max_events_per_session",
        ),
        default_scenario_duration_ms=_safe_int(
            payload.get("default_scenario_duration_ms"),
            0,
            strict=strict,
            field_name="default_scenario_duration_ms",
        ),
        transition_contract_version=_safe_str(
            payload.get("transition_contract_version"),
            TRANSITION_CONTRACT_VERSION,
            strict=False,
            field_name="transition_contract_version",
        ),
    )


def _parse_worldd_event(
    payload: WorlddPayload,
    *,
    strict: bool = False,
) -> WorldBridgeEvent | None:
    raw_event_type = _safe_str(
        payload.get("event_type"),
        strict=strict,
        field_name="event_type",
    ).strip()
    mapped_event_type = world_bridge_event_type_from_worldd(raw_event_type)
    if mapped_event_type is None:
        if strict:
            raise ValueError(f"Unsupported worldd event type: {raw_event_type}")
        return None
    raw_payload = payload.get("payload")
    if raw_payload is None:
        event_payload: WorlddJsonObject = {}
    elif isinstance(raw_payload, dict):
        event_payload = dict(raw_payload)
    else:
        if strict:
            raise ValueError(f"Expected object for payload, received {type(raw_payload).__name__}")
        event_payload = {}
    return WorldBridgeEvent(
        event_id=_safe_str(
            payload.get("event_id"),
            strict=strict,
            field_name="event_id",
        ),
        session_id=_safe_str(
            payload.get("session_id"),
            strict=strict,
            field_name="session_id",
        ),
        type=mapped_event_type,
        timestamp_ms=_ns_to_ms(
            payload.get("timestamp_ns"),
            strict=strict,
            field_name="timestamp_ns",
        ),
        payload=event_payload,
    )


def _parse_transition_type(
    value: object,
    *,
    strict: bool,
) -> WorldBridgeTransitionType | None:
    raw_type = _safe_str(
        value,
        strict=strict,
        field_name="transition_type",
    ).strip()
    try:
        return WorldBridgeTransitionType(raw_type)
    except ValueError:
        if strict:
            raise ValueError(f"Unsupported worldd transition type: {raw_type}") from None
        return None


def _parse_rollout_mode(
    value: object,
    *,
    strict: bool,
) -> WorldBridgeRolloutMode:
    raw_mode = _safe_str(
        value,
        default_value=WorldBridgeRolloutMode.UNSPECIFIED.value,
        strict=False,
        field_name="rollout_mode",
    ).strip()
    if raw_mode == "":
        return WorldBridgeRolloutMode.UNSPECIFIED
    try:
        return WorldBridgeRolloutMode(raw_mode)
    except ValueError:
        if strict:
            raise ValueError(f"Unsupported rollout_mode: {raw_mode}") from None
        return WorldBridgeRolloutMode.UNSPECIFIED


def _parse_worldd_transition(
    payload: WorlddPayload,
    *,
    strict: bool = False,
) -> WorldBridgeTransitionRecord | None:
    transition_type = _parse_transition_type(payload.get("transition_type"), strict=strict)
    if transition_type is None:
        return None
    return WorldBridgeTransitionRecord(
        transition_id=_safe_str(
            payload.get("transition_id"),
            strict=strict,
            field_name="transition_id",
        ),
        session_id=_safe_str(
            payload.get("session_id"),
            strict=strict,
            field_name="session_id",
        ),
        type=transition_type,
        timestamp_ms=_ns_to_ms(
            payload.get("timestamp_ns"),
            strict=strict,
            field_name="timestamp_ns",
        ),
        source=_safe_str(
            payload.get("source"),
            default_value="worldd",
            strict=False,
            field_name="source",
        ),
        sequence_id=(
            _safe_int(payload.get("sequence_id"), strict=strict, field_name="sequence_id")
            if payload.get("sequence_id") is not None
            else None
        ),
        planner_id=payload.get("planner_id"),
        task_id=payload.get("task_id"),
        adapter_id=payload.get("adapter_id"),
        rollout_mode=_parse_rollout_mode(payload.get("rollout_mode"), strict=strict),
        scenario_time_before_ms=_safe_int(
            payload.get("scenario_time_before_ms"),
            0,
            strict=strict,
            field_name="scenario_time_before_ms",
        ),
        scenario_time_after_ms=_safe_int(
            payload.get("scenario_time_after_ms"),
            0,
            strict=strict,
            field_name="scenario_time_after_ms",
        ),
        joint_state_before=_as_str_float_map(
            payload.get("joint_state_before_rad"),
            strict=strict,
            field_name="joint_state_before_rad",
        ),
        action_joint_positions=_as_str_float_map(
            payload.get("action_joint_positions_rad"),
            strict=strict,
            field_name="action_joint_positions_rad",
        ),
        joint_state_after=_as_str_float_map(
            payload.get("joint_state_after_rad"),
            strict=strict,
            field_name="joint_state_after_rad",
        ),
    )


def parse_worldd_session_payload(
    payload: WorlddPayload,
    *,
    strict: bool = False,
) -> WorldBridgeSessionSnapshot:
    recent_events_payload = payload.get("recent_events") or []
    if not isinstance(recent_events_payload, list):
        if strict:
            raise ValueError(
                f"Expected list for recent_events, received {type(recent_events_payload).__name__}"
            )
        recent_events_payload = []
    recent_events: list[WorldBridgeEvent] = []
    for event in recent_events_payload:
        if not isinstance(event, dict):
            if strict:
                raise ValueError(
                    f"Expected object event payload, received {type(event).__name__}"
                )
            continue
        parsed_event = _parse_worldd_event(event, strict=strict)
        if parsed_event is None:
            if strict:
                raise ValueError("Unsupported event payload in strict parsing mode")
            continue
        recent_events.append(parsed_event)
    recent_transitions_payload = payload.get("recent_transitions") or []
    if not isinstance(recent_transitions_payload, list):
        if strict:
            raise ValueError(
                "Expected list for recent_transitions, "
                f"received {type(recent_transitions_payload).__name__}"
            )
        recent_transitions_payload = []
    recent_transitions: list[WorldBridgeTransitionRecord] = []
    for transition in recent_transitions_payload:
        if not isinstance(transition, dict):
            if strict:
                raise ValueError(
                    "Expected object transition payload, "
                    f"received {type(transition).__name__}"
                )
            continue
        parsed_transition = _parse_worldd_transition(transition, strict=strict)
        if parsed_transition is None:
            if strict:
                raise ValueError("Unsupported transition payload in strict parsing mode")
            continue
        recent_transitions.append(parsed_transition)
    return WorldBridgeSessionSnapshot(
        session_id=_safe_str(
            payload.get("session_id"),
            strict=strict,
            field_name="session_id",
        ),
        robot_name=_safe_str(
            payload.get("robot_name"),
            strict=strict,
            field_name="robot_name",
        ),
        urdf_sha256=payload.get("urdf_sha256"),
        camera_ids=_as_str_list(
            payload.get("camera_ids"),
            strict=strict,
            field_name="camera_ids",
        ),
        created_at_ms=_ns_to_ms(
            payload.get("created_at_ns"),
            strict=strict,
            field_name="created_at_ns",
        ),
        updated_at_ms=_ns_to_ms(
            payload.get("updated_at_ns"),
            strict=strict,
            field_name="updated_at_ns",
        ),
        scenario_duration_ms=_safe_int(
            payload.get("scenario_duration_ms"),
            0,
            strict=strict,
            field_name="scenario_duration_ms",
        ),
        scenario_time_ms=_safe_int(
            payload.get("scenario_time_ms"),
            0,
            strict=strict,
            field_name="scenario_time_ms",
        ),
        joint_state=_as_str_float_map(
            payload.get("joint_state_rad"),
            strict=strict,
            field_name="joint_state_rad",
        ),
        last_command_sequence=_safe_int(
            payload.get("last_command_sequence"),
            0,
            strict=strict,
            field_name="last_command_sequence",
        ),
        recent_events=recent_events,
        recent_transitions=recent_transitions,
    )


def parse_worldd_ack_payload(
    payload: WorlddPayload,
    *,
    strict: bool = False,
) -> WorldBridgeCommandAck:
    return WorldBridgeCommandAck(
        session_id=_safe_str(
            payload.get("session_id"),
            strict=strict,
            field_name="session_id",
        ),
        accepted=_safe_bool(
            payload.get("accepted"),
            strict=strict,
            field_name="accepted",
        ),
        applied_joint_count=_safe_int(
            payload.get("applied_joint_count"),
            0,
            strict=strict,
            field_name="applied_joint_count",
        ),
        scenario_time_ms=_safe_int(
            payload.get("scenario_time_ms"),
            0,
            strict=strict,
            field_name="scenario_time_ms",
        ),
        command_sequence=_safe_int(
            payload.get("command_sequence"),
            0,
            strict=strict,
            field_name="command_sequence",
        ),
    )


@dataclass
class WorlddHttpError(Exception):
    status_code: int
    detail: str


class WorlddUnavailableError(Exception):
    ...


class WorlddClient:
    def __init__(self, host: str, port: int, timeout_ms: int) -> None:
        self._base_url = f"http://{host}:{port}"
        self._timeout_s = max(timeout_ms, 1) / 1000.0

    def _request_json(
        self,
        method: str,
        path: str,
        payload: WorlddJsonObject | None = None,
    ) -> WorlddJsonResponse:
        encoded_body = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            encoded_body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = request.Request(
            url=f"{self._base_url}{path}",
            method=method,
            data=encoded_body,
            headers=headers,
        )
        try:
            with request.urlopen(req, timeout=self._timeout_s) as response:
                response_body = response.read().decode("utf-8")
                parsed = json.loads(response_body) if response_body else {}
                return parsed
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8")
            detail = body
            try:
                detail_json = json.loads(body)
                detail = str(detail_json.get("detail") or detail_json.get("message") or body)
            except json.JSONDecodeError:
                pass
            raise WorlddHttpError(status_code=exc.code, detail=detail) from exc
        except (error.URLError, TimeoutError, OSError) as exc:
            raise WorlddUnavailableError(str(exc)) from exc

    def request_json(
        self,
        method: str,
        path: str,
        payload: WorlddJsonObject | None = None,
    ) -> WorlddJsonResponse:
        return self._request_json(method, path, payload=payload)

    def get_status(self) -> WorldBridgeStatusResponse:
        payload = self._request_json("GET", "/world-bridge/status")
        payload_dict = payload if isinstance(payload, dict) else {}
        return parse_worldd_status_payload(payload_dict)

    def list_sessions(self) -> list[WorldBridgeSessionSnapshot]:
        payload = self._request_json("GET", "/world-bridge/sessions")
        session_payloads = payload if isinstance(payload, list) else []
        snapshots: list[WorldBridgeSessionSnapshot] = []
        for item in session_payloads:
            if isinstance(item, dict):
                snapshots.append(parse_worldd_session_payload(item))
        return snapshots

    def create_session(
        self, req: WorldBridgeSessionCreateRequest
    ) -> WorldBridgeSessionSnapshot:
        payload = self._request_json(
            "POST",
            "/world-bridge/sessions",
            payload={
                "schema_version": WORLDD_SCHEMA_VERSION,
                "robot_name": req.robot_name,
                "urdf_sha256": req.urdf_sha256,
                "camera_ids": req.camera_ids,
                "planner_id": req.planner_id,
                "task_id": req.task_id,
                "adapter_id": req.adapter_id,
                "scenario_duration_ms": req.scenario_duration_ms,
            },
        )
        payload_dict = payload if isinstance(payload, dict) else {}
        return parse_worldd_session_payload(payload_dict)

    def get_session(self, session_id: str) -> WorldBridgeSessionSnapshot:
        payload = self._request_json("GET", f"/world-bridge/sessions/{session_id}")
        payload_dict = payload if isinstance(payload, dict) else {}
        return parse_worldd_session_payload(payload_dict)

    def apply_joint_command(
        self, session_id: str, req: WorldBridgeJointCommandRequest
    ) -> WorldBridgeCommandAck:
        payload = self._request_json(
            "POST",
            f"/world-bridge/sessions/{session_id}/joint-command",
            payload={
                "schema_version": WORLDD_SCHEMA_VERSION,
                "joint_positions_rad": req.joint_positions,
                "source": req.source,
                "planner_id": req.planner_id,
                "task_id": req.task_id,
                "adapter_id": req.adapter_id,
                "rollout_mode": req.rollout_mode.value,
                "sequence_id": req.sequence_id,
                "command_time_ms": req.command_time_ms,
            },
        )
        payload_dict = payload if isinstance(payload, dict) else {}
        return parse_worldd_ack_payload(payload_dict)

    def update_scenario_time(
        self, session_id: str, req: WorldBridgeScenarioTimeUpdateRequest
    ) -> WorldBridgeSessionSnapshot:
        payload = self._request_json(
            "POST",
            f"/world-bridge/sessions/{session_id}/scenario-time",
            payload={
                "schema_version": WORLDD_SCHEMA_VERSION,
                "source": req.source,
                "planner_id": req.planner_id,
                "task_id": req.task_id,
                "adapter_id": req.adapter_id,
                "rollout_mode": req.rollout_mode.value,
                "scenario_time_ms": req.scenario_time_ms,
            },
        )
        payload_dict = payload if isinstance(payload, dict) else {}
        return parse_worldd_session_payload(payload_dict)
