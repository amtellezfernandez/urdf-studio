from __future__ import annotations

import pytest
from fastapi import HTTPException

import backend.api.genesis_world as genesis_world_api
from backend.models.genesis_world import (
    GenesisJointStateRequest,
    GenesisLiveStateRequest,
    GenesisWorldPose,
    GenesisWorldStateRequest,
    GenesisWorldOpenRequest,
    GenesisWorldOpenResponse,
)
from backend.services.genesis_live_state import reset_genesis_live_state_for_tests
from backend.services.genesis_world_launcher import GenesisWorldLaunchError


def test_open_genesis_world_endpoint_launches_default_scene(monkeypatch) -> None:
    reset_genesis_live_state_for_tests()
    launched_modes: list[tuple[str, str]] = []

    def fake_launch_default_genesis_world(*, dynamic_container_mode, robot_mode):
        launched_modes.append((dynamic_container_mode, robot_mode))
        return GenesisWorldOpenResponse(
            started=True,
            pid=1234,
            command=["python", "-u", "-m", "backend.scripts.genesis_world_open"],
            dynamic_container_mode=dynamic_container_mode,
            robot_mode=robot_mode,
        )

    monkeypatch.setattr(
        genesis_world_api,
        "launch_default_genesis_world",
        fake_launch_default_genesis_world,
    )
    response = genesis_world_api.open_genesis_world(
        GenesisWorldOpenRequest(dynamic_container_mode="mesh"),
        _access=None,
    )

    assert response.pid == 1234
    assert response.dynamic_container_mode == "mesh"
    assert response.robot_mode == "so101"
    assert launched_modes == [("mesh", "so101")]


def test_open_genesis_world_request_defaults_to_solid_box_colliders() -> None:
    request = GenesisWorldOpenRequest()

    assert request.dynamic_container_mode == "box"
    assert request.robot_mode == "so101"


def test_open_genesis_world_endpoint_launches_crane_scene(monkeypatch) -> None:
    launched_modes: list[tuple[str, str]] = []

    def fake_launch_default_genesis_world(*, dynamic_container_mode, robot_mode):
        launched_modes.append((dynamic_container_mode, robot_mode))
        return GenesisWorldOpenResponse(
            started=True,
            pid=4321,
            command=["python", "-u", "-m", "backend.scripts.genesis_world_open"],
            dynamic_container_mode=dynamic_container_mode,
            robot_mode=robot_mode,
        )

    monkeypatch.setattr(
        genesis_world_api,
        "launch_default_genesis_world",
        fake_launch_default_genesis_world,
    )

    response = genesis_world_api.open_genesis_world(
        GenesisWorldOpenRequest(dynamic_container_mode="box", robot_mode="crane"),
        _access=None,
    )

    assert response.pid == 4321
    assert response.robot_mode == "crane"
    assert launched_modes == [("box", "crane")]


def test_open_genesis_world_endpoint_reports_failed_launch(monkeypatch) -> None:
    def fake_launch_default_genesis_world(*, dynamic_container_mode, robot_mode):
        raise GenesisWorldLaunchError("Genesis launch exited immediately")

    monkeypatch.setattr(
        genesis_world_api,
        "launch_default_genesis_world",
        fake_launch_default_genesis_world,
    )

    with pytest.raises(HTTPException) as exc_info:
        genesis_world_api.open_genesis_world(
            GenesisWorldOpenRequest(dynamic_container_mode="box"),
            _access=None,
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "Genesis launch exited immediately"


def test_open_genesis_world_clears_stale_world_pose_state(monkeypatch) -> None:
    reset_genesis_live_state_for_tests()

    genesis_world_api.publish_genesis_joint_state(
        GenesisJointStateRequest(joint_values={"shoulder_pan": 0.25}),
        _access=None,
    )
    genesis_world_api.publish_genesis_robot_state(
        GenesisJointStateRequest(joint_values={"shoulder_pan": -0.5}),
        _access=None,
    )
    genesis_world_api.publish_genesis_world_state(
        GenesisWorldStateRequest(
            source_sequence=1,
            poses=[
                GenesisWorldPose(
                    element_id="grabbable-container-a",
                    position_xyz=(0.3, -0.1, 0.0),
                    orientation_wxyz=(1.0, 0.0, 0.0, 0.0),
                )
            ],
        ),
        _access=None,
    )

    def fake_launch_default_genesis_world(*, dynamic_container_mode, robot_mode):
        return GenesisWorldOpenResponse(
            started=True,
            pid=1234,
            command=["python", "-u", "-m", "backend.scripts.genesis_world_open"],
            dynamic_container_mode=dynamic_container_mode,
            robot_mode=robot_mode,
        )

    monkeypatch.setattr(
        genesis_world_api,
        "launch_default_genesis_world",
        fake_launch_default_genesis_world,
    )
    genesis_world_api.open_genesis_world(
        GenesisWorldOpenRequest(dynamic_container_mode="mesh"),
        _access=None,
    )

    latest = genesis_world_api.get_latest_genesis_world_state(_access=None)
    assert latest.sequence == 0
    assert latest.poses == []
    latest_command = genesis_world_api.get_latest_genesis_joint_state(_access=None)
    assert latest_command.sequence == 0
    assert latest_command.joint_values == {}
    latest_robot = genesis_world_api.get_latest_genesis_robot_state(_access=None)
    assert latest_robot.sequence == 0
    assert latest_robot.joint_values == {}


def test_genesis_joint_state_roundtrips_latest_values() -> None:
    reset_genesis_live_state_for_tests()

    first = genesis_world_api.publish_genesis_joint_state(
        GenesisJointStateRequest(joint_values={"shoulder_pan": 0.25, "gripper": 0.7}),
        _access=None,
    )
    latest = genesis_world_api.get_latest_genesis_joint_state(_access=None)

    assert first.sequence == 1
    assert latest.sequence == 1
    assert latest.joint_values == {"shoulder_pan": 0.25, "gripper": 0.7}


def test_genesis_robot_state_roundtrips_latest_corrected_values() -> None:
    reset_genesis_live_state_for_tests()

    first = genesis_world_api.publish_genesis_robot_state(
        GenesisJointStateRequest(joint_values={"shoulder_pan": 0.12, "gripper": 0.42}),
        _access=None,
    )
    latest = genesis_world_api.get_latest_genesis_robot_state(_access=None)

    assert first.sequence == 1
    assert latest.sequence == 1
    assert latest.joint_values == {"shoulder_pan": 0.12, "gripper": 0.42}


def test_genesis_live_state_roundtrips_atomic_robot_and_world_values() -> None:
    reset_genesis_live_state_for_tests()

    response = genesis_world_api.publish_genesis_live_state(
        GenesisLiveStateRequest(
            robot_joint_values={"shoulder_pan": 0.12, "gripper": 0.42},
            world_source_sequence=8,
            poses=[
                GenesisWorldPose(
                    element_id="grabbable-container-a",
                    position_xyz=(0.3, -0.1, 0.02),
                    orientation_wxyz=(1.0, 0.0, 0.0, 0.0),
                )
            ],
        ),
        _access=None,
    )
    latest = genesis_world_api.get_latest_genesis_live_state(_access=None)
    latest_robot = genesis_world_api.get_latest_genesis_robot_state(_access=None)
    latest_world = genesis_world_api.get_latest_genesis_world_state(_access=None)

    assert response.sequence == 1
    assert latest.sequence == 1
    assert latest.robot_joint_values == {"shoulder_pan": 0.12, "gripper": 0.42}
    assert latest.world_source_sequence == 8
    assert latest.poses[0].element_id == "grabbable-container-a"
    assert latest_robot.joint_values == latest.robot_joint_values
    assert latest_world.source_sequence == latest.world_source_sequence
    assert latest_world.poses == latest.poses


def test_genesis_world_state_roundtrips_latest_dynamic_poses() -> None:
    reset_genesis_live_state_for_tests()

    response = genesis_world_api.publish_genesis_world_state(
        GenesisWorldStateRequest(
            source_sequence=42,
            poses=[
                GenesisWorldPose(
                    element_id="grabbable-container-a",
                    position_xyz=(0.3, -0.1, 0.0),
                    orientation_wxyz=(1.0, 0.0, 0.0, 0.0),
                )
            ],
        ),
        _access=None,
    )
    latest = genesis_world_api.get_latest_genesis_world_state(_access=None)

    assert response.sequence == 1
    assert latest.sequence == 1
    assert latest.source_sequence == 42
    assert latest.poses[0].element_id == "grabbable-container-a"
    assert latest.poses[0].position_xyz == (0.3, -0.1, 0.0)
