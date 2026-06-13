from __future__ import annotations

import json
import textwrap
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

from scipy.spatial.transform import Rotation

from backend.models.world_scene_package import WorldScenePackageManifest
from backend.services.simulator_adapters.world_scene import SimulatorSceneSpec

BLENDER_EDIT_SESSION_SCHEMA = "urdf-studio.blender-edit-session.v1"
BLENDER_CHANGE_SET_SCHEMA = "urdf-studio.blender-change-set.v1"
BLENDER_CHANGE_SET_FILENAME = "blender-change-set.json"
BLENDER_EDIT_SESSION_FILENAME = "blender-edit-session.json"
BLENDER_OPEN_SCRIPT_FILENAME = "open_blender_scene.py"
BLENDER_EXPORT_SCRIPT_FILENAME = "export_blender_changes.py"


@dataclass(frozen=True)
class BlenderWorkspaceArtifacts:
    edit_session_path: Path
    open_script_path: Path
    export_script_path: Path
    change_set_path: Path


@dataclass(frozen=True)
class BlenderLayoutChangeSetApplyResult:
    world_package: WorldScenePackageManifest
    applied_change_count: int
    review_only_count: int


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
    edit_session = build_blender_edit_session(
        scene,
        robot_urdf_path=robot_urdf_path,
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
        build_blender_export_script(change_set_path=change_set_path),
        encoding="utf-8",
    )
    return BlenderWorkspaceArtifacts(
        edit_session_path=edit_session_path,
        open_script_path=open_script_path,
        export_script_path=export_script_path,
        change_set_path=change_set_path,
    )


def build_blender_edit_session(
    scene: SimulatorSceneSpec,
    *,
    robot_urdf_path: Path,
    blend_path: Path,
    change_set_path: Path,
    export_script_path: Path,
) -> dict[str, Any]:
    return {
        "schema": BLENDER_EDIT_SESSION_SCHEMA,
        "mode": "visual-layout",
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


            def material_for(name, rgba):
                material = bpy.data.materials.new(name)
                material.diffuse_color = tuple(rgba)
                return material


            def assign_metadata(obj, kind, entry):
                obj["urdf_studio_kind"] = kind
                obj["urdf_studio_stable_id"] = entry.get("stable_id", "")
                obj["urdf_studio_sim_name"] = entry.get("sim_name", "")
                obj["urdf_studio_source_name"] = entry.get("source_name") or entry.get("name", "")


            def add_object(entry):
                sim_type = entry.get("sim_type")
                position = entry.get("position_xyz", [0.0, 0.0, 0.0])
                quat = entry.get("quat_wxyz", [1.0, 0.0, 0.0, 0.0])
                size = entry.get("size_xyz", [1.0, 1.0, 1.0])
                if sim_type == "sphere":
                    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=position)
                elif sim_type == "cylinder":
                    bpy.ops.mesh.primitive_cylinder_add(vertices=48, location=position)
                else:
                    bpy.ops.mesh.primitive_cube_add(size=1.0, location=position)
                obj = bpy.context.object
                obj.name = entry.get("sim_name") or entry.get("stable_id") or "world_object"
                obj.rotation_mode = "QUATERNION"
                obj.rotation_quaternion = quat
                obj.dimensions = size
                assign_metadata(obj, "world_object", entry)
                rgba = entry.get("rgba", [0.8, 0.8, 0.8, 1.0])
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
                assign_metadata(obj, "camera", entry)


            def add_robot_reference(session):
                bpy.ops.object.empty_add(type="ARROWS", location=(0.0, 0.0, 0.0))
                obj = bpy.context.object
                obj.name = "robot_urdf_locked_reference"
                obj["urdf_studio_kind"] = "robot_reference"
                obj["urdf_studio_locked"] = True
                obj["urdf_studio_urdf_path"] = session.get("robot", {{}}).get("urdf_path", "")


            def add_session_notes(session):
                text = bpy.data.texts.new("URDF Studio Round Trip")
                text.write(
                    "Edit world object transforms, then run the generated export_blender_changes.py "
                    "script to write the change-set JSON. Robot kinematics remain locked in URDF Studio.\\n"
                )
                text.write(json.dumps(session.get("round_trip", {{}}), indent=2))


            def main():
                session = json.loads(SESSION_PATH.read_text(encoding="utf-8"))
                clear_scene()
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


def build_blender_export_script(*, change_set_path: Path) -> str:
    return (
        textwrap.dedent(
            f"""
            import json
            from pathlib import Path

            import bpy

            CHANGE_SET_PATH = Path({str(change_set_path)!r})


            def quat_wxyz(obj):
                obj.rotation_mode = "QUATERNION"
                quat = obj.rotation_quaternion
                return [float(quat.w), float(quat.x), float(quat.y), float(quat.z)]


            def vector3(value):
                return [float(value[0]), float(value[1]), float(value[2])]


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
                                "size_xyz": vector3(obj.dimensions),
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
                payload = {{
                    "schema": "{BLENDER_CHANGE_SET_SCHEMA}",
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
    if change_set.get("schema") != BLENDER_CHANGE_SET_SCHEMA:
        raise ValueError("Unsupported Blender change-set schema.")
    changes = change_set.get("changes")
    if not isinstance(changes, Sequence) or isinstance(changes, str):
        raise ValueError("Blender change-set changes must be a list.")
    object_updates = {
        str(change.get("stable_id")): change
        for change in changes
        if isinstance(change, Mapping)
        and change.get("entity_type") == "world_object"
        and str(change.get("stable_id", "")).strip()
    }
    review_only = change_set.get("review_only")
    updated = world_package.model_copy(deep=True)
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
        review_only_count=len(review_only)
        if isinstance(review_only, Sequence) and not isinstance(review_only, str)
        else 0,
    )


def _world_object_change_fields(change: Mapping[str, Any]) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    position = _read_vector3(change.get("position_xyz"))
    if position is not None:
        fields["position_xyz"] = list(position)
    quat = _read_quat_wxyz(change.get("quat_wxyz"))
    if quat is not None:
        fields["rotation_rpy_rad"] = list(_quat_wxyz_to_rpy(quat))
    size = _read_vector3(change.get("size_xyz"))
    if size is not None:
        fields["size_xyz"] = list(size)
    return fields


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


def _read_vector3(value: Any) -> tuple[float, float, float] | None:
    if not isinstance(value, Sequence) or isinstance(value, str) or len(value) < 3:
        return None
    try:
        return (float(value[0]), float(value[1]), float(value[2]))
    except (TypeError, ValueError):
        return None


def _read_quat_wxyz(value: Any) -> tuple[float, float, float, float] | None:
    if not isinstance(value, Sequence) or isinstance(value, str) or len(value) < 4:
        return None
    try:
        return (float(value[0]), float(value[1]), float(value[2]), float(value[3]))
    except (TypeError, ValueError):
        return None


def _quat_wxyz_to_rpy(quat_wxyz: tuple[float, float, float, float]) -> tuple[float, float, float]:
    rotation = Rotation.from_quat((quat_wxyz[1], quat_wxyz[2], quat_wxyz[3], quat_wxyz[0]))
    rpy = rotation.as_euler("xyz")
    return (float(rpy[0]), float(rpy[1]), float(rpy[2]))
