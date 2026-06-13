from __future__ import annotations

import json
import math
import textwrap
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

from scipy.spatial.transform import Rotation
import yourdfpy  # type: ignore

from backend.models.world_scene_package import WorldScenePackageManifest
from backend.services.ilu_urdf import convert_urdf_to_usd
from backend.services.simulator_adapters.numeric import is_finite_number
from backend.services.simulator_adapters.world_scene import SimulatorSceneSpec
from backend.services.world_scene_package_digest import computed_world_snapshot_digest

BLENDER_EDIT_SESSION_SCHEMA = "urdf-studio.blender-edit-session.v1"
BLENDER_CHANGE_SET_SCHEMA = "urdf-studio.blender-change-set.v1"
BLENDER_CHANGE_SET_SOURCE_SCHEMA = "urdf-studio.blender-change-set-source.v1"
BLENDER_CHANGE_SET_FILENAME = "blender-change-set.json"
BLENDER_EDIT_SESSION_FILENAME = "blender-edit-session.json"
BLENDER_OPEN_SCRIPT_FILENAME = "open_blender_scene.py"
BLENDER_EXPORT_SCRIPT_FILENAME = "export_blender_changes.py"
BLENDER_ROBOT_GLB_FILENAME = "robot-reference.glb"
BLENDER_ROBOT_USD_FILENAME = "robot-reference.usda"
BLENDER_APPLY_FRAME_MAPS = frozenset({"identity"})


@dataclass(frozen=True)
class BlenderWorkspaceArtifacts:
    edit_session_path: Path
    open_script_path: Path
    export_script_path: Path
    change_set_path: Path
    robot_glb_path: Path | None
    robot_usd_path: Path


@dataclass(frozen=True)
class BlenderRobotGlbReference:
    path: Path
    geometry_count: int
    node_count: int


@dataclass(frozen=True)
class BlenderLayoutChangeSetApplyResult:
    world_package: WorldScenePackageManifest
    applied_change_count: int
    review_only_count: int


@dataclass(frozen=True)
class BlenderWorldObjectChange:
    stable_id: str
    position_xyz: tuple[float, float, float]
    quat_wxyz: tuple[float, float, float, float]
    size_xyz: tuple[float, float, float]


def build_blender_change_set_source(
    world_package: WorldScenePackageManifest,
    *,
    frame_map: str | None = None,
) -> dict[str, str]:
    source = {
        "schema": BLENDER_CHANGE_SET_SOURCE_SCHEMA,
        "package_id": world_package.package_id,
        "version": world_package.version,
        "world_snapshot_digest_sha256": computed_world_snapshot_digest(world_package),
        "frame_convention": world_package.interface.frame_convention,
    }
    if frame_map is not None:
        source["frame_map"] = frame_map
    return source


def write_blender_workspace_artifacts(
    scene: SimulatorSceneSpec,
    *,
    artifact_dir: Path,
    robot_urdf_path: Path,
    blend_path: Path,
) -> BlenderWorkspaceArtifacts:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    edit_session_path = artifact_dir / BLENDER_EDIT_SESSION_FILENAME
    open_script_path = artifact_dir / BLENDER_OPEN_SCRIPT_FILENAME
    export_script_path = artifact_dir / BLENDER_EXPORT_SCRIPT_FILENAME
    change_set_path = artifact_dir / BLENDER_CHANGE_SET_FILENAME
    robot_glb_path = artifact_dir / BLENDER_ROBOT_GLB_FILENAME
    robot_glb = _write_robot_glb_reference(robot_urdf_path, robot_glb_path)
    robot_usd_path = artifact_dir / BLENDER_ROBOT_USD_FILENAME
    usd_conversion = convert_urdf_to_usd(robot_urdf_path.read_text(encoding="utf-8"))
    robot_usd_path.write_text(usd_conversion.usd_content, encoding="utf-8")
    edit_session = build_blender_edit_session(
        scene,
        robot_urdf_path=robot_urdf_path,
        robot_glb_path=robot_glb.path if robot_glb else None,
        robot_glb_stats={
            "geometry_count": robot_glb.geometry_count,
            "node_count": robot_glb.node_count,
        }
        if robot_glb
        else None,
        robot_usd_path=robot_usd_path,
        robot_usd_warnings=usd_conversion.warnings,
        robot_usd_stats={
            "links_converted": usd_conversion.stats.links_converted,
            "joints_converted": usd_conversion.stats.joints_converted,
            "visuals_converted": usd_conversion.stats.visuals_converted,
            "collisions_converted": usd_conversion.stats.collisions_converted,
            "inline_meshes_converted": usd_conversion.stats.inline_meshes_converted,
            "unsupported_meshes": usd_conversion.stats.unsupported_meshes,
        },
        blend_path=blend_path,
        change_set_path=change_set_path,
        export_script_path=export_script_path,
    )
    edit_session_path.write_text(
        f"{json.dumps(edit_session, indent=2, sort_keys=True)}\n",
        encoding="utf-8",
    )
    open_script_path.write_text(
        build_blender_open_script(edit_session_path=edit_session_path),
        encoding="utf-8",
    )
    export_script_path.write_text(
        build_blender_export_script(
            change_set_path=change_set_path,
            source=edit_session["source"],
        ),
        encoding="utf-8",
    )
    return BlenderWorkspaceArtifacts(
        edit_session_path=edit_session_path,
        open_script_path=open_script_path,
        export_script_path=export_script_path,
        change_set_path=change_set_path,
        robot_glb_path=robot_glb.path if robot_glb else None,
        robot_usd_path=robot_usd_path,
    )


def _write_robot_glb_reference(
    robot_urdf_path: Path,
    robot_glb_path: Path,
) -> BlenderRobotGlbReference | None:
    robot = yourdfpy.URDF.load(
        str(robot_urdf_path),
        build_scene_graph=True,
        load_meshes=True,
    )
    scene = robot.scene
    geometry_count = len(scene.geometry)
    node_count = len(scene.graph.nodes_geometry)
    if geometry_count == 0 or node_count == 0:
        return None
    exported = scene.export(file_type="glb")
    if isinstance(exported, bytes | bytearray):
        glb_bytes = bytes(exported)
    else:
        glb_bytes = exported.read()
    robot_glb_path.write_bytes(glb_bytes)
    return BlenderRobotGlbReference(
        path=robot_glb_path,
        geometry_count=geometry_count,
        node_count=node_count,
    )


def build_blender_edit_session(
    scene: SimulatorSceneSpec,
    *,
    robot_urdf_path: Path,
    robot_glb_path: Path | None,
    robot_glb_stats: Mapping[str, int] | None,
    robot_usd_path: Path,
    robot_usd_warnings: Sequence[str],
    robot_usd_stats: Mapping[str, int],
    blend_path: Path,
    change_set_path: Path,
    export_script_path: Path,
) -> dict[str, Any]:
    change_set_source = build_blender_change_set_source(
        scene.world_package,
        frame_map=scene.frame_map,
    )
    return {
        "schema": BLENDER_EDIT_SESSION_SCHEMA,
        "mode": "visual-layout",
        "source": change_set_source,
        "package": {
            "package_id": scene.world_package.package_id,
            "version": scene.world_package.version,
            "frame_map": scene.frame_map,
            "frame_convention": scene.layout.frame_convention,
        },
        "round_trip": {
            "supported_changes": (
                "world_object.position_xyz",
                "world_object.rotation_rpy_rad",
                "world_object.size_xyz",
            ),
            "review_only": (
                "camera.pose",
                "mesh.materials",
                "new_static_props",
            ),
            "locked": (
                "robot.kinematics",
                "robot.inertials",
                "robot.collisions",
                "robot.transmissions",
            ),
            "change_set_path": str(change_set_path),
            "export_script_path": str(export_script_path),
        },
        "robot": {
            "urdf_path": str(robot_urdf_path),
            "visual_glb_path": str(robot_glb_path) if robot_glb_path else None,
            "visual_glb_stats": dict(robot_glb_stats or {}),
            "visual_usd_path": str(robot_usd_path),
            "visual_usd_warnings": list(robot_usd_warnings),
            "visual_usd_stats": dict(robot_usd_stats),
            "locked": True,
        },
        "objects": [_blender_object_entry(primitive) for primitive in scene.primitives],
        "cameras": [
            {
                "kind": "camera",
                "stable_id": camera.camera_id,
                "name": camera.name,
                "sim_name": camera.sim_name,
                "parent_joint": camera.parent_joint,
                "parent_link": camera.parent_link,
                "position_xyz": list(camera.position_xyz),
                "quat_wxyz": list(camera.quat_wxyz),
                "width": camera.width,
                "height": camera.height,
                "fov_deg": camera.fov_deg,
            }
            for camera in scene.cameras
        ],
        "blend_path": str(blend_path),
    }


def build_blender_open_script(*, edit_session_path: Path) -> str:
    return (
        textwrap.dedent(
            f"""
            import json
            import math
            from pathlib import Path

            import bpy

            SESSION_PATH = Path({str(edit_session_path)!r})


            def clear_scene():
                bpy.ops.object.select_all(action="SELECT")
                bpy.ops.object.delete()


            def configure_scene():
                scene = bpy.context.scene
                scene.unit_settings.system = "METRIC"
                scene.unit_settings.scale_length = 1.0
                try:
                    scene.render.engine = "BLENDER_EEVEE_NEXT"
                except TypeError:
                    scene.render.engine = "BLENDER_EEVEE"
                if scene.world is not None:
                    scene.world.color = (0.03, 0.035, 0.04)


            def material_for(name, rgba):
                material = bpy.data.materials.new(name)
                material.diffuse_color = tuple(rgba)
                material.use_nodes = True
                node = material.node_tree.nodes.get("Principled BSDF")
                if node is not None:
                    node.inputs["Base Color"].default_value = tuple(rgba)
                    node.inputs["Alpha"].default_value = float(rgba[3])
                material.blend_method = "BLEND" if float(rgba[3]) < 1.0 else "OPAQUE"
                return material


            def assign_metadata(obj, kind, entry):
                obj["urdf_studio_kind"] = kind
                obj["urdf_studio_stable_id"] = entry.get("stable_id", "")
                obj["urdf_studio_sim_name"] = entry.get("sim_name", "")
                obj["urdf_studio_source_name"] = entry.get("source_name") or entry.get("name", "")


            def vector3(entry, key, default):
                value = entry.get(key, default)
                return [float(value[0]), float(value[1]), float(value[2])]


            def add_object(entry):
                sim_type = entry.get("sim_type")
                position = entry.get("position_xyz", [0.0, 0.0, 0.0])
                quat = entry.get("quat_wxyz", [1.0, 0.0, 0.0, 0.0])
                size = vector3(entry, "size_xyz", [1.0, 1.0, 1.0])
                if sim_type == "sphere":
                    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.5, location=position)
                elif sim_type == "cylinder":
                    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.5, depth=1.0, location=position)
                else:
                    bpy.ops.mesh.primitive_cube_add(size=1.0, location=position)
                obj = bpy.context.object
                obj.name = entry.get("sim_name") or entry.get("stable_id") or "world_object"
                obj.rotation_mode = "QUATERNION"
                obj.rotation_quaternion = quat
                obj.scale = size
                assign_metadata(obj, "world_object", entry)
                obj["urdf_studio_base_size_xyz"] = [1.0, 1.0, 1.0]
                rgba = entry.get("rgba", [0.8, 0.8, 0.8, 1.0])
                obj.color = tuple(rgba)
                obj.data.materials.append(material_for(f"mat_{{obj.name}}", rgba))


            def add_camera(entry):
                position = entry.get("position_xyz", [0.0, 0.0, 0.0])
                quat = entry.get("quat_wxyz", [1.0, 0.0, 0.0, 0.0])
                bpy.ops.object.camera_add(location=position)
                obj = bpy.context.object
                obj.name = entry.get("sim_name") or entry.get("stable_id") or "camera"
                obj.rotation_mode = "QUATERNION"
                obj.rotation_quaternion = quat
                obj.data.angle = math.radians(float(entry.get("fov_deg", 60.0)))
                obj.data.clip_start = 0.01
                obj.data.clip_end = 25.0
                obj.data.display_size = 0.08
                assign_metadata(obj, "camera", entry)


            def lock_robot_object(obj, root=None):
                obj["urdf_studio_kind"] = "robot_reference"
                obj["urdf_studio_locked"] = True
                obj["urdf_studio_urdf_path"] = session_robot_urdf_path
                obj.hide_select = True
                obj.lock_location = (True, True, True)
                obj.lock_rotation = (True, True, True)
                obj.lock_scale = (True, True, True)
                if root is not None and obj is not root and obj.parent is None:
                    obj.parent = root


            def import_visual_file(root, path, importer, status):
                if importer is None:
                    root["urdf_studio_robot_visual_status"] = f"{{status}}_import_unavailable"
                    print(f"[urdf-studio-blender] {{status}} importer unavailable.", flush=True)
                    return False
                if not path.is_file():
                    root["urdf_studio_robot_visual_status"] = f"missing_{{status}}"
                    print(f"[urdf-studio-blender] robot {{status}} missing: {{path}}", flush=True)
                    return False
                before_import = set(bpy.data.objects)
                try:
                    importer(filepath=str(path))
                except Exception as exc:
                    root["urdf_studio_robot_visual_status"] = f"{{status}}_import_failed"
                    root["urdf_studio_robot_visual_error"] = str(exc)
                    print(f"[urdf-studio-blender] robot {{status}} import failed: {{exc}}", flush=True)
                    return False
                imported = [obj for obj in bpy.data.objects if obj not in before_import]
                for obj in imported:
                    lock_robot_object(obj, root)
                root["urdf_studio_robot_visual_status"] = f"{{status}}_imported"
                root["urdf_studio_robot_visual_object_count"] = len(imported)
                root["urdf_studio_robot_visual_path"] = str(path)
                print(f"[urdf-studio-blender] robot {{status}} imported: {{path}} objects={{len(imported)}}", flush=True)
                return True


            def add_robot_reference(session):
                global session_robot_urdf_path
                robot = session.get("robot", {{}})
                session_robot_urdf_path = robot.get("urdf_path", "")
                bpy.ops.object.empty_add(type="ARROWS", location=(0.0, 0.0, 0.0))
                root = bpy.context.object
                root.name = "robot_urdf_locked_reference"
                lock_robot_object(root)
                glb_value = robot.get("visual_glb_path")
                glb_path = Path(glb_value) if glb_value else None
                gltf_importer = getattr(bpy.ops.import_scene, "gltf", None)
                if glb_path is not None and import_visual_file(root, glb_path, gltf_importer, "glb"):
                    return root
                usd_path = Path(robot.get("visual_usd_path", ""))
                importer = getattr(bpy.ops.wm, "usd_import", None)
                import_visual_file(root, usd_path, importer, "usd")
                return root


            def add_session_notes(session):
                text = bpy.data.texts.new("URDF Studio Round Trip")
                text.write(
                    "Edit world object transforms, then run the generated export_blender_changes.py "
                    "script to write the change-set JSON. Robot kinematics remain locked in URDF Studio.\\n"
                )
                text.write(json.dumps(session.get("round_trip", {{}}), indent=2))
                text.write("\\n\\nRobot visual reference:\\n")
                text.write(json.dumps(session.get("robot", {{}}), indent=2))


            def main():
                session = json.loads(SESSION_PATH.read_text(encoding="utf-8"))
                clear_scene()
                configure_scene()
                add_robot_reference(session)
                for entry in session.get("objects", []):
                    add_object(entry)
                for entry in session.get("cameras", []):
                    add_camera(entry)
                add_session_notes(session)
                blend_path = Path(session["blend_path"])
                blend_path.parent.mkdir(parents=True, exist_ok=True)
                bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
                print(f"[urdf-studio-blender] edit session loaded: {{SESSION_PATH}}", flush=True)
                print(f"[urdf-studio-blender] blend written: {{blend_path}}", flush=True)


            main()
            """
        ).lstrip()
    )


def build_blender_export_script(*, change_set_path: Path, source: Mapping[str, str]) -> str:
    source_json = json.dumps(dict(source), sort_keys=True)
    return (
        textwrap.dedent(
            f"""
            import json
            from pathlib import Path

            import bpy

            CHANGE_SET_PATH = Path({str(change_set_path)!r})
            CHANGE_SET_SOURCE = json.loads({source_json!r})


            def quat_wxyz(obj):
                obj.rotation_mode = "QUATERNION"
                quat = obj.rotation_quaternion
                return [float(quat.w), float(quat.x), float(quat.y), float(quat.z)]


            def vector3(value):
                return [float(value[0]), float(value[1]), float(value[2])]


            def local_size_xyz(obj):
                bounds = getattr(obj, "bound_box", None)
                if not bounds:
                    return vector3(obj.dimensions)
                xs = [float(corner[0]) for corner in bounds]
                ys = [float(corner[1]) for corner in bounds]
                zs = [float(corner[2]) for corner in bounds]
                scale = vector3(obj.scale)
                return [
                    abs((max(xs) - min(xs)) * scale[0]),
                    abs((max(ys) - min(ys)) * scale[1]),
                    abs((max(zs) - min(zs)) * scale[2]),
                ]


            def main():
                changes = []
                review_only = []
                for obj in bpy.data.objects:
                    kind = obj.get("urdf_studio_kind")
                    stable_id = obj.get("urdf_studio_stable_id")
                    if kind == "world_object" and stable_id:
                        changes.append(
                            {{
                                "entity_type": "world_object",
                                "stable_id": str(stable_id),
                                "sim_name": str(obj.get("urdf_studio_sim_name", obj.name)),
                                "position_xyz": vector3(obj.location),
                                "quat_wxyz": quat_wxyz(obj),
                                "size_xyz": local_size_xyz(obj),
                            }}
                        )
                    elif kind == "camera" and stable_id:
                        review_only.append(
                            {{
                                "entity_type": "camera",
                                "stable_id": str(stable_id),
                                "sim_name": str(obj.get("urdf_studio_sim_name", obj.name)),
                                "position_xyz": vector3(obj.location),
                                "quat_wxyz": quat_wxyz(obj),
                                "reason": "camera round-trip requires camera-frame review before apply",
                            }}
                        )
                    elif kind is None and getattr(obj, "type", "") == "MESH":
                        review_only.append(
                            {{
                                "entity_type": "new_world_object",
                                "sim_name": str(obj.name),
                                "position_xyz": vector3(obj.location),
                                "quat_wxyz": quat_wxyz(obj),
                                "size_xyz": local_size_xyz(obj),
                                "reason": "new Blender objects require Studio review before import",
                            }}
                        )
                payload = {{
                    "schema": "{BLENDER_CHANGE_SET_SCHEMA}",
                    "source": CHANGE_SET_SOURCE,
                    "changes": changes,
                    "review_only": review_only,
                }}
                CHANGE_SET_PATH.parent.mkdir(parents=True, exist_ok=True)
                CHANGE_SET_PATH.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\\n", encoding="utf-8")
                print(f"[urdf-studio-blender] change-set written: {{CHANGE_SET_PATH}}", flush=True)


            main()
            """
        ).lstrip()
    )


def apply_blender_layout_change_set(
    world_package: WorldScenePackageManifest,
    change_set: Mapping[str, Any],
) -> WorldScenePackageManifest:
    return apply_blender_layout_change_set_with_summary(
        world_package,
        change_set,
    ).world_package


def apply_blender_layout_change_set_with_summary(
    world_package: WorldScenePackageManifest,
    change_set: Mapping[str, Any],
) -> BlenderLayoutChangeSetApplyResult:
    object_updates, review_only_count = _validate_blender_change_set(change_set, world_package)
    updated = world_package.model_copy(deep=True)
    package_object_ids = _world_package_object_ids(updated)
    missing_object_ids = sorted(set(object_updates) - package_object_ids)
    if missing_object_ids:
        raise ValueError(
            "Blender change-set references unknown world object id(s): "
            f"{', '.join(missing_object_ids)}."
        )
    applied_change_count = 0
    next_objects: list[dict[str, Any]] = []
    for item in updated.world_snapshot.objects:
        next_item = dict(item)
        object_id = str(next_item.get("id", "")).strip()
        change = object_updates.get(object_id)
        if change is not None:
            next_item.update(_world_object_change_fields(change))
            applied_change_count += 1
        next_objects.append(next_item)
    updated.world_snapshot.objects = next_objects
    return BlenderLayoutChangeSetApplyResult(
        world_package=updated,
        applied_change_count=applied_change_count,
        review_only_count=review_only_count,
    )


def _validate_blender_change_set(
    change_set: Mapping[str, Any],
    world_package: WorldScenePackageManifest,
) -> tuple[dict[str, BlenderWorldObjectChange], int]:
    if change_set.get("schema") != BLENDER_CHANGE_SET_SCHEMA:
        raise ValueError("Unsupported Blender change-set schema.")
    _validate_change_set_source(change_set.get("source"), world_package)
    changes = _required_list(change_set.get("changes"), "Blender change-set changes")
    review_only = _required_list(
        change_set.get("review_only"),
        "Blender change-set review_only",
    )

    object_updates: dict[str, BlenderWorldObjectChange] = {}
    for index, change in enumerate(changes):
        normalized = _validate_world_object_change(change, f"changes[{index}]")
        if normalized.stable_id in object_updates:
            raise ValueError(
                f"Blender change-set changes duplicate stable_id {normalized.stable_id!r}."
            )
        object_updates[normalized.stable_id] = normalized

    seen_review_ids: set[str] = set()
    for index, entry in enumerate(review_only):
        stable_id = _validate_review_only_entry(entry, f"review_only[{index}]")
        if stable_id in seen_review_ids:
            raise ValueError(f"Blender change-set review_only duplicates stable_id {stable_id!r}.")
        seen_review_ids.add(stable_id)

    return object_updates, len(review_only)


def _validate_change_set_source(
    value: Any,
    world_package: WorldScenePackageManifest,
) -> None:
    if not isinstance(value, Mapping):
        raise ValueError("Blender change-set source must be an object.")
    _reject_unknown_fields(
        value,
        "source",
        {
            "schema",
            "package_id",
            "version",
            "world_snapshot_digest_sha256",
            "frame_convention",
            "frame_map",
        },
    )
    schema = _required_string(value.get("schema"), "source.schema")
    if schema != BLENDER_CHANGE_SET_SOURCE_SCHEMA:
        raise ValueError("Unsupported Blender change-set source schema.")

    expected = build_blender_change_set_source(world_package)
    actual_package_id = _required_string(value.get("package_id"), "source.package_id")
    actual_version = _required_string(value.get("version"), "source.version")
    actual_digest = _required_string(
        value.get("world_snapshot_digest_sha256"),
        "source.world_snapshot_digest_sha256",
    ).lower()
    actual_frame_convention = _required_string(
        value.get("frame_convention"),
        "source.frame_convention",
    )
    actual_frame_map = value.get("frame_map")
    if actual_frame_map is not None:
        actual_frame_map = _required_string(actual_frame_map, "source.frame_map")

    if actual_package_id != expected["package_id"] or actual_version != expected["version"]:
        raise ValueError(
            "Blender change-set source package does not match the current world package."
        )
    if actual_frame_convention != expected["frame_convention"]:
        raise ValueError(
            "Blender change-set source frame convention does not match the current world package."
        )
    if actual_digest != expected["world_snapshot_digest_sha256"]:
        raise ValueError(
            "Blender change-set source world snapshot does not match the current world package."
        )
    if actual_frame_map is not None and actual_frame_map not in BLENDER_APPLY_FRAME_MAPS:
        raise ValueError(
            "Blender change-set source frame_map is not supported for direct apply. "
            "Only identity frame_map sessions can be imported without coordinate conversion."
        )


def _validate_world_object_change(value: Any, path: str) -> BlenderWorldObjectChange:
    if not isinstance(value, Mapping):
        raise ValueError(f"Blender change-set {path} must be an object.")
    _reject_unknown_fields(
        value,
        path,
        {
            "entity_type",
            "stable_id",
            "sim_name",
            "position_xyz",
            "quat_wxyz",
            "size_xyz",
        },
    )
    entity_type = _required_string(value.get("entity_type"), f"{path}.entity_type")
    if entity_type != "world_object":
        raise ValueError(
            f"Blender change-set {path}.entity_type must be 'world_object'. "
            "Camera, robot, material, and mesh edits must stay in review_only."
        )
    stable_id = _required_string(value.get("stable_id"), f"{path}.stable_id")
    return BlenderWorldObjectChange(
        stable_id=stable_id,
        position_xyz=_required_vector3(value.get("position_xyz"), f"{path}.position_xyz"),
        quat_wxyz=_required_quat_wxyz(value.get("quat_wxyz"), f"{path}.quat_wxyz"),
        size_xyz=_required_positive_vector3(value.get("size_xyz"), f"{path}.size_xyz"),
    )


def _validate_review_only_entry(value: Any, path: str) -> str:
    if not isinstance(value, Mapping):
        raise ValueError(f"Blender change-set {path} must be an object.")
    _reject_unknown_fields(
        value,
        path,
        {
            "entity_type",
            "stable_id",
            "sim_name",
            "position_xyz",
            "quat_wxyz",
            "size_xyz",
            "reason",
        },
    )
    entity_type = _required_string(value.get("entity_type"), f"{path}.entity_type")
    if entity_type not in {"camera", "new_world_object"}:
        raise ValueError(
            f"Blender change-set {path}.entity_type must be 'camera' or "
            "'new_world_object' for review-only edits."
        )
    stable_id = (
        _required_string(value.get("stable_id"), f"{path}.stable_id")
        if entity_type == "camera"
        else _required_string(value.get("sim_name"), f"{path}.sim_name")
    )
    if "position_xyz" in value:
        _required_vector3(value.get("position_xyz"), f"{path}.position_xyz")
    if "quat_wxyz" in value:
        _required_quat_wxyz(value.get("quat_wxyz"), f"{path}.quat_wxyz")
    if "size_xyz" in value:
        _required_positive_vector3(value.get("size_xyz"), f"{path}.size_xyz")
    if "reason" in value:
        _required_string(value.get("reason"), f"{path}.reason")
    return f"{entity_type}:{stable_id}"


def _world_package_object_ids(world_package: WorldScenePackageManifest) -> set[str]:
    object_ids: set[str] = set()
    for index, item in enumerate(world_package.world_snapshot.objects):
        if not isinstance(item, Mapping):
            raise ValueError(f"World package object at index {index} must be an object.")
        object_id = str(item.get("id", "")).strip()
        if not object_id:
            raise ValueError(f"World package object at index {index} is missing id.")
        if object_id in object_ids:
            raise ValueError(f"World package contains duplicate object id {object_id!r}.")
        object_ids.add(object_id)
    return object_ids


def _world_object_change_fields(change: BlenderWorldObjectChange) -> dict[str, Any]:
    return {
        "position_xyz": list(change.position_xyz),
        "rotation_rpy_rad": list(_quat_wxyz_to_rpy(change.quat_wxyz)),
        "size_xyz": list(change.size_xyz),
    }


def _blender_object_entry(primitive: Any) -> dict[str, Any]:
    return {
        "kind": "world_object",
        "stable_id": primitive.source_id,
        "source_name": primitive.source_name,
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
        "semantic_role": primitive.semantic_role,
        "asset_ref": primitive.asset_ref,
        "asset_scale_xyz": list(primitive.asset_scale_xyz) if primitive.asset_scale_xyz else None,
    }


def _required_list(value: Any, label: str) -> Sequence[Any]:
    if not isinstance(value, Sequence) or isinstance(value, str):
        raise ValueError(f"{label} must be a list.")
    return value


def _required_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Blender change-set {label} must be a non-empty string.")
    return value.strip()


def _reject_unknown_fields(value: Mapping[str, Any], path: str, allowed_fields: set[str]) -> None:
    unknown_fields = sorted(str(field) for field in value.keys() if field not in allowed_fields)
    if unknown_fields:
        raise ValueError(
            f"Blender change-set {path} contains unsupported field(s): "
            f"{', '.join(unknown_fields)}."
        )


def _required_vector(value: Any, label: str, expected_length: int) -> tuple[float, ...]:
    if (
        not isinstance(value, Sequence)
        or isinstance(value, str)
        or len(value) != expected_length
    ):
        raise ValueError(f"Blender change-set {label} must be a {expected_length}-number list.")
    if not all(is_finite_number(item) for item in value):
        raise ValueError(f"Blender change-set {label} must contain only finite numbers.")
    numbers = tuple(float(item) for item in value)
    return numbers


def _required_vector3(value: Any, label: str) -> tuple[float, float, float]:
    numbers = _required_vector(value, label, 3)
    return (numbers[0], numbers[1], numbers[2])


def _required_positive_vector3(value: Any, label: str) -> tuple[float, float, float]:
    numbers = _required_vector3(value, label)
    if any(number <= 0.0 for number in numbers):
        raise ValueError(f"Blender change-set {label} must contain positive dimensions.")
    return numbers


def _required_quat_wxyz(value: Any, label: str) -> tuple[float, float, float, float]:
    numbers = _required_vector(value, label, 4)
    norm = math.sqrt(sum(number * number for number in numbers))
    if norm <= 0.0:
        raise ValueError(f"Blender change-set {label} must be a non-zero quaternion.")
    return (
        numbers[0] / norm,
        numbers[1] / norm,
        numbers[2] / norm,
        numbers[3] / norm,
    )


def _quat_wxyz_to_rpy(quat_wxyz: tuple[float, float, float, float]) -> tuple[float, float, float]:
    rotation = Rotation.from_quat((quat_wxyz[1], quat_wxyz[2], quat_wxyz[3], quat_wxyz[0]))
    rpy = rotation.as_euler("xyz")
    return (float(rpy[0]), float(rpy[1]), float(rpy[2]))
