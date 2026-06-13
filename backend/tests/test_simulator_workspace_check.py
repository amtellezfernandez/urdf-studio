from __future__ import annotations

import json
import sys

from backend.models.simulator_runtime import (
    SIMULATOR_BLENDER_ID,
    SIMULATOR_GENESIS_ID,
    SIMULATOR_MJLAB_ID,
    SIMULATOR_PYBULLET_ID,
)
from backend.scripts.simulator_workspace_check import (
    MUJOCO_WORKSPACE_PROCESS_PARAMS,
    PreparedWorkspaceCommand,
    WORKSPACE_SIMULATORS,
    _active_object_count,
    _prepare_blender_command,
    _prepare_genesis_command,
    _prepare_mujoco_command,
    _prepare_pybullet_command,
    _validate_report_artifact,
    build_demo_workspace_request,
)


def _report_object(source_id: str = "crate") -> dict:
    return {
        "source_id": source_id,
        "sim_name": f"wl_{source_id}",
        "sim_type": "box",
        "position_xyz": [0.0, 0.0, 0.0],
        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
        "size_xyz": [0.1, 0.2, 0.3],
        "rgba": [1.0, 0.0, 0.0, 1.0],
    }


def _report_camera(camera_id: str = "cam") -> dict:
    return {
        "camera_id": camera_id,
        "sim_name": f"{camera_id}_camera",
        "parent_link": "base_link",
        "position_xyz": [0.0, 0.0, 1.0],
        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
        "width": 64,
        "height": 48,
        "fov_deg": 60.0,
    }


def test_demo_workspace_request_contains_robot_assets_objects_and_cameras() -> None:
    request = build_demo_workspace_request()

    assert request.urdf_asset_path == "robot.urdf"
    assert request.world_package.interface.frame_convention == "ros-rep-103"
    assert len(request.mesh_assets) > 0
    assert len(request.world_package.world_snapshot.objects) == 3
    assert len(request.world_package.world_snapshot.cameras) == 3
    assert [target.name for target in request.world_package.runtime_targets] == list(
        WORKSPACE_SIMULATORS
    )


def test_workspace_check_expected_object_count_ignores_hidden_objects() -> None:
    request = build_demo_workspace_request()
    request.world_package.world_snapshot.objects.append(
        {
            "id": "hidden-object",
            "name": "Hidden object",
            "type": "cube",
            "position_xyz": [0.0, 0.0, 0.0],
            "rotation_rpy_rad": [0.0, 0.0, 0.0],
            "size_xyz": [0.1, 0.1, 0.1],
            "color": "#ffffff",
            "is_hidden": True,
        }
    )

    assert _active_object_count(request) == 3


def test_genesis_workspace_check_requests_viewer_and_camera_artifacts(monkeypatch, tmp_path) -> None:
    request = build_demo_workspace_request()

    class _Prepared:
        workspace_dir = tmp_path
        world_package_path = tmp_path / "world-package.json"
        robot_urdf_path = tmp_path / "robot.urdf"

    monkeypatch.setattr(
        "backend.scripts.simulator_workspace_check.prepare_genesis_workspace",
        lambda _request: _Prepared(),
    )
    command = _prepare_genesis_command(
        request,
        expectations=type(
            "Expectations",
            (),
            {
                "object_count": 3,
                "camera_count": 3,
                "duration_sec": 0.02,
            },
        )(),
    )

    assert "--screenshot" in command.command
    assert "--camera-screenshot-dir" in command.command
    assert "--sensor-screenshot-dir" in command.command
    assert "--report" in command.command
    assert command.expected_report_path == tmp_path / "artifacts" / "report.json"
    assert command.expected_simulator_id == SIMULATOR_GENESIS_ID
    assert command.expected_object_count == 3
    assert command.expected_camera_count == 3
    assert "camera_screenshots=3" in command.extra_expected_markers
    assert "observation_cameras=3" in command.extra_expected_markers
    assert "sensor_reads=3" in command.extra_expected_markers
    assert "sensor_screenshots=3" in command.extra_expected_markers
    assert "merge_fixed_links=True" in command.extra_expected_markers


def test_pybullet_workspace_check_requests_camera_artifacts(monkeypatch, tmp_path) -> None:
    request = build_demo_workspace_request()

    class _Prepared:
        workspace_dir = tmp_path
        world_package_path = tmp_path / "world-package.json"
        robot_urdf_path = tmp_path / "robot.urdf"

    monkeypatch.setattr(
        "backend.scripts.simulator_workspace_check.prepare_pybullet_workspace",
        lambda _request: _Prepared(),
    )
    command = _prepare_pybullet_command(
        request,
        expectations=type(
            "Expectations",
            (),
            {
                "object_count": 3,
                "camera_count": 3,
                "duration_sec": 0.02,
            },
        )(),
    )

    assert "--camera-screenshot-dir" in command.command
    assert "--report" in command.command
    assert command.expected_report_path == tmp_path / "artifacts" / "report.json"
    assert command.expected_simulator_id == SIMULATOR_PYBULLET_ID
    assert command.expected_object_count == 3
    assert command.expected_camera_count == 3
    assert "camera_screenshots=3" in command.extra_expected_markers
    assert command.expected_image_dirs == ((tmp_path / "artifacts" / "cameras", 3),)


def test_mjlab_workspace_check_requests_validation_report(monkeypatch, tmp_path) -> None:
    request = build_demo_workspace_request()

    class _Shared:
        workspace_dir = tmp_path
        world_package_path = tmp_path / "world-package.json"
        robot_urdf_path = tmp_path / "robot.urdf"

    class _Prepared:
        shared_workspace = _Shared()
        mjcf_path = tmp_path / "robot.xml"

    monkeypatch.setattr(
        "backend.scripts.simulator_workspace_check.prepare_mujoco_workspace",
        lambda _request, *, simulator_id: _Prepared(),
    )
    command = _prepare_mujoco_command(
        request,
        expectations=type(
            "Expectations",
            (),
            {
                "object_count": 3,
                "camera_count": 3,
                "duration_sec": 0.02,
            },
        )(),
        simulator_id=SIMULATOR_MJLAB_ID,
    )

    assert command.command[:4] == [
        sys.executable,
        "-u",
        "-m",
        MUJOCO_WORKSPACE_PROCESS_PARAMS.module_name,
    ]
    assert "--simulator-id" in command.command
    assert SIMULATOR_MJLAB_ID in command.command
    assert "--camera-screenshot-dir" in command.command
    assert "--report" in command.command
    assert command.expected_report_path == tmp_path / "artifacts" / "report.json"
    assert command.expected_simulator_id == SIMULATOR_MJLAB_ID
    assert command.expected_object_count == 3
    assert command.expected_camera_count == 3
    assert "camera_screenshots=3" in command.extra_expected_markers
    assert command.expected_image_dirs == ((tmp_path / "artifacts" / "cameras", 3),)


def test_blender_workspace_check_requests_edit_session_artifacts(monkeypatch, tmp_path) -> None:
    request = build_demo_workspace_request()

    class _Prepared:
        workspace_dir = tmp_path
        world_package_path = tmp_path / "world-package.json"
        robot_urdf_path = tmp_path / "robot.urdf"

    monkeypatch.setattr(
        "backend.scripts.simulator_workspace_check.prepare_blender_workspace_package",
        lambda _request: _Prepared(),
    )
    command = _prepare_blender_command(
        request,
        expectations=type(
            "Expectations",
            (),
            {
                "object_count": 3,
                "camera_count": 3,
                "duration_sec": 0.02,
            },
        )(),
    )

    assert "--no-viewer" in command.command
    assert "--report" in command.command
    assert command.expected_report_path == tmp_path / "artifacts" / "report.json"
    assert command.expected_simulator_id == SIMULATOR_BLENDER_ID
    assert command.expected_object_count == 3
    assert command.expected_camera_count == 3
    assert "edit_session=" in command.extra_expected_markers
    assert command.expected_file_paths == (
        tmp_path / "artifacts" / "blender-edit-session.json",
        tmp_path / "artifacts" / "open_blender_scene.py",
        tmp_path / "artifacts" / "export_blender_changes.py",
        tmp_path / "artifacts" / "robot-reference.glb",
        tmp_path / "artifacts" / "robot-reference.usda",
    )


def test_workspace_report_validation_accepts_matching_report(tmp_path) -> None:
    report_path = tmp_path / "report.json"
    report_path.write_text(
        json.dumps(
            {
                "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
                "package_id": "demo",
                "frame_map": "identity",
                "primitive_count": 2,
                "camera_count": 1,
                "objects": [_report_object("crate-a"), _report_object("crate-b")],
                "cameras": [_report_camera()],
                "artifacts": {},
            }
        ),
        encoding="utf-8",
    )
    command = PreparedWorkspaceCommand(
        command=[],
        ready_marker="ready",
        expected_object_marker="objects=2",
        expected_camera_log_marker="cameras=1",
        expected_report_path=report_path,
        expected_simulator_id=SIMULATOR_GENESIS_ID,
        expected_object_count=2,
        expected_camera_count=1,
    )

    assert _validate_report_artifact(command) is None


def test_workspace_report_validation_rejects_wrong_counts(tmp_path) -> None:
    report_path = tmp_path / "report.json"
    report_path.write_text(
        json.dumps(
            {
                "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
                "package_id": "demo",
                "frame_map": "identity",
                "primitive_count": 1,
                "camera_count": 1,
                "objects": [_report_object()],
                "cameras": [_report_camera()],
                "artifacts": {},
            }
        ),
        encoding="utf-8",
    )
    command = PreparedWorkspaceCommand(
        command=[],
        ready_marker="ready",
        expected_object_marker="objects=2",
        expected_camera_log_marker="cameras=1",
        expected_report_path=report_path,
        expected_simulator_id=SIMULATOR_GENESIS_ID,
        expected_object_count=2,
        expected_camera_count=1,
    )

    assert _validate_report_artifact(command) == (
        "simulator validation report has primitive_count=1, expected 2"
    )


def test_workspace_report_validation_rejects_missing_object_fields(tmp_path) -> None:
    report_path = tmp_path / "report.json"
    report_path.write_text(
        json.dumps(
            {
                "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
                "package_id": "demo",
                "frame_map": "identity",
                "primitive_count": 1,
                "camera_count": 1,
                "objects": [{"source_id": "crate"}],
                "cameras": [_report_camera()],
                "artifacts": {},
            }
        ),
        encoding="utf-8",
    )
    command = PreparedWorkspaceCommand(
        command=[],
        ready_marker="ready",
        expected_object_marker="objects=1",
        expected_camera_log_marker="cameras=1",
        expected_report_path=report_path,
        expected_simulator_id=SIMULATOR_GENESIS_ID,
        expected_object_count=1,
        expected_camera_count=1,
    )

    assert _validate_report_artifact(command) == (
        "simulator validation report field 'objects[0]' missing field(s): "
        "sim_name, sim_type, position_xyz, quat_wxyz, size_xyz, rgba"
    )


def test_workspace_report_validation_rejects_missing_camera_fields(tmp_path) -> None:
    report_path = tmp_path / "report.json"
    report_path.write_text(
        json.dumps(
            {
                "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
                "package_id": "demo",
                "frame_map": "identity",
                "primitive_count": 1,
                "camera_count": 1,
                "objects": [_report_object()],
                "cameras": [{"camera_id": "cam"}],
                "artifacts": {},
            }
        ),
        encoding="utf-8",
    )
    command = PreparedWorkspaceCommand(
        command=[],
        ready_marker="ready",
        expected_object_marker="objects=1",
        expected_camera_log_marker="cameras=1",
        expected_report_path=report_path,
        expected_simulator_id=SIMULATOR_GENESIS_ID,
        expected_object_count=1,
        expected_camera_count=1,
    )

    assert _validate_report_artifact(command) == (
        "simulator validation report field 'cameras[0]' missing field(s): "
        "sim_name, parent_link, position_xyz, quat_wxyz, width, height, fov_deg"
    )


def test_workspace_report_validation_rejects_invalid_object_values(tmp_path) -> None:
    report_path = tmp_path / "report.json"
    invalid_object = _report_object()
    invalid_object["size_xyz"] = [0.1, -0.2, 0.3]
    report_path.write_text(
        json.dumps(
            {
                "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
                "package_id": "demo",
                "frame_map": "identity",
                "primitive_count": 1,
                "camera_count": 1,
                "objects": [invalid_object],
                "cameras": [_report_camera()],
                "artifacts": {},
            }
        ),
        encoding="utf-8",
    )
    command = PreparedWorkspaceCommand(
        command=[],
        ready_marker="ready",
        expected_object_marker="objects=1",
        expected_camera_log_marker="cameras=1",
        expected_report_path=report_path,
        expected_simulator_id=SIMULATOR_GENESIS_ID,
        expected_object_count=1,
        expected_camera_count=1,
    )

    assert _validate_report_artifact(command) == (
        "simulator validation report field 'objects[0].size_xyz' must contain positive numbers"
    )


def test_workspace_report_validation_rejects_invalid_camera_values(tmp_path) -> None:
    report_path = tmp_path / "report.json"
    invalid_camera = _report_camera()
    invalid_camera["width"] = 0
    report_path.write_text(
        json.dumps(
            {
                "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
                "package_id": "demo",
                "frame_map": "identity",
                "primitive_count": 1,
                "camera_count": 1,
                "objects": [_report_object()],
                "cameras": [invalid_camera],
                "artifacts": {},
            }
        ),
        encoding="utf-8",
    )
    command = PreparedWorkspaceCommand(
        command=[],
        ready_marker="ready",
        expected_object_marker="objects=1",
        expected_camera_log_marker="cameras=1",
        expected_report_path=report_path,
        expected_simulator_id=SIMULATOR_GENESIS_ID,
        expected_object_count=1,
        expected_camera_count=1,
    )

    assert _validate_report_artifact(command) == (
        "simulator validation report field 'cameras[0].width' must be a positive integer"
    )
