"""OpenUSD interchange for the World format.

The JSON World document stays the canonical, hashable source of truth
(docs/specs/WORLD_FORMAT.md); USD is an interchange target/source handled at
the adapter layer, exactly like MJCF — but expressed with native USD
constructs wherever USD has one:

- Primitives are UsdGeom Cube/Sphere/Cylinder prims; mesh-backed objects with
  resolvable assets export as real ``UsdGeom.Mesh`` geometry (via trimesh),
  falling back to a bounding cube only when the asset cannot be resolved.
- Rigid-body/collision/mass use the ``UsdPhysics`` applied APIs.
- Friction/restitution are native physics materials: ``UsdShade.Material``
  prims with ``UsdPhysics.MaterialAPI``, bound with the ``physics`` material
  purpose (deduplicated under ``/World/PhysicsMaterials``).
- Portable asset references ride in prim ``assetInfo`` (the native asset
  provenance channel); only concepts USD has no channel for (the World
  object type, semantic role, asset scale) use ``customData``.

Import flattens rigid stages: gprim world transforms/sizes, physics APIs and
bound physics materials, displayColor — and ``UsdGeom.Mesh`` prims become
world mesh objects with their triangulated geometry written to portable
``assets/*.stl`` files when an asset output directory is provided.
``metersPerUnit`` scales into meters; a Y-up stage records a y-up
``environment.frame_convention`` so the existing frame-map machinery converts
on simulator transfer. Provenance records the source path and file digest.

Requires the ``usd-core`` package (pxr without Isaac/Omniverse).
"""

from __future__ import annotations

import hashlib
import math
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from backend.models.json_payload import JsonObject

WORLD_USD_OBJECT_TYPE_KEY = "urdfstudio:objectType"
WORLD_USD_ASSET_SCALE_KEY = "urdfstudio:assetScaleXyz"
WORLD_USD_SEMANTIC_ROLE_KEY = "urdfstudio:semanticRole"
WORLD_USD_ASSET_INFO_KEY = "urdfstudio:assetRef"

WORLD_USD_PHYSICS_MATERIALS_SCOPE = "/World/PhysicsMaterials"
WORLD_USD_DEFAULT_COLOR = "#9ca3af"

_IMPORTED_MESH_ASSET_DIRNAME = "assets"


class WorldUsdInterchangeError(ValueError):
    ...


def _require_pxr() -> Any:
    try:
        from pxr import Gf, Sdf, Usd, UsdGeom, UsdPhysics, UsdShade, Vt
    except ImportError as exc:  # pragma: no cover - environment guard
        raise WorldUsdInterchangeError(
            "OpenUSD support requires the usd-core package (pip install usd-core)."
        ) from exc
    return Gf, Sdf, Usd, UsdGeom, UsdPhysics, UsdShade, Vt


# --- export ---


def export_world_to_usda(
    world_payload: JsonObject,
    output_path: str | Path,
    *,
    asset_roots: Sequence[str | Path] = (),
) -> Path:
    """Export a world document/envelope payload to a .usda stage.

    ``asset_roots`` are directories used to resolve mesh/splat asset
    references so their real geometry can be exported as UsdGeom.Mesh prims.
    """
    from backend.services.world_scene_package_compat import read_world_scene_registry_envelope

    Gf, Sdf, Usd, UsdGeom, UsdPhysics, UsdShade, Vt = _require_pxr()
    del Sdf
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
    UsdGeom.Scope.Define(stage, "/World/Objects")

    exporter = _StageExporter(
        stage,
        asset_roots=tuple(Path(entry) for entry in asset_roots),
        Gf=Gf,
        UsdGeom=UsdGeom,
        UsdPhysics=UsdPhysics,
        UsdShade=UsdShade,
        Vt=Vt,
    )
    for world_object in world.objects:
        if isinstance(world_object, dict):
            exporter.export_object(world_object)

    stage.GetRootLayer().Save()
    return output


class _StageExporter:
    def __init__(
        self,
        stage: Any,
        *,
        asset_roots: tuple[Path, ...],
        Gf: Any,
        UsdGeom: Any,
        UsdPhysics: Any,
        UsdShade: Any,
        Vt: Any,
    ) -> None:
        self._stage = stage
        self._asset_roots = asset_roots
        self._Gf = Gf
        self._UsdGeom = UsdGeom
        self._UsdPhysics = UsdPhysics
        self._UsdShade = UsdShade
        self._Vt = Vt
        self._physics_materials: dict[tuple[float | None, float | None], Any] = {}

    def export_object(self, world_object: dict) -> None:
        object_id = str(world_object.get("id", "")).strip()
        if not object_id:
            return
        object_type = str(world_object.get("type", "cube"))
        prim_path = f"/World/Objects/{_safe_prim_name(object_id)}"
        size = [float(v) for v in world_object.get("size_xyz", (0.1, 0.1, 0.1))]

        gprim, scale = self._define_geometry(world_object, object_type, prim_path, size)
        self._apply_transform(gprim, world_object, scale)
        color = str(world_object.get("color", WORLD_USD_DEFAULT_COLOR))
        gprim.GetDisplayColorAttr().Set([self._Gf.Vec3f(*_hex_to_rgb(color))])
        self._apply_physics(gprim.GetPrim(), world_object, object_type)

    def _define_geometry(
        self,
        world_object: dict,
        object_type: str,
        prim_path: str,
        size: list[float],
    ) -> tuple[Any, list[float] | None]:
        UsdGeom = self._UsdGeom
        Gf = self._Gf
        if object_type == "sphere":
            gprim = UsdGeom.Sphere.Define(self._stage, prim_path)
            gprim.GetRadiusAttr().Set(max(size) / 2.0)
            extent = max(size) / 2.0
            gprim.GetExtentAttr().Set([Gf.Vec3f(-extent), Gf.Vec3f(extent)])
            return gprim, None
        if object_type == "cylinder":
            gprim = UsdGeom.Cylinder.Define(self._stage, prim_path)
            gprim.GetRadiusAttr().Set(size[0] / 2.0)
            gprim.GetHeightAttr().Set(size[2])
            gprim.GetAxisAttr().Set(UsdGeom.Tokens.z)
            half = Gf.Vec3f(size[0] / 2.0, size[0] / 2.0, size[2] / 2.0)
            gprim.GetExtentAttr().Set([-half, half])
            return gprim, None
        if object_type in ("mesh", "splat"):
            mesh_gprim = self._try_define_mesh(world_object, prim_path)
            if mesh_gprim is not None:
                return mesh_gprim, None
        gprim = UsdGeom.Cube.Define(self._stage, prim_path)
        gprim.GetSizeAttr().Set(1.0)
        half = Gf.Vec3f(0.5, 0.5, 0.5)
        gprim.GetExtentAttr().Set([-half, half])
        return gprim, size

    def _try_define_mesh(self, world_object: dict, prim_path: str) -> Any | None:
        asset_ref = _read_asset_ref(world_object)
        asset_path = _resolve_asset(asset_ref, self._asset_roots)
        if asset_path is None:
            return None
        try:
            import trimesh

            loaded = trimesh.load(str(asset_path), force="mesh")
            vertices = loaded.vertices
            faces = loaded.faces
        except Exception:  # noqa: BLE001 — unloadable assets fall back to a cube
            return None
        if vertices is None or faces is None or len(vertices) == 0 or len(faces) == 0:
            return None
        asset_scale = world_object.get("asset_scale_xyz")
        if isinstance(asset_scale, (list, tuple)) and len(asset_scale) == 3:
            vertices = vertices * [float(v) for v in asset_scale]

        UsdGeom = self._UsdGeom
        Gf = self._Gf
        Vt = self._Vt
        mesh = UsdGeom.Mesh.Define(self._stage, prim_path)
        mesh.GetPointsAttr().Set(
            Vt.Vec3fArray([Gf.Vec3f(*(float(c) for c in vertex)) for vertex in vertices])
        )
        mesh.GetFaceVertexCountsAttr().Set(Vt.IntArray([3] * len(faces)))
        mesh.GetFaceVertexIndicesAttr().Set(
            Vt.IntArray([int(index) for face in faces for index in face])
        )
        minimum = vertices.min(axis=0)
        maximum = vertices.max(axis=0)
        mesh.GetExtentAttr().Set(
            [Gf.Vec3f(*(float(v) for v in minimum)), Gf.Vec3f(*(float(v) for v in maximum))]
        )
        mesh.GetSubdivisionSchemeAttr().Set(UsdGeom.Tokens.none)
        return mesh

    def _apply_transform(self, gprim: Any, world_object: dict, scale: list[float] | None) -> None:
        Gf = self._Gf
        xform = self._UsdGeom.Xformable(gprim)
        position = [float(v) for v in world_object.get("position_xyz", (0.0, 0.0, 0.0))]
        rotation = [float(v) for v in world_object.get("rotation_rpy_rad", (0.0, 0.0, 0.0))]
        xform.AddTranslateOp().Set(Gf.Vec3d(*position))
        xform.AddRotateXYZOp().Set(Gf.Vec3f(*(math.degrees(component) for component in rotation)))
        if scale is not None:
            xform.AddScaleOp().Set(Gf.Vec3f(*scale))

    def _apply_physics(self, prim: Any, world_object: dict, object_type: str) -> None:
        UsdPhysics = self._UsdPhysics
        physics = world_object.get("physics") if isinstance(world_object.get("physics"), dict) else {}
        simulation = (
            world_object.get("simulation")
            if isinstance(world_object.get("simulation"), dict)
            else {}
        )
        fixed = bool(physics.get("fixed", simulation.get("fixed", True)))
        collision = bool(physics.get("collision", simulation.get("collision", True)))
        mass_kg = physics.get("mass_kg", simulation.get("mass_kg"))
        friction = physics.get("friction", simulation.get("friction"))
        restitution = physics.get("restitution", simulation.get("restitution"))
        semantic_role = physics.get("semantic_role", simulation.get("semantic_role"))

        if collision:
            UsdPhysics.CollisionAPI.Apply(prim)
        if not fixed:
            UsdPhysics.RigidBodyAPI.Apply(prim)
            if mass_kg is not None:
                UsdPhysics.MassAPI.Apply(prim).GetMassAttr().Set(float(mass_kg))
        if friction is not None or restitution is not None:
            self._bind_physics_material(prim, friction, restitution)

        asset_ref = _read_asset_ref(world_object)
        if asset_ref is not None:
            prim.SetAssetInfoByKey(WORLD_USD_ASSET_INFO_KEY, asset_ref)

        custom_data: dict[str, Any] = {WORLD_USD_OBJECT_TYPE_KEY: object_type}
        asset_scale = world_object.get("asset_scale_xyz")
        if isinstance(asset_scale, (list, tuple)) and len(asset_scale) == 3:
            custom_data[WORLD_USD_ASSET_SCALE_KEY] = [float(v) for v in asset_scale]
        if isinstance(semantic_role, str) and semantic_role.strip():
            custom_data[WORLD_USD_SEMANTIC_ROLE_KEY] = semantic_role
        prim.SetCustomData(custom_data)

    def _bind_physics_material(
        self,
        prim: Any,
        friction: float | None,
        restitution: float | None,
    ) -> None:
        UsdPhysics = self._UsdPhysics
        UsdShade = self._UsdShade
        key = (
            None if friction is None else round(float(friction), 6),
            None if restitution is None else round(float(restitution), 6),
        )
        material = self._physics_materials.get(key)
        if material is None:
            index = len(self._physics_materials)
            material_path = f"{WORLD_USD_PHYSICS_MATERIALS_SCOPE}/physics_material_{index}"
            material = UsdShade.Material.Define(self._stage, material_path)
            material_api = UsdPhysics.MaterialAPI.Apply(material.GetPrim())
            if friction is not None:
                material_api.CreateStaticFrictionAttr().Set(float(friction))
                material_api.CreateDynamicFrictionAttr().Set(float(friction))
            if restitution is not None:
                material_api.CreateRestitutionAttr().Set(float(restitution))
            self._physics_materials[key] = material
        binding = UsdShade.MaterialBindingAPI.Apply(prim)
        binding.Bind(
            material,
            bindingStrength=UsdShade.Tokens.fallbackStrength,
            materialPurpose="physics",
        )


def _frame_convention(world: Any) -> str | None:
    environment = world.environment if isinstance(world.environment, dict) else None
    if environment is None:
        return None
    value = environment.get("frame_convention")
    return str(value) if isinstance(value, str) and value.strip() else None


def _safe_prim_name(object_id: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_]", "_", object_id)
    if not normalized or normalized[0].isdigit():
        normalized = f"obj_{normalized}"
    return normalized


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


def _resolve_asset(asset_ref: str | None, asset_roots: tuple[Path, ...]) -> Path | None:
    if asset_ref is None:
        return None
    for root in asset_roots:
        candidate = (root / asset_ref).resolve()
        if candidate.is_file():
            return candidate
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
    asset_output_dir: str | Path | None = None,
) -> JsonObject:
    """Import a USD stage as a thin world registry envelope payload.

    Cube/Sphere/Cylinder gprims map directly onto world primitives.
    ``UsdGeom.Mesh`` prims become world mesh objects: their triangulated
    geometry is written as portable ``assets/*.stl`` files under
    ``asset_output_dir`` (meshes are skipped, with a provenance note, when no
    directory is given). Physics come from the UsdPhysics applied APIs and
    bound physics materials.
    """
    Gf, Sdf, Usd, UsdGeom, UsdPhysics, UsdShade, Vt = _require_pxr()
    del Gf, Sdf, Vt
    path = Path(usd_path)
    if not path.is_file():
        raise WorldUsdInterchangeError(f"USD file was not found: {path}")
    stage = Usd.Stage.Open(str(path))
    if stage is None:
        raise WorldUsdInterchangeError(f"Failed to open USD stage: {path}")

    meters_per_unit = float(UsdGeom.GetStageMetersPerUnit(stage) or 1.0)
    up_axis = UsdGeom.GetStageUpAxis(stage)
    frame_convention = "ros-rep-103" if up_axis == UsdGeom.Tokens.z else "y-up"

    importer = _StageImporter(
        meters_per_unit=meters_per_unit,
        asset_output_dir=Path(asset_output_dir) if asset_output_dir is not None else None,
        UsdGeom=UsdGeom,
        UsdPhysics=UsdPhysics,
        UsdShade=UsdShade,
    )
    objects: list[JsonObject] = []
    for prim in stage.Traverse():
        world_object = importer.import_prim(prim)
        if world_object is not None:
            objects.append(world_object)

    if not objects:
        raise WorldUsdInterchangeError(
            f"No importable gprims (Cube/Sphere/Cylinder/Mesh) found in {path}."
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
    if importer.skipped:
        provenance["skipped_prims"] = importer.skipped

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


class _StageImporter:
    def __init__(
        self,
        *,
        meters_per_unit: float,
        asset_output_dir: Path | None,
        UsdGeom: Any,
        UsdPhysics: Any,
        UsdShade: Any,
    ) -> None:
        self._meters_per_unit = meters_per_unit
        self._asset_output_dir = asset_output_dir
        self._UsdGeom = UsdGeom
        self._UsdPhysics = UsdPhysics
        self._UsdShade = UsdShade
        self._used_ids: set[str] = set()
        self.skipped: list[str] = []

    def import_prim(self, prim: Any) -> JsonObject | None:
        UsdGeom = self._UsdGeom
        if prim.IsA(UsdGeom.Cube):
            gprim = UsdGeom.Cube(prim)
            base_size = float(gprim.GetSizeAttr().Get() or 1.0)
            return self._primitive_object(prim, "cube", (base_size,) * 3)
        if prim.IsA(UsdGeom.Sphere):
            gprim = UsdGeom.Sphere(prim)
            diameter = 2.0 * float(gprim.GetRadiusAttr().Get() or 0.05)
            return self._primitive_object(prim, "sphere", (diameter,) * 3)
        if prim.IsA(UsdGeom.Cylinder):
            gprim = UsdGeom.Cylinder(prim)
            diameter = 2.0 * float(gprim.GetRadiusAttr().Get() or 0.05)
            height = float(gprim.GetHeightAttr().Get() or 0.1)
            return self._primitive_object(prim, "cylinder", (diameter, diameter, height))
        if prim.IsA(UsdGeom.Mesh):
            return self._mesh_object(prim)
        if prim.IsA(UsdGeom.Gprim):
            self.skipped.append(f"{prim.GetPath()} ({prim.GetTypeName()})")
        return None

    def _primitive_object(
        self,
        prim: Any,
        object_type: str,
        local_size: tuple[float, float, float],
    ) -> JsonObject:
        translation, rotation_rpy, scale = _decompose(
            self._UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(0.0)
        )
        position = [component * self._meters_per_unit for component in translation]
        size = [
            max(abs(local) * abs(axis_scale) * self._meters_per_unit, 1e-6)
            for local, axis_scale in zip(local_size, scale)
        ]
        return self._finish_object(prim, object_type, position, rotation_rpy, size)

    def _mesh_object(self, prim: Any) -> JsonObject | None:
        if self._asset_output_dir is None:
            self.skipped.append(f"{prim.GetPath()} (Mesh; no asset output directory)")
            return None
        mesh = self._UsdGeom.Mesh(prim)
        points = mesh.GetPointsAttr().Get()
        counts = mesh.GetFaceVertexCountsAttr().Get()
        indices = mesh.GetFaceVertexIndicesAttr().Get()
        if not points or not counts or not indices:
            self.skipped.append(f"{prim.GetPath()} (Mesh; empty geometry)")
            return None

        import numpy as np
        import trimesh

        translation, rotation_rpy, scale = _decompose(
            self._UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(0.0)
        )
        vertices = np.array([[float(c) for c in point] for point in points])
        vertices = vertices * np.array(scale) * self._meters_per_unit
        faces = _triangulate(counts, indices)
        if not faces:
            self.skipped.append(f"{prim.GetPath()} (Mesh; no triangulatable faces)")
            return None

        object_id = _unique_object_id(prim.GetName(), self._used_ids, reserve=False)
        asset_name = f"{_safe_prim_name(object_id)}.stl"
        asset_dir = self._asset_output_dir / _IMPORTED_MESH_ASSET_DIRNAME
        asset_dir.mkdir(parents=True, exist_ok=True)
        trimesh.Trimesh(vertices=vertices, faces=np.array(faces), process=False).export(
            str(asset_dir / asset_name)
        )

        minimum = vertices.min(axis=0)
        maximum = vertices.max(axis=0)
        size = [max(float(high - low), 1e-6) for low, high in zip(minimum, maximum)]
        position = [component * self._meters_per_unit for component in translation]
        world_object = self._finish_object(prim, "mesh", position, rotation_rpy, size)
        world_object["asset_ref"] = f"{_IMPORTED_MESH_ASSET_DIRNAME}/{asset_name}"
        return world_object

    def _finish_object(
        self,
        prim: Any,
        default_type: str,
        position: list[float],
        rotation_rpy: tuple[float, float, float],
        size: list[float],
    ) -> JsonObject:
        custom_data = prim.GetCustomData() or {}
        object_type = default_type
        declared_type = custom_data.get(WORLD_USD_OBJECT_TYPE_KEY)
        if isinstance(declared_type, str) and declared_type.strip():
            object_type = declared_type

        physics: JsonObject = {
            "fixed": not prim.HasAPI(self._UsdPhysics.RigidBodyAPI),
            "collision": prim.HasAPI(self._UsdPhysics.CollisionAPI),
        }
        if prim.HasAPI(self._UsdPhysics.MassAPI):
            mass = self._UsdPhysics.MassAPI(prim).GetMassAttr().Get()
            if mass:
                physics["mass_kg"] = float(mass)
        friction, restitution = self._bound_physics_material(prim)
        if friction is not None:
            physics["friction"] = friction
        if restitution is not None:
            physics["restitution"] = restitution
        semantic_role = custom_data.get(WORLD_USD_SEMANTIC_ROLE_KEY)
        if isinstance(semantic_role, str) and semantic_role.strip():
            physics["semantic_role"] = semantic_role

        object_id = _unique_object_id(prim.GetName(), self._used_ids)
        world_object: JsonObject = {
            "id": object_id,
            "name": prim.GetName(),
            "type": object_type,
            "position_xyz": position,
            "rotation_rpy_rad": list(rotation_rpy),
            "size_xyz": size,
            "color": _display_color_hex(self._UsdGeom.Gprim(prim)),
            "physics": physics,
        }
        asset_ref = prim.GetAssetInfoByKey(WORLD_USD_ASSET_INFO_KEY)
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

    def _bound_physics_material(self, prim: Any) -> tuple[float | None, float | None]:
        UsdShade = self._UsdShade
        UsdPhysics = self._UsdPhysics
        binding = UsdShade.MaterialBindingAPI(prim)
        material, _relationship = binding.ComputeBoundMaterial(materialPurpose="physics")
        if not material:
            return None, None
        material_api = UsdPhysics.MaterialAPI(material.GetPrim())
        if not material_api:
            return None, None
        friction_attr = material_api.GetDynamicFrictionAttr()
        restitution_attr = material_api.GetRestitutionAttr()
        friction = friction_attr.Get() if friction_attr else None
        restitution = restitution_attr.Get() if restitution_attr else None
        return (
            float(friction) if friction is not None else None,
            float(restitution) if restitution is not None else None,
        )


def _triangulate(counts: Any, indices: Any) -> list[list[int]]:
    faces: list[list[int]] = []
    cursor = 0
    for count in counts:
        count = int(count)
        if count >= 3:
            base = int(indices[cursor])
            for offset in range(1, count - 1):
                faces.append([base, int(indices[cursor + offset]), int(indices[cursor + offset + 1])])
        cursor += count
    return faces


def _package_id_from_filename(path: Path) -> str:
    stem = re.sub(r"[^A-Za-z0-9_\-]", "-", path.stem).strip("-")
    return stem or "usd-import"


def _unique_object_id(name: str, used_ids: set[str], *, reserve: bool = True) -> str:
    candidate = name or "object"
    suffix = 1
    while candidate in used_ids:
        suffix += 1
        candidate = f"{name}_{suffix}"
    if reserve:
        used_ids.add(candidate)
    return candidate


def _decompose(
    transform: Any,
) -> tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]:
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
    rotation_rpy = tuple(float(v) for v in Rotation.from_matrix(rotation_matrix).as_euler("xyz"))
    return translation, rotation_rpy, scale


def _display_color_hex(gprim: Any) -> str:
    colors = gprim.GetDisplayColorAttr().Get()
    if not colors:
        return WORLD_USD_DEFAULT_COLOR
    rgb = colors[0]
    return "#{:02x}{:02x}{:02x}".format(
        *(max(0, min(255, round(float(channel) * 255))) for channel in rgb)
    )
