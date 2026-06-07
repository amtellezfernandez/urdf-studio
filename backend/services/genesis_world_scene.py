from __future__ import annotations

import json
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import numpy as np
import trimesh
from scipy.spatial.transform import Rotation

from backend.core.paths import BASE_DIR

GenesisDynamicContainerMode = Literal["mesh", "box", "visual-only"]

DEFAULT_DYNAMIC_CONTAINER_MODE: GenesisDynamicContainerMode = "mesh"
WORLD_LAYOUT_ELEMENT_SCALE = 0.5
WORLD_LAYOUT_ELEMENT_MIN_METRIC_SCALE = 0.02
WORLD_LAYOUT_ELEMENT_MAX_METRIC_SCALE = 200.0
DEFAULT_WORLD_LAYOUT_PATH = BASE_DIR / "web/public/world-layouts/hk-cargo-port.world-layout.json"
DEFAULT_SO101_URDF_PATH = (
    BASE_DIR
    / "third_party/so-arm100/Simulation/SO101/so101_new_calib.urdf"
)


@dataclass(frozen=True)
class GenesisElementPhysics:
    body_type: Literal["static", "dynamic"] = "static"
    mass_kg: float | None = None
    friction: float | None = None
    restitution: float | None = None
    linear_damping: float | None = None
    angular_damping: float | None = None


@dataclass(frozen=True)
class GenesisWorldElement:
    id: str
    name: str
    uri: str
    position_xyz: tuple[float, float, float]
    rotation_rpy_rad: tuple[float, float, float]
    scale_xyz: tuple[float, float, float]
    real_world_height_m: float | None
    material_color: str | None
    physics: GenesisElementPhysics


@dataclass(frozen=True)
class GenesisMeshBounds:
    minimum_xyz: tuple[float, float, float]
    maximum_xyz: tuple[float, float, float]
    size_xyz: tuple[float, float, float]
    studio_visual_offset_xyz: tuple[float, float, float]
    studio_visual_center_after_offset_xyz: tuple[float, float, float]


@dataclass(frozen=True)
class GenesisElementSpec:
    element: GenesisWorldElement
    asset_path: Path
    mesh_bounds: GenesisMeshBounds
    metric_scale: float
    effective_scale_xyz: tuple[float, float, float]
    mesh_position_xyz: tuple[float, float, float]
    box_center_xyz: tuple[float, float, float]
    box_size_xyz: tuple[float, float, float]
    is_dynamic: bool


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _read_finite_number(value: Any, fallback: float) -> float:
    if isinstance(value, bool):
        return fallback
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if math.isfinite(parsed) else fallback


def _read_vector3(
    value: Any,
    fallback: tuple[float, float, float],
) -> tuple[float, float, float]:
    if not isinstance(value, list | tuple) or len(value) != 3:
        return fallback
    return tuple(
        _read_finite_number(component, fallback[index])
        for index, component in enumerate(value)
    )


def _read_non_empty_string(value: Any, fallback: str = "") -> str:
    return value.strip() if isinstance(value, str) and value.strip() else fallback


def _read_positive_number(value: Any) -> float | None:
    parsed = _read_finite_number(value, float("nan"))
    return parsed if math.isfinite(parsed) and parsed > 0 else None


def _read_non_negative_number(value: Any) -> float | None:
    parsed = _read_finite_number(value, float("nan"))
    return parsed if math.isfinite(parsed) and parsed >= 0 else None


def _read_scale_xyz(entry: dict[str, Any]) -> tuple[float, float, float]:
    raw_scale_xyz = entry.get("scale_xyz")
    if isinstance(raw_scale_xyz, list | tuple) and len(raw_scale_xyz) == 3:
        scale_xyz = _read_vector3(raw_scale_xyz, (1.0, 1.0, 1.0))
        if all(component > 0 for component in scale_xyz):
            return scale_xyz
    scalar = _read_positive_number(entry.get("scale")) or 1.0
    return (scalar, scalar, scalar)


def _read_element_physics(
    value: Any,
    defaults: GenesisElementPhysics | None,
) -> GenesisElementPhysics:
    if not _is_record(value):
        return defaults or GenesisElementPhysics()
    raw_body_type = value.get("body_type")
    body_type: Literal["static", "dynamic"] = (
        "dynamic"
        if raw_body_type == "dynamic"
        else defaults.body_type
        if defaults is not None
        else "static"
    )
    return GenesisElementPhysics(
        body_type=body_type,
        mass_kg=_read_positive_number(value.get("mass_kg"))
        if value.get("mass_kg") is not None
        else defaults.mass_kg
        if defaults is not None
        else None,
        friction=_read_non_negative_number(value.get("friction"))
        if value.get("friction") is not None
        else defaults.friction
        if defaults is not None
        else None,
        restitution=_read_non_negative_number(value.get("restitution"))
        if value.get("restitution") is not None
        else defaults.restitution
        if defaults is not None
        else None,
        linear_damping=_read_non_negative_number(value.get("linear_damping"))
        if value.get("linear_damping") is not None
        else defaults.linear_damping
        if defaults is not None
        else None,
        angular_damping=_read_non_negative_number(value.get("angular_damping"))
        if value.get("angular_damping") is not None
        else defaults.angular_damping
        if defaults is not None
        else None,
    )


def _read_physics_defaults(environment: dict[str, Any]) -> GenesisElementPhysics | None:
    elements_layout = environment.get("elements_layout")
    if not _is_record(elements_layout):
        return None
    raw_defaults = elements_layout.get("physics_defaults")
    if not _is_record(raw_defaults):
        return None
    return _read_element_physics(raw_defaults, None)


def parse_world_layout_environment_elements(
    payload: dict[str, Any],
) -> tuple[str, tuple[GenesisWorldElement, ...]]:
    world_layout = payload.get("world_layout")
    environment = payload.get("environment")
    if not _is_record(environment):
        raise ValueError("World layout payload must contain environment")
    raw_elements = environment.get("elements")
    if not isinstance(raw_elements, list):
        raise ValueError("World layout environment.elements must be an array")
    layout_name = (
        _read_non_empty_string(world_layout.get("name"), "world-layout")
        if _is_record(world_layout)
        else "world-layout"
    )
    defaults = _read_physics_defaults(environment)
    elements: list[GenesisWorldElement] = []
    for index, raw_element in enumerate(raw_elements):
        if not _is_record(raw_element):
            continue
        uri = _read_non_empty_string(raw_element.get("uri"))
        if not uri:
            continue
        element_id = _read_non_empty_string(raw_element.get("id"), f"element-{index}")
        material_color = _read_non_empty_string(
            raw_element.get("material_color") or raw_element.get("color")
        )
        elements.append(
            GenesisWorldElement(
                id=element_id,
                name=_read_non_empty_string(raw_element.get("name"), element_id),
                uri=uri,
                position_xyz=_read_vector3(raw_element.get("position_xyz"), (0.0, 0.0, 0.0)),
                rotation_rpy_rad=_read_vector3(
                    raw_element.get("rotation_rpy_rad"), (0.0, 0.0, 0.0)
                ),
                scale_xyz=_read_scale_xyz(raw_element),
                real_world_height_m=_read_positive_number(
                    raw_element.get("real_world_height_m")
                ),
                material_color=material_color or None,
                physics=_read_element_physics(raw_element.get("physics"), defaults),
            )
        )
    return layout_name, tuple(elements)


def load_world_layout_environment_elements(
    layout_path: Path,
) -> tuple[str, tuple[GenesisWorldElement, ...]]:
    payload = json.loads(layout_path.read_text(encoding="utf-8"))
    if not _is_record(payload):
        raise ValueError("World layout payload must be an object")
    return parse_world_layout_environment_elements(payload)


def resolve_world_layout_asset_path(
    uri: str,
    *,
    layout_path: Path,
    repo_root: Path = BASE_DIR,
) -> Path:
    if uri.startswith(("http://", "https://")):
        raise ValueError(f"Genesis launcher only supports local world assets: {uri}")
    if uri.startswith("/"):
        return repo_root / "web/public" / uri.lstrip("/")
    return layout_path.parent / uri


@lru_cache(maxsize=64)
def read_mesh_bounds(mesh_path: str) -> GenesisMeshBounds:
    loaded = trimesh.load(mesh_path, force="scene")
    bounds = loaded.bounds
    if bounds is None:
        raise ValueError(f"Mesh has no bounds: {mesh_path}")
    minimum = np.array(bounds[0], dtype=float)
    maximum = np.array(bounds[1], dtype=float)
    center = (minimum + maximum) * 0.5
    size = maximum - minimum
    offset = np.array([-center[0], -minimum[1], -center[2]], dtype=float)
    center_after_offset = center + offset
    return GenesisMeshBounds(
        minimum_xyz=tuple(float(value) for value in minimum),
        maximum_xyz=tuple(float(value) for value in maximum),
        size_xyz=tuple(float(value) for value in size),
        studio_visual_offset_xyz=tuple(float(value) for value in offset),
        studio_visual_center_after_offset_xyz=tuple(
            float(value) for value in center_after_offset
        ),
    )


def _apply_layout_transform(
    *,
    position_xyz: tuple[float, float, float],
    rotation_rpy_rad: tuple[float, float, float],
    scale_xyz: tuple[float, float, float],
    local_xyz: tuple[float, float, float],
) -> tuple[float, float, float]:
    base = np.array(position_xyz, dtype=float)
    local = np.array(local_xyz, dtype=float) * np.array(scale_xyz, dtype=float)
    rotated = Rotation.from_euler("xyz", rotation_rpy_rad).apply(local)
    return tuple(float(value) for value in base + rotated)


def resolve_world_layout_element_metric_scale(
    real_world_height_m: float | None,
    bounds_height: float,
) -> float:
    if real_world_height_m is None or bounds_height <= 0:
        return WORLD_LAYOUT_ELEMENT_SCALE
    return min(
        WORLD_LAYOUT_ELEMENT_MAX_METRIC_SCALE,
        max(WORLD_LAYOUT_ELEMENT_MIN_METRIC_SCALE, real_world_height_m / bounds_height),
    )


def build_genesis_element_specs(
    layout_path: Path,
    *,
    repo_root: Path = BASE_DIR,
) -> tuple[str, tuple[GenesisElementSpec, ...]]:
    layout_name, elements = load_world_layout_environment_elements(layout_path)
    specs: list[GenesisElementSpec] = []
    for element in elements:
        asset_path = resolve_world_layout_asset_path(
            element.uri,
            layout_path=layout_path,
            repo_root=repo_root,
        )
        bounds = read_mesh_bounds(str(asset_path.resolve()))
        metric_scale = resolve_world_layout_element_metric_scale(
            element.real_world_height_m,
            bounds.size_xyz[1],
        )
        effective_scale_xyz = tuple(
            metric_scale * element.scale_xyz[index] for index in range(3)
        )
        mesh_position = _apply_layout_transform(
            position_xyz=element.position_xyz,
            rotation_rpy_rad=element.rotation_rpy_rad,
            scale_xyz=effective_scale_xyz,
            local_xyz=bounds.studio_visual_offset_xyz,
        )
        box_center = _apply_layout_transform(
            position_xyz=element.position_xyz,
            rotation_rpy_rad=element.rotation_rpy_rad,
            scale_xyz=effective_scale_xyz,
            local_xyz=bounds.studio_visual_center_after_offset_xyz,
        )
        box_size = tuple(
            max(1e-4, bounds.size_xyz[index] * effective_scale_xyz[index])
            for index in range(3)
        )
        specs.append(
            GenesisElementSpec(
                element=element,
                asset_path=asset_path,
                mesh_bounds=bounds,
                metric_scale=metric_scale,
                effective_scale_xyz=effective_scale_xyz,
                mesh_position_xyz=mesh_position,
                box_center_xyz=box_center,
                box_size_xyz=box_size,
                is_dynamic=element.physics.body_type == "dynamic",
            )
        )
    return layout_name, tuple(specs)


def color_hex_to_rgb(value: str | None) -> tuple[float, float, float] | None:
    if not value:
        return None
    color = value.strip()
    if color.startswith("#"):
        color = color[1:]
    if len(color) != 6:
        return None
    try:
        red = int(color[0:2], 16) / 255.0
        green = int(color[2:4], 16) / 255.0
        blue = int(color[4:6], 16) / 255.0
    except ValueError:
        return None
    return (red, green, blue)


def scene_center_and_radius(
    points: tuple[tuple[float, float, float], ...],
) -> tuple[tuple[float, float, float], float]:
    if not points:
        return (0.0, 0.0, 0.4), 1.0
    array = np.array(points, dtype=float)
    minimum = array.min(axis=0)
    maximum = array.max(axis=0)
    center = (minimum + maximum) * 0.5
    radius = max(
        0.75,
        max(float(np.linalg.norm(point - center)) for point in array),
    )
    return tuple(float(value) for value in center), radius
