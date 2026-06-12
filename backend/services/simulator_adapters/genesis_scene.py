from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Sequence

import numpy as np
from scipy.spatial.transform import Rotation

from backend.services.simulator_adapters.params import GENESIS_SCENE_PARAMS
from backend.services.world_layout_static_transfer import resolve_world_layout_asset_path
from backend.services.world_layout_transfer_types import SimPrimitive


def primitive_bounds(primitive: SimPrimitive) -> tuple[np.ndarray, np.ndarray]:
    half_size = np.array(primitive.size_xyz, dtype=float) * 0.5
    quat = primitive.quat_wxyz
    rotation = Rotation.from_quat((quat[1], quat[2], quat[3], quat[0])).as_matrix()
    half_extent = np.abs(rotation) @ half_size
    center = np.array(primitive.position_xyz, dtype=float)
    return center - half_extent, center + half_extent


def scene_center_and_radius(
    primitives: Sequence[SimPrimitive],
) -> tuple[tuple[float, float, float], float]:
    viewer = GENESIS_SCENE_PARAMS.viewer
    bounds: list[tuple[np.ndarray, np.ndarray]] = []
    robot_half_extent = np.full(3, viewer.robot_bounds_half_extent_m, dtype=float)
    robot_center = np.array((0.0, 0.0, viewer.robot_bounds_half_extent_m), dtype=float)
    bounds.append((robot_center - robot_half_extent, robot_center + robot_half_extent))
    bounds.extend(primitive_bounds(primitive) for primitive in primitives)
    if not bounds:
        return GENESIS_SCENE_PARAMS.viewer.default_center_xyz, GENESIS_SCENE_PARAMS.viewer.default_radius_m
    mins = np.min(np.stack([item[0] for item in bounds], axis=0), axis=0)
    maxs = np.max(np.stack([item[1] for item in bounds], axis=0), axis=0)
    center_array = (mins + maxs) * 0.5
    center = tuple(float(value) for value in center_array)
    radius = max(
        viewer.min_radius_m,
        float(np.linalg.norm((maxs - mins) * 0.5)),
    )
    return center, radius


def add_floor_entity(gs: Any, scene: Any) -> None:
    floor = GENESIS_SCENE_PARAMS.floor
    scene.add_entity(
        gs.morphs.Box(
            size=(floor.size_xy_m[0], floor.size_xy_m[1], floor.thickness_m),
            pos=(0.0, 0.0, -floor.thickness_m / 2.0),
            fixed=True,
            collision=True,
        ),
        surface=gs.surfaces.Default(color=floor.rgba[:3], opacity=floor.rgba[3]),
        name="wl_reference_floor",
    )


def primitive_volume_m3(primitive: SimPrimitive) -> float | None:
    if primitive.sim_type == "box":
        return float(np.prod(np.array(primitive.size_xyz, dtype=float)))
    if primitive.sim_type == "sphere":
        radius = max(primitive.size_xyz) * 0.5
        return float((4.0 / 3.0) * math.pi * radius**3)
    if primitive.sim_type == "cylinder":
        radius = primitive.size_xyz[0] * 0.5
        return float(math.pi * radius**2 * primitive.size_xyz[2])
    return None


def primitive_rigid_material(gs: Any, primitive: SimPrimitive) -> Any | None:
    kwargs: dict[str, float] = {}
    if primitive.mass_kg is not None:
        volume = primitive_volume_m3(primitive)
        if volume is not None and volume > 0.0:
            kwargs["rho"] = primitive.mass_kg / volume
    if primitive.friction is not None:
        kwargs["friction"] = primitive.friction
    if primitive.restitution is not None:
        kwargs["coup_restitution"] = primitive.restitution
    return gs.materials.Rigid(**kwargs) if kwargs else None


def add_mesh_entity_if_available(
    gs: Any,
    scene: Any,
    primitive: SimPrimitive,
    asset_roots: Sequence[Path],
) -> bool:
    if primitive.asset_ref is None:
        return False
    asset_path = resolve_world_layout_asset_path(primitive.asset_ref, asset_roots)
    if asset_path is None:
        print(
            "[genesis-workspace] warning: "
            f"mesh asset not found for object '{primitive.source_id}': {primitive.asset_ref}; using proxy.",
            flush=True,
        )
        return False
    try:
        morph = gs.morphs.Mesh(
            file=str(asset_path),
            scale=primitive.asset_scale_xyz or (1.0, 1.0, 1.0),
            pos=primitive.position_xyz,
            quat=primitive.quat_wxyz,
            fixed=primitive.fixed,
            collision=primitive.collision,
        )
        material = primitive_rigid_material(gs, primitive)
        entity_kwargs = {
            "morph": morph,
            "surface": gs.surfaces.Default(color=primitive.rgba[:3], opacity=primitive.rgba[3]),
            "name": primitive.sim_name,
        }
        if material is not None:
            entity_kwargs["material"] = material
        scene.add_entity(**entity_kwargs)
        return True
    except Exception as exc:
        print(
            "[genesis-workspace] warning: "
            f"failed to add mesh object '{primitive.source_id}': {exc}; using proxy.",
            flush=True,
        )
        return False


def add_primitive_entity(
    gs: Any,
    scene: Any,
    primitive: SimPrimitive,
    *,
    asset_roots: Sequence[Path] = (),
) -> None:
    if add_mesh_entity_if_available(gs, scene, primitive, asset_roots):
        return
    if primitive.sim_type == "box":
        morph = gs.morphs.Box(
            size=primitive.size_xyz,
            pos=primitive.position_xyz,
            quat=primitive.quat_wxyz,
            fixed=primitive.fixed,
            collision=primitive.collision,
        )
    elif primitive.sim_type == "sphere":
        morph = gs.morphs.Sphere(
            radius=max(primitive.size_xyz) * 0.5,
            pos=primitive.position_xyz,
            quat=primitive.quat_wxyz,
            fixed=primitive.fixed,
            collision=primitive.collision,
        )
    elif primitive.sim_type == "cylinder":
        morph = gs.morphs.Cylinder(
            radius=primitive.size_xyz[0] * 0.5,
            height=primitive.size_xyz[2],
            pos=primitive.position_xyz,
            quat=primitive.quat_wxyz,
            fixed=primitive.fixed,
            collision=primitive.collision,
        )
    else:
        raise ValueError(f"Unsupported Genesis primitive type: {primitive.sim_type}")
    material = primitive_rigid_material(gs, primitive)
    entity_kwargs = {
        "morph": morph,
        "surface": gs.surfaces.Default(color=primitive.rgba[:3], opacity=primitive.rgba[3]),
        "name": primitive.sim_name,
    }
    if material is not None:
        entity_kwargs["material"] = material
    scene.add_entity(**entity_kwargs)
