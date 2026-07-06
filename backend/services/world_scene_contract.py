from __future__ import annotations

import re

WORLD_OBJECT_TYPES = frozenset({"cube", "point", "sphere", "cylinder", "mesh"})
WORLD_OBJECT_MESH_ASSET_KEYS = ("asset_ref", "path", "uri", "filename")

CONCRETE_WORLD_LAYOUT_FRAME_MAPS = frozenset({"identity", "studio-y-up-to-z-up"})
Z_UP_FRAME_CONVENTIONS = frozenset(
    {
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
