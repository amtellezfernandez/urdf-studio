from __future__ import annotations

import json
import math
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Sequence
from xml.etree import ElementTree as ET

import numpy as np
from scipy.spatial.transform import Rotation

WorldLayoutBackend = Literal["mujoco", "genesis"]
ConcreteWorldLayoutFrameMap = Literal["identity", "studio-y-up-to-z-up"]
WorldLayoutFrameMap = Literal["auto", "identity", "studio-y-up-to-z-up"]

SUPPORTED_WORLD_OBJECT_TYPES = {"cube", "sphere", "cylinder", "point"}
CONCRETE_WORLD_LAYOUT_FRAME_MAPS = {"identity", "studio-y-up-to-z-up"}
Z_UP_FRAME_CONVENTIONS = {
    "ros",
    "ros-rep-103",
    "rep-103",
    "urdf",
    "world",
    "z-up",
    "zup",
    "studio-z-up",
    "urdf-studio",
    "urdf-studio-z-up",
}
Y_UP_FRAME_CONVENTIONS = {
    "studio-y-up",
    "three-y-up",
    "threejs-y-up",
    "webgl-y-up",
    "y-up",
    "yup",
}
STATIC_SCENARIO_TIME_MS = 0
STATIC_SCENARIO_DURATION_MS = 0
DEFAULT_RGBA = (0.231372549, 0.509803922, 0.964705882, 1.0)
POSITION_TOLERANCE_M = 1e-6
SIZE_TOLERANCE_M = 1e-6
QUATERNION_TOLERANCE = 1e-6

STUDIO_Y_UP_TO_Z_UP = np.array(
    [
        [1.0, 0.0, 0.0],
        [0.0, 0.0, -1.0],
        [0.0, 1.0, 0.0],
    ]
)


class WorldLayoutTransferError(ValueError):
    pass


@dataclass(frozen=True)
class WorldLayoutObject:
    id: str
    name: str
    primitive_type: str
    position_xyz: tuple[float, float, float]
    rotation_rpy_rad: tuple[float, float, float]
    size_xyz: tuple[float, float, float]
    color: str
    is_hidden: bool = False


@dataclass(frozen=True)
class StaticWorldLayout:
    name: str
    objects: tuple[WorldLayoutObject, ...]
    scenario_time_ms: int
    scenario_duration_ms: int
    source_kind: str
    frame_convention: str | None = None
    frame_map_hint: ConcreteWorldLayoutFrameMap | None = None


@dataclass(frozen=True)
class SimPrimitive:
    source_id: str
    source_name: str
    sim_name: str
    source_type: str
    sim_type: str
    position_xyz: tuple[float, float, float]
    quat_wxyz: tuple[float, float, float, float]
    size_xyz: tuple[float, float, float]
    rgba: tuple[float, float, float, float]
    collision: bool


@dataclass(frozen=True)
class LoadedPrimitive:
    source_id: str
    sim_name: str
    sim_type: str | None
    position_xyz: tuple[float, float, float]
    quat_wxyz: tuple[float, float, float, float] | None
    size_xyz: tuple[float, float, float] | None
    collision: bool | None


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _read_finite_number(value: Any, field: str) -> float:
    if isinstance(value, bool):
        raise WorldLayoutTransferError(f"{field} must be a finite number")
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise WorldLayoutTransferError(f"{field} must be a finite number") from exc
    if not math.isfinite(parsed):
        raise WorldLayoutTransferError(f"{field} must be a finite number")
    return parsed


def _read_vector3(value: Any, field: str, *, positive: bool = False) -> tuple[float, float, float]:
    if not isinstance(value, list | tuple) or len(value) != 3:
        raise WorldLayoutTransferError(f"{field} must be an array of 3 finite numbers")
    parsed = tuple(_read_finite_number(component, f"{field}[{index}]") for index, component in enumerate(value))
    if positive and any(component <= 0 for component in parsed):
        raise WorldLayoutTransferError(f"{field} components must be > 0")
    return parsed


def _read_static_timing(snapshot: dict[str, Any]) -> tuple[int, int]:
    scenario_time_ms = snapshot.get("scenario_time_ms")
    scenario_duration_ms = snapshot.get("scenario_duration_ms")
    if not isinstance(scenario_time_ms, int) or isinstance(scenario_time_ms, bool):
        raise WorldLayoutTransferError("scenario_time_ms must be an integer")
    if not isinstance(scenario_duration_ms, int) or isinstance(scenario_duration_ms, bool):
        raise WorldLayoutTransferError("scenario_duration_ms must be an integer")
    if scenario_time_ms != STATIC_SCENARIO_TIME_MS or scenario_duration_ms != STATIC_SCENARIO_DURATION_MS:
        raise WorldLayoutTransferError(
            "Only static world layouts are supported: scenario_time_ms and scenario_duration_ms must both be 0."
        )
    return scenario_time_ms, scenario_duration_ms


def _read_world_object(value: Any, index: int) -> WorldLayoutObject:
    if not _is_record(value):
        raise WorldLayoutTransferError(f"objects[{index}] must be an object")
    raw_id = value.get("id")
    if not isinstance(raw_id, str) or not raw_id.strip():
        raise WorldLayoutTransferError(f"objects[{index}].id must be a non-empty string")
    raw_type = value.get("type")
    if raw_type not in SUPPORTED_WORLD_OBJECT_TYPES:
        raise WorldLayoutTransferError(
            f"objects[{index}].type must be one of: {', '.join(sorted(SUPPORTED_WORLD_OBJECT_TYPES))}"
        )
    raw_name = value.get("name")
    position = _read_vector3(value.get("position_xyz"), f"objects[{index}].position_xyz")
    rotation = (
        _read_vector3(value.get("rotation_rpy_rad"), f"objects[{index}].rotation_rpy_rad")
        if "rotation_rpy_rad" in value
        else (0.0, 0.0, 0.0)
    )
    size = _read_vector3(value.get("size_xyz"), f"objects[{index}].size_xyz", positive=True)
    raw_color = value.get("color")
    return WorldLayoutObject(
        id=raw_id.strip(),
        name=raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else raw_id.strip(),
        primitive_type=raw_type,
        position_xyz=position,
        rotation_rpy_rad=rotation,
        size_xyz=size,
        color=raw_color.strip() if isinstance(raw_color, str) and raw_color.strip() else "#3b82f6",
        is_hidden=value.get("is_hidden") is True,
    )


def _read_optional_string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _normalize_frame_convention(value: str) -> str:
    normalized = value.strip().lower().replace("_", "-")
    return re.sub(r"\s+", "-", normalized)


def _read_frame_map_hint(payload: dict[str, Any]) -> ConcreteWorldLayoutFrameMap | None:
    environment = payload.get("environment")
    if not _is_record(environment):
        return None
    raw_frame_map = _read_optional_string(environment.get("frame_map"))
    normalized_frame_map = raw_frame_map.lower() if raw_frame_map is not None else None
    if normalized_frame_map is None or normalized_frame_map == "auto":
        return None
    if normalized_frame_map not in CONCRETE_WORLD_LAYOUT_FRAME_MAPS:
        allowed = ", ".join(sorted(CONCRETE_WORLD_LAYOUT_FRAME_MAPS))
        raise WorldLayoutTransferError(f"environment.frame_map must be one of: {allowed}")
    return normalized_frame_map  # type: ignore[return-value]


def _read_frame_convention(payload: dict[str, Any], snapshot: dict[str, Any]) -> str | None:
    interface = payload.get("interface")
    if _is_record(interface):
        frame_convention = _read_optional_string(interface.get("frame_convention"))
        if frame_convention is not None:
            return frame_convention
    frame_convention = _read_optional_string(snapshot.get("frame_convention"))
    if frame_convention is not None:
        return frame_convention
    frame_convention = _read_optional_string(payload.get("frame_convention"))
    if frame_convention is not None:
        return frame_convention
    environment = payload.get("environment")
    if _is_record(environment):
        return _read_optional_string(environment.get("frame_convention"))
    return None


def _read_snapshot_from_payload(
    payload: Any,
) -> tuple[dict[str, Any], str, str, str | None, ConcreteWorldLayoutFrameMap | None]:
    if not _is_record(payload):
        raise WorldLayoutTransferError("World layout payload must be a JSON object")
    if _is_record(payload.get("manifest")):
        return _read_snapshot_from_payload(payload["manifest"])
    if _is_record(payload.get("world_layout")):
        snapshot = payload["world_layout"]
        name = snapshot.get("name") if isinstance(snapshot.get("name"), str) else "static-world-layout"
        return (
            snapshot,
            name,
            "world_layout",
            _read_frame_convention(payload, snapshot),
            _read_frame_map_hint(payload),
        )
    if _is_record(payload.get("world_snapshot")):
        snapshot = payload["world_snapshot"]
        name = payload.get("title") if isinstance(payload.get("title"), str) else "world-snapshot"
        return (
            snapshot,
            name,
            "world_snapshot",
            _read_frame_convention(payload, snapshot),
            _read_frame_map_hint(payload),
        )
    raise WorldLayoutTransferError("Payload must contain world_layout, world_snapshot, or manifest")


def parse_static_world_layout_payload(payload: Any) -> StaticWorldLayout:
    snapshot, name, source_kind, frame_convention, frame_map_hint = _read_snapshot_from_payload(
        payload
    )
    raw_objects = snapshot.get("objects")
    if not isinstance(raw_objects, list):
        raise WorldLayoutTransferError("World layout objects must be an array")
    scenario_time_ms, scenario_duration_ms = _read_static_timing(snapshot)
    objects = tuple(_read_world_object(item, index) for index, item in enumerate(raw_objects))
    return StaticWorldLayout(
        name=name.strip() or "static-world-layout",
        objects=objects,
        scenario_time_ms=scenario_time_ms,
        scenario_duration_ms=scenario_duration_ms,
        source_kind=source_kind,
        frame_convention=frame_convention,
        frame_map_hint=frame_map_hint,
    )


def load_static_world_layout(path: Path) -> StaticWorldLayout:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise WorldLayoutTransferError(f"Failed to read world layout: {path}") from exc
    except json.JSONDecodeError as exc:
        raise WorldLayoutTransferError(f"Invalid world layout JSON: {exc}") from exc
    return parse_static_world_layout_payload(payload)


def resolve_world_layout_frame_map(
    layout: StaticWorldLayout,
    frame_map: WorldLayoutFrameMap = "auto",
) -> ConcreteWorldLayoutFrameMap:
    if frame_map != "auto":
        _frame_matrix(frame_map)
        return frame_map
    if layout.frame_map_hint is not None:
        return layout.frame_map_hint
    if layout.frame_convention is None:
        return "identity"
    normalized = _normalize_frame_convention(layout.frame_convention)
    if normalized in Z_UP_FRAME_CONVENTIONS:
        return "identity"
    if normalized in Y_UP_FRAME_CONVENTIONS:
        return "studio-y-up-to-z-up"
    raise WorldLayoutTransferError(
        f"Unsupported world frame convention: {layout.frame_convention}. "
        "Use ros-rep-103 for Z-up packages, studio-y-up for legacy Y-up layouts, "
        "or set environment.frame_map explicitly."
    )


def _frame_matrix(frame_map: ConcreteWorldLayoutFrameMap) -> np.ndarray:
    if frame_map == "identity":
        return np.eye(3)
    if frame_map == "studio-y-up-to-z-up":
        return STUDIO_Y_UP_TO_Z_UP
    raise WorldLayoutTransferError(f"Unsupported frame map: {frame_map}")


def _transform_position(
    position: Sequence[float],
    frame_map: ConcreteWorldLayoutFrameMap,
) -> tuple[float, float, float]:
    transformed = _frame_matrix(frame_map) @ np.array(position, dtype=float)
    return tuple(float(component) for component in transformed)


def _transform_size(
    size: Sequence[float],
    frame_map: ConcreteWorldLayoutFrameMap,
) -> tuple[float, float, float]:
    transformed = np.abs(_frame_matrix(frame_map)) @ np.array(size, dtype=float)
    return tuple(float(component) for component in transformed)


def _transform_quat_wxyz(
    rotation_rpy_rad: Sequence[float],
    frame_map: ConcreteWorldLayoutFrameMap,
) -> tuple[float, float, float, float]:
    frame = _frame_matrix(frame_map)
    studio_rotation = Rotation.from_euler("xyz", rotation_rpy_rad).as_matrix()
    sim_rotation = frame @ studio_rotation @ frame.T
    quat_xyzw = Rotation.from_matrix(sim_rotation).as_quat()
    return (
        float(quat_xyzw[3]),
        float(quat_xyzw[0]),
        float(quat_xyzw[1]),
        float(quat_xyzw[2]),
    )


def _parse_rgba(color: str) -> tuple[float, float, float, float]:
    normalized = color.strip()
    if normalized.startswith("#"):
        hex_value = normalized[1:]
        if len(hex_value) == 3:
            hex_value = "".join(component * 2 for component in hex_value)
        if len(hex_value) == 6:
            try:
                return (
                    int(hex_value[0:2], 16) / 255.0,
                    int(hex_value[2:4], 16) / 255.0,
                    int(hex_value[4:6], 16) / 255.0,
                    1.0,
                )
            except ValueError:
                return DEFAULT_RGBA
    return DEFAULT_RGBA


def _safe_sim_name(value: str, used_names: set[str], fallback: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_]+", "_", value.strip()).strip("_")
    base = f"wl_{normalized or fallback}"
    candidate = base
    suffix = 2
    while candidate in used_names:
        candidate = f"{base}_{suffix}"
        suffix += 1
    used_names.add(candidate)
    return candidate


def build_sim_primitives(
    layout: StaticWorldLayout,
    *,
    frame_map: WorldLayoutFrameMap = "auto",
    include_hidden: bool = False,
) -> tuple[tuple[SimPrimitive, ...], tuple[str, ...]]:
    resolved_frame_map = resolve_world_layout_frame_map(layout, frame_map)
    used_names: set[str] = set()
    primitives: list[SimPrimitive] = []
    warnings: list[str] = []
    for index, obj in enumerate(layout.objects):
        if obj.is_hidden and not include_hidden:
            warnings.append(f"Skipped hidden object: {obj.id}")
            continue
        sim_name = _safe_sim_name(obj.id, used_names, f"object_{index}")
        rgba = _parse_rgba(obj.color)
        position = _transform_position(obj.position_xyz, resolved_frame_map)
        quat = _transform_quat_wxyz(obj.rotation_rpy_rad, resolved_frame_map)
        if obj.primitive_type == "cube":
            sim_size = _transform_size(obj.size_xyz, resolved_frame_map)
            primitives.append(
                SimPrimitive(
                    source_id=obj.id,
                    source_name=obj.name,
                    sim_name=sim_name,
                    source_type=obj.primitive_type,
                    sim_type="box",
                    position_xyz=position,
                    quat_wxyz=quat,
                    size_xyz=sim_size,
                    rgba=rgba,
                    collision=True,
                )
            )
            continue
        if obj.primitive_type == "sphere":
            diameter = max(obj.size_xyz)
            if len({round(component, 12) for component in obj.size_xyz}) > 1:
                warnings.append(f"Normalized non-uniform sphere size for object: {obj.id}")
            primitives.append(
                SimPrimitive(
                    source_id=obj.id,
                    source_name=obj.name,
                    sim_name=sim_name,
                    source_type=obj.primitive_type,
                    sim_type="sphere",
                    position_xyz=position,
                    quat_wxyz=quat,
                    size_xyz=(diameter, diameter, diameter),
                    rgba=rgba,
                    collision=True,
                )
            )
            continue
        if obj.primitive_type == "cylinder":
            sim_size = _transform_size(obj.size_xyz, resolved_frame_map)
            diameter = max(sim_size[0], sim_size[1])
            if abs(sim_size[0] - sim_size[1]) > 1e-12:
                warnings.append(f"Normalized non-uniform cylinder diameter for object: {obj.id}")
            primitives.append(
                SimPrimitive(
                    source_id=obj.id,
                    source_name=obj.name,
                    sim_name=sim_name,
                    source_type=obj.primitive_type,
                    sim_type="cylinder",
                    position_xyz=position,
                    quat_wxyz=quat,
                    size_xyz=(diameter, diameter, sim_size[2]),
                    rgba=rgba,
                    collision=True,
                )
            )
            continue
        if obj.primitive_type == "point":
            diameter = max(obj.size_xyz)
            warnings.append(f"Mapped point marker to non-colliding sphere: {obj.id}")
            primitives.append(
                SimPrimitive(
                    source_id=obj.id,
                    source_name=obj.name,
                    sim_name=sim_name,
                    source_type=obj.primitive_type,
                    sim_type="sphere",
                    position_xyz=position,
                    quat_wxyz=quat,
                    size_xyz=(diameter, diameter, diameter),
                    rgba=rgba,
                    collision=False,
                )
            )
            continue
        raise WorldLayoutTransferError(f"Unsupported primitive type: {obj.primitive_type}")
    return tuple(primitives), tuple(warnings)


def _format_float(value: float) -> str:
    return f"{value:.12g}"


def _format_vec(values: Sequence[float]) -> str:
    return " ".join(_format_float(value) for value in values)


def _mujoco_geom_attrs(primitive: SimPrimitive) -> dict[str, str]:
    attrs = {
        "name": primitive.sim_name,
        "type": primitive.sim_type,
        "pos": _format_vec(primitive.position_xyz),
        "quat": _format_vec(primitive.quat_wxyz),
        "rgba": _format_vec(primitive.rgba),
    }
    if primitive.sim_type == "box":
        attrs["size"] = _format_vec(component * 0.5 for component in primitive.size_xyz)
    elif primitive.sim_type == "sphere":
        attrs["size"] = _format_float(max(primitive.size_xyz) * 0.5)
    elif primitive.sim_type == "cylinder":
        attrs["size"] = _format_vec((primitive.size_xyz[0] * 0.5, primitive.size_xyz[2] * 0.5))
    else:
        raise WorldLayoutTransferError(f"Unsupported MuJoCo primitive type: {primitive.sim_type}")
    if not primitive.collision:
        attrs["contype"] = "0"
        attrs["conaffinity"] = "0"
    return attrs


def _add_mujoco_floor(worldbody: ET.Element) -> None:
    ET.SubElement(
        worldbody,
        "geom",
        {
            "name": "wl_reference_floor",
            "type": "plane",
            "pos": "0 0 0",
            "size": "4 4 0.01",
            "rgba": "0.16 0.16 0.16 0.35",
        },
    )


def _set_mujoco_offscreen_size(root: ET.Element, offscreen_size: tuple[int, int]) -> None:
    visual = root.find("visual")
    if visual is None:
        visual = ET.SubElement(root, "visual")
    global_visual = visual.find("global")
    if global_visual is None:
        global_visual = ET.SubElement(visual, "global")
    global_visual.set("offwidth", str(max(int(offscreen_size[0]), 1)))
    global_visual.set("offheight", str(max(int(offscreen_size[1]), 1)))


def append_primitives_to_mujoco_mjcf(
    mjcf_text: str,
    primitives: Sequence[SimPrimitive],
    *,
    include_floor: bool = False,
    offscreen_size: tuple[int, int] | None = None,
) -> str:
    try:
        root = ET.fromstring(mjcf_text)
    except ET.ParseError as exc:
        raise WorldLayoutTransferError(f"Invalid MuJoCo MJCF XML: {exc}") from exc
    if root.tag != "mujoco":
        raise WorldLayoutTransferError("MuJoCo MJCF root element must be <mujoco>")
    if offscreen_size is not None:
        _set_mujoco_offscreen_size(root, offscreen_size)
    worldbody = root.find("worldbody")
    if worldbody is None:
        worldbody = ET.SubElement(root, "worldbody")
    if include_floor:
        _add_mujoco_floor(worldbody)
    for primitive in primitives:
        ET.SubElement(worldbody, "geom", _mujoco_geom_attrs(primitive))
    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="unicode")


def export_primitives_to_mujoco_mjcf(
    primitives: Sequence[SimPrimitive],
    *,
    model_name: str = "static_world_layout",
    include_floor: bool = False,
    offscreen_size: tuple[int, int] | None = None,
) -> str:
    root = ET.Element("mujoco", {"model": _safe_xml_token(model_name)})
    ET.SubElement(root, "compiler", {"angle": "radian"})
    ET.SubElement(root, "option", {"timestep": "0.01", "gravity": "0 0 -9.81"})
    if offscreen_size is not None:
        visual = ET.SubElement(root, "visual")
        ET.SubElement(
            visual,
            "global",
            {
                "offwidth": str(max(int(offscreen_size[0]), 1)),
                "offheight": str(max(int(offscreen_size[1]), 1)),
            },
        )
    worldbody = ET.SubElement(root, "worldbody")
    if include_floor:
        _add_mujoco_floor(worldbody)
    for primitive in primitives:
        ET.SubElement(worldbody, "geom", _mujoco_geom_attrs(primitive))
    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="unicode")


def _safe_xml_token(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip()).strip("_")
    return normalized or "static_world_layout"


def _quat_error(lhs: Sequence[float] | None, rhs: Sequence[float]) -> float | None:
    if lhs is None:
        return None
    lhs_array = np.array(lhs, dtype=float)
    rhs_array = np.array(rhs, dtype=float)
    direct = np.linalg.norm(lhs_array - rhs_array)
    negated = np.linalg.norm(lhs_array + rhs_array)
    return float(min(direct, negated))


def _position_error(lhs: Sequence[float], rhs: Sequence[float]) -> float:
    return float(np.linalg.norm(np.array(lhs, dtype=float) - np.array(rhs, dtype=float)))


def _size_error(lhs: Sequence[float] | None, rhs: Sequence[float]) -> float | None:
    if lhs is None:
        return None
    return float(np.linalg.norm(np.array(lhs, dtype=float) - np.array(rhs, dtype=float)))


def _primitive_check_report(
    primitives: Sequence[SimPrimitive],
    loaded: Sequence[LoadedPrimitive],
    *,
    position_tolerance_m: float = POSITION_TOLERANCE_M,
    size_tolerance_m: float = SIZE_TOLERANCE_M,
    quaternion_tolerance: float = QUATERNION_TOLERANCE,
) -> dict[str, Any]:
    loaded_by_name = {item.sim_name: item for item in loaded}
    objects: list[dict[str, Any]] = []
    max_position_error = 0.0
    max_size_error = 0.0
    max_quat_error = 0.0
    missing: list[str] = []
    type_mismatches: list[str] = []
    collision_mismatches: list[str] = []
    for primitive in primitives:
        loaded_primitive = loaded_by_name.get(primitive.sim_name)
        if loaded_primitive is None:
            missing.append(primitive.source_id)
            continue
        position_error = _position_error(primitive.position_xyz, loaded_primitive.position_xyz)
        quat_error = _quat_error(loaded_primitive.quat_wxyz, primitive.quat_wxyz)
        size_error = _size_error(loaded_primitive.size_xyz, primitive.size_xyz)
        type_matches = loaded_primitive.sim_type == primitive.sim_type
        collision_matches = (
            loaded_primitive.collision is None or loaded_primitive.collision == primitive.collision
        )
        max_position_error = max(max_position_error, position_error)
        if quat_error is not None:
            max_quat_error = max(max_quat_error, quat_error)
        if size_error is not None:
            max_size_error = max(max_size_error, size_error)
        if not type_matches:
            type_mismatches.append(primitive.source_id)
        if not collision_matches:
            collision_mismatches.append(primitive.source_id)
        objects.append(
            {
                "source_id": primitive.source_id,
                "sim_name": primitive.sim_name,
                "source_type": primitive.source_type,
                "sim_type": primitive.sim_type,
                "loaded_sim_type": loaded_primitive.sim_type,
                "expected_position_xyz": list(primitive.position_xyz),
                "loaded_position_xyz": list(loaded_primitive.position_xyz),
                "position_error_m": position_error,
                "expected_quat_wxyz": list(primitive.quat_wxyz),
                "loaded_quat_wxyz": (
                    list(loaded_primitive.quat_wxyz) if loaded_primitive.quat_wxyz is not None else None
                ),
                "quat_error": quat_error,
                "expected_size_xyz": list(primitive.size_xyz),
                "loaded_size_xyz": (
                    list(loaded_primitive.size_xyz) if loaded_primitive.size_xyz is not None else None
                ),
                "size_error_m": size_error,
                "collision": primitive.collision,
                "loaded_collision": loaded_primitive.collision,
                "type_matches": type_matches,
                "collision_matches": collision_matches,
            }
        )
    ok = (
        len(missing) == 0
        and len(type_mismatches) == 0
        and len(collision_mismatches) == 0
        and len(loaded) == len(primitives)
        and max_position_error <= position_tolerance_m
        and max_size_error <= size_tolerance_m
        and max_quat_error <= quaternion_tolerance
    )
    return {
        "ok": ok,
        "expected_count": len(primitives),
        "loaded_count": len(loaded),
        "missing_source_ids": missing,
        "type_mismatch_source_ids": type_mismatches,
        "collision_mismatch_source_ids": collision_mismatches,
        "max_position_error_m": max_position_error,
        "max_size_error_m": max_size_error,
        "max_quat_error": max_quat_error,
        "position_tolerance_m": position_tolerance_m,
        "size_tolerance_m": size_tolerance_m,
        "quat_tolerance": quaternion_tolerance,
        "objects": objects,
    }


def check_mujoco_transfer(
    primitives: Sequence[SimPrimitive],
    *,
    mjcf_text: str | None = None,
    position_tolerance_m: float = POSITION_TOLERANCE_M,
    size_tolerance_m: float = SIZE_TOLERANCE_M,
    quaternion_tolerance: float = QUATERNION_TOLERANCE,
) -> dict[str, Any]:
    import mujoco

    compiled_mjcf = mjcf_text or export_primitives_to_mujoco_mjcf(primitives)
    model = mujoco.MjModel.from_xml_string(compiled_mjcf)
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)
    loaded: list[LoadedPrimitive] = []
    for primitive in primitives:
        geom_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM, primitive.sim_name)
        if geom_id < 0:
            continue
        loaded.append(
            LoadedPrimitive(
                source_id=primitive.source_id,
                sim_name=primitive.sim_name,
                sim_type=_mujoco_geom_type_name(mujoco, model, geom_id),
                position_xyz=tuple(float(value) for value in data.geom_xpos[geom_id]),
                quat_wxyz=_matrix9_to_quat_wxyz(data.geom_xmat[geom_id]),
                size_xyz=_mujoco_geom_full_size(mujoco, model, geom_id),
                collision=bool(model.geom_contype[geom_id] != 0 or model.geom_conaffinity[geom_id] != 0),
            )
        )
    report = _primitive_check_report(
        primitives,
        loaded,
        position_tolerance_m=position_tolerance_m,
        size_tolerance_m=size_tolerance_m,
        quaternion_tolerance=quaternion_tolerance,
    )
    report.update(
        {
            "backend": "mujoco",
            "mujoco_version": getattr(mujoco, "__version__", "unknown"),
            "compiled_geom_count": int(model.ngeom),
        }
    )
    return report


def _mujoco_geom_type_name(mujoco: Any, model: Any, geom_id: int) -> str | None:
    geom_type = int(model.geom_type[geom_id])
    if geom_type == int(mujoco.mjtGeom.mjGEOM_BOX):
        return "box"
    if geom_type == int(mujoco.mjtGeom.mjGEOM_SPHERE):
        return "sphere"
    if geom_type == int(mujoco.mjtGeom.mjGEOM_CYLINDER):
        return "cylinder"
    return None


def _mujoco_geom_full_size(mujoco: Any, model: Any, geom_id: int) -> tuple[float, float, float] | None:
    geom_type = int(model.geom_type[geom_id])
    size = model.geom_size[geom_id]
    if geom_type == int(mujoco.mjtGeom.mjGEOM_BOX):
        return (float(size[0] * 2.0), float(size[1] * 2.0), float(size[2] * 2.0))
    if geom_type == int(mujoco.mjtGeom.mjGEOM_SPHERE):
        diameter = float(size[0] * 2.0)
        return (diameter, diameter, diameter)
    if geom_type == int(mujoco.mjtGeom.mjGEOM_CYLINDER):
        diameter = float(size[0] * 2.0)
        return (diameter, diameter, float(size[1] * 2.0))
    return None


def _matrix9_to_quat_wxyz(matrix9: Sequence[float]) -> tuple[float, float, float, float]:
    matrix = np.array(matrix9, dtype=float).reshape(3, 3)
    quat_xyzw = Rotation.from_matrix(matrix).as_quat()
    return (
        float(quat_xyzw[3]),
        float(quat_xyzw[0]),
        float(quat_xyzw[1]),
        float(quat_xyzw[2]),
    )


_GENESIS_INITIALIZED = False


def _ensure_genesis_initialized(gs: Any) -> None:
    global _GENESIS_INITIALIZED
    if _GENESIS_INITIALIZED:
        return
    try:
        gs.init(backend=gs.cpu, logging_level="warning")
    except Exception as exc:
        if "already" not in str(exc).lower() and "initialized" not in str(exc).lower():
            raise
    _GENESIS_INITIALIZED = True


def check_genesis_transfer(
    primitives: Sequence[SimPrimitive],
    *,
    position_tolerance_m: float = POSITION_TOLERANCE_M,
    size_tolerance_m: float = SIZE_TOLERANCE_M,
    quaternion_tolerance: float = QUATERNION_TOLERANCE,
) -> dict[str, Any]:
    import genesis as gs

    _ensure_genesis_initialized(gs)
    scene = gs.Scene(show_viewer=False)
    entities: list[tuple[SimPrimitive, Any]] = []
    for primitive in primitives:
        if primitive.sim_type == "box":
            morph = gs.morphs.Box(
                size=primitive.size_xyz,
                pos=primitive.position_xyz,
                quat=primitive.quat_wxyz,
                fixed=True,
                collision=primitive.collision,
            )
        elif primitive.sim_type == "sphere":
            morph = gs.morphs.Sphere(
                radius=max(primitive.size_xyz) * 0.5,
                pos=primitive.position_xyz,
                quat=primitive.quat_wxyz,
                fixed=True,
                collision=primitive.collision,
            )
        elif primitive.sim_type == "cylinder":
            morph = gs.morphs.Cylinder(
                radius=primitive.size_xyz[0] * 0.5,
                height=primitive.size_xyz[2],
                pos=primitive.position_xyz,
                quat=primitive.quat_wxyz,
                fixed=True,
                collision=primitive.collision,
            )
        else:
            raise WorldLayoutTransferError(f"Unsupported Genesis primitive type: {primitive.sim_type}")
        surface = gs.surfaces.Default(color=primitive.rgba[:3], opacity=primitive.rgba[3])
        entity = scene.add_entity(morph, surface=surface, name=primitive.sim_name)
        entities.append((primitive, entity))
    scene.build()
    loaded: list[LoadedPrimitive] = []
    for primitive, entity in entities:
        pos = entity.get_pos()
        quat = entity.get_quat()
        loaded.append(
            LoadedPrimitive(
                source_id=primitive.source_id,
                sim_name=primitive.sim_name,
                sim_type=_genesis_morph_type_name(entity.main_morph),
                position_xyz=tuple(float(value) for value in pos.tolist()),
                quat_wxyz=tuple(float(value) for value in quat.tolist()),
                size_xyz=_genesis_morph_full_size(entity.main_morph),
                collision=bool(entity.main_morph.collision),
            )
        )
    report = _primitive_check_report(
        primitives,
        loaded,
        position_tolerance_m=position_tolerance_m,
        size_tolerance_m=size_tolerance_m,
        quaternion_tolerance=quaternion_tolerance,
    )
    report.update(
        {
            "backend": "genesis",
            "genesis_version": getattr(gs, "__version__", "unknown"),
            "entity_count": len(entities),
        }
    )
    return report


def _genesis_morph_type_name(morph: Any) -> str | None:
    class_name = type(morph).__name__.lower()
    if class_name == "box":
        return "box"
    if class_name == "sphere":
        return "sphere"
    if class_name == "cylinder":
        return "cylinder"
    return None


def _genesis_morph_full_size(morph: Any) -> tuple[float, float, float] | None:
    morph_type = _genesis_morph_type_name(morph)
    if morph_type == "box":
        return tuple(float(value) for value in morph.size)
    if morph_type == "sphere":
        diameter = float(morph.radius * 2.0)
        return (diameter, diameter, diameter)
    if morph_type == "cylinder":
        diameter = float(morph.radius * 2.0)
        return (diameter, diameter, float(morph.height))
    return None


def build_static_transfer_report(
    layout: StaticWorldLayout,
    *,
    backends: Sequence[WorldLayoutBackend] = ("mujoco", "genesis"),
    frame_map: WorldLayoutFrameMap = "auto",
    include_hidden: bool = False,
    write_mjcf_path: Path | None = None,
    position_tolerance_m: float = POSITION_TOLERANCE_M,
    size_tolerance_m: float = SIZE_TOLERANCE_M,
    quaternion_tolerance: float = QUATERNION_TOLERANCE,
) -> dict[str, Any]:
    resolved_frame_map = resolve_world_layout_frame_map(layout, frame_map)
    primitives, warnings = build_sim_primitives(
        layout,
        frame_map=resolved_frame_map,
        include_hidden=include_hidden,
    )
    mjcf_text = export_primitives_to_mujoco_mjcf(primitives, model_name=layout.name)
    if write_mjcf_path is not None:
        write_mjcf_path.parent.mkdir(parents=True, exist_ok=True)
        write_mjcf_path.write_text(mjcf_text, encoding="utf-8")

    backend_reports: dict[str, Any] = {}
    for backend in backends:
        try:
            if backend == "mujoco":
                backend_reports[backend] = check_mujoco_transfer(
                    primitives,
                    mjcf_text=mjcf_text,
                    position_tolerance_m=position_tolerance_m,
                    size_tolerance_m=size_tolerance_m,
                    quaternion_tolerance=quaternion_tolerance,
                )
            elif backend == "genesis":
                backend_reports[backend] = check_genesis_transfer(
                    primitives,
                    position_tolerance_m=position_tolerance_m,
                    size_tolerance_m=size_tolerance_m,
                    quaternion_tolerance=quaternion_tolerance,
                )
            else:
                raise WorldLayoutTransferError(f"Unsupported backend: {backend}")
        except Exception as exc:
            backend_reports[backend] = {
                "backend": backend,
                "ok": False,
                "error": str(exc),
                "error_type": type(exc).__name__,
            }

    return {
        "ok": all(report.get("ok") is True for report in backend_reports.values()),
        "layout": {
            "name": layout.name,
            "source_kind": layout.source_kind,
            "object_count": len(layout.objects),
            "active_object_count": len(primitives),
            "scenario_time_ms": layout.scenario_time_ms,
            "scenario_duration_ms": layout.scenario_duration_ms,
            "frame_convention": layout.frame_convention,
            "frame_map_hint": layout.frame_map_hint,
        },
        "requested_frame_map": frame_map,
        "frame_map": resolved_frame_map,
        "tolerances": {
            "position_m": position_tolerance_m,
            "size_m": size_tolerance_m,
            "quat": quaternion_tolerance,
        },
        "warnings": list(warnings),
        "primitives": [
            {
                "source_id": primitive.source_id,
                "sim_name": primitive.sim_name,
                "source_type": primitive.source_type,
                "sim_type": primitive.sim_type,
                "position_xyz": list(primitive.position_xyz),
                "quat_wxyz": list(primitive.quat_wxyz),
                "size_xyz": list(primitive.size_xyz),
                "rgba": list(primitive.rgba),
                "collision": primitive.collision,
            }
            for primitive in primitives
        ],
        "backends": backend_reports,
    }


def check_static_world_layout_file(
    layout_path: Path,
    *,
    backends: Sequence[WorldLayoutBackend] = ("mujoco", "genesis"),
    frame_map: WorldLayoutFrameMap = "auto",
    include_hidden: bool = False,
    write_mjcf_path: Path | None = None,
    position_tolerance_m: float = POSITION_TOLERANCE_M,
    size_tolerance_m: float = SIZE_TOLERANCE_M,
    quaternion_tolerance: float = QUATERNION_TOLERANCE,
) -> dict[str, Any]:
    layout = load_static_world_layout(layout_path)
    return build_static_transfer_report(
        layout,
        backends=backends,
        frame_map=frame_map,
        include_hidden=include_hidden,
        write_mjcf_path=write_mjcf_path,
        position_tolerance_m=position_tolerance_m,
        size_tolerance_m=size_tolerance_m,
        quaternion_tolerance=quaternion_tolerance,
    )


def check_static_world_layout_text(
    raw_json: str,
    *,
    backends: Sequence[WorldLayoutBackend] = ("mujoco", "genesis"),
    frame_map: WorldLayoutFrameMap = "auto",
    include_hidden: bool = False,
    position_tolerance_m: float = POSITION_TOLERANCE_M,
    size_tolerance_m: float = SIZE_TOLERANCE_M,
    quaternion_tolerance: float = QUATERNION_TOLERANCE,
) -> dict[str, Any]:
    layout = parse_static_world_layout_payload(json.loads(raw_json))
    with tempfile.TemporaryDirectory(prefix="world-layout-transfer-") as temp_dir:
        return build_static_transfer_report(
            layout,
            backends=backends,
            frame_map=frame_map,
            include_hidden=include_hidden,
            write_mjcf_path=Path(temp_dir) / "layout.xml",
            position_tolerance_m=position_tolerance_m,
            size_tolerance_m=size_tolerance_m,
            quaternion_tolerance=quaternion_tolerance,
        )
