from __future__ import annotations

from backend.scripts.simulator_launch_check import (
    WORLD_LAUNCH_SIMULATORS,
    _active_object_count,
    build_demo_world_open_request,
)


def test_demo_world_open_request_contains_robot_assets_objects_and_cameras() -> None:
    request = build_demo_world_open_request()

    assert request.urdf_asset_path == "robot.urdf"
    assert request.world_package.interface.frame_convention == "ros-rep-103"
    assert len(request.mesh_assets) > 0
    assert len(request.world_package.world_snapshot.objects) == 3
    assert len(request.world_package.world_snapshot.cameras) == 3
    assert [target.name for target in request.world_package.runtime_targets] == list(
        WORLD_LAUNCH_SIMULATORS
    )


def test_launch_check_expected_object_count_ignores_hidden_objects() -> None:
    request = build_demo_world_open_request()
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
