from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from backend.services.simulator_adapters.params import MUJOCO_SCENE_PARAMS
from backend.services.simulator_adapters.scene_bounds import scene_bounds_from_aabbs


@dataclass(frozen=True)
class MujocoSceneBounds:
    center_xyz: tuple[float, float, float]
    radius_m: float
    min_xyz: tuple[float, float, float]
    max_xyz: tuple[float, float, float]
    geom_count: int


def mujoco_scene_bounds(mujoco: Any, model: Any, data: Any) -> MujocoSceneBounds:
    aabbs: list[tuple[tuple[float, float, float], tuple[float, float, float]]] = []
    plane_type = int(mujoco.mjtGeom.mjGEOM_PLANE)

    for geom_id in range(int(model.ngeom)):
        if int(model.geom_type[geom_id]) == plane_type:
            continue
        center = np.asarray(data.geom_xpos[geom_id], dtype=float)
        half_extent = _geom_half_extent(mujoco, model, data, geom_id)
        if half_extent is None:
            continue
        lower = center - half_extent
        upper = center + half_extent
        aabbs.append((
            tuple(float(value) for value in lower),
            tuple(float(value) for value in upper),
        ))

    viewer_params = MUJOCO_SCENE_PARAMS.viewer
    bounds = scene_bounds_from_aabbs(
        aabbs,
        default_center_xyz=viewer_params.default_center_xyz,
        default_radius_m=viewer_params.default_radius_m,
        min_radius_m=viewer_params.min_radius_m,
    )
    return MujocoSceneBounds(
        center_xyz=bounds.center_xyz,
        radius_m=bounds.radius_m,
        min_xyz=bounds.min_xyz,
        max_xyz=bounds.max_xyz,
        geom_count=bounds.item_count,
    )


def configure_mujoco_passive_viewer(
    mujoco: Any,
    model: Any,
    data: Any,
    viewer: Any,
) -> MujocoSceneBounds:
    bounds = mujoco_scene_bounds(mujoco, model, data)
    params = MUJOCO_SCENE_PARAMS.viewer

    _configure_free_camera_type(mujoco, viewer)
    viewer.cam.lookat[:] = bounds.center_xyz
    viewer.cam.distance = max(
        float(params.min_distance_m),
        bounds.radius_m * float(params.distance_scale),
    )
    viewer.cam.azimuth = float(params.azimuth_deg)
    viewer.cam.elevation = float(params.elevation_deg)

    geomgroup = getattr(getattr(viewer, "opt", None), "geomgroup", None)
    if geomgroup is not None:
        for group_id in params.visible_geom_groups:
            if 0 <= group_id < len(geomgroup):
                geomgroup[group_id] = 1

    return bounds


def _configure_free_camera_type(mujoco: Any, viewer: Any) -> None:
    try:
        viewer.cam.type = mujoco.mjtCamera.mjCAMERA_FREE
    except AttributeError:
        return


def _finite_positive_float(value: object) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(parsed) or parsed <= 0.0:
        return None
    return parsed


def _geom_half_extent(mujoco: Any, model: Any, data: Any, geom_id: int) -> np.ndarray | None:
    geom_type = int(model.geom_type[geom_id])
    size = np.asarray(model.geom_size[geom_id], dtype=float)
    rotation = np.asarray(data.geom_xmat[geom_id], dtype=float).reshape(3, 3)

    if geom_type == int(mujoco.mjtGeom.mjGEOM_BOX):
        return _rotated_half_extent(rotation, size[:3])
    if geom_type == int(mujoco.mjtGeom.mjGEOM_SPHERE):
        radius = _finite_positive_float(size[0])
        return np.full(3, radius, dtype=float) if radius is not None else None
    if geom_type == int(mujoco.mjtGeom.mjGEOM_CYLINDER):
        radius = _finite_positive_float(size[0])
        half_height = _finite_positive_float(size[1])
        if radius is None or half_height is None:
            return None
        return _rotated_half_extent(rotation, (radius, radius, half_height))
    if geom_type == int(mujoco.mjtGeom.mjGEOM_CAPSULE):
        radius = _finite_positive_float(size[0])
        half_height = _finite_positive_float(size[1])
        if radius is None or half_height is None:
            return None
        return _rotated_half_extent(rotation, (radius, radius, half_height + radius))
    if geom_type == int(mujoco.mjtGeom.mjGEOM_ELLIPSOID):
        return _rotated_half_extent(rotation, size[:3])

    radius = _finite_positive_float(model.geom_rbound[geom_id])
    if radius is None:
        radius = _geom_size_radius_estimate(model, geom_id)
    return np.full(3, radius, dtype=float) if radius is not None else None


def _rotated_half_extent(rotation: np.ndarray, local_half_extent: object) -> np.ndarray | None:
    half_extent = np.asarray(local_half_extent, dtype=float)
    if (
        half_extent.shape != (3,)
        or not np.all(np.isfinite(half_extent))
        or np.any(half_extent <= 0.0)
    ):
        return None
    return np.abs(rotation) @ half_extent


def _geom_size_radius_estimate(model: Any, geom_id: int) -> float | None:
    size = np.asarray(model.geom_size[geom_id], dtype=float)
    if size.size == 0:
        return None
    finite = size[np.isfinite(size) & (size > 0.0)]
    if finite.size == 0:
        return None
    return float(np.linalg.norm(finite))
