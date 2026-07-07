"""OpenUSD interchange for the World format.

The JSON World document stays the canonical, hashable source of truth
(docs/specs/WORLD_FORMAT.md); USD is an interchange target/source handled at
the adapter layer, exactly like MJCF:

- ``export_world_to_usda``: World -> .usda stage (Z-up, meters). Primitives
  become UsdGeom Cube/Sphere/Cylinder prims with UsdPhysics rigid-body /
  collision / mass APIs and displayColor; asset-backed objects (mesh/splat)
  export as their bounding cube with the portable asset reference preserved
  in customData (lossy by design). The robot URDF and cameras are not
  exported (documented; the Isaac adapter stages the robot separately).
- ``import_usd_to_world``: flattened-stage import for rigid scenes. Gprim
  world transforms/sizes, UsdPhysics APIs, and displayColor map onto world
  objects; metersPerUnit scales into meters; a Y-up stage sets
  environment.frame_convention so the existing frame-map machinery converts.
  Provenance records the source path and file digest.

Requires the ``usd-core`` package (pxr without Isaac/Omniverse).
"""

from __future__ import annotations

import hashlib
import math
from pathlib import Path
from typing import Any

from backend.models.json_payload import JsonObject

WORLD_USD_OBJECT_TYPE_KEY = "urdfstudio:objectType"
WORLD_USD_ASSET_REF_KEY = "urdfstudio:assetRef"
WORLD_USD_ASSET_SCALE_KEY = "urdfstudio:assetScaleXyz"
WORLD_USD_FRICTION_KEY = "urdfstudio:friction"
WORLD_USD_RESTITUTION_KEY = "urdfstudio:restitution"
WORLD_USD_SEMANTIC_ROLE_KEY = "urdfstudio:semanticRole"

WORLD_USD_DEFAULT_COLOR = "#9ca3af"


class WorldUsdInterchangeError(ValueError):
    ...


def _require_pxr() -> Any:
    try:
        from pxr import Gf, Sdf, Usd, UsdGeom, UsdPhysics
    except ImportError as exc:  # pragma: no cover - environment guard
        raise WorldUsdInterchangeError(
            "OpenUSD support requires the usd-core package (pip install usd-core)."
        ) from exc
    return Gf, Sdf, Usd, UsdGeom, UsdPhysics


# --- export ---


def export_world_to_usda(world_payload: JsonObject, output_path: str | Path) -> Path:
    """Export a world document/envelope payload to a .usda stage."""
    from backend.services.world_scene_package_compat import read_world_scene_registry_envelope

    Gf, Sdf, Usd, UsdGeom, UsdPhysics = _require_pxr()
    envelope = read_world_scene_registry_envelope(world_payload)
    world = envelope.world

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Usd.Stage.CreateNew(str(output))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    stage.SetMetadata(
        "customLayerData",
        {
            "urdfstudio:packageId": envelope.package_id,
            "urdfstudio:version": envelope.version,
            "urdfstudio:worldName": world.name or "",
            "urdfstudio:frameConvention": _frame_convention(world) or "ros-rep-103",
        },
    )
    root = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(root.GetPrim())
    objects_scope = UsdGeom.Scope.Define(stage, "/World/Objects")
    del objects_scope

    for world_object in world.objects:
        if not isinstance(world_object, dict):
            continue
        _export_object(stage, world_object, Gf=Gf, UsdGeom=UsdGeom, UsdPhysics=UsdPhysics)

    stage.GetRootLayer().Save()
    return output


def _frame_convention(world: Any) -> str | None:
    environment = world.environment if isinstance(world.environment, dict) else None
    if environment is None:
        return None
    value = environment.get("frame_convention")
    return str(value) if isinstance(value, str) and value.strip() else None


def _safe_prim_name(object_id: str) -> str:
    import re

    normalized = re.sub(r"[^A-Za-z0-9_]", "_", object_id)
    if not normalized or normalized[0].isdigit():
        normalized = f"obj_{normalized}"
    return normalized


def _export_object(stage: Any, world_object: dict, *, Gf: Any, UsdGeom: Any, UsdPhysics: Any) -> None:
    object_id = str(world_object.get("id", "")).strip()
    if not object_id:
        return
    object_type = str(world_object.get("type", "cube"))
    prim_path = f"/World/Objects/{_safe_prim_name(object_id)}"
    size = [float(v) for v in world_object.get("size_xyz", (0.1, 0.1, 0.1))]

    if object_type == "sphere":
        gprim = UsdGeom.Sphere.Define(stage, prim_path)
        gprim.GetRadiusAttr().Set(max(size) / 2.0)
        extent = max(size) / 2.0
        gprim.GetExtentAttr().Set([Gf.Vec3f(-extent), Gf.Vec3f(extent)])
        scale = None
    elif object_type == "cylinder":
        gprim = UsdGeom.Cylinder.Define(stage, prim_path)
        gprim.GetRadiusAttr().Set(size[0] / 2.0)
        gprim.GetHeightAttr().Set(size[2])
        gprim.GetAxisAttr().Set(UsdGeom.Tokens.z)
        half = Gf.Vec3f(size[0] / 2.0, size[0] / 2.0, size[2] / 2.0)
        gprim.GetExtentAttr().Set([-half, half])
        scale = None
    else:
        # cube, point, and asset-backed mesh/splat objects (bounding cube).
        gprim = UsdGeom.Cube.Define(stage, prim_path)
        gprim.GetSizeAttr().Set(1.0)
        half = Gf.Vec3f(0.5, 0.5, 0.5)
        gprim.GetExtentAttr().Set([-half, half])
        scale = size

    xform = UsdGeom.Xformable(gprim)
    position = [float(v) for v in world_object.get("position_xyz", (0.0, 0.0, 0.0))]
    rotation = [float(v) for v in world_object.get("rotation_rpy_rad", (0.0, 0.0, 0.0))]
    xform.AddTranslateOp().Set(Gf.Vec3d(*position))
    xform.AddRotateXYZOp().Set(
        Gf.Vec3f(*(math.degrees(component) for component in rotation))
    )
    if scale is not None:
        xform.AddScaleOp().Set(Gf.Vec3f(*scale))

    color = str(world_object.get("color", WORLD_USD_DEFAULT_COLOR))
    gprim.GetDisplayColorAttr().Set([Gf.Vec3f(*_hex_to_rgb(color))])

    physics = world_object.get("physics") if isinstance(world_object.get("physics"), dict) else {}
    simulation = (
        world_object.get("simulation") if isinstance(world_object.get("simulation"), dict) else {}
    )
    fixed = bool(physics.get("fixed", simulation.get("fixed", True)))
    collision = bool(physics.get("collision", simulation.get("collision", True)))
    mass_kg = physics.get("mass_kg", simulation.get("mass_kg"))
    friction = physics.get("friction", simulation.get("friction"))
    restitution = physics.get("restitution", simulation.get("restitution"))
    semantic_role = physics.get("semantic_role", simulation.get("semantic_role"))

    prim = gprim.GetPrim()
    if collision:
        UsdPhysics.CollisionAPI.Apply(prim)
    if not fixed:
        UsdPhysics.RigidBodyAPI.Apply(prim)
        if mass_kg is not None:
            UsdPhysics.MassAPI.Apply(prim).GetMassAttr().Set(float(mass_kg))

    custom_data: dict[str, Any] = {WORLD_USD_OBJECT_TYPE_KEY: object_type}
    asset_ref = _read_asset_ref(world_object)
    if asset_ref is not None:
        custom_data[WORLD_USD_ASSET_REF_KEY] = asset_ref
    asset_scale = world_object.get("asset_scale_xyz")
    if isinstance(asset_scale, (list, tuple)) and len(asset_scale) == 3:
        custom_data[WORLD_USD_ASSET_SCALE_KEY] = [float(v) for v in asset_scale]
    if friction is not None:
        custom_data[WORLD_USD_FRICTION_KEY] = float(friction)
    if restitution is not None:
        custom_data[WORLD_USD_RESTITUTION_KEY] = float(restitution)
    if isinstance(semantic_role, str) and semantic_role.strip():
        custom_data[WORLD_USD_SEMANTIC_ROLE_KEY] = semantic_role
    prim.SetCustomData(custom_data)


def _read_asset_ref(world_object: dict) -> str | None:
    asset_ref = world_object.get("asset_ref")
    if isinstance(asset_ref, str) and asset_ref.strip():
        return asset_ref
    mesh = world_object.get("mesh")
    if isinstance(mesh, dict):
        for key in ("asset_ref", "path", "uri", "filename"):
            value = mesh.get(key)
            if isinstance(value, str) and value.strip():
                return value
    return None


def _hex_to_rgb(color: str) -> tuple[float, float, float]:
    value = color.lstrip("#")
    if len(value) != 6:
        return (0.61, 0.64, 0.69)
    try:
        return tuple(int(value[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError:
        return (0.61, 0.64, 0.69)


# --- import ---


def import_usd_to_world(
    usd_path: str | Path,
    *,
    package_id: str | None = None,
    version: str = "1.0.0",
) -> JsonObject:
    """Import a USD stage as a thin world registry envelope payload (lossy).

    Supported: UsdGeom Cube/Sphere/Cylinder gprims with rigid transforms,
    UsdPhysics rigid-body/collision/mass, displayColor. Mesh prims and other
    types are skipped with a warning entry in provenance. metersPerUnit is
    scaled into meters; a Y-up stage records a y-up frame convention so the
    existing frame-map machinery converts on simulator transfer.
    """
    Gf, Sdf, Usd, UsdGeom, UsdPhysics = _require_pxr()
    del Gf, Sdf
    path = Path(usd_path)
    if not path.is_file():
        raise WorldUsdInterchangeError(f"USD file was not found: {path}")
    stage = Usd.Stage.Open(str(path))
    if stage is None:
        raise WorldUsdInterchangeError(f"Failed to open USD stage: {path}")

    meters_per_unit = float(UsdGeom.GetStageMetersPerUnit(stage) or 1.0)
    up_axis = UsdGeom.GetStageUpAxis(stage)
    frame_convention = "ros-rep-103" if up_axis == UsdGeom.Tokens.z else "y-up"

    objects: list[JsonObject] = []
    skipped: list[str] = []
    used_ids: set[str] = set()
    for prim in stage.Traverse():
        world_object = _import_prim(
            prim,
            meters_per_unit=meters_per_unit,
            used_ids=used_ids,
            skipped=skipped,
            UsdGeom=UsdGeom,
            UsdPhysics=UsdPhysics,
        )
        if world_object is not None:
            objects.append(world_object)

    if not objects:
        raise WorldUsdInterchangeError(
            f"No importable rigid gprims (Cube/Sphere/Cylinder) found in {path}."
        )

    layer_data = stage.GetRootLayer().customLayerData or {}
    resolved_package_id = (
        package_id
        or str(layer_data.get("urdfstudio:packageId", "")).strip()
        or _package_id_from_filename(path)
    )
    provenance: JsonObject = {
        "source": "usd-import",
        "source_usd": path.name,
        "source_usd_digest_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "meters_per_unit": meters_per_unit,
        "up_axis": str(up_axis),
    }
    if skipped:
        provenance["skipped_prims"] = skipped

    return {
        "package_id": resolved_package_id,
        "version": version,
        "provenance": provenance,
        "artifacts": [],
        "world": {
            "name": str(layer_data.get("urdfstudio:worldName", "")) or resolved_package_id,
            "objects": objects,
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
            "environment": {"frame_convention": frame_convention},
        },
    }


def _package_id_from_filename(path: Path) -> str:
    import re

    stem = re.sub(r"[^A-Za-z0-9_\-]", "-", path.stem).strip("-")
    return stem or "usd-import"


def _import_prim(
    prim: Any,
    *,
    meters_per_unit: float,
    used_ids: set[str],
    skipped: list[str],
    UsdGeom: Any,
    UsdPhysics: Any,
) -> JsonObject | None:
    if prim.IsA(UsdGeom.Cube):
        gprim = UsdGeom.Cube(prim)
        base_size = float(gprim.GetSizeAttr().Get() or 1.0)
        local_size = (base_size, base_size, base_size)
        object_type = "cube"
    elif prim.IsA(UsdGeom.Sphere):
        gprim = UsdGeom.Sphere(prim)
        diameter = 2.0 * float(gprim.GetRadiusAttr().Get() or 0.05)
        local_size = (diameter, diameter, diameter)
        object_type = "sphere"
    elif prim.IsA(UsdGeom.Cylinder):
        gprim = UsdGeom.Cylinder(prim)
        diameter = 2.0 * float(gprim.GetRadiusAttr().Get() or 0.05)
        height = float(gprim.GetHeightAttr().Get() or 0.1)
        local_size = (diameter, diameter, height)
        object_type = "cylinder"
    elif prim.IsA(UsdGeom.Gprim):
        skipped.append(f"{prim.GetPath()} ({prim.GetTypeName()})")
        return None
    else:
        return None

    transform = UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(0.0)
    translation, rotation_rpy, scale = _decompose(transform)
    position = [component * meters_per_unit for component in translation]
    size = [
        max(abs(local) * abs(axis_scale) * meters_per_unit, 1e-6)
        for local, axis_scale in zip(local_size, scale)
    ]

    custom_data = prim.GetCustomData() or {}
    declared_type = custom_data.get(WORLD_USD_OBJECT_TYPE_KEY)
    if isinstance(declared_type, str) and declared_type.strip():
        object_type = declared_type

    physics: JsonObject = {
        "fixed": not prim.HasAPI(UsdPhysics.RigidBodyAPI),
        "collision": prim.HasAPI(UsdPhysics.CollisionAPI),
    }
    if prim.HasAPI(UsdPhysics.MassAPI):
        mass = UsdPhysics.MassAPI(prim).GetMassAttr().Get()
        if mass:
            physics["mass_kg"] = float(mass)
    friction = custom_data.get(WORLD_USD_FRICTION_KEY)
    if isinstance(friction, (int, float)):
        physics["friction"] = float(friction)
    restitution = custom_data.get(WORLD_USD_RESTITUTION_KEY)
    if isinstance(restitution, (int, float)):
        physics["restitution"] = float(restitution)
    semantic_role = custom_data.get(WORLD_USD_SEMANTIC_ROLE_KEY)
    if isinstance(semantic_role, str) and semantic_role.strip():
        physics["semantic_role"] = semantic_role

    object_id = _unique_object_id(prim.GetName(), used_ids)
    world_object: JsonObject = {
        "id": object_id,
        "name": prim.GetName(),
        "type": object_type,
        "position_xyz": position,
        "rotation_rpy_rad": list(rotation_rpy),
        "size_xyz": size,
        "color": _display_color_hex(UsdGeom.Gprim(prim)),
        "physics": physics,
    }
    asset_ref = custom_data.get(WORLD_USD_ASSET_REF_KEY)
    if isinstance(asset_ref, str) and asset_ref.strip():
        world_object["asset_ref"] = asset_ref
    asset_scale = custom_data.get(WORLD_USD_ASSET_SCALE_KEY)
    if asset_scale is not None:
        try:
            values = [float(v) for v in asset_scale]
        except (TypeError, ValueError):
            values = []
        if len(values) == 3:
            world_object["asset_scale_xyz"] = values
    return world_object


def _unique_object_id(name: str, used_ids: set[str]) -> str:
    candidate = name or "object"
    suffix = 1
    while candidate in used_ids:
        suffix += 1
        candidate = f"{name}_{suffix}"
    used_ids.add(candidate)
    return candidate


def _decompose(transform: Any) -> tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]:
    import numpy as np
    from scipy.spatial.transform import Rotation

    matrix = np.array([[transform[row][col] for col in range(4)] for row in range(4)], dtype=float)
    # Gf matrices are row-major with translation in the last row.
    translation = tuple(float(v) for v in matrix[3, :3])
    linear = matrix[:3, :3].T
    scale = tuple(float(np.linalg.norm(linear[:, axis])) for axis in range(3))
    rotation_matrix = np.column_stack(
        [linear[:, axis] / scale[axis] if scale[axis] > 0 else linear[:, axis] for axis in range(3)]
    )
    rotation_rpy = tuple(
        float(v) for v in Rotation.from_matrix(rotation_matrix).as_euler("xyz")
    )
    return translation, rotation_rpy, scale


def _display_color_hex(gprim: Any) -> str:
    colors = gprim.GetDisplayColorAttr().Get()
    if not colors:
        return WORLD_USD_DEFAULT_COLOR
    rgb = colors[0]
    return "#{:02x}{:02x}{:02x}".format(
        *(max(0, min(255, round(float(channel) * 255))) for channel in rgb)
    )
