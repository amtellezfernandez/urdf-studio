from __future__ import annotations

import ast
import json
import math
import runpy
import sys
from pathlib import Path

import pytest

from backend.models.simulator_runtime import SIMULATOR_BLENDER_ID, SimulatorWorkspacePrepareRequest
from backend.models.world_scene_package import WorldArtifactRef
from backend.scripts import blender_workspace_prepare as blender_prepare
from backend.scripts.blender_workspace_prepare import prepare_blender_workspace_scene
from backend.services.ilu_urdf import BundleMeshAssetsResult
from backend.services.simulator_adapters import blender as blender_adapter
from backend.services.simulator_adapters.camera_conventions import (
    world_camera_to_opengl_camera_rotation,
)
from backend.services.simulator_adapters.blender_runtime import (
    _windows_drive_path_to_wsl_path,
    resolve_blender_executable,
)
from backend.services.simulator_adapters.blender_change_sets import (
    BLENDER_CHANGE_SET_SCHEMA,
    apply_blender_layout_change_set,
    apply_blender_layout_change_set_with_summary,
    build_blender_change_set_source,
)
from backend.services.simulator_adapters.blender_workspace import (
    BLENDER_ROBOT_GLB_FILENAME,
    BLENDER_ROBOT_USD_FILENAME,
    write_blender_workspace_artifacts,
)
from backend.services.simulator_adapters.blender_edit_session import (
    BLENDER_EDIT_SESSION_SCHEMA,
    validate_blender_edit_session_artifact,
)
from backend.services.simulator_adapters.params import (
    BLENDER_WORKSPACE_PROCESS_PARAMS,
    WORKSPACE_LAUNCH_FRAME_MAP,
)
from backend.services.simulator_adapters.workspace_package import PreparedSimulatorWorkspace
from backend.services.simulator_adapters.world_scene import prepare_simulator_scene
from backend.services.world_scene_package_digest import (
    computed_world_snapshot_digest,
    declared_world_snapshot_digests,
)
from backend.tests.fake_blender import FakeBlenderModule
from backend.tests.simulator_adapter_test_utils import make_world_package, write_world_package_file


def _write_scene_inputs(tmp_path: Path):
    urdf_xml = """
<robot name="blender_demo">
  <link name="base_link">
    <visual>
      <geometry>
        <box size="0.1 0.2 0.3"/>
      </geometry>
    </visual>
  </link>
</robot>
""".strip()
    world_package = make_world_package(
        urdf_xml,
        objects=[
            {
                "id": "crate",
                "name": "Crate",
                "type": "cube",
                "position_xyz": [0.1, 0.2, 0.3],
                "rotation_rpy_rad": [0.0, 0.0, 0.0],
                "size_xyz": [0.2, 0.3, 0.4],
                "color": "#22c55e",
            }
        ],
    )
    world_package.world_snapshot.cameras = [
        {
            "id": "cam-1",
            "name": "scene camera",
            "parent_joint": "base_link",
            "pose": {"xyz": [0.0, 0.0, 1.0], "rpy": [0.0, 0.0, 0.0]},
            "intrinsics": {"width": 640, "height": 480, "fov_deg": 60},
        }
    ]
    world_package_path = tmp_path / "world-package.json"
    robot_urdf_path = tmp_path / "robot.urdf"
    write_world_package_file(world_package_path, world_package)
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")
    return world_package, world_package_path, robot_urdf_path


def _blender_change_set(
    world_package,
    *,
    changes,
    review_only=None,
    include_camera_changes=True,
    frame_map=None,
):
    next_changes = list(changes)
    review_only_entries = list(review_only or [])
    if include_camera_changes:
        changed_camera_ids = {
            str(change.get("stable_id", ""))
            for change in next_changes
            if change.get("entity_type") == "camera"
        }
        deleted_camera_ids = {
            str(entry.get("stable_id", ""))
            for entry in review_only_entries
            if entry.get("entity_type") == "deleted_camera"
        }
        for camera in world_package.world_snapshot.cameras:
            camera_id = str(camera.get("id", ""))
            if (
                camera_id
                and camera_id not in changed_camera_ids
                and camera_id not in deleted_camera_ids
            ):
                next_changes.append(_scene_camera_change(stable_id=camera_id))
    return {
        "schema": BLENDER_CHANGE_SET_SCHEMA,
        "source": build_blender_change_set_source(
            world_package,
            frame_map=frame_map,
            world_object_ids=[
                str(item.get("id", ""))
                for item in world_package.world_snapshot.objects
            ],
            camera_ids=[
                str(item.get("id", ""))
                for item in world_package.world_snapshot.cameras
            ],
        ),
        "changes": next_changes,
        "review_only": review_only_entries,
    }


def _crate_layout_change() -> dict:
    return {
        "entity_type": "world_object",
        "stable_id": "crate",
        "position_xyz": [1.0, 2.0, 3.0],
        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
        "size_xyz": [0.5, 0.6, 0.7],
    }


def _scene_camera_change(stable_id="cam-1", position_xyz=None) -> dict:
    return {
        "entity_type": "camera",
        "stable_id": stable_id,
        "position_xyz": position_xyz or [0.0, 0.0, 1.0],
        "quat_wxyz": _studio_zero_camera_render_quat_wxyz(),
        "fov_deg": 60.0,
        "pose_frame": "opengl_render_local",
    }


def _studio_zero_camera_render_quat_wxyz() -> list[float]:
    quat_xyzw = world_camera_to_opengl_camera_rotation().as_quat()
    return [
        float(quat_xyzw[3]),
        float(quat_xyzw[0]),
        float(quat_xyzw[1]),
        float(quat_xyzw[2]),
    ]


def _write_blender_edit_session_artifacts(tmp_path: Path):
    _world_package, world_package_path, robot_urdf_path = _write_scene_inputs(tmp_path)
    scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map="identity",
        include_hidden=False,
    )
    return write_blender_workspace_artifacts(
        scene,
        artifact_dir=tmp_path / "artifacts",
        robot_urdf_path=robot_urdf_path,
        blend_path=tmp_path / "layout.blend",
    )


def _write_mutated_blender_edit_session_artifact(
    tmp_path: Path,
    path: tuple[object, ...],
    value,
):
    artifacts = _write_blender_edit_session_artifacts(tmp_path)
    edit_session = json.loads(artifacts.edit_session_path.read_text(encoding="utf-8"))
    target = edit_session
    for segment in path[:-1]:
        target = target[segment]
    target[path[-1]] = value
    artifacts.edit_session_path.write_text(
        f"{json.dumps(edit_session, indent=2, sort_keys=True)}\n",
        encoding="utf-8",
    )
    return artifacts


def test_blender_workspace_artifacts_preserve_round_trip_ids(tmp_path: Path) -> None:
    _world_package, world_package_path, robot_urdf_path = _write_scene_inputs(tmp_path)
    scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map="identity",
        include_hidden=False,
    )

    artifacts = write_blender_workspace_artifacts(
        scene,
        artifact_dir=tmp_path / "artifacts",
        robot_urdf_path=robot_urdf_path,
        blend_path=tmp_path / "layout.blend",
        camera_screenshot_dir=tmp_path / "artifacts" / "cameras",
    )
    edit_session = json.loads(artifacts.edit_session_path.read_text(encoding="utf-8"))

    assert edit_session["schema"] == BLENDER_EDIT_SESSION_SCHEMA
    assert edit_session["source"] == build_blender_change_set_source(
        _world_package,
        frame_map="identity",
        world_object_ids=("crate",),
        camera_ids=("cam-1",),
    )
    assert edit_session["robot"]["locked"] is True
    assert Path(edit_session["robot"]["visual_glb_path"]).name == BLENDER_ROBOT_GLB_FILENAME
    assert edit_session["robot"]["visual_glb_stats"]["geometry_count"] == 1
    assert edit_session["robot"]["visual_glb_stats"]["applied_joint_count"] == 0
    assert Path(edit_session["robot"]["visual_usd_path"]).name == BLENDER_ROBOT_USD_FILENAME
    assert edit_session["robot"]["visual_usd_stats"]["links_converted"] == 1
    assert edit_session["objects"][0]["stable_id"] == "crate"
    assert edit_session["cameras"][0]["stable_id"] == "cam-1"
    assert edit_session["camera_screenshot_dir"] == str(tmp_path / "artifacts" / "cameras")
    assert "camera.intrinsics.fov_deg" in edit_session["round_trip"]["supported_changes"]
    assert "world_object.color" in edit_session["round_trip"]["supported_changes"]
    assert "new_world_object" in edit_session["round_trip"]["review_only"]
    assert "new_static_props" not in edit_session["round_trip"]["review_only"]
    assert "robot.kinematics" in edit_session["round_trip"]["locked"]
    assert artifacts.robot_glb_path is not None
    assert artifacts.robot_glb_path.exists()
    assert artifacts.robot_usd_path.exists()
    assert artifacts.robot_usd_path.read_text(encoding="utf-8").startswith("#usda")
    assert artifacts.open_script_path.exists()
    assert artifacts.export_script_path.exists()
    assert (
        validate_blender_edit_session_artifact(
            artifacts.edit_session_path,
            expected_object_count=1,
            expected_camera_count=1,
        )
        is None
    )


def test_blender_robot_glb_reference_applies_joint_positions(tmp_path: Path) -> None:
    urdf_xml = """
<robot name="blender_joint_pose_demo">
  <link name="base_link">
    <visual>
      <geometry>
        <box size="0.1 0.1 0.1"/>
      </geometry>
    </visual>
  </link>
  <link name="arm_link">
    <visual>
      <origin xyz="0.2 0 0"/>
      <geometry>
        <box size="0.2 0.05 0.05"/>
      </geometry>
    </visual>
  </link>
  <joint name="shoulder" type="revolute">
    <parent link="base_link"/>
    <child link="arm_link"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="1" velocity="1"/>
  </joint>
</robot>
""".strip()
    world_package = make_world_package(urdf_xml, joint_positions={"shoulder": 0.75})
    world_package_path = tmp_path / "world-package.json"
    robot_urdf_path = tmp_path / "robot.urdf"
    write_world_package_file(world_package_path, world_package)
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")
    scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map="identity",
        include_hidden=False,
    )

    artifacts = write_blender_workspace_artifacts(
        scene,
        artifact_dir=tmp_path / "artifacts",
        robot_urdf_path=robot_urdf_path,
        blend_path=tmp_path / "layout.blend",
    )
    edit_session = json.loads(artifacts.edit_session_path.read_text(encoding="utf-8"))

    assert edit_session["robot"]["visual_glb_stats"]["applied_joint_count"] == 1
    assert artifacts.robot_glb_path is not None
    assert artifacts.robot_glb_path.exists()


def test_blender_edit_session_validation_rejects_missing_supported_change(
    tmp_path: Path,
) -> None:
    artifacts = _write_blender_edit_session_artifacts(tmp_path)
    edit_session = json.loads(artifacts.edit_session_path.read_text(encoding="utf-8"))
    edit_session["round_trip"]["supported_changes"].remove("world_object.color")
    artifacts.edit_session_path.write_text(
        f"{json.dumps(edit_session, indent=2, sort_keys=True)}\n",
        encoding="utf-8",
    )

    assert validate_blender_edit_session_artifact(artifacts.edit_session_path) == (
        "Blender edit-session field 'round_trip.supported_changes' "
        "missing value(s): world_object.color"
    )


def test_blender_edit_session_validation_rejects_source_object_mismatch(
    tmp_path: Path,
) -> None:
    artifacts = _write_blender_edit_session_artifacts(tmp_path)
    edit_session = json.loads(artifacts.edit_session_path.read_text(encoding="utf-8"))
    edit_session["source"]["world_object_ids"] = ["missing-crate"]
    artifacts.edit_session_path.write_text(
        f"{json.dumps(edit_session, indent=2, sort_keys=True)}\n",
        encoding="utf-8",
    )

    assert validate_blender_edit_session_artifact(artifacts.edit_session_path) == (
        "Blender edit-session field 'source.world_object_ids' references id(s) "
        "missing from objects: missing-crate"
    )


def test_blender_edit_session_validation_rejects_duplicate_source_camera_id(
    tmp_path: Path,
) -> None:
    artifacts = _write_blender_edit_session_artifacts(tmp_path)
    edit_session = json.loads(artifacts.edit_session_path.read_text(encoding="utf-8"))
    edit_session["source"]["camera_ids"] = ["cam-1", "cam-1"]
    artifacts.edit_session_path.write_text(
        f"{json.dumps(edit_session, indent=2, sort_keys=True)}\n",
        encoding="utf-8",
    )

    assert validate_blender_edit_session_artifact(artifacts.edit_session_path) == (
        "Blender edit-session field 'source.camera_ids' contains duplicate id(s): cam-1"
    )


@pytest.mark.parametrize(
    ("path", "value", "expected_error"),
    (
        (
            ("objects", 0, "position_xyz"),
            [0.0, "bad", 0.0],
            "Blender edit-session field 'objects[0].position_xyz' must contain only finite numbers",
        ),
        (
            ("objects", 0, "size_xyz"),
            [0.0, 1.0, 1.0],
            "Blender edit-session field 'objects[0].size_xyz' must contain positive dimensions",
        ),
        (
            ("objects", 0, "rgba"),
            [1.2, 0.0, 0.0, 1.0],
            "Blender edit-session field 'objects[0].rgba' must contain numbers between 0 and 1",
        ),
        (
            ("objects", 0, "quat_wxyz"),
            [0.0, 0.0, 0.0, 0.0],
            "Blender edit-session field 'objects[0].quat_wxyz' must be a non-zero quaternion",
        ),
        (
            ("cameras", 0, "width"),
            0,
            "Blender edit-session field 'cameras[0].width' must be a positive integer",
        ),
        (
            ("cameras", 0, "fov_deg"),
            180.0,
            "Blender edit-session field 'cameras[0].fov_deg' must be between 0 and 180 degrees",
        ),
    ),
)
def test_blender_edit_session_validation_rejects_bad_numeric_fields(
    tmp_path: Path,
    path: tuple[object, ...],
    value,
    expected_error: str,
) -> None:
    artifacts = _write_mutated_blender_edit_session_artifact(tmp_path, path, value)

    assert validate_blender_edit_session_artifact(artifacts.edit_session_path) == expected_error


def test_blender_change_set_applies_world_object_layout_only(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[
            {
                "entity_type": "world_object",
                "stable_id": "crate",
                "position_xyz": [1.0, 2.0, 3.0],
                "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                "size_xyz": [0.5, 0.6, 0.7],
            },
        ],
    )

    updated = apply_blender_layout_change_set(world_package, change_set)
    updated_object = updated.world_snapshot.objects[0]

    assert updated_object["position_xyz"] == [1.0, 2.0, 3.0]
    assert updated_object["size_xyz"] == [0.5, 0.6, 0.7]
    assert updated_object["color"] == "#22c55e"
    assert all(math.isclose(value, 0.0, abs_tol=1e-9) for value in updated_object["rotation_rpy_rad"])
    assert updated.world_snapshot.cameras == world_package.world_snapshot.cameras


def test_blender_change_set_applies_world_object_color(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change = _crate_layout_change()
    change["rgba"] = [0.8, 0.1, 0.2, 1.0]

    updated = apply_blender_layout_change_set(
        world_package,
        _blender_change_set(
            world_package,
            changes=[change],
        ),
    )

    assert updated.world_snapshot.objects[0]["color"] == "#cc1a33"


def test_blender_change_set_applies_camera_pose(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)

    result = apply_blender_layout_change_set_with_summary(
        world_package,
        _blender_change_set(
            world_package,
            changes=[
                _crate_layout_change(),
                _scene_camera_change(position_xyz=[0.2, 0.3, 1.4]),
            ],
        ),
    )

    updated_camera = result.world_package.world_snapshot.cameras[0]
    assert result.applied_change_count == 2
    assert result.review_only_count == 0
    assert updated_camera["pose"]["xyz"] == [0.2, 0.3, 1.4]
    assert updated_camera["intrinsics"]["fov_deg"] == 60.0
    assert all(
        math.isclose(value, 0.0, abs_tol=1e-9)
        for value in updated_camera["pose"]["rpy"]
    )


def test_blender_change_set_applies_camera_fov_to_calibrated_intrinsics(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    world_package.world_snapshot.cameras[0]["intrinsics"] = {
        "width": 640,
        "height": 480,
        "fx": 500.0,
        "fy": 500.0,
        "cx": 319.5,
        "cy": 239.5,
    }
    camera_change = _scene_camera_change(position_xyz=[0.0, 0.0, 1.0])
    camera_change["fov_deg"] = 72.0

    result = apply_blender_layout_change_set_with_summary(
        world_package,
        _blender_change_set(
            world_package,
            changes=[
                _crate_layout_change(),
                camera_change,
            ],
        ),
    )

    intrinsics = result.world_package.world_snapshot.cameras[0]["intrinsics"]
    expected_fy = 480 / (2.0 * math.tan(math.radians(72.0) * 0.5))
    assert intrinsics["fov_deg"] == 72.0
    assert intrinsics["fy"] == pytest.approx(expected_fy)
    assert intrinsics["fx"] == pytest.approx(expected_fy * (640 / 480))
    assert intrinsics["cx"] == 319.5
    assert intrinsics["cy"] == 239.5


def test_blender_change_set_refreshes_world_snapshot_artifact_digest(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    original_digest = computed_world_snapshot_digest(world_package)
    world_package.artifacts = [
        WorldArtifactRef(
            kind="world_snapshot",
            digest_sha256=original_digest,
            uri="inline://snapshot",
        )
    ]

    updated = apply_blender_layout_change_set(
        world_package,
        _blender_change_set(
            world_package,
            changes=[_crate_layout_change()],
        ),
    )

    updated_digest = computed_world_snapshot_digest(updated)
    assert updated_digest != original_digest
    assert declared_world_snapshot_digests(updated) == (updated_digest,)


def test_blender_change_set_imports_new_world_objects(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)

    result = apply_blender_layout_change_set_with_summary(
        world_package,
        _blender_change_set(
            world_package,
            changes=[
                {
                    "entity_type": "world_object",
                    "stable_id": "crate",
                    "position_xyz": [1.0, 2.0, 3.0],
                    "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                    "size_xyz": [0.5, 0.6, 0.7],
                }
            ],
            review_only=[
                {
                    "entity_type": "new_world_object",
                    "sim_name": "Added cube",
                    "position_xyz": [0.2, 0.3, 0.4],
                    "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                    "size_xyz": [0.1, 0.2, 0.3],
                    "rgba": [1.0, 0.82, 0.0, 1.0],
                    "reason": "new Blender mesh object will import as a Studio cube world object",
                }
            ],
        ),
    )
    added_object = result.world_package.world_snapshot.objects[1]

    assert result.applied_change_count == 3
    assert result.review_only_count == 0
    assert added_object == {
        "id": "blender_added_cube",
        "name": "Added cube",
        "type": "cube",
        "position_xyz": [0.2, 0.3, 0.4],
        "rotation_rpy_rad": [0.0, 0.0, 0.0],
        "size_xyz": [0.1, 0.2, 0.3],
        "color": "#ffd100",
        "simulation": {
            "fixed": True,
            "collision": True,
            "semantic_role": "blender_import",
        },
    }


def test_blender_change_set_imports_new_mesh_world_objects(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)

    result = apply_blender_layout_change_set_with_summary(
        world_package,
        _blender_change_set(
            world_package,
            changes=[_crate_layout_change()],
            review_only=[
                {
                    "entity_type": "new_world_object",
                    "sim_name": "Added mesh",
                    "position_xyz": [0.2, 0.3, 0.4],
                    "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                    "size_xyz": [0.1, 0.2, 0.3],
                    "rgba": [0.1, 0.2, 0.3, 1.0],
                    "asset_ref": "assets/added_mesh.obj",
                    "reason": "new Blender mesh object will import as a Studio mesh world object",
                },
            ],
        ),
    )

    added_object = result.world_package.world_snapshot.objects[1]
    assert result.applied_change_count == 3
    assert result.review_only_count == 0
    assert added_object["id"] == "blender_added_mesh"
    assert added_object["type"] == "mesh"
    assert added_object["asset_ref"] == "assets/added_mesh.obj"
    assert added_object["size_xyz"] == [0.1, 0.2, 0.3]
    assert added_object["color"] == "#1a334c"


def test_blender_change_set_assigns_unique_ids_to_imported_world_objects(
    tmp_path: Path,
) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    world_package.world_snapshot.objects.append(
        {
            "id": "blender_added_cube",
            "name": "Existing imported cube",
            "type": "cube",
            "position_xyz": [0.0, 0.0, 0.0],
            "rotation_rpy_rad": [0.0, 0.0, 0.0],
            "size_xyz": [0.1, 0.1, 0.1],
            "color": "#ffffff",
        }
    )

    result = apply_blender_layout_change_set_with_summary(
        world_package,
        _blender_change_set(
            world_package,
            changes=[
                {
                    "entity_type": "world_object",
                    "stable_id": "crate",
                    "position_xyz": [1.0, 2.0, 3.0],
                    "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                    "size_xyz": [0.5, 0.6, 0.7],
                },
                {
                    "entity_type": "world_object",
                    "stable_id": "blender_added_cube",
                    "position_xyz": [0.0, 0.0, 0.0],
                    "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                    "size_xyz": [0.1, 0.1, 0.1],
                },
            ],
            review_only=[
                {
                    "entity_type": "new_world_object",
                    "sim_name": "Added cube",
                    "position_xyz": [0.2, 0.3, 0.4],
                    "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                    "size_xyz": [0.1, 0.2, 0.3],
                    "reason": "new Blender mesh object will import as a Studio cube world object",
                },
            ],
        ),
    )

    assert result.applied_change_count == 4
    assert result.review_only_count == 0
    assert [item["id"] for item in result.world_package.world_snapshot.objects] == [
        "crate",
        "blender_added_cube",
        "blender_added_cube_2",
    ]


def test_blender_change_set_rejects_incomplete_new_world_object(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)

    with pytest.raises(ValueError, match="review_only\\[0\\]\\.size_xyz"):
        apply_blender_layout_change_set_with_summary(
            world_package,
            _blender_change_set(
                world_package,
                changes=[_crate_layout_change()],
                review_only=[
                    {
                        "entity_type": "new_world_object",
                        "sim_name": "Incomplete cube",
                        "position_xyz": [0.2, 0.3, 0.4],
                        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                    }
                ],
            ),
        )


def test_blender_change_set_rejects_invalid_new_world_object_rgba(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)

    with pytest.raises(ValueError, match="review_only\\[0\\]\\.rgba"):
        apply_blender_layout_change_set_with_summary(
            world_package,
            _blender_change_set(
                world_package,
                changes=[_crate_layout_change()],
                review_only=[
                    {
                        "entity_type": "new_world_object",
                        "sim_name": "Invalid color cube",
                        "position_xyz": [0.2, 0.3, 0.4],
                        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                        "size_xyz": [0.1, 0.2, 0.3],
                        "rgba": [1.2, 0.0, 0.0, 1.0],
                        "reason": "new Blender mesh object will import as a Studio cube world object",
                    }
                ],
            ),
        )


def test_blender_change_set_rejects_nonportable_new_mesh_asset_ref(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)

    with pytest.raises(ValueError, match="portable relative asset reference"):
        apply_blender_layout_change_set_with_summary(
            world_package,
            _blender_change_set(
                world_package,
                changes=[_crate_layout_change()],
                review_only=[
                    {
                        "entity_type": "new_world_object",
                        "sim_name": "Absolute mesh",
                        "position_xyz": [0.2, 0.3, 0.4],
                        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                        "size_xyz": [0.1, 0.2, 0.3],
                        "asset_ref": "assets/./crate.obj",
                    }
                ],
            ),
        )


def test_blender_change_set_rejects_invalid_world_object_rgba(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change = _crate_layout_change()
    change["rgba"] = [1.2, 0.0, 0.0, 1.0]

    with pytest.raises(ValueError, match="changes\\[0\\]\\.rgba"):
        apply_blender_layout_change_set_with_summary(
            world_package,
            _blender_change_set(
                world_package,
                changes=[change],
            ),
        )


def test_blender_change_set_applies_deleted_world_object(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[],
        review_only=[
            {
                "entity_type": "deleted_world_object",
                "stable_id": "crate",
                "reason": "deleted Blender world object removes the Studio world object",
            }
        ],
        include_camera_changes=False,
    )
    change_set["source"]["world_object_ids"] = ["crate"]
    change_set["source"]["camera_ids"] = []

    result = apply_blender_layout_change_set_with_summary(
        world_package,
        change_set,
    )

    assert result.applied_change_count == 1
    assert result.review_only_count == 0
    assert result.world_package.world_snapshot.objects == []


def test_blender_change_set_accepts_source_camera_update(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[_crate_layout_change()],
    )
    change_set["source"]["camera_ids"] = ["cam-1"]

    result = apply_blender_layout_change_set_with_summary(world_package, change_set)

    assert result.applied_change_count == 2
    assert result.review_only_count == 0


def test_blender_change_set_applies_deleted_camera(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[_crate_layout_change()],
        review_only=[
            {
                "entity_type": "deleted_camera",
                "stable_id": "cam-1",
                "reason": "deleted Blender camera removes the Studio camera",
            }
        ],
    )
    change_set["source"]["camera_ids"] = ["cam-1"]

    result = apply_blender_layout_change_set_with_summary(world_package, change_set)

    assert result.applied_change_count == 2
    assert result.review_only_count == 0
    assert result.world_package.world_snapshot.cameras == []


def test_blender_change_set_rejects_missing_source_object_coverage(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(world_package, changes=[])
    change_set["source"]["world_object_ids"] = ["crate"]

    with pytest.raises(ValueError, match="missing update or delete"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_updates_outside_source_object_ids(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[
            {
                "entity_type": "world_object",
                "stable_id": "crate",
                "position_xyz": [1.0, 2.0, 3.0],
                "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                "size_xyz": [0.5, 0.6, 0.7],
            },
        ],
    )
    change_set["source"]["world_object_ids"] = []

    with pytest.raises(ValueError, match="outside source world_object_ids"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_deletions_outside_source_object_ids(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[],
        review_only=[
            {
                "entity_type": "deleted_world_object",
                "stable_id": "crate",
                "reason": "deleted Blender world object removes the Studio world object",
            }
        ],
    )
    change_set["source"]["world_object_ids"] = []

    with pytest.raises(ValueError, match="deletes object id\\(s\\) outside source"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_missing_source_camera_coverage(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[_crate_layout_change()],
        include_camera_changes=False,
    )
    change_set["source"]["camera_ids"] = ["cam-1"]

    with pytest.raises(ValueError, match="missing camera update"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_camera_updates_outside_source_camera_ids(
    tmp_path: Path,
) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[_crate_layout_change(), _scene_camera_change()],
    )
    change_set["source"]["camera_ids"] = []

    with pytest.raises(ValueError, match="changes reference camera id\\(s\\) outside source"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_deleted_cameras_outside_source_camera_ids(
    tmp_path: Path,
) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[_crate_layout_change()],
        review_only=[
            {
                "entity_type": "deleted_camera",
                "stable_id": "cam-1",
                "reason": "deleted Blender camera removes the Studio camera",
            }
        ],
    )
    change_set["source"]["camera_ids"] = []

    with pytest.raises(ValueError, match="deletes camera id\\(s\\) outside source"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_update_and_delete_for_same_camera(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[_scene_camera_change()],
        review_only=[
            {
                "entity_type": "deleted_camera",
                "stable_id": "cam-1",
                "reason": "deleted Blender camera removes the Studio camera",
            },
        ],
    )

    with pytest.raises(ValueError, match="both update and delete camera"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_camera_edits_without_explicit_pose_frame(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)

    with pytest.raises(ValueError, match="pose_frame"):
        apply_blender_layout_change_set(
            world_package,
            _blender_change_set(
                world_package,
                changes=[
                    {
                        "entity_type": "camera",
                        "stable_id": "cam-1",
                        "position_xyz": [0.0, 0.0, 1.0],
                        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                    }
                ],
            ),
        )


def test_blender_change_set_rejects_unknown_world_object_id(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)

    with pytest.raises(ValueError, match="outside source world_object_ids"):
        apply_blender_layout_change_set(
            world_package,
            _blender_change_set(
                world_package,
                changes=[
                    {
                        "entity_type": "world_object",
                        "stable_id": "missing",
                        "position_xyz": [1.0, 2.0, 3.0],
                        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                        "size_xyz": [0.5, 0.6, 0.7],
                    }
                ],
            ),
        )


@pytest.mark.parametrize(
    ("field_name", "value", "message"),
    [
        ("position_xyz", [1.0, 2.0], "3-number list"),
        ("position_xyz", [1.0, True, 3.0], "finite numbers"),
        ("quat_wxyz", [0.0, 0.0, 0.0, 0.0], "non-zero quaternion"),
        ("size_xyz", [0.5, 0.0, 0.7], "positive dimensions"),
    ],
)
def test_blender_change_set_rejects_invalid_transform_values(
    tmp_path: Path,
    field_name: str,
    value: list[object],
    message: str,
) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change = {
        "entity_type": "world_object",
        "stable_id": "crate",
        "position_xyz": [1.0, 2.0, 3.0],
        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
        "size_xyz": [0.5, 0.6, 0.7],
    }
    change[field_name] = value

    with pytest.raises(ValueError, match=message):
        apply_blender_layout_change_set(
            world_package,
            _blender_change_set(world_package, changes=[change]),
        )


def test_blender_change_set_rejects_duplicate_stable_ids(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change = {
        "entity_type": "world_object",
        "stable_id": "crate",
        "position_xyz": [1.0, 2.0, 3.0],
        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
        "size_xyz": [0.5, 0.6, 0.7],
    }

    with pytest.raises(ValueError, match="duplicate stable_id"):
        apply_blender_layout_change_set(
            world_package,
            _blender_change_set(world_package, changes=[change, dict(change)]),
        )


def test_blender_change_set_rejects_update_and_delete_for_same_object(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)

    with pytest.raises(ValueError, match="both update and delete"):
        apply_blender_layout_change_set(
            world_package,
            _blender_change_set(
                world_package,
                changes=[
                    {
                        "entity_type": "world_object",
                        "stable_id": "crate",
                        "position_xyz": [1.0, 2.0, 3.0],
                        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                        "size_xyz": [0.5, 0.6, 0.7],
                    }
                ],
                review_only=[
                    {
                        "entity_type": "deleted_world_object",
                        "stable_id": "crate",
                        "reason": "deleted Blender world object removes the Studio world object",
                    }
                ],
            ),
        )


def test_blender_change_set_rejects_missing_source(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)

    with pytest.raises(ValueError, match="source must be an object"):
        apply_blender_layout_change_set(
            world_package,
            {
                "schema": BLENDER_CHANGE_SET_SCHEMA,
                "changes": [],
                "review_only": [],
            },
        )


def test_blender_change_set_rejects_missing_source_world_object_ids(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[_crate_layout_change()],
    )
    del change_set["source"]["world_object_ids"]

    with pytest.raises(ValueError, match="source\\.world_object_ids"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_missing_source_camera_ids(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[_crate_layout_change()],
    )
    del change_set["source"]["camera_ids"]

    with pytest.raises(ValueError, match="source\\.camera_ids"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_stale_world_snapshot_source(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    stale_world_package = world_package.model_copy(deep=True)
    stale_world_package.world_snapshot.objects = []
    change_set = _blender_change_set(stale_world_package, changes=[])

    with pytest.raises(ValueError, match="world snapshot does not match"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_applies_non_identity_frame_map_source(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)

    result = apply_blender_layout_change_set_with_summary(
        world_package,
        _blender_change_set(
            world_package,
            frame_map="studio-y-up-to-z-up",
            changes=[
                {
                    "entity_type": "world_object",
                    "stable_id": "crate",
                    "position_xyz": [1.0, -3.0, 2.0],
                    "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                    "size_xyz": [0.5, 0.7, 0.6],
                },
                _scene_camera_change(position_xyz=[0.2, -1.4, 0.3]),
            ],
            review_only=[
                {
                    "entity_type": "new_world_object",
                    "sim_name": "Added cube",
                    "position_xyz": [2.0, -4.0, 3.0],
                    "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                    "size_xyz": [0.4, 0.6, 0.5],
                    "rgba": [0.1, 0.2, 0.3, 1.0],
                    "reason": "new Blender mesh object will import as a Studio cube world object",
                }
            ],
        ),
    )

    updated_object = result.world_package.world_snapshot.objects[0]
    added_object = result.world_package.world_snapshot.objects[1]
    updated_camera = result.world_package.world_snapshot.cameras[0]
    assert updated_object["position_xyz"] == pytest.approx([1.0, 2.0, 3.0])
    assert updated_object["size_xyz"] == pytest.approx([0.5, 0.6, 0.7])
    assert added_object["position_xyz"] == pytest.approx([2.0, 3.0, 4.0])
    assert added_object["size_xyz"] == pytest.approx([0.4, 0.5, 0.6])
    assert updated_camera["pose"]["xyz"] == pytest.approx([0.2, 0.3, 1.4])
    assert all(
        math.isclose(value, 0.0, abs_tol=1e-9)
        for value in updated_camera["pose"]["rpy"]
    )


def test_blender_change_set_rejects_unknown_source_world_object_id(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(world_package, changes=[])
    change_set["source"]["world_object_ids"] = ["crate", "missing"]

    with pytest.raises(ValueError, match="unknown world object"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_duplicate_source_world_object_id(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(world_package, changes=[])
    change_set["source"]["world_object_ids"] = ["crate", "crate"]

    with pytest.raises(ValueError, match="duplicate id"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_unknown_source_camera_id(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(world_package, changes=[])
    change_set["source"]["camera_ids"] = ["cam-1", "missing"]

    with pytest.raises(ValueError, match="unknown camera id"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_duplicate_source_camera_id(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(world_package, changes=[])
    change_set["source"]["camera_ids"] = ["cam-1", "cam-1"]

    with pytest.raises(ValueError, match="source camera_ids contains duplicate"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_workspace_prepare_no_viewer_writes_report_and_scripts(tmp_path: Path) -> None:
    _world_package, world_package_path, robot_urdf_path = _write_scene_inputs(tmp_path)
    report_path = tmp_path / "artifacts" / "report.json"

    prepare_blender_workspace_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map="identity",
        duration_sec=0.0,
        include_hidden=False,
        no_viewer=True,
        report_path=report_path,
        blender_executable=None,
        camera_screenshot_dir=tmp_path / "artifacts" / "cameras",
    )
    report = json.loads(report_path.read_text(encoding="utf-8"))

    assert report["simulator"]["id"] == SIMULATOR_BLENDER_ID
    assert report["primitive_count"] == 1
    assert report["camera_count"] == 1
    assert Path(report["artifacts"]["edit_session_path"]).exists()
    assert Path(report["artifacts"]["open_script_path"]).exists()
    assert Path(report["artifacts"]["export_script_path"]).exists()
    assert Path(report["artifacts"]["robot_glb_path"]).exists()
    assert Path(report["artifacts"]["robot_usd_path"]).exists()
    assert report["artifacts"]["camera_screenshot_dir"] == str(tmp_path / "artifacts" / "cameras")
    open_script = Path(report["artifacts"]["open_script_path"]).read_text(encoding="utf-8")
    export_script = Path(report["artifacts"]["export_script_path"]).read_text(encoding="utf-8")
    ast.parse(open_script)
    ast.parse(export_script)
    assert "new_world_object" in export_script
    assert "deleted_world_object" in export_script
    assert "deleted_camera" in export_script
    assert "camera_screenshots=" in open_script
    assert "bpy.ops.render.render" in open_script
    assert "initialize_edit_view" in open_script
    assert "view_perspective = \"PERSP\"" in open_script
    assert "world_objects_created=" in open_script


def test_start_blender_workspace_uses_auto_frame_map(monkeypatch, tmp_path: Path) -> None:
    workspace_dir = tmp_path / "workspace"
    robot_dir = workspace_dir / "robot"
    robot_dir.mkdir(parents=True)
    world_package_path = workspace_dir / "world-package.json"
    robot_urdf_path = robot_dir / "robot.urdf"
    world_package_path.write_text("{}", encoding="utf-8")
    robot_urdf_path.write_text("<robot name=\"demo\"><link name=\"base\"/></robot>", encoding="utf-8")
    prepared = PreparedSimulatorWorkspace(
        workspace_dir=workspace_dir,
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        bundle_result=BundleMeshAssetsResult(
            success=True,
            content=robot_urdf_path.read_text(encoding="utf-8"),
            out_path=str(robot_urdf_path),
            assets_root=str(robot_dir / "assets"),
            copied_files=0,
            bundled=(),
            unresolved=(),
            error=None,
        ),
    )

    class _FakeProcess:
        pid = 4321

        def poll(self) -> None:
            return None

    monkeypatch.setattr(blender_adapter, "resolve_blender_executable", lambda: "/bin/blender")
    monkeypatch.setattr(
        blender_adapter,
        "prepare_blender_workspace_package",
        lambda request: prepared,
    )
    monkeypatch.setattr(
        blender_adapter.subprocess,
        "Popen",
        lambda *args, **kwargs: _FakeProcess(),
    )
    monkeypatch.setattr(blender_adapter, "wait_for_workspace_readiness", lambda *args, **kwargs: None)

    response = blender_adapter.start_blender_workspace(
        SimulatorWorkspacePrepareRequest(
            world_package=make_world_package("<robot name=\"demo\"><link name=\"base\"/></robot>"),
        )
    )

    assert response.simulator_id == SIMULATOR_BLENDER_ID
    assert response.command[response.command.index("--frame-map") + 1] == WORKSPACE_LAUNCH_FRAME_MAP


def test_generated_blender_scripts_round_trip_with_fake_bpy(monkeypatch, tmp_path: Path) -> None:
    world_package, world_package_path, robot_urdf_path = _write_scene_inputs(tmp_path)
    scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map="identity",
        include_hidden=False,
    )
    camera_screenshot_dir = tmp_path / "artifacts" / "cameras"
    blend_path = tmp_path / "layout.blend"
    artifacts = write_blender_workspace_artifacts(
        scene,
        artifact_dir=tmp_path / "artifacts",
        robot_urdf_path=robot_urdf_path,
        blend_path=blend_path,
        camera_screenshot_dir=camera_screenshot_dir,
    )
    fake_bpy = FakeBlenderModule()
    monkeypatch.setitem(sys.modules, "bpy", fake_bpy)

    runpy.run_path(str(artifacts.open_script_path), run_name="__main__")

    world_objects = [
        obj for obj in fake_bpy.data.objects if obj.get("urdf_studio_kind") == "world_object"
    ]
    camera_objects = [
        obj for obj in fake_bpy.data.objects if obj.get("urdf_studio_kind") == "camera"
    ]
    assert blend_path.exists()
    assert [path.name for path in sorted(camera_screenshot_dir.glob("*.png"))] == [
        "01_scene_camera.png"
    ]
    assert len(world_objects) == 1
    assert len(camera_objects) == 1
    assert camera_objects[0].data.angle > 0.0

    world_objects[0].location = [1.0, 2.0, 3.0]
    world_objects[0].scale = [0.5, 0.6, 0.7]
    world_objects[0].rotation_quaternion = [1.0, 0.0, 0.0, 0.0]
    world_objects[0].data.materials[0].diffuse_color = (0.9, 0.1, 0.2, 1.0)
    camera_objects[0].location = [0.2, 0.4, 1.6]
    camera_objects[0].data.angle = math.radians(72.0)
    fake_bpy.ops.mesh.primitive_cube_add(size=1.0, location=(2.0, 3.0, 4.0))
    new_world_object = fake_bpy.context.object
    new_world_object.name = "Extra Box"
    new_world_object.scale = [0.4, 0.5, 0.6]
    new_world_object.color = (0.2, 0.4, 0.6, 1.0)
    new_world_object.rotation_quaternion = [1.0, 0.0, 0.0, 0.0]
    runpy.run_path(str(artifacts.export_script_path), run_name="__main__")

    change_set = json.loads(artifacts.change_set_path.read_text(encoding="utf-8"))
    assert change_set["schema"] == BLENDER_CHANGE_SET_SCHEMA
    assert change_set["changes"] == [
        {
            "entity_type": "world_object",
            "position_xyz": [1.0, 2.0, 3.0],
            "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
            "rgba": [0.9, 0.1, 0.2, 1.0],
            "sim_name": "wl_crate",
            "size_xyz": [0.5, 0.6, 0.7],
            "stable_id": "crate",
        },
        {
            "entity_type": "camera",
            "fov_deg": 72.0,
            "pose_frame": "opengl_render_local",
            "position_xyz": [0.2, 0.4, 1.6],
            "quat_wxyz": _studio_zero_camera_render_quat_wxyz(),
            "sim_name": "scene_camera",
            "stable_id": "cam-1",
        },
    ]
    assert change_set["review_only"][0]["entity_type"] == "new_world_object"
    assert change_set["review_only"][0]["sim_name"] == "Extra Box"
    assert change_set["review_only"][0]["rgba"] == [0.2, 0.4, 0.6, 1.0]

    result = apply_blender_layout_change_set_with_summary(world_package, change_set)

    assert result.applied_change_count == 3
    assert result.review_only_count == 0
    assert result.world_package.world_snapshot.objects[0]["position_xyz"] == [1.0, 2.0, 3.0]
    assert result.world_package.world_snapshot.objects[0]["size_xyz"] == [0.5, 0.6, 0.7]
    assert result.world_package.world_snapshot.objects[0]["color"] == "#e61a33"
    assert result.world_package.world_snapshot.objects[1]["id"] == "blender_extra_box"
    assert result.world_package.world_snapshot.objects[1]["position_xyz"] == [2.0, 3.0, 4.0]
    assert result.world_package.world_snapshot.objects[1]["color"] == "#336699"
    assert result.world_package.world_snapshot.cameras[0]["pose"]["xyz"] == [0.2, 0.4, 1.6]
    assert result.world_package.world_snapshot.cameras[0]["intrinsics"]["fov_deg"] == 72.0
    assert all(
        math.isclose(value, 0.0, abs_tol=1e-9)
        for value in result.world_package.world_snapshot.cameras[0]["pose"]["rpy"]
    )


def test_generated_blender_export_applies_deleted_studio_entities(
    monkeypatch,
    tmp_path: Path,
) -> None:
    world_package, world_package_path, robot_urdf_path = _write_scene_inputs(tmp_path)
    scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map="identity",
        include_hidden=False,
    )
    artifacts = write_blender_workspace_artifacts(
        scene,
        artifact_dir=tmp_path / "artifacts",
        robot_urdf_path=robot_urdf_path,
        blend_path=tmp_path / "layout.blend",
    )
    fake_bpy = FakeBlenderModule()
    monkeypatch.setitem(sys.modules, "bpy", fake_bpy)

    runpy.run_path(str(artifacts.open_script_path), run_name="__main__")

    fake_bpy.data.objects[:] = [
        obj
        for obj in fake_bpy.data.objects
        if obj.get("urdf_studio_kind") not in {"world_object", "camera"}
    ]
    runpy.run_path(str(artifacts.export_script_path), run_name="__main__")

    change_set = json.loads(artifacts.change_set_path.read_text(encoding="utf-8"))
    assert change_set["changes"] == []
    assert change_set["review_only"] == [
        {
            "entity_type": "deleted_camera",
            "reason": "deleted Blender camera removes the Studio camera",
            "stable_id": "cam-1",
        },
        {
            "entity_type": "deleted_world_object",
            "reason": "deleted Blender world object removes the Studio world object",
            "stable_id": "crate",
        },
    ]

    result = apply_blender_layout_change_set_with_summary(world_package, change_set)

    assert result.applied_change_count == 2
    assert result.review_only_count == 0
    assert result.world_package.world_snapshot.objects == []
    assert result.world_package.world_snapshot.cameras == []


def test_generated_blender_export_preserves_tagged_new_mesh_asset_ref(
    monkeypatch,
    tmp_path: Path,
) -> None:
    world_package, world_package_path, robot_urdf_path = _write_scene_inputs(tmp_path)
    scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map="identity",
        include_hidden=False,
    )
    artifacts = write_blender_workspace_artifacts(
        scene,
        artifact_dir=tmp_path / "artifacts",
        robot_urdf_path=robot_urdf_path,
        blend_path=tmp_path / "layout.blend",
    )
    fake_bpy = FakeBlenderModule()
    monkeypatch.setitem(sys.modules, "bpy", fake_bpy)

    runpy.run_path(str(artifacts.open_script_path), run_name="__main__")
    fake_bpy.ops.mesh.primitive_cube_add(size=1.0, location=(2.0, 3.0, 4.0))
    new_world_object = fake_bpy.context.object
    new_world_object.name = "New Mesh"
    new_world_object.scale = [0.4, 0.5, 0.6]
    new_world_object.color = (0.2, 0.4, 0.6, 1.0)
    new_world_object.rotation_quaternion = [1.0, 0.0, 0.0, 0.0]
    new_world_object["urdf_studio_asset_ref"] = "assets/new_mesh.obj"
    runpy.run_path(str(artifacts.export_script_path), run_name="__main__")

    change_set = json.loads(artifacts.change_set_path.read_text(encoding="utf-8"))
    imported = [
        entry
        for entry in change_set["review_only"]
        if entry["entity_type"] == "new_world_object"
    ]
    assert imported == [
        {
            "asset_ref": "assets/new_mesh.obj",
            "entity_type": "new_world_object",
            "position_xyz": [2.0, 3.0, 4.0],
            "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
            "reason": "new Blender mesh object will import as a Studio mesh world object",
            "rgba": [0.2, 0.4, 0.6, 1.0],
            "sim_name": "New Mesh",
            "size_xyz": [0.4, 0.5, 0.6],
        }
    ]

    result = apply_blender_layout_change_set_with_summary(world_package, change_set)
    added_object = result.world_package.world_snapshot.objects[1]
    assert added_object["id"] == "blender_new_mesh"
    assert added_object["type"] == "mesh"
    assert added_object["asset_ref"] == "assets/new_mesh.obj"
    assert added_object["position_xyz"] == [2.0, 3.0, 4.0]


def test_generated_blender_scripts_import_mesh_world_objects(monkeypatch, tmp_path: Path) -> None:
    urdf_xml = "<robot name=\"mesh_world\"><link name=\"base_link\"/></robot>"
    mesh_path = tmp_path / "assets" / "crate.obj"
    mesh_path.parent.mkdir(parents=True)
    mesh_path.write_text("o crate\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", encoding="utf-8")
    world_package = make_world_package(
        urdf_xml,
        objects=[
            {
                "id": "crate",
                "name": "Crate Mesh",
                "type": "mesh",
                "position_xyz": [0.1, 0.2, 0.3],
                "rotation_rpy_rad": [0.0, 0.0, 0.0],
                "size_xyz": [0.4, 0.5, 0.6],
                "color": "#22c55e",
                "asset_ref": "assets/crate.obj",
            }
        ],
    )
    world_package_path = tmp_path / "world-package.json"
    robot_urdf_path = tmp_path / "robot.urdf"
    write_world_package_file(world_package_path, world_package)
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")
    scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map="identity",
        include_hidden=False,
    )
    artifacts = write_blender_workspace_artifacts(
        scene,
        artifact_dir=tmp_path / "artifacts",
        robot_urdf_path=robot_urdf_path,
        blend_path=tmp_path / "layout.blend",
    )
    edit_session = json.loads(artifacts.edit_session_path.read_text(encoding="utf-8"))
    assert edit_session["objects"][0]["asset_path"] == str(mesh_path)

    fake_bpy = FakeBlenderModule()
    monkeypatch.setitem(sys.modules, "bpy", fake_bpy)
    runpy.run_path(str(artifacts.open_script_path), run_name="__main__")

    world_roots = [
        obj for obj in fake_bpy.data.objects if obj.get("urdf_studio_kind") == "world_object"
    ]
    mesh_children = [
        obj
        for obj in fake_bpy.data.objects
        if obj.get("urdf_studio_kind") == "world_object_mesh_child"
    ]
    assert len(world_roots) == 1
    assert len(mesh_children) == 1
    assert world_roots[0].type == "EMPTY"
    assert world_roots[0]["urdf_studio_asset_path"] == str(mesh_path)
    assert world_roots[0].scale == [0.4, 0.5, 0.6]
    assert mesh_children[0].parent is world_roots[0]
    assert mesh_children[0]["fake_import_path"] == str(mesh_path)

    world_roots[0].location = [1.0, 2.0, 3.0]
    world_roots[0].scale = [0.7, 0.8, 0.9]
    runpy.run_path(str(artifacts.export_script_path), run_name="__main__")

    change_set = json.loads(artifacts.change_set_path.read_text(encoding="utf-8"))
    assert change_set["changes"] == [
        {
            "entity_type": "world_object",
            "position_xyz": [1.0, 2.0, 3.0],
            "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
            "rgba": [0.13333333333333333, 0.7725490196078432, 0.3686274509803922, 1.0],
            "sim_name": "wl_crate",
            "size_xyz": [0.7, 0.8, 0.9],
            "stable_id": "crate",
        }
    ]
    assert change_set["review_only"] == []


def test_blender_workspace_rejects_unresolved_mesh_asset(tmp_path: Path) -> None:
    urdf_xml = "<robot name=\"mesh_world\"><link name=\"base_link\"/></robot>"
    world_package = make_world_package(
        urdf_xml,
        objects=[
            {
                "id": "crate",
                "name": "Crate Mesh",
                "type": "mesh",
                "position_xyz": [0.1, 0.2, 0.3],
                "rotation_rpy_rad": [0.0, 0.0, 0.0],
                "size_xyz": [0.4, 0.5, 0.6],
                "color": "#22c55e",
                "asset_ref": "assets/missing.obj",
            }
        ],
    )
    world_package_path = tmp_path / "world-package.json"
    robot_urdf_path = tmp_path / "robot.urdf"
    write_world_package_file(world_package_path, world_package)
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")
    scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map="identity",
        include_hidden=False,
    )

    with pytest.raises(ValueError, match="Blender mesh object 'crate' asset_ref does not resolve"):
        write_blender_workspace_artifacts(
            scene,
            artifact_dir=tmp_path / "artifacts",
            robot_urdf_path=robot_urdf_path,
            blend_path=tmp_path / "layout.blend",
        )


def test_generated_blender_script_rejects_mesh_import_fallback(
    monkeypatch,
    tmp_path: Path,
) -> None:
    urdf_xml = "<robot name=\"mesh_world\"><link name=\"base_link\"/></robot>"
    mesh_path = tmp_path / "assets" / "crate.obj"
    mesh_path.parent.mkdir(parents=True)
    mesh_path.write_text("o crate\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", encoding="utf-8")
    world_package = make_world_package(
        urdf_xml,
        objects=[
            {
                "id": "crate",
                "name": "Crate Mesh",
                "type": "mesh",
                "position_xyz": [0.1, 0.2, 0.3],
                "rotation_rpy_rad": [0.0, 0.0, 0.0],
                "size_xyz": [0.4, 0.5, 0.6],
                "color": "#22c55e",
                "asset_ref": "assets/crate.obj",
            }
        ],
    )
    world_package_path = tmp_path / "world-package.json"
    robot_urdf_path = tmp_path / "robot.urdf"
    write_world_package_file(world_package_path, world_package)
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")
    scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map="identity",
        include_hidden=False,
    )
    artifacts = write_blender_workspace_artifacts(
        scene,
        artifact_dir=tmp_path / "artifacts",
        robot_urdf_path=robot_urdf_path,
        blend_path=tmp_path / "layout.blend",
    )
    edit_session = json.loads(artifacts.edit_session_path.read_text(encoding="utf-8"))
    edit_session["objects"][0]["asset_path"] = str(tmp_path / "assets" / "deleted.obj")
    artifacts.edit_session_path.write_text(
        f"{json.dumps(edit_session, indent=2, sort_keys=True)}\n",
        encoding="utf-8",
    )

    fake_bpy = FakeBlenderModule()
    monkeypatch.setitem(sys.modules, "bpy", fake_bpy)

    with pytest.raises(RuntimeError, match="Blender mesh object failed to import"):
        runpy.run_path(str(artifacts.open_script_path), run_name="__main__")

    assert not [
        obj for obj in fake_bpy.data.objects if obj.get("urdf_studio_kind") == "world_object"
    ]


class _FakeBlenderProcess:
    def __init__(self, lines: list[str], returncode: int = 0):
        self.stdout = iter(lines)
        self.returncode = returncode
        self.terminated = False

    def poll(self) -> int | None:
        return None

    def wait(self) -> int:
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True


def test_blender_workspace_runner_reports_ready_after_edit_session_load(
    monkeypatch, capsys, tmp_path: Path
) -> None:
    captured_commands: list[list[str]] = []
    blend_path = tmp_path / "layout.blend"
    blend_path.write_text("fake blend", encoding="utf-8")

    def fake_popen(command, **kwargs):
        captured_commands.append(command)
        if len(captured_commands) == 1:
            return _FakeBlenderProcess(
                [
                    "Blender booting\n",
                    f"{blender_prepare.BLENDER_EDIT_SESSION_LOADED_MARKER} /tmp/session.json\n",
                    "[urdf-studio-blender] blend written: /tmp/layout.blend\n",
                ]
            )
        return _FakeBlenderProcess(
            [
                "Blender GUI running\n",
            ]
        )

    monkeypatch.setattr(blender_prepare.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(blender_prepare.time, "sleep", lambda _seconds: None)

    blender_prepare._run_blender_workspace_until_ready(
        blender_executable="/usr/bin/blender",
        open_script_path=tmp_path / "open_blender_scene.py",
        blend_path=blend_path,
        cwd=tmp_path,
    )

    output = capsys.readouterr().out
    assert captured_commands == [
        [
            "/usr/bin/blender",
            "--background",
            "--python-exit-code",
            "1",
            "--python",
            str(tmp_path / "open_blender_scene.py"),
        ],
        [
            "/usr/bin/blender",
            "--window-geometry",
            "80",
            "80",
            "1440",
            "900",
            str(blend_path),
        ],
    ]
    assert blender_prepare.BLENDER_EDIT_SESSION_LOADED_MARKER in output
    assert BLENDER_WORKSPACE_PROCESS_PARAMS.ready_log_marker in output
    assert output.index(blender_prepare.BLENDER_EDIT_SESSION_LOADED_MARKER) < output.index(
        BLENDER_WORKSPACE_PROCESS_PARAMS.ready_log_marker
    )


def test_blender_workspace_runner_requires_saved_blend_for_interactive_launch(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        blender_prepare.subprocess,
        "Popen",
        lambda _command, **_kwargs: _FakeBlenderProcess(
            [
                f"{blender_prepare.BLENDER_EDIT_SESSION_LOADED_MARKER} /tmp/session.json\n",
            ]
        ),
    )

    with pytest.raises(RuntimeError, match="workspace \\.blend was not created"):
        blender_prepare._run_blender_workspace_until_ready(
            blender_executable="/usr/bin/blender",
            open_script_path=tmp_path / "open_blender_scene.py",
            blend_path=tmp_path / "missing.blend",
            cwd=tmp_path,
        )


def test_blender_workspace_runner_rejects_interactive_launch_without_blend_path(
    tmp_path: Path,
) -> None:
    with pytest.raises(RuntimeError, match="requires a saved \\.blend path"):
        blender_prepare._run_blender_workspace_until_ready(
            blender_executable="/usr/bin/blender",
            open_script_path=tmp_path / "open_blender_scene.py",
            cwd=tmp_path,
        )


def test_blender_workspace_runner_builds_with_background_before_gui(
    monkeypatch, tmp_path: Path
) -> None:
    captured_commands: list[list[str]] = []
    blend_path = tmp_path / "layout.blend"
    blend_path.write_text("fake blend", encoding="utf-8")

    def fake_popen(command, **kwargs):
        captured_commands.append(command)
        if len(captured_commands) == 1:
            return _FakeBlenderProcess(
                [
                    f"{blender_prepare.BLENDER_EDIT_SESSION_LOADED_MARKER} /tmp/session.json\n",
                ]
            )
        return _FakeBlenderProcess(["Blender GUI running\n"])

    monkeypatch.setattr(blender_prepare.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(blender_prepare.time, "sleep", lambda _seconds: None)

    blender_prepare._run_blender_workspace_until_ready(
        blender_executable="/usr/bin/blender",
        open_script_path=tmp_path / "open_blender_scene.py",
        blend_path=blend_path,
        cwd=tmp_path,
    )

    assert captured_commands[0] == [
        "/usr/bin/blender",
        "--background",
        "--python-exit-code",
        "1",
        "--python",
        str(tmp_path / "open_blender_scene.py"),
    ]
    assert captured_commands[1][-1] == str(blend_path)


def test_blender_workspace_runner_rejects_exit_before_edit_session_load(
    monkeypatch, capsys, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        blender_prepare.subprocess,
        "Popen",
        lambda _command, **_kwargs: _FakeBlenderProcess(["Blender booting\n"], returncode=0),
    )

    with pytest.raises(RuntimeError, match="before loading the URDF Studio edit session"):
        blender_prepare._run_blender_workspace_until_ready(
            blender_executable="/usr/bin/blender",
            open_script_path=tmp_path / "open_blender_scene.py",
            cwd=tmp_path,
            background=True,
        )

    assert BLENDER_WORKSPACE_PROCESS_PARAMS.ready_log_marker not in capsys.readouterr().out


def test_blender_workspace_runner_uses_background_flag_for_headless_load(
    monkeypatch, tmp_path: Path
) -> None:
    captured: dict[str, object] = {}

    def fake_popen(command, **kwargs):
        captured["command"] = command
        return _FakeBlenderProcess(
            [
                f"{blender_prepare.BLENDER_EDIT_SESSION_LOADED_MARKER} /tmp/session.json\n",
            ]
        )

    monkeypatch.setattr(blender_prepare.subprocess, "Popen", fake_popen)

    blender_prepare._run_blender_workspace_until_ready(
        blender_executable="/usr/bin/blender",
        open_script_path=tmp_path / "open_blender_scene.py",
        cwd=tmp_path,
        background=True,
    )

    assert captured["command"] == [
        "/usr/bin/blender",
        "--background",
        "--python-exit-code",
        "1",
        "--python",
        str(tmp_path / "open_blender_scene.py"),
    ]


def test_blender_workspace_runner_prefers_x11_on_wsl_gui(
    monkeypatch, tmp_path: Path
) -> None:
    captured: list[dict[str, object]] = []
    blend_path = tmp_path / "layout.blend"
    blend_path.write_text("fake blend", encoding="utf-8")

    def fake_popen(command, **kwargs):
        captured.append({"command": command, "kwargs": kwargs})
        if len(captured) == 1:
            return _FakeBlenderProcess(
                [
                    f"{blender_prepare.BLENDER_EDIT_SESSION_LOADED_MARKER} /tmp/session.json\n",
                ]
            )
        return _FakeBlenderProcess(
            [
                "Blender GUI running\n",
            ]
        )

    monkeypatch.setenv("WAYLAND_DISPLAY", "wayland-0")
    monkeypatch.setattr(blender_prepare, "_is_wsl_environment", lambda: True)
    monkeypatch.setattr(blender_prepare.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(blender_prepare.time, "sleep", lambda _seconds: None)

    blender_prepare._run_blender_workspace_until_ready(
        blender_executable="/usr/bin/blender",
        open_script_path=tmp_path / "open_blender_scene.py",
        blend_path=blend_path,
        cwd=tmp_path,
    )

    env = captured[1]["kwargs"]["env"]
    assert env["GDK_BACKEND"] == "x11"
    assert env["QT_QPA_PLATFORM"] == "xcb"
    assert "WAYLAND_DISPLAY" not in env


def test_blender_runtime_status_reports_missing_executable(monkeypatch) -> None:
    monkeypatch.setattr(blender_adapter, "resolve_blender_executable", lambda: None)

    status = blender_adapter.BLENDER_SIMULATOR_ADAPTER.runtime_status()

    assert status.runtime_name == SIMULATOR_BLENDER_ID
    assert status.available is False
    assert status.dependencies[0].name == "blender"
    assert status.dependencies[0].available is False


def test_blender_runtime_resolves_configured_app_bundle(tmp_path: Path) -> None:
    app_binary = tmp_path / "Blender.app" / "Contents" / "MacOS" / "Blender"
    app_binary.parent.mkdir(parents=True)
    app_binary.write_text(
        "#!/bin/sh\nprintf 'blender python runtime ok\\n'\n",
        encoding="utf-8",
    )
    app_binary.chmod(0o755)

    assert resolve_blender_executable(str(tmp_path / "Blender.app")) == str(app_binary)


def test_blender_runtime_resolves_configured_install_directory(
    tmp_path: Path,
) -> None:
    executable_name = "blender.exe" if sys.platform == "win32" else "blender"
    executable_path = tmp_path / executable_name
    executable_path.write_text(
        "#!/bin/sh\nprintf 'blender python runtime ok\\n'\n",
        encoding="utf-8",
    )
    executable_path.chmod(0o755)

    assert resolve_blender_executable(str(tmp_path)) == str(executable_path)


def test_blender_runtime_rejects_windows_executable_on_posix(tmp_path: Path) -> None:
    if sys.platform == "win32":
        pytest.skip("Windows hosts can use blender.exe directly.")
    executable_path = tmp_path / "blender.exe"
    executable_path.write_text("#!/bin/sh\n", encoding="utf-8")
    executable_path.chmod(0o755)

    assert resolve_blender_executable(str(executable_path)) is None
    assert resolve_blender_executable(str(tmp_path)) is None


@pytest.mark.parametrize(
    ("windows_path", "wsl_path"),
    (
        (
            r"C:\Program Files\Blender Foundation\Blender 4.3\blender.exe",
            "/mnt/c/Program Files/Blender Foundation/Blender 4.3/blender.exe",
        ),
        (
            "D:/Tools/Blender/blender.exe",
            "/mnt/d/Tools/Blender/blender.exe",
        ),
    ),
)
def test_blender_runtime_normalizes_windows_drive_paths_for_wsl(
    windows_path: str,
    wsl_path: str,
) -> None:
    assert _windows_drive_path_to_wsl_path(windows_path) == wsl_path
