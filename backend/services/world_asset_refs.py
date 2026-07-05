from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

PORTABLE_WORLD_ASSET_REF_ERROR = "must be a portable relative asset reference"
WORLD_OBJECT_ASSET_REF_KEYS = (
    "asset_ref",
    "asset_path",
    "mesh_ref",
    "mesh_path",
    "meshReference",
)
WORLD_OBJECT_MESH_ASSET_REF_KEYS = ("asset_ref", "path", "uri", "filename")
WORLD_OBJECT_APPEARANCE_ASSET_REF_KINDS = {"mesh", "splat"}


@dataclass(frozen=True)
class WorldObjectAssetRef:
    value: str
    field_path: str


def normalize_portable_world_asset_ref(value: str) -> str:
    if value != value.strip():
        raise ValueError(PORTABLE_WORLD_ASSET_REF_ERROR)
    normalized = value.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    segments = normalized.split("/") if normalized else []
    if (
        not normalized
        or any(segment in {"", ".", ".."} for segment in segments)
        or normalized.startswith("/")
        or normalized.startswith("../")
        or "/../" in f"/{normalized}/"
        or ":" in normalized
    ):
        raise ValueError(PORTABLE_WORLD_ASSET_REF_ERROR)
    return normalized


def read_world_object_asset_ref(value: Mapping[str, object]) -> WorldObjectAssetRef | None:
    physics = value.get("physics")
    if isinstance(physics, Mapping):
        collision_geometry = physics.get("collision_geometry")
        if isinstance(collision_geometry, Mapping):
            asset_ref = collision_geometry.get("asset_ref")
            if isinstance(asset_ref, str) and asset_ref.strip():
                return WorldObjectAssetRef(
                    value=asset_ref,
                    field_path="physics.collision_geometry.asset_ref",
                )
    for key in WORLD_OBJECT_ASSET_REF_KEYS:
        asset_ref = value.get(key)
        if isinstance(asset_ref, str) and asset_ref.strip():
            return WorldObjectAssetRef(value=asset_ref, field_path=key)
    mesh = value.get("mesh")
    if isinstance(mesh, Mapping):
        for key in WORLD_OBJECT_MESH_ASSET_REF_KEYS:
            asset_ref = mesh.get(key)
            if isinstance(asset_ref, str) and asset_ref.strip():
                return WorldObjectAssetRef(value=asset_ref, field_path=f"mesh.{key}")
    geometry = value.get("geometry")
    if isinstance(geometry, Mapping):
        geometry_mesh = geometry.get("mesh")
        if isinstance(geometry_mesh, Mapping):
            for key in WORLD_OBJECT_MESH_ASSET_REF_KEYS:
                asset_ref = geometry_mesh.get(key)
                if isinstance(asset_ref, str) and asset_ref.strip():
                    return WorldObjectAssetRef(
                        value=asset_ref,
                        field_path=f"geometry.mesh.{key}",
                    )
    appearance = value.get("appearance")
    if isinstance(appearance, Mapping):
        representations = appearance.get("representations")
        if isinstance(representations, list):
            for index, representation in enumerate(representations):
                if not isinstance(representation, Mapping):
                    continue
                if representation.get("kind") not in WORLD_OBJECT_APPEARANCE_ASSET_REF_KINDS:
                    continue
                asset_ref = representation.get("asset_ref")
                if isinstance(asset_ref, str) and asset_ref.strip():
                    return WorldObjectAssetRef(
                        value=asset_ref,
                        field_path=f"appearance.representations[{index}].asset_ref",
                    )
    return None
