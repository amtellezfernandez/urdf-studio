from __future__ import annotations

import importlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Literal

from backend.models.physical_state import ActionToken, PhysicalRolloutTrace
from backend.services.robot_reality_log import compile_robot_reality_log_payload
from backend.services.world_model_dataset import build_world_model_training_samples


TraceAdapterSource = Literal["auto", "mujoco", "genesis", "ros", "lerobot"]


def _read_payload(path: Path) -> Any:
    try:
        raw_text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ValueError(f"Failed to read trace adapter input: {path}") from exc
    stripped = raw_text.strip()
    if not stripped:
        raise ValueError(f"Trace adapter input is empty: {path}")
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            pass
    records: list[Any] = []
    for line_number, line in enumerate(raw_text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid trace adapter JSONL line {line_number} in {path}: {exc}") from exc
    return records


def _record(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object.")
    return value


def _position_from_pose(raw_pose: Any) -> list[float]:
    if isinstance(raw_pose, dict):
        if "position_xyz" in raw_pose:
            return [float(value) for value in raw_pose["position_xyz"]]
        if "position" in raw_pose:
            return [float(value) for value in raw_pose["position"]]
        if "translation" in raw_pose:
            return [float(value) for value in raw_pose["translation"]]
        return [
            float(raw_pose.get("x", 0.0)),
            float(raw_pose.get("y", 0.0)),
            float(raw_pose.get("z", 0.0)),
        ]
    if isinstance(raw_pose, list | tuple) and len(raw_pose) >= 3:
        return [float(raw_pose[0]), float(raw_pose[1]), float(raw_pose[2])]
    return [0.0, 0.0, 0.0]


def _entity_from_template(template: dict[str, Any], pose: Any | None = None) -> dict[str, Any]:
    entity = dict(template)
    if pose is not None:
        entity["position_xyz"] = _position_from_pose(pose)
    entity.setdefault("size_xyz", [0.2, 0.2, 0.2])
    entity.setdefault("geometry_type", "box")
    return entity


def _action_from_raw(raw_action: Any, *, frame_index: int, fallback_id: str) -> dict[str, Any] | None:
    if raw_action is None:
        return None
    if isinstance(raw_action, dict):
        action = dict(raw_action)
        action.setdefault("id", action.get("action_id") or f"{fallback_id}:action:{frame_index}")
        action.setdefault("type", action.get("action_type") or "custom")
        return action
    if isinstance(raw_action, list | tuple):
        delta = [float(raw_action[index]) if index < len(raw_action) else 0.0 for index in range(3)]
        return {
            "id": f"{fallback_id}:action:{frame_index}",
            "type": "translate",
            "params": {"delta_xyz": delta},
        }
    return None


def _generic_payload_from_sim_trace(payload: dict[str, Any], *, source_kind: str) -> dict[str, Any]:
    trace_id = str(payload.get("trace_id") or payload.get("episode_id") or f"{source_kind}-trace")
    templates = payload.get("bodies") or payload.get("entities") or payload.get("objects") or []
    if not isinstance(templates, list):
        raise ValueError(f"{source_kind} templates must be an array.")
    template_by_id: dict[str, dict[str, Any]] = {}
    for index, raw_template in enumerate(templates):
        template = _record(raw_template, f"{source_kind}.bodies[{index}]")
        entity_id = template.get("entity_id") or template.get("id") or template.get("name")
        if not isinstance(entity_id, str) or not entity_id:
            raise ValueError(f"{source_kind}.bodies[{index}] must include id/entity_id.")
        template_by_id[entity_id] = {
            "id": entity_id,
            "entity_type": template.get("entity_type") or template.get("type") or "object",
            "geometry_type": template.get("geometry_type") or template.get("geometry") or "box",
            "position_xyz": template.get("position_xyz") or template.get("position") or [0.0, 0.0, 0.0],
            "size_xyz": template.get("size_xyz") or template.get("size") or [0.2, 0.2, 0.2],
            "mass_kg": template.get("mass_kg"),
            "friction": template.get("friction"),
            "battery": template.get("battery"),
            "movable": template.get("movable", True),
            "metadata": {**(template.get("metadata") if isinstance(template.get("metadata"), dict) else {}), "source_kind": source_kind},
        }
    raw_steps = payload.get("steps") or payload.get("frames") or payload.get("samples")
    if not isinstance(raw_steps, list) or len(raw_steps) < 2:
        raise ValueError(f"{source_kind} trace must contain at least two steps/frames.")
    frames: list[dict[str, Any]] = []
    for index, raw_step in enumerate(raw_steps):
        step = _record(raw_step, f"{source_kind}.steps[{index}]")
        poses = step.get("poses") or step.get("body_poses") or {}
        entities = step.get("entities")
        if isinstance(entities, list):
            frame_entities = [
                _entity_from_template(_record(entity, f"{source_kind}.steps[{index}].entities[]"))
                for entity in entities
            ]
        elif isinstance(poses, dict):
            frame_entities = [
                _entity_from_template(template, poses.get(entity_id))
                for entity_id, template in template_by_id.items()
            ]
        else:
            frame_entities = [_entity_from_template(template) for template in template_by_id.values()]
        frames.append(
            {
                "frame_id": step.get("frame_id") or f"{trace_id}:{index}",
                "t_ms": int(step.get("t_ms") or step.get("time_ms") or step.get("timestamp_ms") or index),
                "entities": frame_entities,
                "action": _action_from_raw(step.get("action"), frame_index=index, fallback_id=trace_id),
            }
        )
    return {
        "trace_id": trace_id,
        "source": str(payload.get("source") or source_kind),
        "frame_convention": payload.get("frame_convention") or ("mujoco-z-up" if source_kind == "mujoco" else "studio-y-up"),
        "frames": frames,
    }


def _flatten_ros_messages(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if isinstance(payload.get("messages"), list):
        return [_record(message, "ros.messages[]") for message in payload["messages"]]
    messages: list[dict[str, Any]] = []
    raw_topics = payload.get("topics")
    if isinstance(raw_topics, list):
        for topic_record in raw_topics:
            topic_payload = _record(topic_record, "ros.topics[]")
            topic = topic_payload.get("topic") or topic_payload.get("name")
            for message in topic_payload.get("messages", []):
                message_record = _record(message, f"ros.topic[{topic}].messages[]")
                messages.append({"topic": topic, **message_record})
    return messages


def _generic_payload_from_ros(payload: dict[str, Any]) -> dict[str, Any]:
    trace_id = str(payload.get("trace_id") or payload.get("bag_id") or payload.get("mcap_id") or "ros-trace")
    entity_messages: dict[int, list[dict[str, Any]]] = {}
    action_messages: dict[int, dict[str, Any]] = {}
    tf_by_time: dict[int, dict[str, list[float]]] = defaultdict(dict)
    for index, message in enumerate(_flatten_ros_messages(payload)):
        topic = str(message.get("topic") or "")
        stamp = int(message.get("timestamp_ms") or message.get("t_ms") or message.get("time_ms") or index)
        body = message.get("payload") if isinstance(message.get("payload"), dict) else message
        if topic.endswith("/entities") or "entities" in body:
            entities = body.get("entities")
            if isinstance(entities, list):
                entity_messages[stamp] = [
                    _entity_from_template(_record(entity, f"ros.entities[{entity_index}]"))
                    for entity_index, entity in enumerate(entities)
                ]
        elif topic.endswith("/actions") or topic.endswith("/action") or "action" in body:
            action_messages[stamp] = _action_from_raw(body.get("action") or body, frame_index=index, fallback_id=trace_id) or {}
        elif topic.endswith("/tf") or "transforms" in body:
            transforms = body.get("transforms") or body.get("frames") or []
            if isinstance(transforms, list):
                for transform in transforms:
                    transform_record = _record(transform, "ros.tf[]")
                    child_id = transform_record.get("child_frame_id") or transform_record.get("entity_id") or transform_record.get("id")
                    if isinstance(child_id, str):
                        tf_by_time[stamp][child_id] = _position_from_pose(transform_record)
    frames: list[dict[str, Any]] = []
    last_entities: list[dict[str, Any]] | None = None
    for frame_index, stamp in enumerate(sorted(set(entity_messages) | set(tf_by_time))):
        entities = [dict(entity) for entity in entity_messages.get(stamp) or last_entities or []]
        if stamp in tf_by_time:
            pose_by_id = tf_by_time[stamp]
            for entity in entities:
                entity_id = entity.get("entity_id") or entity.get("id")
                if isinstance(entity_id, str) and entity_id in pose_by_id:
                    entity["position_xyz"] = pose_by_id[entity_id]
        if len(entities) < 1:
            continue
        last_entities = entities
        action = action_messages.get(stamp)
        frames.append(
            {
                "frame_id": f"{trace_id}:{stamp}",
                "t_ms": stamp,
                "entities": entities,
                "action": action,
            }
        )
    if len(frames) < 2:
        raise ValueError("ROS adapter needs at least two entity/tf timestamps.")
    return {
        "trace_id": trace_id,
        "source": str(payload.get("source") or "ros"),
        "frame_convention": payload.get("frame_convention") or "ros-z-up",
        "frames": frames,
    }


def _entity_from_lerobot_object(raw_object: dict[str, Any], index: int) -> dict[str, Any]:
    entity_id = raw_object.get("entity_id") or raw_object.get("id") or f"object_{index}"
    return {
        "id": entity_id,
        "entity_type": raw_object.get("entity_type") or raw_object.get("type") or "object",
        "geometry_type": raw_object.get("geometry_type") or "box",
        "position_xyz": raw_object.get("position_xyz") or raw_object.get("position") or raw_object.get("pose") or [0.0, 0.0, 0.0],
        "size_xyz": raw_object.get("size_xyz") or raw_object.get("size") or [0.2, 0.2, 0.2],
        "mass_kg": raw_object.get("mass_kg"),
        "friction": raw_object.get("friction"),
        "movable": raw_object.get("movable", True),
        "metadata": {"source_kind": "lerobot"},
    }


def _generic_payload_from_lerobot(payload: dict[str, Any]) -> dict[str, Any]:
    trace_id = str(payload.get("trace_id") or payload.get("episode_id") or "lerobot-episode")
    raw_frames = payload.get("frames") or payload.get("steps")
    if not isinstance(raw_frames, list) or len(raw_frames) < 2:
        raise ValueError("LeRobot adapter needs at least two frames.")
    frames: list[dict[str, Any]] = []
    for index, raw_frame in enumerate(raw_frames):
        frame = _record(raw_frame, f"lerobot.frames[{index}]")
        observation = frame.get("observation") if isinstance(frame.get("observation"), dict) else frame
        robot_state = observation.get("robot") if isinstance(observation.get("robot"), dict) else {}
        state_vector = observation.get("state") if isinstance(observation.get("state"), list) else None
        robot_position = robot_state.get("position_xyz") or robot_state.get("position") or (
            state_vector[:3] if state_vector and len(state_vector) >= 3 else [0.0, 0.0, 0.0]
        )
        entities = [
            {
                "id": robot_state.get("entity_id") or robot_state.get("id") or "robot",
                "entity_type": "robot",
                "geometry_type": "box",
                "position_xyz": robot_position,
                "size_xyz": robot_state.get("size_xyz") or [0.2, 0.2, 0.2],
                "battery": robot_state.get("battery"),
                "metadata": {"source_kind": "lerobot"},
            }
        ]
        objects = observation.get("objects") or frame.get("objects") or []
        if isinstance(objects, list):
            entities.extend(_entity_from_lerobot_object(_record(raw_object, "lerobot.objects[]"), object_index) for object_index, raw_object in enumerate(objects))
        frames.append(
            {
                "frame_id": frame.get("frame_id") or f"{trace_id}:{index}",
                "t_ms": int(frame.get("timestamp_ms") or frame.get("t_ms") or index),
                "entities": entities,
                "action": _action_from_raw(frame.get("action"), frame_index=index, fallback_id=trace_id),
            }
        )
    return {
        "trace_id": trace_id,
        "source": str(payload.get("source") or "lerobot"),
        "frame_convention": payload.get("frame_convention") or "lerobot-camera-or-world",
        "frames": frames,
    }


def detect_trace_adapter_source(payload: Any) -> TraceAdapterSource:
    if isinstance(payload, list):
        return "ros"
    root = _record(payload, "trace adapter payload")
    source = str(root.get("source") or root.get("source_kind") or "").lower()
    if "mujoco" in source:
        return "mujoco"
    if "genesis" in source:
        return "genesis"
    if "lerobot" in source or "episode_id" in root:
        return "lerobot"
    if "topics" in root or "messages" in root or "bag_id" in root or "mcap_id" in root:
        return "ros"
    return "mujoco" if "steps" in root and "bodies" in root else "lerobot"


def compile_trace_adapter_payload(payload: Any, *, source: TraceAdapterSource = "auto") -> PhysicalRolloutTrace:
    if isinstance(payload, list):
        if source in {"mujoco", "genesis"}:
            payload = {"trace_id": f"jsonl-{source}-trace", "steps": payload}
        else:
            payload = {"trace_id": "jsonl-ros-trace", "messages": payload}
    root = _record(payload, "trace adapter payload")
    selected_source = detect_trace_adapter_source(root) if source == "auto" else source
    if selected_source in {"mujoco", "genesis"}:
        generic_payload = _generic_payload_from_sim_trace(root, source_kind=selected_source)
    elif selected_source == "ros":
        generic_payload = _generic_payload_from_ros(root)
    elif selected_source == "lerobot":
        generic_payload = _generic_payload_from_lerobot(root)
    else:
        raise ValueError(f"Unsupported trace adapter source: {selected_source}")
    trace = compile_robot_reality_log_payload(generic_payload)
    trace.metadata = {
        **trace.metadata,
        "source_kind": selected_source,
        "adapter_schema_version": "wsp-trace-adapter-v1",
    }
    return trace


def compile_trace_adapter_file(path: Path, *, source: TraceAdapterSource = "auto") -> PhysicalRolloutTrace:
    return compile_trace_adapter_payload(_read_payload(path), source=source)


def build_trace_adapter_dataset(trace: PhysicalRolloutTrace) -> list[Any]:
    return build_world_model_training_samples(
        trace,
        metadata={"split": f"{trace.metadata.get('source_kind', 'adapter')}_trace_adapter"},
    )


def compile_simulator_file(path: Path, *, source: TraceAdapterSource = "auto") -> PhysicalRolloutTrace:
    """Read a simulator trace file (JSON or NDJSON) and compile to a PhysicalRolloutTrace.

    Supports MuJoCo, Genesis, ROS JSON-export, and LeRobot formats.
    For native ROS 2 binary bag files (.mcap), use compile_mcap_file() instead.
    """
    return compile_trace_adapter_file(path, source=source)


def _ros2_message_to_dict(msg: Any) -> dict[str, Any]:
    """Best-effort conversion of a decoded ROS 2 message object to a plain dict."""
    if hasattr(msg, "_fields_and_field_types"):
        return {field: getattr(msg, field, None) for field in msg._fields_and_field_types}
    if hasattr(msg, "__dict__"):
        return {k: v for k, v in msg.__dict__.items() if not k.startswith("_")}
    return {}


def _load_mcap_decoder_tools() -> tuple[Any, Any]:
    try:
        reader_module = importlib.import_module("mcap.reader")
        decoder_module = importlib.import_module("mcap_ros2.decoder")
    except ImportError as exc:
        raise ImportError(
            "Native MCAP reading requires the mcap packages: "
            "pip install mcap mcap-ros2-support"
        ) from exc

    make_reader = getattr(reader_module, "make_reader", None)
    decoder_factory = getattr(decoder_module, "DecoderFactory", None)
    if not callable(make_reader) or not callable(decoder_factory):
        raise ImportError(
            "Native MCAP reading requires the mcap packages: "
            "pip install mcap mcap-ros2-support"
        )
    return make_reader, decoder_factory


def compile_mcap_file(path: Path) -> PhysicalRolloutTrace:
    """Read a native ROS 2 MCAP bag and compile to a PhysicalRolloutTrace.

    Requires: pip install mcap mcap-ros2-support

    Expected topics (any subset is accepted):
      /tf              — TF2 transforms keyed by child_frame_id
      /wsp/entities    — WSP entity state list
      /wsp/action      — WSP action command
    """
    make_reader, decoder_factory = _load_mcap_decoder_tools()

    messages: list[dict[str, Any]] = []
    with open(path, "rb") as bag_file:
        reader = make_reader(bag_file, decoder_factories=[decoder_factory()])
        for _schema, channel, message, ros_msg in reader.iter_decoded_messages():
            messages.append({
                "topic": channel.topic,
                "t_ms": message.log_time // 1_000_000,
                "payload": _ros2_message_to_dict(ros_msg),
            })

    payload: dict[str, Any] = {"mcap_id": path.stem, "messages": messages}
    return compile_trace_adapter_payload(payload, source="ros")
