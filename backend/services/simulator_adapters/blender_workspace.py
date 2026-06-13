from __future__ import annotations

import json
import textwrap
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

import yourdfpy  # type: ignore

from backend.services.ilu_urdf import convert_urdf_to_usd
from backend.services.simulator_adapters.blender_change_sets import (
    BLENDER_CHANGE_SET_SCHEMA,
    build_blender_change_set_source,
)
from backend.services.simulator_adapters.blender_edit_session import (
    BLENDER_EDIT_SESSION_SCHEMA,
    BLENDER_LOCKED_DOMAINS,
    BLENDER_REVIEW_ONLY_CHANGES,
    BLENDER_SUPPORTED_WORLD_OBJECT_CHANGES,
)
from backend.services.simulator_adapters.world_scene import SimulatorSceneSpec
from backend.services.world_layout_static_transfer import resolve_world_layout_asset_path

BLENDER_CHANGE_SET_FILENAME = "blender-change-set.json"
BLENDER_EDIT_SESSION_FILENAME = "blender-edit-session.json"
BLENDER_OPEN_SCRIPT_FILENAME = "open_blender_scene.py"
BLENDER_EXPORT_SCRIPT_FILENAME = "export_blender_changes.py"
BLENDER_ROBOT_GLB_FILENAME = "robot-reference.glb"
BLENDER_ROBOT_USD_FILENAME = "robot-reference.usda"


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


def write_blender_workspace_artifacts(
    scene: SimulatorSceneSpec,
    *,
    artifact_dir: Path,
    robot_urdf_path: Path,
    blend_path: Path,
    camera_screenshot_dir: Path | None = None,
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
        camera_screenshot_dir=camera_screenshot_dir,
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
    camera_screenshot_dir: Path | None = None,
) -> dict[str, Any]:
    objects = [_blender_object_entry(primitive, scene.robot.asset_roots) for primitive in scene.primitives]
    change_set_source = build_blender_change_set_source(
        scene.world_package,
        frame_map=scene.frame_map,
        world_object_ids=[str(entry["stable_id"]) for entry in objects],
        camera_ids=[camera.camera_id for camera in scene.cameras],
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
            "supported_changes": tuple(sorted(BLENDER_SUPPORTED_WORLD_OBJECT_CHANGES)),
            "review_only": tuple(sorted(BLENDER_REVIEW_ONLY_CHANGES)),
            "locked": tuple(sorted(BLENDER_LOCKED_DOMAINS)),
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
        "objects": objects,
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
        "camera_screenshot_dir": str(camera_screenshot_dir) if camera_screenshot_dir else None,
    }


def build_blender_open_script(*, edit_session_path: Path) -> str:
    return (
        textwrap.dedent(
            f"""
            import json
            import math
            import re
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
                scene.render.image_settings.file_format = "PNG"
                scene.render.resolution_percentage = 100


            def add_default_lighting():
                bpy.ops.object.light_add(type="AREA", location=(0.0, -2.0, 3.0))
                light = bpy.context.object
                light.name = "urdf_studio_key_light"
                light.data.energy = 500.0
                light.data.size = 5.0


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
                rgba = entry.get("rgba", [0.8, 0.8, 0.8, 1.0])
                if entry.get("asset_path"):
                    imported = add_mesh_asset_object(entry, position, quat, size, rgba)
                    if imported is not None:
                        return imported
                if sim_type == "sphere":
                    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.5, location=position)
                elif sim_type == "cylinder":
                    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.5, depth=1.0, location=position)
                else:
                    bpy.ops.mesh.primitive_cube_add(size=1.0, location=position)
                obj = bpy.context.object
                apply_world_object_transform(obj, entry, position, quat, size, rgba)
                return obj


            def apply_world_object_transform(obj, entry, position, quat, size, rgba):
                obj.name = entry.get("sim_name") or entry.get("stable_id") or "world_object"
                obj.location = position
                obj.rotation_mode = "QUATERNION"
                obj.rotation_quaternion = quat
                obj.scale = size
                assign_metadata(obj, "world_object", entry)
                obj["urdf_studio_base_size_xyz"] = [1.0, 1.0, 1.0]
                obj.color = tuple(rgba)
                data = getattr(obj, "data", None)
                materials = getattr(data, "materials", None)
                if materials is not None:
                    materials.append(material_for(f"mat_{{obj.name}}", rgba))


            def mesh_asset_importer(path):
                suffix = path.suffix.lower()
                if suffix in {{".glb", ".gltf"}}:
                    return getattr(bpy.ops.import_scene, "gltf", None)
                if suffix == ".obj":
                    return getattr(bpy.ops.wm, "obj_import", None) or getattr(bpy.ops.import_scene, "obj", None)
                if suffix == ".stl":
                    return getattr(bpy.ops.wm, "stl_import", None) or getattr(getattr(bpy.ops, "import_mesh", None), "stl", None)
                if suffix == ".ply":
                    return getattr(bpy.ops.wm, "ply_import", None) or getattr(getattr(bpy.ops, "import_mesh", None), "ply", None)
                if suffix == ".dae":
                    return getattr(bpy.ops.wm, "collada_import", None)
                if suffix in {{".usd", ".usda", ".usdc"}}:
                    return getattr(bpy.ops.wm, "usd_import", None)
                return None


            def apply_material_to_unassigned_meshes(objects, rgba):
                material = material_for("mat_imported_world_object", rgba)
                for obj in objects:
                    data = getattr(obj, "data", None)
                    materials = getattr(data, "materials", None)
                    if materials is not None and len(materials) == 0:
                        materials.append(material)


            def add_mesh_asset_object(entry, position, quat, size, rgba):
                asset_path_value = entry.get("asset_path")
                if not asset_path_value:
                    return None
                asset_path = Path(asset_path_value)
                importer = mesh_asset_importer(asset_path)
                if importer is None or not asset_path.is_file():
                    print(f"[urdf-studio-blender] mesh asset unavailable: {{asset_path}}", flush=True)
                    return None
                before_import = set(bpy.data.objects)
                try:
                    importer(filepath=str(asset_path))
                except Exception as exc:
                    print(f"[urdf-studio-blender] mesh asset import failed: {{asset_path}}: {{exc}}", flush=True)
                    return None
                imported = [obj for obj in bpy.data.objects if obj not in before_import]
                if not imported:
                    print(f"[urdf-studio-blender] mesh asset import produced no objects: {{asset_path}}", flush=True)
                    return None
                bpy.ops.object.empty_add(type="PLAIN_AXES", location=position)
                root = bpy.context.object
                apply_world_object_transform(root, entry, position, quat, size, rgba)
                root["urdf_studio_asset_path"] = str(asset_path)
                apply_material_to_unassigned_meshes(imported, rgba)
                for child in imported:
                    child.parent = root
                    child["urdf_studio_kind"] = "world_object_mesh_child"
                    child["urdf_studio_parent_stable_id"] = entry.get("stable_id", "")
                    child.hide_select = True
                return root


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
                return obj


            def safe_artifact_name(value, default_name):
                normalized = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value).strip()).strip("._")
                return normalized or default_name


            def render_camera_views(session, camera_entries, camera_objects):
                output_dir_value = session.get("camera_screenshot_dir")
                if not output_dir_value:
                    return 0
                output_dir = Path(output_dir_value)
                output_dir.mkdir(parents=True, exist_ok=True)
                scene = bpy.context.scene
                rendered = 0
                for index, pair in enumerate(zip(camera_entries, camera_objects), start=1):
                    entry, obj = pair
                    scene.camera = obj
                    scene.render.resolution_x = int(entry.get("width", 640))
                    scene.render.resolution_y = int(entry.get("height", 480))
                    image_path = output_dir / f"{{index:02d}}_{{safe_artifact_name(obj.name, 'camera')}}.png"
                    scene.render.filepath = str(image_path)
                    bpy.ops.render.render(write_still=True)
                    rendered += 1
                print(f"[urdf-studio-blender] camera_screenshots={{rendered}}", flush=True)
                return rendered


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
                add_default_lighting()
                add_robot_reference(session)
                for entry in session.get("objects", []):
                    add_object(entry)
                camera_entries = session.get("cameras", [])
                camera_objects = [add_camera(entry) for entry in camera_entries]
                render_camera_views(session, camera_entries, camera_objects)
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


def build_blender_export_script(*, change_set_path: Path, source: Mapping[str, Any]) -> str:
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
                base_size = obj.get("urdf_studio_base_size_xyz")
                if isinstance(base_size, list) and len(base_size) == 3:
                    scale = vector3(obj.scale)
                    return [
                        abs(float(base_size[0]) * scale[0]),
                        abs(float(base_size[1]) * scale[1]),
                        abs(float(base_size[2]) * scale[2]),
                    ]
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


            def rgba(obj):
                material = getattr(obj, "active_material", None)
                if material is None:
                    materials = getattr(getattr(obj, "data", None), "materials", [])
                    material = materials[0] if materials else None
                color = getattr(material, "diffuse_color", None) if material is not None else None
                if color is None:
                    color = getattr(obj, "color", [1.0, 1.0, 1.0, 1.0])
                values = [float(color[index]) for index in range(min(len(color), 4))]
                while len(values) < 4:
                    values.append(1.0)
                return [max(0.0, min(1.0, value)) for value in values[:4]]


            def custom_string(owner, key):
                getter = getattr(owner, "get", None)
                if getter is None:
                    return ""
                value = getter(key)
                return str(value).strip() if isinstance(value, str) and value.strip() else ""


            def portable_asset_ref_value(value):
                normalized = value.replace("\\\\", "/").strip()
                while normalized.startswith("./"):
                    normalized = normalized[2:]
                segments = normalized.split("/") if normalized else []
                if (
                    not normalized
                    or any(segment in {{"", ".", ".."}} for segment in segments)
                    or normalized.startswith("/")
                    or normalized.startswith("../")
                    or "/../" in f"/{{normalized}}/"
                    or ":" in normalized
                ):
                    return ""
                return normalized


            def portable_asset_ref(obj):
                for key in ("urdf_studio_asset_ref", "asset_ref", "mesh_asset_ref"):
                    value = portable_asset_ref_value(custom_string(obj, key))
                    if value:
                        return value
                data = getattr(obj, "data", None)
                for key in ("urdf_studio_asset_ref", "asset_ref", "mesh_asset_ref"):
                    value = portable_asset_ref_value(custom_string(data, key))
                    if value:
                        return value
                return ""


            def main():
                changes = []
                review_only = []
                source_world_object_ids = [
                    str(stable_id)
                    for stable_id in CHANGE_SET_SOURCE["world_object_ids"]
                ]
                source_camera_ids = [
                    str(stable_id)
                    for stable_id in CHANGE_SET_SOURCE["camera_ids"]
                ]
                exported_world_object_ids = set()
                exported_camera_ids = set()
                for obj in bpy.data.objects:
                    kind = obj.get("urdf_studio_kind")
                    stable_id = obj.get("urdf_studio_stable_id")
                    if kind == "world_object" and stable_id:
                        exported_world_object_ids.add(str(stable_id))
                        changes.append(
                            {{
                                "entity_type": "world_object",
                                "stable_id": str(stable_id),
                                "sim_name": str(obj.get("urdf_studio_sim_name", obj.name)),
                                "position_xyz": vector3(obj.location),
                                "quat_wxyz": quat_wxyz(obj),
                                "size_xyz": local_size_xyz(obj),
                                "rgba": rgba(obj),
                            }}
                        )
                    elif kind == "camera" and stable_id:
                        exported_camera_ids.add(str(stable_id))
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
                        entry = {{
                            "entity_type": "new_world_object",
                            "sim_name": str(obj.name),
                            "position_xyz": vector3(obj.location),
                            "quat_wxyz": quat_wxyz(obj),
                            "size_xyz": local_size_xyz(obj),
                            "rgba": rgba(obj),
                            "reason": "new Blender mesh object will import as a Studio cube world object",
                        }}
                        asset_ref = portable_asset_ref(obj)
                        if asset_ref:
                            entry["asset_ref"] = asset_ref
                            entry["reason"] = "new Blender mesh object will import as a Studio mesh world object"
                        review_only.append(entry)
                for stable_id in source_camera_ids:
                    if stable_id not in exported_camera_ids:
                        review_only.append(
                            {{
                                "entity_type": "deleted_camera",
                                "stable_id": stable_id,
                                "reason": "deleted Studio cameras require Studio review before removal",
                            }}
                        )
                for stable_id in source_world_object_ids:
                    if stable_id not in exported_world_object_ids:
                        review_only.append(
                            {{
                                "entity_type": "deleted_world_object",
                                "stable_id": stable_id,
                                "reason": "deleted Studio world objects require Studio review before removal",
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


def _blender_object_entry(primitive: Any, asset_roots: Sequence[Path]) -> dict[str, Any]:
    asset_path = resolve_world_layout_asset_path(primitive.asset_ref, asset_roots)
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
        "asset_path": str(asset_path) if asset_path is not None else None,
        "asset_scale_xyz": list(primitive.asset_scale_xyz) if primitive.asset_scale_xyz else None,
    }
