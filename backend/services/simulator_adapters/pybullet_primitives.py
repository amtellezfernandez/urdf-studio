from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence, TypeAlias

from backend.services.simulator_adapters.camera_transfer import (
    CAMERA_MARKER_RGBA,
    CAMERA_MARKER_SIZE_XYZ,
    SimCameraSpec,
)
from backend.services.simulator_adapters.world_mesh_assets import resolve_declared_mesh_asset_path
from backend.services.world_layout_transfer_types import SimPrimitive
from backend.services.world_layout_transfer_types import WorldLayoutTransferError


PyBulletShapeKwargs: TypeAlias = dict[str, object]


@dataclass(frozen=True)
class PyBulletPrimitiveShape:
    shape_type: int
    collision_kwargs: PyBulletShapeKwargs
    visual_kwargs: PyBulletShapeKwargs


def _quat_wxyz_to_xyzw(quat_wxyz: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    return (quat_wxyz[1], quat_wxyz[2], quat_wxyz[3], quat_wxyz[0])


def pybullet_primitive_shape(
    pybullet: Any,
    primitive: SimPrimitive,
    *,
    asset_roots: Sequence[Path] = (),
) -> PyBulletPrimitiveShape:
    asset_path = resolve_declared_mesh_asset_path(
        primitive,
        asset_roots,
        simulator_label="PyBullet",
    )
    if asset_path is not None:
        if not hasattr(pybullet, "GEOM_MESH"):
            raise WorldLayoutTransferError("PyBullet mesh asset transfer requires GEOM_MESH support.")
        shape_kwargs = {
            "fileName": str(asset_path),
            "meshScale": primitive.asset_scale_xyz or (1.0, 1.0, 1.0),
        }
        return PyBulletPrimitiveShape(
            shape_type=pybullet.GEOM_MESH,
            collision_kwargs=shape_kwargs,
            visual_kwargs=shape_kwargs,
        )
    if primitive.sim_type == "box":
        shape_kwargs = {
            "halfExtents": [component * 0.5 for component in primitive.size_xyz],
        }
        return PyBulletPrimitiveShape(
            shape_type=pybullet.GEOM_BOX,
            collision_kwargs=shape_kwargs,
            visual_kwargs=shape_kwargs,
        )
    if primitive.sim_type == "sphere":
        shape_kwargs = {
            "radius": max(primitive.size_xyz) * 0.5,
        }
        return PyBulletPrimitiveShape(
            shape_type=pybullet.GEOM_SPHERE,
            collision_kwargs=shape_kwargs,
            visual_kwargs=shape_kwargs,
        )
    if primitive.sim_type == "cylinder":
        return PyBulletPrimitiveShape(
            shape_type=pybullet.GEOM_CYLINDER,
            collision_kwargs={
                "radius": primitive.size_xyz[0] * 0.5,
                "height": primitive.size_xyz[2],
            },
            visual_kwargs={
                "radius": primitive.size_xyz[0] * 0.5,
                "length": primitive.size_xyz[2],
            },
        )
    raise ValueError(f"Unsupported PyBullet primitive type: {primitive.sim_type}")


def add_pybullet_primitive(
    pybullet: Any,
    primitive: SimPrimitive,
    *,
    asset_roots: Sequence[Path] = (),
) -> int:
    shape = pybullet_primitive_shape(
        pybullet,
        primitive,
        asset_roots=asset_roots,
    )
    collision_shape = (
        pybullet.createCollisionShape(shape.shape_type, **shape.collision_kwargs)
        if primitive.collision
        else -1
    )
    visual_shape = pybullet.createVisualShape(
        shape.shape_type,
        rgbaColor=primitive.rgba,
        **shape.visual_kwargs,
    )
    base_mass = 0.0 if primitive.fixed else (primitive.mass_kg if primitive.mass_kg is not None else 1.0)
    body_id = pybullet.createMultiBody(
        baseMass=base_mass,
        baseCollisionShapeIndex=collision_shape,
        baseVisualShapeIndex=visual_shape,
        basePosition=primitive.position_xyz,
        baseOrientation=_quat_wxyz_to_xyzw(primitive.quat_wxyz),
    )
    dynamics_kwargs: dict[str, float] = {}
    if primitive.friction is not None:
        dynamics_kwargs["lateralFriction"] = primitive.friction
    if primitive.restitution is not None:
        dynamics_kwargs["restitution"] = primitive.restitution
    if dynamics_kwargs:
        pybullet.changeDynamics(body_id, -1, **dynamics_kwargs)
    return body_id


def add_pybullet_camera_marker(pybullet: Any, camera: SimCameraSpec) -> int:
    visual_shape = pybullet.createVisualShape(
        pybullet.GEOM_BOX,
        halfExtents=[component * 0.5 for component in CAMERA_MARKER_SIZE_XYZ],
        rgbaColor=CAMERA_MARKER_RGBA,
    )
    return pybullet.createMultiBody(
        baseMass=0.0,
        baseCollisionShapeIndex=-1,
        baseVisualShapeIndex=visual_shape,
        basePosition=camera.position_xyz,
        baseOrientation=camera.quat_xyzw,
    )
