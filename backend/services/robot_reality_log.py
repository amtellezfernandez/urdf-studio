from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from backend.models.physical_state import ActionToken, PhysicalEntity, PhysicalRolloutTrace, PhysicalStateFrame

KNOWN_ENTITY_TYPES = {
    "robot",
    "object",
    "pallet",
    "dock",
    "lane",
    "zone",
    "surface",
    "target",
    "camera",
    "human",
    "tool",
    "unknown",
}
KNOWN_GEOMETRY_TYPES = {"box", "sphere", "cylinder", "point", "mesh", "unknown"}
KNOWN_ACTION_TYPES = {
    "noop",
    "navigate",
    "translate",
    "push",
    "pick",
    "place",
    "move_object",
    "reserve_dock",
    "wait",
    "handoff_to_human",
    "inspect",
    "replan",
    "set_pose",
    "custom",
}


def _as_record(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object.")
    return value


def _read_number(value: Any, field: str, fallback: float | None = None) -> float:
    if value is None and fallback is not None:
        return fallback
    if isinstance(value, bool):
        raise ValueError(f"{field} must be a finite number.")
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be a finite number.") from exc
    if not math.isfinite(parsed):
        raise ValueError(f"{field} must be a finite number.")
    return parsed


def _read_int(value: Any, field: str, fallback: int | None = None) -> int:
    parsed = _read_number(value, field, float(fallback) if fallback is not None else None)
    if parsed < 0:
        raise ValueError(f"{field} must be >= 0.")
    return int(parsed)


def _read_vector(value: Any, field: str, *, length: int, fallback: list[float] | None = None) -> list[float]:
    if value is None and fallback is not None:
        return list(fallback)
    if not isinstance(value, list | tuple) or len(value) != length:
        raise ValueError(f"{field} must contain {length} numbers.")
    return [_read_number(component, f"{field}[{index}]") for index, component in enumerate(value)]


def _read_pose(record: dict[str, Any], field: str) -> list[float]:
    if "position_xyz" in record:
        return _read_vector(record["position_xyz"], f"{field}.position_xyz", length=3)
    if "position" in record:
        return _read_vector(record["position"], f"{field}.position", length=3)
    if "pose" in record:
        raw_pose = record["pose"]
        if isinstance(raw_pose, dict):
            return [
                _read_number(raw_pose.get("x"), f"{field}.pose.x", 0.0),
                _read_number(raw_pose.get("y"), f"{field}.pose.y", 0.0),
                _read_number(raw_pose.get("z"), f"{field}.pose.z", 0.0),
            ]
        pose_vector = _read_vector(raw_pose, f"{field}.pose", length=3)
        return pose_vector
    return [0.0, 0.0, 0.0]


def _read_quat(record: dict[str, Any], field: str) -> list[float]:
    if "quat_wxyz" in record:
        return _read_vector(record["quat_wxyz"], f"{field}.quat_wxyz", length=4)
    return [1.0, 0.0, 0.0, 0.0]


def _optional_positive_number(value: Any, field: str) -> float | None:
    if value is None:
        return None
    parsed = _read_number(value, field)
    return parsed if parsed > 0 else None


def _optional_unit_interval(value: Any, field: str) -> float | None:
    if value is None:
        return None
    parsed = _read_number(value, field)
    if parsed < 0.0 or parsed > 1.0:
        return None
    return parsed


def _compile_entity(raw_entity: Any, index: int, *, frame_id: str) -> PhysicalEntity:
    record = _as_record(raw_entity, f"frames[].entities[{index}]")
    raw_id = record.get("entity_id") or record.get("id") or record.get("name")
    if not isinstance(raw_id, str) or not raw_id.strip():
        raise ValueError(f"frames[].entities[{index}] must include a non-empty id.")
    raw_type = record.get("entity_type") or record.get("type") or "unknown"
    raw_geometry = record.get("geometry_type") or record.get("geometry") or record.get("shape") or "unknown"
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
    if "collision" in record:
        metadata = {**metadata, "collision": record.get("collision") is not False}
    if "color" in record:
        metadata = {**metadata, "color": record.get("color")}
    return PhysicalEntity(
        entity_id=raw_id.strip(),
        entity_type=raw_type if raw_type in KNOWN_ENTITY_TYPES else "unknown",
        label=record.get("label") if isinstance(record.get("label"), str) else raw_id.strip(),
        geometry_type=raw_geometry if raw_geometry in KNOWN_GEOMETRY_TYPES else "unknown",
        position_xyz=_read_pose(record, f"{frame_id}.entities[{index}]"),
        quat_wxyz=_read_quat(record, f"{frame_id}.entities[{index}]"),
        size_xyz=(
            _read_vector(record.get("size_xyz") or record.get("size"), f"{frame_id}.entities[{index}].size", length=3)
            if record.get("size_xyz") is not None or record.get("size") is not None
            else None
        ),
        velocity_xyz=_read_vector(
            record.get("velocity_xyz") or record.get("velocity"),
            f"{frame_id}.entities[{index}].velocity",
            length=3,
            fallback=[0.0, 0.0, 0.0],
        ),
        mass_kg=_optional_positive_number(record.get("mass_kg"), f"{frame_id}.entities[{index}].mass_kg"),
        friction=(
            _read_number(record.get("friction"), f"{frame_id}.entities[{index}].friction")
            if record.get("friction") is not None
            else None
        ),
        battery=_optional_unit_interval(record.get("battery"), f"{frame_id}.entities[{index}].battery"),
        movable=record.get("movable", True) is not False,
        confidence=_optional_unit_interval(record.get("confidence"), f"{frame_id}.entities[{index}].confidence") or 1.0,
        source_ref=f"robot_reality_log:{frame_id}:entities[{index}]",
        metadata=metadata,
    )


def _compile_action(raw_action: Any, index: int, *, frame_id: str) -> ActionToken | None:
    if raw_action is None:
        return None
    record = _as_record(raw_action, f"frames[{index}].action")
    raw_id = record.get("action_id") or record.get("id") or f"{frame_id}:action:{index}"
    if not isinstance(raw_id, str) or not raw_id.strip():
        raise ValueError(f"frames[{index}].action must include a non-empty id.")
    raw_type = record.get("action_type") or record.get("type") or "custom"
    return ActionToken(
        action_id=raw_id.strip(),
        action_type=raw_type if raw_type in KNOWN_ACTION_TYPES else "custom",
        actor_id=record.get("actor_id") or record.get("actor"),
        object_id=record.get("object_id") or record.get("object") or record.get("target"),
        target_id=record.get("target_id"),
        destination_id=record.get("destination_id") or record.get("destination"),
        params=record.get("params") if isinstance(record.get("params"), dict) else {},
        start_time_ms=(
            _read_int(record.get("start_time_ms"), f"{frame_id}.action.start_time_ms")
            if record.get("start_time_ms") is not None
            else None
        ),
        duration_ms=(
            _read_int(record.get("duration_ms"), f"{frame_id}.action.duration_ms")
            if record.get("duration_ms") is not None
            else None
        ),
        confidence=_optional_unit_interval(record.get("confidence"), f"{frame_id}.action.confidence") or 1.0,
    )


def _read_log_frames(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw_frames = payload.get("frames") or payload.get("samples") or payload.get("events")
    if not isinstance(raw_frames, list) or len(raw_frames) < 2:
        raise ValueError("Robot reality log must contain at least two frames/samples/events.")
    return [_as_record(frame, f"frames[{index}]") for index, frame in enumerate(raw_frames)]


def _first_present(record: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in record:
            return record[key]
    return None


def compile_robot_reality_log_payload(payload: Any) -> PhysicalRolloutTrace:
    if isinstance(payload, str):
        payload = json.loads(payload)
    root = _as_record(payload, "robot reality log")
    trace_id = root.get("trace_id") or root.get("log_id") or "robot-reality-log"
    if not isinstance(trace_id, str) or not trace_id.strip():
        raise ValueError("Robot reality log trace_id/log_id must be a non-empty string.")
    frame_convention = root.get("frame_convention") if isinstance(root.get("frame_convention"), str) else "studio-y-up"
    source_refs = [root.get("source")] if isinstance(root.get("source"), str) else []
    raw_frames = _read_log_frames(root)
    frames: list[PhysicalStateFrame] = []
    actions: list[ActionToken] = []
    for index, raw_frame in enumerate(raw_frames):
        t_ms = _read_int(_first_present(raw_frame, "t_ms", "time_ms", "timestamp_ms"), "time_ms", index)
        frame_id = raw_frame.get("frame_id") if isinstance(raw_frame.get("frame_id"), str) else f"{trace_id}:{t_ms}"
        raw_entities = raw_frame.get("entities") or raw_frame.get("objects")
        if not isinstance(raw_entities, list):
            raise ValueError(f"{frame_id}.entities must be an array.")
        frames.append(
            PhysicalStateFrame(
                frame_id=frame_id,
                t_ms=t_ms,
                frame_convention=frame_convention,
                entities=[
                    _compile_entity(raw_entity, entity_index, frame_id=frame_id)
                    for entity_index, raw_entity in enumerate(raw_entities)
                ],
                source_refs=source_refs,
                metadata={
                    "source_kind": "robot_reality_log",
                    "trace_id": trace_id.strip(),
                    "frame_index": index,
                },
            )
        )
        action = _compile_action(raw_frame.get("action"), index, frame_id=frame_id)
        if action is not None and index < len(raw_frames) - 1:
            actions.append(action)

    return PhysicalRolloutTrace(
        trace_id=trace_id.strip(),
        frames=frames,
        actions=actions,
        metadata={
            "source_kind": "robot_reality_log",
            "frame_count": len(frames),
            "action_count": len(actions),
            "frame_convention": frame_convention,
            "source_refs": source_refs,
        },
    )


def compile_robot_reality_log_file(path: Path) -> PhysicalRolloutTrace:
    raw_text = path.read_text(encoding="utf-8")
    stripped = raw_text.strip()
    if not stripped:
        raise ValueError(f"Robot reality log is empty: {path}")
    if stripped.startswith("{"):
        return compile_robot_reality_log_payload(stripped)
    frames = [json.loads(line) for line in raw_text.splitlines() if line.strip()]
    return compile_robot_reality_log_payload(
        {
            "trace_id": path.stem,
            "source": str(path),
            "frames": frames,
        }
    )
