from __future__ import annotations

import re

from backend.services.world_layout_transfer_types import ConcreteWorldLayoutFrameMap

WORLD_OBJECT_TYPES = frozenset({"cube", "point", "sphere", "cylinder", "mesh"})
WORLD_OBJECT_MESH_ASSET_KEYS = ("asset_ref", "path", "uri", "filename")
WORLD_OBJECT_ASSET_SCALE_KEYS = ("asset_scale_xyz", "mesh_scale_xyz", "scale_xyz")

CONCRETE_WORLD_LAYOUT_FRAME_MAPS = frozenset({"identity", "studio-y-up-to-z-up"})
Z_UP_FRAME_CONVENTIONS = frozenset(
    {
        "ros",
        "ros-rep-103",
        "rep-103",
        "urdf",
        "world",
        "world-z-up",
        "z-up",
        "zup",
        "identity",
        "mujoco-z-up",
        "genesis-z-up",
        "simulator-z-up",
        "studio-z-up",
        "urdf-studio",
        "urdf-studio-z-up",
    }
)
Y_UP_FRAME_CONVENTIONS = frozenset(
    {
        "studio-y-up",
        "three-y-up",
        "threejs-y-up",
        "webgl-y-up",
        "y-up",
        "yup",
    }
)


def normalize_world_frame_convention(value: str) -> str:
    normalized = value.strip().lower().replace("_", "-")
    return re.sub(r"\s+", "-", normalized)


def frame_map_from_world_frame_convention(
    frame_convention: str,
) -> ConcreteWorldLayoutFrameMap | None:
    normalized = normalize_world_frame_convention(frame_convention)
    if normalized in Z_UP_FRAME_CONVENTIONS:
        return "identity"
    if normalized in Y_UP_FRAME_CONVENTIONS:
        return "studio-y-up-to-z-up"
    return None
