from __future__ import annotations

import json
import math
from pathlib import Path

from backend.models.simulator_runtime import SIMULATOR_BLENDER_ID
from backend.scripts.blender_workspace_prepare import prepare_blender_workspace_scene
from backend.services.simulator_adapters import blender as blender_adapter
from backend.services.simulator_adapters.blender_workspace import (
    BLENDER_CHANGE_SET_SCHEMA,
    BLENDER_EDIT_SESSION_SCHEMA,
    apply_blender_layout_change_set,
    write_blender_workspace_artifacts,
)
from backend.services.simulator_adapters.world_scene import prepare_simulator_scene
from backend.tests.simulator_adapter_test_utils import make_world_package


def _write_scene_inputs(tmp_path: Path):
    urdf_xml = """
<robot name="blender_demo">
  <link name="base_link"/>
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
    world_package_path.write_text(
        json.dumps(world_package.model_dump(mode="json")),
        encoding="utf-8",
    )
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")
    return world_package, world_package_path, robot_urdf_path


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
    )
    edit_session = json.loads(artifacts.edit_session_path.read_text(encoding="utf-8"))

    assert edit_session["schema"] == BLENDER_EDIT_SESSION_SCHEMA
    assert edit_session["robot"]["locked"] is True
    assert edit_session["objects"][0]["stable_id"] == "crate"
    assert edit_session["cameras"][0]["stable_id"] == "cam-1"
    assert "robot.kinematics" in edit_session["round_trip"]["locked"]
    assert artifacts.open_script_path.exists()
    assert artifacts.export_script_path.exists()


def test_blender_change_set_applies_world_object_layout_only(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = {
        "schema": BLENDER_CHANGE_SET_SCHEMA,
        "changes": [
            {
                "entity_type": "world_object",
                "stable_id": "crate",
                "position_xyz": [1.0, 2.0, 3.0],
                "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                "size_xyz": [0.5, 0.6, 0.7],
            },
            {
                "entity_type": "camera",
                "stable_id": "cam-1",
                "position_xyz": [9.0, 9.0, 9.0],
                "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
            },
        ],
        "review_only": [],
    }

    updated = apply_blender_layout_change_set(world_package, change_set)
    updated_object = updated.world_snapshot.objects[0]

    assert updated_object["position_xyz"] == [1.0, 2.0, 3.0]
    assert updated_object["size_xyz"] == [0.5, 0.6, 0.7]
    assert all(math.isclose(value, 0.0, abs_tol=1e-9) for value in updated_object["rotation_rpy_rad"])
    assert updated.world_snapshot.cameras == world_package.world_snapshot.cameras


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
    )
    report = json.loads(report_path.read_text(encoding="utf-8"))

    assert report["simulator"]["id"] == SIMULATOR_BLENDER_ID
    assert report["primitive_count"] == 1
    assert report["camera_count"] == 1
    assert Path(report["artifacts"]["edit_session_path"]).exists()
    assert Path(report["artifacts"]["open_script_path"]).exists()
    assert Path(report["artifacts"]["export_script_path"]).exists()


def test_blender_runtime_status_reports_missing_executable(monkeypatch) -> None:
    monkeypatch.setattr(blender_adapter, "resolve_blender_executable", lambda: None)

    status = blender_adapter.BLENDER_SIMULATOR_ADAPTER.runtime_status()

    assert status.runtime_name == SIMULATOR_BLENDER_ID
    assert status.available is False
    assert status.dependencies[0].name == "blender"
    assert status.dependencies[0].available is False
