from __future__ import annotations

import backend.api.genesis_world as genesis_world_api
from backend.models.genesis_world import (
    GenesisJointStateRequest,
    GenesisWorldPose,
    GenesisWorldStateRequest,
    GenesisWorldOpenRequest,
    GenesisWorldOpenResponse,
)
from backend.services.genesis_live_state import reset_genesis_live_state_for_tests


def test_open_genesis_world_endpoint_launches_default_scene(monkeypatch) -> None:
    reset_genesis_live_state_for_tests()
    launched_modes: list[str] = []

    def fake_launch_default_genesis_world(*, dynamic_container_mode):
        launched_modes.append(dynamic_container_mode)
        return GenesisWorldOpenResponse(
            started=True,
            pid=1234,
            command=["python", "-m", "backend.scripts.genesis_world_open"],
            dynamic_container_mode=dynamic_container_mode,
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
    assert launched_modes == ["mesh"]


def test_open_genesis_world_request_defaults_to_solid_box_colliders() -> None:
    request = GenesisWorldOpenRequest()

    assert request.dynamic_container_mode == "box"


def test_open_genesis_world_clears_stale_world_pose_state(monkeypatch) -> None:
    reset_genesis_live_state_for_tests()

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

    def fake_launch_default_genesis_world(*, dynamic_container_mode):
        return GenesisWorldOpenResponse(
            started=True,
            pid=1234,
            command=["python", "-m", "backend.scripts.genesis_world_open"],
            dynamic_container_mode=dynamic_container_mode,
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
