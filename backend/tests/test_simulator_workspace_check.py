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
    _active_object_count,
    _check_target,
    _expected_object_vectors_for_request,
    _module_command,
    _prepare_blender_command,
    _prepare_genesis_command,
    _prepare_mujoco_command,
    _prepare_pybullet_command,
    _print_human_results,
    _report_has_camera_artifacts,
    _resolved_frame_map_for_request,
    _selected_simulator_ids_from_args,
    _validate_file_artifacts,
    _workspace_request_from_args,
    main,
)
from backend.services.simulator_adapters.workspace_request_sources import (
    build_demo_workspace_request,
    build_studio_y_up_axis_workspace_request,
)


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


def test_workspace_check_selected_simulator_ids_accepts_positional_target() -> None:
    args = type(
        "Args",
        (),
        {
            "simulator": None,
            "simulator_targets": [SIMULATOR_BLENDER_ID],
        },
    )()

    assert _selected_simulator_ids_from_args(args) == (SIMULATOR_BLENDER_ID,)


def test_workspace_check_selected_simulator_ids_deduplicates_flag_and_positional() -> None:
    args = type(
        "Args",
        (),
        {
            "simulator": [SIMULATOR_BLENDER_ID, SIMULATOR_GENESIS_ID],
            "simulator_targets": [SIMULATOR_BLENDER_ID],
        },
    )()

    assert _selected_simulator_ids_from_args(args) == (
        SIMULATOR_BLENDER_ID,
        SIMULATOR_GENESIS_ID,
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


def test_workspace_check_resolves_auto_frame_map_from_world_convention() -> None:
    request = build_studio_y_up_axis_workspace_request()

    assert _resolved_frame_map_for_request(request, "auto") == "studio-y-up-to-z-up"


def test_workspace_check_expected_object_vectors_follow_auto_frame_map() -> None:
    request = build_studio_y_up_axis_workspace_request()

    positions, sizes = _expected_object_vectors_for_request(request, "auto")

    assert positions == {"axis-box": (1.0, -3.0, 2.0)}
    assert sizes == {"axis-box": (0.2, 0.8, 0.4)}


def test_workspace_check_fixture_selects_studio_y_up_axis_request() -> None:
    args = type(
        "Args",
        (),
        {
            "fixture": "studio-y-up-axis",
            "world_package": "",
            "robot_urdf": "",
            "asset_root": [],
        },
    )()

    request = _workspace_request_from_args(args)

    assert request.world_package.package_id == "studio-y-up-axis-workspace-check"
    assert request.world_package.interface.frame_convention == "studio-y-up"
    assert request.world_package.world_snapshot.cameras == []
    assert [item["id"] for item in request.world_package.world_snapshot.objects] == [
        "axis-box"
    ]


def test_workspace_check_rejects_fixture_with_custom_world_package() -> None:
    args = type(
        "Args",
        (),
        {
            "fixture": "studio-y-up-axis",
            "world_package": "world-package.json",
            "robot_urdf": "robot.urdf",
            "asset_root": [],
        },
    )()

    with pytest.raises(SystemExit, match="--fixture cannot be combined"):
        _workspace_request_from_args(args)


def test_workspace_check_module_command_writes_report_argument_once(tmp_path) -> None:
    command = _module_command(
        MUJOCO_WORKSPACE_PROCESS_PARAMS,
        world_package_path=tmp_path / "world-package.json",
        robot_asset_flag="--robot-urdf",
        robot_asset_path=tmp_path / "robot.urdf",
        duration_sec=0.02,
        report_path=tmp_path / "report.json",
    )

    assert command.count("--report") == 1
    assert command[command.index("--report") + 1] == str(tmp_path / "report.json")
    assert command[command.index("--frame-map") + 1] == "auto"


def test_workspace_check_module_command_accepts_explicit_frame_map(tmp_path) -> None:
    command = _module_command(
        MUJOCO_WORKSPACE_PROCESS_PARAMS,
        world_package_path=tmp_path / "world-package.json",
        robot_asset_flag="--robot-urdf",
        robot_asset_path=tmp_path / "robot.urdf",
        duration_sec=0.02,
        frame_map="identity",
    )

    assert command[command.index("--frame-map") + 1] == "identity"


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
    assert command.expected_requested_frame_map == "auto"
    assert command.expected_frame_map is None
    assert "camera_screenshots=3" in command.extra_expected_markers
    assert "observation_cameras=3" in command.extra_expected_markers
    assert "sensor_reads=3" in command.extra_expected_markers
    assert "sensor_screenshots=3" in command.extra_expected_markers
    assert "merge_fixed_links=True" in command.extra_expected_markers
    assert command.expected_report_artifact_file_keys == ("viewer_screenshot",)
    assert command.expected_report_artifact_dir_keys == (
        "camera_screenshot_dir",
        "sensor_screenshot_dir",
    )


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
    assert command.expected_report_artifact_file_keys == ()
    assert command.expected_report_artifact_dir_keys == ("camera_screenshot_dir",)


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
    assert command.expected_report_artifact_file_keys == ("mjcf_path",)
    assert command.expected_report_artifact_dir_keys == ("camera_screenshot_dir",)


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
    assert command.expected_file_validators[0][0] == (
        tmp_path / "artifacts" / "blender-edit-session.json"
    )
    assert command.expected_file_paths == (
        tmp_path / "artifacts" / "open_blender_scene.py",
        tmp_path / "artifacts" / "export_blender_changes.py",
        tmp_path / "artifacts" / "robot-reference.usda",
    )
    assert command.expected_report_artifact_file_keys == (
        "edit_session_path",
        "open_script_path",
        "export_script_path",
        "robot_usd_path",
    )
    assert command.expected_report_artifact_dir_keys == ()


def test_workspace_check_runs_configured_file_validators(tmp_path) -> None:
    edit_session_path = tmp_path / "blender-edit-session.json"
    edit_session_path.write_text('{"schema": "bad"}\n', encoding="utf-8")

    command = PreparedWorkspaceCommand(
        command=[],
        ready_marker="ready",
        expected_object_marker="objects=0",
        expected_camera_log_marker="cameras=0",
        expected_file_validators=(
            (
                edit_session_path,
                lambda path: "invalid edit session" if path.read_text(encoding="utf-8") else None,
            ),
        ),
    )

    assert _validate_file_artifacts(command) == "invalid edit session"


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
        expectations=WorkspaceExpectations(
            object_count=3,
            camera_count=3,
            duration_sec=0.02,
            frame_map="auto",
            resolved_frame_map="studio-y-up-to-z-up",
        ),
    )

    assert "--blender" in command.command
    assert "/usr/bin/blender" in command.command
    assert "--camera-screenshot-dir" in command.command
    assert command.expected_requested_frame_map == "auto"
    assert command.expected_frame_map == "studio-y-up-to-z-up"
    assert command.expected_image_dirs == ((tmp_path / "artifacts" / "cameras", 3),)
    assert command.expected_file_validators[0][0] == (
        tmp_path / "artifacts" / "blender-edit-session.json"
    )
    assert command.expected_file_validators[1][0] == (
        tmp_path / "blender" / "urdf-studio-layout.blend"
    )
    assert "camera_screenshots=3" in command.extra_expected_markers
    assert command.expected_report_artifact_file_keys == (
        "edit_session_path",
        "open_script_path",
        "export_script_path",
        "robot_usd_path",
        "blend_path",
    )
    assert command.expected_report_artifact_dir_keys == ("camera_screenshot_dir",)


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

    assert result.status == "artifact-only"
    assert "missing runtime dependency: blender" in result.detail
    assert "validating transfer artifacts without opening runtime" in result.detail
    assert "workspace artifacts ready" in result.detail


def test_workspace_check_prints_artifact_only_status(capsys) -> None:
    _print_human_results(
        (
            WorkspaceCheckResult(
                SIMULATOR_BLENDER_ID,
                "Blender",
                "artifact-only",
                "missing runtime dependency: blender; validating transfer artifacts without opening runtime\nworkspace artifacts ready",
            ),
        )
    )

    assert capsys.readouterr().out == (
        "[simulator-workspaces-check] Blender: artifact-only "
        "(missing runtime dependency: blender; validating transfer artifacts without opening runtime)\n"
    )


def test_workspace_check_artifact_only_selected_target_does_not_require_runtime(
    monkeypatch, capsys
) -> None:
    captured: dict[str, object] = {}

    def fake_check_target(
        target,
        *,
        request,
        expectations,
        timeout_sec,
        require_runtime,
    ):
        captured["require_runtime"] = require_runtime
        captured["frame_map"] = expectations.frame_map
        return WorkspaceCheckResult(target.simulator_id, target.label, "passed", "ok")

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "simulator_workspace_check.py",
            "--simulator",
            "blender",
            "--artifact-only",
            "--frame-map",
            "studio-y-up-to-z-up",
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
    assert captured == {
        "require_runtime": False,
        "frame_map": "studio-y-up-to-z-up",
    }
    assert '"status": "passed"' in capsys.readouterr().out


def test_workspace_check_defaults_to_auto_frame_map(monkeypatch, capsys) -> None:
    captured: dict[str, object] = {}

    def fake_check_target(
        target,
        *,
        request,
        expectations,
        timeout_sec,
        require_runtime,
    ):
        captured["frame_map"] = expectations.frame_map
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
    assert captured == {"frame_map": "auto"}
    assert '"status": "passed"' in capsys.readouterr().out


def test_workspace_check_rejects_artifact_only_with_require_all(monkeypatch) -> None:
    monkeypatch.setattr(
        sys,
        "argv",
        ["simulator_workspace_check.py", "--artifact-only", "--require-all"],
    )

    with pytest.raises(SystemExit, match="--artifact-only cannot be combined with --require-all"):
        main()
