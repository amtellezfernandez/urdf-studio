from __future__ import annotations

from collections import Counter
import json
import math
import re
import tempfile
from pathlib import Path
from typing import Any, Sequence

import numpy as np
from scipy.spatial.transform import Rotation

from backend.services.world_layout_transfer_constants import (
    COLOR_TOLERANCE,
    POSITION_TOLERANCE_M,
    QUATERNION_TOLERANCE,
    SIZE_TOLERANCE_M,
)
from backend.services.world_layout_transfer_types import (
    ConcreteWorldLayoutFrameMap,
    SimPrimitive,
    StaticTransferValidationBackend,
    StaticWorldLayout,
    WorldLayoutFrameMap,
    WorldLayoutObject,
    WorldLayoutTransferError,
)
from backend.services.world_asset_refs import (
    normalize_portable_world_asset_ref,
    read_world_object_asset_ref,
)

SUPPORTED_WORLD_OBJECT_TYPES = {"cube", "sphere", "cylinder", "point", "mesh"}
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

STUDIO_Y_UP_TO_Z_UP = np.array(
    [
        [1.0, 0.0, 0.0],
        [0.0, 0.0, -1.0],
        [0.0, 1.0, 0.0],
    ]
)


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


def _read_optional_finite_number(
    value: Any,
    field: str,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float | None:
    if value is None:
        return None
    parsed = _read_finite_number(value, field)
    if minimum is not None and parsed < minimum:
        raise WorldLayoutTransferError(f"{field} must be >= {minimum:g}")
    if maximum is not None and parsed > maximum:
        raise WorldLayoutTransferError(f"{field} must be <= {maximum:g}")
    return parsed


def _read_optional_bool(value: Any, default: bool, field: str) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    raise WorldLayoutTransferError(f"{field} must be a boolean")


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
    simulation = value.get("simulation")
    if simulation is not None and not _is_record(simulation):
        raise WorldLayoutTransferError(f"objects[{index}].simulation must be an object")
    simulation = simulation if _is_record(simulation) else {}
    fixed = _read_optional_bool(
        simulation.get("fixed", value.get("fixed", value.get("is_fixed"))),
        True,
        f"objects[{index}].simulation.fixed",
    )
    collision = _read_optional_bool(
        simulation.get("collision", value.get("collision")),
        True,
        f"objects[{index}].simulation.collision",
    )
    mass_kg = _read_optional_finite_number(
        simulation.get("mass_kg", value.get("mass_kg")),
        f"objects[{index}].simulation.mass_kg",
        minimum=0.0,
    )
    friction = _read_optional_finite_number(
        simulation.get("friction", value.get("friction")),
        f"objects[{index}].simulation.friction",
        minimum=0.01,
        maximum=5.0,
    )
    restitution = _read_optional_finite_number(
        simulation.get("restitution", value.get("restitution")),
        f"objects[{index}].simulation.restitution",
        minimum=0.0,
        maximum=1.0,
    )
    semantic_role = _read_optional_string(
        simulation.get("semantic_role", value.get("semantic_role", value.get("role")))
    )
    asset_ref = _read_object_asset_ref(value, index)
    asset_scale = _read_object_asset_scale(value, index)
    return WorldLayoutObject(
        id=raw_id.strip(),
        name=raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else raw_id.strip(),
        primitive_type=raw_type,
        position_xyz=position,
        rotation_rpy_rad=rotation,
        size_xyz=size,
        color=raw_color.strip() if isinstance(raw_color, str) and raw_color.strip() else "#3b82f6",
        is_hidden=value.get("is_hidden") is True,
        fixed=fixed,
        collision=collision,
        mass_kg=mass_kg,
        friction=friction,
        restitution=restitution,
        semantic_role=semantic_role,
        asset_ref=asset_ref,
        asset_scale_xyz=asset_scale,
    )


def _read_optional_string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _read_object_asset_ref(value: dict[str, Any], index: int) -> str | None:
    asset_ref_entry = read_world_object_asset_ref(value)
    if asset_ref_entry is None:
        return None
    return _read_portable_asset_ref(
        asset_ref_entry.value,
        f"objects[{index}].{asset_ref_entry.field_path}",
    )


def _read_portable_asset_ref(value: str, field: str) -> str:
    try:
        return normalize_portable_world_asset_ref(value)
    except ValueError as exc:
        raise WorldLayoutTransferError(
            f"{field} must be a portable relative asset reference"
        ) from exc


def _read_object_asset_scale(value: dict[str, Any], index: int) -> tuple[float, float, float] | None:
    for key in ("asset_scale_xyz", "mesh_scale_xyz", "scale_xyz"):
        if key in value:
            return _read_vector3(value.get(key), f"objects[{index}].{key}", positive=True)
    mesh = value.get("mesh")
    if _is_record(mesh):
        for key in ("scale_xyz", "scale"):
            if key not in mesh:
                continue
            raw_scale = mesh.get(key)
            if isinstance(raw_scale, int | float) and not isinstance(raw_scale, bool):
                scale = _read_finite_number(raw_scale, f"objects[{index}].mesh.{key}")
                if scale <= 0.0:
                    raise WorldLayoutTransferError(f"objects[{index}].mesh.{key} must be > 0")
                return (scale, scale, scale)
            return _read_vector3(raw_scale, f"objects[{index}].mesh.{key}", positive=True)
    return None


def resolve_world_layout_asset_path(asset_ref: str | None, roots: Sequence[Path]) -> Path | None:
    if asset_ref is None:
        return None
    try:
        normalized = normalize_portable_world_asset_ref(asset_ref)
    except ValueError:
        return None
    for root in roots:
        root_path = root.resolve()
        candidate = (root_path / normalized).resolve()
        try:
            candidate.relative_to(root_path)
        except ValueError:
            continue
        if candidate.exists():
            return candidate
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
    frame_map: WorldLayoutFrameMap = "identity",
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


def _duplicate_world_object_warnings(objects: Sequence[WorldLayoutObject]) -> tuple[str, ...]:
    warnings: list[str] = []
    for label, values in (
        ("id", [obj.id for obj in objects]),
        ("name", [obj.name for obj in objects]),
    ):
        counts = Counter(values)
        for value in sorted(item for item, count in counts.items() if count > 1):
            warnings.append(
                f"Duplicate world object {label} '{value}' appears {counts[value]} times; "
                "simulator transfer may be ambiguous."
            )
    return tuple(warnings)


def _primitive_simulation_fields(
    obj: WorldLayoutObject,
    *,
    collision: bool | None = None,
    fixed: bool | None = None,
) -> dict[str, Any]:
    return {
        "collision": obj.collision if collision is None else collision,
        "fixed": obj.fixed if fixed is None else fixed,
        "mass_kg": obj.mass_kg,
        "friction": obj.friction,
        "restitution": obj.restitution,
        "semantic_role": obj.semantic_role,
        "asset_ref": obj.asset_ref,
        "asset_scale_xyz": obj.asset_scale_xyz,
    }


def build_sim_primitives(
    layout: StaticWorldLayout,
    *,
    frame_map: WorldLayoutFrameMap = "identity",
    include_hidden: bool = False,
) -> tuple[tuple[SimPrimitive, ...], tuple[str, ...]]:
    resolved_frame_map = resolve_world_layout_frame_map(layout, frame_map)
    used_names: set[str] = set()
    primitives: list[SimPrimitive] = []
    warnings: list[str] = list(_duplicate_world_object_warnings(layout.objects))
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
                    **_primitive_simulation_fields(obj),
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
                    **_primitive_simulation_fields(obj),
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
                    **_primitive_simulation_fields(obj),
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
                    **_primitive_simulation_fields(obj, collision=False, fixed=True),
                )
            )
            continue
        if obj.primitive_type == "mesh":
            sim_size = _transform_size(obj.size_xyz, resolved_frame_map)
            if obj.asset_ref is None:
                warnings.append(f"Mesh object has no asset_ref; using primitive proxy: {obj.id}")
            else:
                warnings.append(f"Mesh object keeps asset_ref for mesh-capable adapters: {obj.id}")
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
                    **_primitive_simulation_fields(obj),
                )
            )
            continue
        raise WorldLayoutTransferError(f"Unsupported primitive type: {obj.primitive_type}")
    return tuple(primitives), tuple(warnings)


def append_primitives_to_mujoco_mjcf(
    mjcf_text: str,
    primitives: Sequence[SimPrimitive],
    *,
    include_floor: bool = False,
    offscreen_size: tuple[int, int] | None = None,
    asset_roots: Sequence[Path] = (),
) -> str:
    from backend.services.world_layout_transfer_mujoco import append_primitives_to_mujoco_mjcf as _impl

    return _impl(
        mjcf_text,
        primitives,
        include_floor=include_floor,
        offscreen_size=offscreen_size,
        asset_roots=asset_roots,
    )


def export_primitives_to_mujoco_mjcf(
    primitives: Sequence[SimPrimitive],
    *,
    model_name: str = "static_world_layout",
    include_floor: bool = False,
    offscreen_size: tuple[int, int] | None = None,
    asset_roots: Sequence[Path] = (),
) -> str:
    from backend.services.world_layout_transfer_mujoco import export_primitives_to_mujoco_mjcf as _impl

    return _impl(
        primitives,
        model_name=model_name,
        include_floor=include_floor,
        offscreen_size=offscreen_size,
        asset_roots=asset_roots,
    )


def check_mujoco_transfer(
    primitives: Sequence[SimPrimitive],
    *,
    mjcf_text: str | None = None,
    position_tolerance_m: float = POSITION_TOLERANCE_M,
    size_tolerance_m: float = SIZE_TOLERANCE_M,
    quaternion_tolerance: float = QUATERNION_TOLERANCE,
    color_tolerance: float = COLOR_TOLERANCE,
) -> dict[str, Any]:
    from backend.services.world_layout_transfer_mujoco import check_mujoco_transfer as _impl

    return _impl(
        primitives,
        mjcf_text=mjcf_text,
        position_tolerance_m=position_tolerance_m,
        size_tolerance_m=size_tolerance_m,
        quaternion_tolerance=quaternion_tolerance,
        color_tolerance=color_tolerance,
    )


def check_genesis_transfer(
    primitives: Sequence[SimPrimitive],
    *,
    position_tolerance_m: float = POSITION_TOLERANCE_M,
    size_tolerance_m: float = SIZE_TOLERANCE_M,
    quaternion_tolerance: float = QUATERNION_TOLERANCE,
    color_tolerance: float = COLOR_TOLERANCE,
) -> dict[str, Any]:
    from backend.services.world_layout_transfer_genesis import check_genesis_transfer as _impl

    return _impl(
        primitives,
        position_tolerance_m=position_tolerance_m,
        size_tolerance_m=size_tolerance_m,
        quaternion_tolerance=quaternion_tolerance,
        color_tolerance=color_tolerance,
    )


def build_static_transfer_report(
    layout: StaticWorldLayout,
    *,
    backends: Sequence[StaticTransferValidationBackend] = ("mujoco", "genesis"),
    frame_map: WorldLayoutFrameMap = "identity",
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
                "fixed": primitive.fixed,
                "mass_kg": primitive.mass_kg,
                "friction": primitive.friction,
                "restitution": primitive.restitution,
                "semantic_role": primitive.semantic_role,
                "asset_ref": primitive.asset_ref,
                "asset_scale_xyz": list(primitive.asset_scale_xyz) if primitive.asset_scale_xyz else None,
            }
            for primitive in primitives
        ],
        "backends": backend_reports,
    }


def check_static_world_layout_file(
    layout_path: Path,
    *,
    backends: Sequence[StaticTransferValidationBackend] = ("mujoco", "genesis"),
    frame_map: WorldLayoutFrameMap = "identity",
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
    backends: Sequence[StaticTransferValidationBackend] = ("mujoco", "genesis"),
    frame_map: WorldLayoutFrameMap = "identity",
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
