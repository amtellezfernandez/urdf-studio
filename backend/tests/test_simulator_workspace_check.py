from __future__ import annotations

from backend.scripts.simulator_workspace_check import (
    WORKSPACE_SIMULATORS,
    _active_object_count,
    _prepare_genesis_command,
    _prepare_pybullet_command,
    build_demo_workspace_request,
)


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
    assert "camera_screenshots=3" in command.extra_expected_markers
    assert command.expected_image_dirs == ((tmp_path / "artifacts" / "cameras", 3),)
