from __future__ import annotations

import json
import sys

import pytest

from backend.models.simulator_runtime import (
    SIMULATOR_BLENDER_ID,
    SIMULATOR_GENESIS_ID,
    SIMULATOR_MJLAB_ID,
    SIMULATOR_PYBULLET_ID,
    SimulatorRuntimeDependency,
    SimulatorRuntimeStatus,
)
from backend.scripts.simulator_workspace_check import (
    MUJOCO_WORKSPACE_PROCESS_PARAMS,
    PreparedWorkspaceCommand,
    WorkspaceCheckResult,
    WorkspaceExpectations,
    WorkspaceTarget,
    WORKSPACE_SIMULATORS,
    _active_object_count,
    _check_target,
    _prepare_blender_command,
    _prepare_genesis_command,
    _prepare_mujoco_command,
    _prepare_pybullet_command,
    _report_has_camera_artifacts,
    _workspace_request_from_args,
    _validate_report_artifact,
    build_demo_workspace_request,
    build_workspace_request_from_files,
    main,
)
from backend.tests.simulator_adapter_test_utils import make_world_package


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
        "intrinsics": {
            "matrix": [
                [41.569219381653056, 0.0, 32.0],
                [0.0, 41.569219381653056, 24.0],
                [0.0, 0.0, 1.0],
            ]
        },
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


def test_workspace_request_from_files_loads_custom_package_assets(tmp_path) -> None:
    asset_root = tmp_path / "scene"
    mesh_path = asset_root / "assets" / "box.stl"
    robot_urdf_path = asset_root / "robot.urdf"
    mesh_path.parent.mkdir(parents=True)
    (asset_root / "__pycache__").mkdir()
    (asset_root / "__pycache__" / "local.pyc").write_bytes(b"cache")
    mesh_path.write_text("solid box\nendsolid box\n", encoding="utf-8")
    urdf_xml = """
<robot name="custom_robot">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="assets/box.stl"/>
      </geometry>
    </visual>
  </link>
</robot>
""".strip()
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")
    world_package = make_world_package(
        urdf_xml,
        objects=[
            {
                "id": "crate",
                "name": "Crate",
                "type": "cube",
                "position_xyz": [0.0, 0.0, 0.0],
                "rotation_rpy_rad": [0.0, 0.0, 0.0],
                "size_xyz": [0.1, 0.2, 0.3],
                "color": "#ff0000",
            }
        ],
    )
    world_package_path = tmp_path / "world-package.json"
    world_package_path.write_text(
        json.dumps(world_package.model_dump(mode="json")),
        encoding="utf-8",
    )

    request = build_workspace_request_from_files(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        asset_roots=(asset_root,),
    )

    assert request.world_package.package_id == "demo_world"
    assert request.urdf_asset_path == "robot.urdf"
    assert [asset.path for asset in request.mesh_assets] == ["assets/box.stl"]


def test_workspace_request_from_files_accepts_xacro_source_path(tmp_path) -> None:
    asset_root = tmp_path / "scene"
    robot_source_path = asset_root / "robot.urdf.xacro"
    asset_root.mkdir()
    urdf_xml = "<robot name=\"custom_robot\"><link name=\"base_link\"/></robot>"
    robot_source_path.write_text(urdf_xml, encoding="utf-8")
    world_package_path = tmp_path / "world-package.json"
    world_package_path.write_text(
        json.dumps(make_world_package(urdf_xml).model_dump(mode="json")),
        encoding="utf-8",
    )

    request = build_workspace_request_from_files(
        world_package_path=world_package_path,
        robot_urdf_path=robot_source_path,
        asset_roots=(asset_root,),
    )

    assert request.urdf_asset_path == "robot.urdf.xacro"


def test_workspace_request_from_args_rejects_partial_custom_inputs() -> None:
    args = type(
        "Args",
        (),
        {
            "world_package": "world-package.json",
            "robot_urdf": "",
            "asset_root": [],
        },
    )()

    with pytest.raises(SystemExit, match="--world-package and --robot-urdf"):
        _workspace_request_from_args(args)


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
    monkeypatch.setattr(
        "backend.scripts.simulator_workspace_check.resolve_blender_executable",
        lambda: None,
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
    assert "--camera-screenshot-dir" not in command.command
    assert "--report" in command.command
    assert command.expected_report_path == tmp_path / "artifacts" / "report.json"
    assert command.expected_simulator_id == SIMULATOR_BLENDER_ID
    assert command.expected_object_count == 3
    assert command.expected_camera_count == 3
    assert "edit_session=" in command.extra_expected_markers
    assert command.expected_image_dirs == ()
    assert command.expected_file_paths == (
        tmp_path / "artifacts" / "blender-edit-session.json",
        tmp_path / "artifacts" / "open_blender_scene.py",
        tmp_path / "artifacts" / "export_blender_changes.py",
        tmp_path / "artifacts" / "robot-reference.usda",
    )


def test_blender_workspace_check_requests_camera_artifacts_when_runtime_exists(
    monkeypatch, tmp_path
) -> None:
    request = build_demo_workspace_request()

    class _Prepared:
        workspace_dir = tmp_path
        world_package_path = tmp_path / "world-package.json"
        robot_urdf_path = tmp_path / "robot.urdf"

    monkeypatch.setattr(
        "backend.scripts.simulator_workspace_check.prepare_blender_workspace_package",
        lambda _request: _Prepared(),
    )
    monkeypatch.setattr(
        "backend.scripts.simulator_workspace_check.resolve_blender_executable",
        lambda: "/usr/bin/blender",
    )

    command = _prepare_blender_command(
        request,
        expectations=WorkspaceExpectations(object_count=3, camera_count=3, duration_sec=0.02),
    )

    assert "--blender" in command.command
    assert "/usr/bin/blender" in command.command
    assert "--camera-screenshot-dir" in command.command
    assert command.expected_image_dirs == ((tmp_path / "artifacts" / "cameras", 3),)
    assert "camera_screenshots=3" in command.extra_expected_markers


def test_workspace_parity_requires_camera_artifacts(tmp_path) -> None:
    report_path = tmp_path / "report.json"
    report_path.write_text(
        json.dumps(
            {
                "simulator": {"id": SIMULATOR_BLENDER_ID, "label": "Blender"},
                "artifacts": {},
            }
        ),
        encoding="utf-8",
    )

    assert _report_has_camera_artifacts(report_path) is False

    report_path.write_text(
        json.dumps(
            {
                "simulator": {"id": SIMULATOR_BLENDER_ID, "label": "Blender"},
                "artifacts": {"camera_screenshot_dir": str(tmp_path / "cameras")},
            }
        ),
        encoding="utf-8",
    )

    assert _report_has_camera_artifacts(report_path) is True


def test_blender_workspace_check_fails_missing_runtime_when_required(monkeypatch) -> None:
    called = False

    def prepare(_request, _expectations):
        nonlocal called
        called = True
        raise AssertionError("prepare should not run when runtime is required")

    monkeypatch.setattr(
        "backend.scripts.simulator_workspace_check.get_simulator_runtime_status",
        lambda _simulator_id: SimulatorRuntimeStatus(
            runtimeName=SIMULATOR_BLENDER_ID,
            available=False,
            status="missing blender",
            dependencies=[
                SimulatorRuntimeDependency(name="blender", available=False),
            ],
        ),
    )

    result = _check_target(
        WorkspaceTarget(
            simulator_id=SIMULATOR_BLENDER_ID,
            label="Blender",
            prepare=prepare,
            requires_runtime=False,
            include_in_parity=False,
        ),
        request=build_demo_workspace_request(),
        expectations=WorkspaceExpectations(object_count=3, camera_count=3, duration_sec=0.0),
        timeout_sec=1.0,
        require_runtime=True,
    )

    assert result.status == "failed"
    assert result.detail == "missing runtime dependency: blender"
    assert called is False


def test_blender_workspace_check_validates_artifacts_without_runtime(monkeypatch) -> None:
    def prepare(_request, _expectations):
        return PreparedWorkspaceCommand(
            command=[],
            ready_marker="ready",
            expected_object_marker="objects=3",
            expected_camera_log_marker="cameras=3",
            expected_simulator_id=SIMULATOR_BLENDER_ID,
        )

    monkeypatch.setattr(
        "backend.scripts.simulator_workspace_check.get_simulator_runtime_status",
        lambda _simulator_id: SimulatorRuntimeStatus(
            runtimeName=SIMULATOR_BLENDER_ID,
            available=False,
            status="missing blender",
            dependencies=[
                SimulatorRuntimeDependency(name="blender", available=False),
            ],
        ),
    )
    monkeypatch.setattr(
        "backend.scripts.simulator_workspace_check._run_workspace_command",
        lambda _command, *, timeout_sec: (True, "workspace artifacts ready"),
    )

    result = _check_target(
        WorkspaceTarget(
            simulator_id=SIMULATOR_BLENDER_ID,
            label="Blender",
            prepare=prepare,
            requires_runtime=False,
            include_in_parity=False,
        ),
        request=build_demo_workspace_request(),
        expectations=WorkspaceExpectations(object_count=3, camera_count=3, duration_sec=0.0),
        timeout_sec=1.0,
        require_runtime=False,
    )

    assert result.status == "passed"
    assert "missing runtime dependency: blender" in result.detail
    assert "validating transfer artifacts without opening runtime" in result.detail
    assert "workspace artifacts ready" in result.detail


def test_workspace_check_artifact_only_selected_target_does_not_require_runtime(
    monkeypatch, capsys
) -> None:
    captured: dict[str, bool] = {}

    def fake_check_target(
        target,
        *,
        request,
        expectations,
        timeout_sec,
        require_runtime,
    ):
        captured["require_runtime"] = require_runtime
        return WorkspaceCheckResult(target.simulator_id, target.label, "passed", "ok")

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "simulator_workspace_check.py",
            "--simulator",
            "blender",
            "--artifact-only",
            "--json",
        ],
    )
    monkeypatch.setattr(
        "backend.scripts.simulator_workspace_check._check_target",
        fake_check_target,
    )
    monkeypatch.setattr(
        "backend.scripts.simulator_workspace_check._check_cross_simulator_parity",
        lambda _results: None,
    )

    assert main() == 0
    assert captured == {"require_runtime": False}
    assert '"status": "passed"' in capsys.readouterr().out


def test_workspace_check_rejects_artifact_only_with_require_all(monkeypatch) -> None:
    monkeypatch.setattr(
        sys,
        "argv",
        ["simulator_workspace_check.py", "--artifact-only", "--require-all"],
    )

    with pytest.raises(SystemExit, match="--artifact-only cannot be combined with --require-all"):
        main()


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
        "sim_name, parent_link, position_xyz, quat_wxyz, width, height, fov_deg, intrinsics"
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


def test_workspace_report_validation_rejects_invalid_camera_intrinsics(tmp_path) -> None:
    report_path = tmp_path / "report.json"
    invalid_camera = _report_camera()
    invalid_camera["intrinsics"] = {
        "matrix": [
            [0.0, 0.0, 32.0],
            [0.0, 41.569219381653056, 24.0],
            [0.0, 0.0, 1.0],
        ]
    }
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
        "simulator validation report field 'cameras[0].intrinsics.matrix' "
        "must have positive focal lengths"
    )
