from __future__ import annotations

import json
import sys

import pytest

from backend.core.paths import BASE_DIR
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
    WorkspaceTarget,
    _check_target,
    _module_command,
    _prepare_blender_command,
    _prepare_genesis_command,
    _prepare_mujoco_command,
    _prepare_pybullet_command,
    _print_human_results,
    _report_has_camera_artifacts,
    _selected_simulator_ids_from_args,
    _validate_file_artifacts,
    _workspace_request_from_args,
    main,
)
from backend.services.simulator_adapters.workspace_expectations import (
    WorkspaceExpectations,
    active_object_count,
    expected_camera_contracts_for_request,
    expected_camera_ids_for_request,
    expected_object_contracts_for_request,
    resolved_frame_map_for_request,
)
from backend.services.simulator_adapters.workspace_image_artifacts import (
    WorkspaceImageArtifactExpectations,
    validate_workspace_image_artifacts,
)
from backend.services.simulator_adapters.workspace_report_validation import ExpectedCameraReport
from backend.services.simulator_adapters.workspace_request_sources import (
    WORKSPACE_FIXTURES,
    build_demo_workspace_request,
    build_studio_y_up_axis_workspace_request,
    build_xacro_source_workspace_request,
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

    assert active_object_count(request) == 3


def test_workspace_check_resolves_auto_frame_map_from_world_convention() -> None:
    request = build_studio_y_up_axis_workspace_request()

    assert resolved_frame_map_for_request(request, "auto") == "studio-y-up-to-z-up"


def test_workspace_check_expected_object_vectors_follow_auto_frame_map() -> None:
    request = build_studio_y_up_axis_workspace_request()

    object_contracts = expected_object_contracts_for_request(
        request,
        "auto",
    )

    assert object_contracts.positions_xyz == {"axis-box": (1.0, -3.0, 2.0)}
    assert object_contracts.sizes_xyz == {"axis-box": (0.2, 0.8, 0.4)}
    assert object_contracts.asset_refs == {"axis-box": None}
    assert object_contracts.contracts["axis-box"].source_type == "cube"
    assert object_contracts.contracts["axis-box"].rgba == (
        0.13333333333333333,
        0.7725490196078432,
        0.3686274509803922,
        1.0,
    )


def test_workspace_check_expected_object_contract_preserves_mesh_asset_refs() -> None:
    request = build_studio_y_up_axis_workspace_request()
    request.world_package.world_snapshot.objects = [
        {
            "id": "mesh-crate",
            "name": "Mesh crate",
            "type": "mesh",
            "position_xyz": [0.0, 0.0, 0.0],
            "rotation_rpy_rad": [0.0, 0.0, 0.0],
            "size_xyz": [0.2, 0.3, 0.4],
            "color": "#22c55e",
            "asset_ref": "assets/crate.obj",
        }
    ]

    object_contracts = expected_object_contracts_for_request(
        request,
        "auto",
    )

    assert object_contracts.positions_xyz == {"mesh-crate": (0.0, -0.0, 0.0)}
    assert object_contracts.sizes_xyz == {"mesh-crate": (0.2, 0.4, 0.3)}
    assert object_contracts.asset_refs == {"mesh-crate": "assets/crate.obj"}
    assert object_contracts.contracts["mesh-crate"].source_type == "mesh"
    assert object_contracts.contracts["mesh-crate"].asset_ref == "assets/crate.obj"


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


def test_workspace_check_fixture_selects_mesh_asset_request() -> None:
    args = type(
        "Args",
        (),
        {
            "fixture": "mesh-asset",
            "world_package": "",
            "robot_urdf": "",
            "asset_root": [],
        },
    )()

    request = _workspace_request_from_args(args)

    assert request.world_package.package_id == "mesh-asset-workspace-check"
    assert request.world_package.world_snapshot.cameras == []
    assert request.world_package.world_snapshot.objects[0]["id"] == "mesh-crate"
    assert request.world_package.world_snapshot.objects[0]["asset_ref"] == (
        "assets/workspace_mesh_crate.obj"
    )
    assert "assets/workspace_mesh_crate.obj" in {asset.path for asset in request.mesh_assets}


def test_workspace_check_fixture_selects_xacro_source_request() -> None:
    args = type(
        "Args",
        (),
        {
            "fixture": "xacro-source",
            "world_package": "",
            "robot_urdf": "",
            "asset_root": [],
        },
    )()

    request = _workspace_request_from_args(args)

    assert request.world_package.package_id == "xacro-source-workspace-check"
    assert request.urdf_asset_path == "robots/so101.urdf.xacro"
    assert request.world_package.provenance["workspace_check_fixture"] == "xacro-source"
    assert request.world_package.world_snapshot.objects
    assert request.world_package.world_snapshot.cameras
    assert request.mesh_assets


def test_xacro_source_fixture_preserves_demo_scene_contract() -> None:
    demo_request = build_demo_workspace_request()
    xacro_request = build_xacro_source_workspace_request()

    assert xacro_request.urdf_asset_path.endswith(".urdf.xacro")
    assert xacro_request.world_package.world_snapshot.urdf_xml == (
        demo_request.world_package.world_snapshot.urdf_xml
    )
    assert xacro_request.world_package.world_snapshot.objects == (
        demo_request.world_package.world_snapshot.objects
    )
    assert xacro_request.world_package.world_snapshot.cameras == (
        demo_request.world_package.world_snapshot.cameras
    )


def test_workspace_fixture_scripts_cover_all_backend_fixtures() -> None:
    package_json = json.loads((BASE_DIR / "package.json").read_text(encoding="utf-8"))
    scripts = package_json["scripts"]
    for script_name in (
        "simulator:workspace:check:fixtures",
        "simulator:blender:check:fixtures",
    ):
        script = scripts[script_name]
        for fixture in WORKSPACE_FIXTURES:
            assert f"--fixture {fixture}" in script


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
        expectations=WorkspaceExpectations(
            object_count=3,
            camera_count=3,
            duration_sec=0.02,
            camera_ids=("so101_overhead_scene", "so101_gripper_down", "so101_port_oblique"),
        ),
    )

    assert "--screenshot" in command.command
    assert "--camera-screenshot-dir" in command.command
    assert "--sensor-screenshot-dir" in command.command
    assert "--report" in command.command
    assert command.expected_report_path == tmp_path / "artifacts" / "report.json"
    assert command.expected_simulator_id == SIMULATOR_GENESIS_ID
    assert command.expected_object_count == 3
    assert command.expected_camera_count == 3
    assert command.expected_camera_ids == (
        "so101_overhead_scene",
        "so101_gripper_down",
        "so101_port_oblique",
    )
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


def test_workspace_check_derives_expected_camera_ids_from_request() -> None:
    request = build_demo_workspace_request()

    assert expected_camera_ids_for_request(request) == (
        "so101_overhead_scene",
        "so101_gripper_down",
        "so101_port_oblique",
    )


def test_workspace_check_derives_expected_camera_contracts_from_request() -> None:
    request = build_demo_workspace_request()

    contracts = expected_camera_contracts_for_request(request)

    assert tuple(contracts) == (
        "so101_overhead_scene",
        "so101_gripper_down",
        "so101_port_oblique",
    )
    overhead = contracts["so101_overhead_scene"]
    assert overhead.parent_joint == "base_link"
    assert overhead.parent_link == "base_link"
    assert overhead.width == 1280
    assert overhead.height == 720
    assert overhead.intrinsics_matrix[2] == (0.0, 0.0, 1.0)


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
        expectations=WorkspaceExpectations(
            object_count=3,
            camera_count=3,
            duration_sec=0.02,
        ),
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


def test_pybullet_workspace_check_carries_expected_joint_positions(monkeypatch, tmp_path) -> None:
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
        expectations=WorkspaceExpectations(
            object_count=3,
            camera_count=3,
            duration_sec=0.02,
            joint_positions={"shoulder": 0.5, "elbow": -0.25},
        ),
    )

    assert command.expected_joint_positions == {"shoulder": 0.5, "elbow": -0.25}


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
        expectations=WorkspaceExpectations(
            object_count=3,
            camera_count=3,
            duration_sec=0.02,
            camera_ids=expected_camera_ids_for_request(request),
            camera_contracts=expected_camera_contracts_for_request(request),
        ),
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
    assert command.expected_camera_ids == (
        "so101_overhead_scene",
        "so101_gripper_down",
        "so101_port_oblique",
    )
    assert tuple(command.expected_camera_contracts or {}) == (
        "so101_overhead_scene",
        "so101_gripper_down",
        "so101_port_oblique",
    )
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
        expectations=WorkspaceExpectations(
            object_count=3,
            camera_count=3,
            duration_sec=0.02,
        ),
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


def _write_visible_png(path, *, size=(64, 48)) -> None:
    from PIL import Image

    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", size, (255, 0, 0))
    image.putpixel((size[0] - 1, size[1] - 1), (0, 255, 0))
    image.save(path)


def _camera_contract(
    *,
    camera_id: str = "scene-camera",
    sim_name: str = "scene_camera",
    width: int = 64,
    height: int = 48,
) -> ExpectedCameraReport:
    return ExpectedCameraReport(
        camera_id=camera_id,
        sim_name=sim_name,
        parent_joint="base_link",
        parent_link="base_link",
        position_xyz=(0.0, 0.0, 1.0),
        quat_wxyz=(1.0, 0.0, 0.0, 0.0),
        width=width,
        height=height,
        fov_deg=60.0,
        intrinsics_matrix=(
            (41.569219381653056, 0.0, 32.0),
            (0.0, 41.569219381653056, 24.0),
            (0.0, 0.0, 1.0),
        ),
    )


def test_workspace_check_validates_camera_image_names_and_dimensions(tmp_path) -> None:
    camera_dir = tmp_path / "cameras"
    _write_visible_png(camera_dir / "01_scene_camera.png")
    contract = _camera_contract()
    expectations = WorkspaceImageArtifactExpectations(
        image_dirs=((camera_dir, 1),),
        camera_ids=("scene-camera",),
        camera_contracts={"scene-camera": contract},
    )

    assert validate_workspace_image_artifacts(expectations) is None


def test_workspace_check_rejects_wrong_camera_image_name(tmp_path) -> None:
    camera_dir = tmp_path / "cameras"
    _write_visible_png(camera_dir / "01_wrong_camera.png")
    contract = _camera_contract()
    expectations = WorkspaceImageArtifactExpectations(
        image_dirs=((camera_dir, 1),),
        camera_ids=("scene-camera",),
        camera_contracts={"scene-camera": contract},
    )

    assert (
        validate_workspace_image_artifacts(expectations)
        == "camera image artifact names in "
        f"{camera_dir} are ('01_wrong_camera.png',), expected ('01_scene_camera.png',)"
    )


def test_workspace_check_rejects_wrong_camera_image_dimensions(tmp_path) -> None:
    camera_dir = tmp_path / "cameras"
    _write_visible_png(camera_dir / "01_scene_camera.png", size=(32, 48))
    contract = _camera_contract()
    expectations = WorkspaceImageArtifactExpectations(
        image_dirs=((camera_dir, 1),),
        camera_ids=("scene-camera",),
        camera_contracts={"scene-camera": contract},
    )

    assert validate_workspace_image_artifacts(expectations) == (
        f"image artifact has wrong size: {camera_dir / '01_scene_camera.png'} "
        "32x48, expected 64x48"
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
