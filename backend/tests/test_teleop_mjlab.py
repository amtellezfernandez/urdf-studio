from __future__ import annotations

import base64
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.models.teleop_mjlab import (
    TeleopMjlabEndEffectorSample,
    TeleopMjlabMotionThresholds,
    TeleopMjlabRobotMeshFile,
    TeleopMjlabRobotModel,
)
from backend.models.teleop_replay import TeleopReplayRecording
from backend.services.teleop_mjlab import (
    rollout_teleop_mjlab_physics,
    validate_teleop_mjlab_motion,
)
from backend.services.teleop_mjlab_params import (
    TELEOP_MJLAB_BUNDLE_KIND,
    TELEOP_MJLAB_ISSUE_CODE_JOINT_ACCELERATION_LIMIT,
    TELEOP_MJLAB_ISSUE_CODE_JOINT_VELOCITY_LIMIT,
    TELEOP_MJLAB_ISSUE_CODE_SELF_COLLISION_MODEL_MISSING,
    TELEOP_MJLAB_ROLLOUT_SCHEMA_VERSION,
    TELEOP_MJLAB_RUNTIME_DEPENDENCY_MJLAB,
    TELEOP_MJLAB_RUNTIME_DEPENDENCY_MUJOCO,
    TELEOP_MJLAB_SCHEMA_VERSION,
    TELEOP_MJLAB_TIMESTAMP_SEMANTICS_COMMAND_SOURCE,
    TELEOP_MJLAB_TRAJECTORY_SOURCE_STUDIO_JOINT_TARGETS,
)

TEST_RECORDING_SCHEMA_VERSION = "urdf-studio.teleop-recording.v1"
TEST_RECORDING_ID = "fold-shirt-mjlab"
TEST_TASK_LANGUAGE = "fold a t-shirt"
TEST_STARTED_AT_MS = 1_000
TEST_FIRST_SOURCE_TS_MS = 1_100
TEST_SECOND_SOURCE_TS_MS = 1_200
TEST_THIRD_SOURCE_TS_MS = 1_300
TEST_FIRST_SAMPLE_INDEX = 0
TEST_SECOND_SAMPLE_INDEX = 1
TEST_THIRD_SAMPLE_INDEX = 2
TEST_FIRST_COMMAND_SEQUENCE = 1
TEST_SECOND_COMMAND_SEQUENCE = 2
TEST_THIRD_COMMAND_SEQUENCE = 3
TEST_JOINT_NAME = "openarm_left_joint1"
TEST_FIRST_TARGET_RAD = 0.1
TEST_SECOND_TARGET_RAD = 0.2
TEST_SPIKE_TARGET_RAD = 2.0
TEST_ACCELERATION_SPIKE_TARGET_RAD = 1.7
TEST_STRICT_MAX_JOINT_VELOCITY_RAD_PER_SEC = 1.0
TEST_HIGH_MAX_JOINT_VELOCITY_RAD_PER_SEC = 20.0
TEST_STRICT_MAX_JOINT_ACCELERATION_RAD_PER_SEC2 = 120.0
TEST_MAX_JOINT_ACCELERATION_RAD_PER_SEC2 = 1_000.0
TEST_MAX_TIMESTAMP_GAP_MS = 250.0
TEST_LOOPBACK_CLIENT = ("127.0.0.1", 50_000)
TEST_DYNAMIC_CUBE_ID = "red-pickup-cube"
TEST_PRIMITIVE_COLLISION_URDF = """
<robot name="primitive_check">
  <link name="base">
    <collision>
      <geometry>
        <box size="0.1 0.1 0.1"/>
      </geometry>
    </collision>
  </link>
</robot>
"""
TEST_MESH_COLLISION_OBJ = """\
v 0 0 0
v 0.1 0 0
v 0 0.1 0
v 0 0 0.1
f 1 2 3
f 1 2 4
f 1 3 4
f 2 3 4
"""
TEST_MESH_COLLISION_URDF = """
<robot name="mesh_check">
  <link name="base">
    <collision>
      <geometry>
        <mesh filename="meshes/tetra.obj"/>
      </geometry>
    </collision>
  </link>
</robot>
"""


def _kinematic_recording_payload() -> dict[str, object]:
    first_sample = {
        "schemaVersion": TEST_RECORDING_SCHEMA_VERSION,
        "sampleIndex": TEST_FIRST_SAMPLE_INDEX,
        "command": {
            "kind": "joint_targets",
            "jointTargets": {
                TEST_JOINT_NAME: TEST_FIRST_TARGET_RAD,
            },
        },
        "metadata": {
            "command_kind": "joint_targets",
            "sequence": TEST_FIRST_COMMAND_SEQUENCE,
            "source_ts_ms": TEST_FIRST_SOURCE_TS_MS,
        },
        "recordedAtMs": TEST_FIRST_SOURCE_TS_MS,
        "context": {},
        "stateCaptureStatus": "state_unavailable",
        "preCommandState": None,
        "postCommandState": None,
    }
    second_sample = deepcopy(first_sample)
    second_sample["sampleIndex"] = TEST_SECOND_SAMPLE_INDEX
    second_sample["command"]["jointTargets"] = {
        TEST_JOINT_NAME: TEST_SECOND_TARGET_RAD,
    }
    second_sample["metadata"]["sequence"] = TEST_SECOND_COMMAND_SEQUENCE
    second_sample["metadata"]["source_ts_ms"] = TEST_SECOND_SOURCE_TS_MS
    second_sample["recordedAtMs"] = TEST_SECOND_SOURCE_TS_MS

    return {
        "schemaVersion": TEST_RECORDING_SCHEMA_VERSION,
        "recordingId": TEST_RECORDING_ID,
        "taskLanguage": TEST_TASK_LANGUAGE,
        "startedAtMs": TEST_STARTED_AT_MS,
        "endedAtMs": TEST_SECOND_SOURCE_TS_MS,
        "durationMs": TEST_SECOND_SOURCE_TS_MS - TEST_STARTED_AT_MS,
        "sampleCount": 2,
        "droppedSampleCount": 0,
        "samples": [first_sample, second_sample],
    }


def _kinematic_recording() -> TeleopReplayRecording:
    return TeleopReplayRecording.model_validate(_kinematic_recording_payload())


def _dynamic_cube_world_layout_payload() -> dict[str, object]:
    return {
        "world_layout": {
            "name": "mjlab-pickup-smoke",
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
            "objects": [
                {
                    "id": TEST_DYNAMIC_CUBE_ID,
                    "name": "red pickup cube",
                    "type": "cube",
                    "position_xyz": [0.0, 0.0, 0.025],
                    "rotation_rpy_rad": [0.0, 0.0, 0.0],
                    "size_xyz": [0.05, 0.05, 0.05],
                    "color": "#ff1f1f",
                    "physics": {
                        "body_type": "dynamic",
                        "mass_kg": 0.04,
                        "friction": 1.5,
                        "restitution": 0.0,
                    },
                }
            ],
        }
    }


def _pickup_end_effector_samples() -> list[TeleopMjlabEndEffectorSample]:
    return [
        TeleopMjlabEndEffectorSample(
            sample_index=0,
            timestamp_ms=0.0,
            position_xyz=(0.0, 0.0, 0.05),
            quat_wxyz=(1.0, 0.0, 0.0, 0.0),
            gripper_opening_m=0.09,
        ),
        TeleopMjlabEndEffectorSample(
            sample_index=1,
            timestamp_ms=120.0,
            position_xyz=(0.0, 0.0, 0.05),
            quat_wxyz=(1.0, 0.0, 0.0, 0.0),
            gripper_opening_m=0.035,
        ),
        TeleopMjlabEndEffectorSample(
            sample_index=2,
            timestamp_ms=360.0,
            position_xyz=(0.0, 0.0, 0.14),
            quat_wxyz=(1.0, 0.0, 0.0, 0.0),
            gripper_opening_m=0.035,
        ),
    ]


def test_teleop_mjlab_runtime_endpoint_reports_dependency_status() -> None:
    client = TestClient(create_app(), client=TEST_LOOPBACK_CLIENT)

    response = client.get("/teleop/mjlab/runtime")

    assert response.status_code == 200
    payload = response.json()
    assert {dependency["name"] for dependency in payload["dependencies"]} == {
        TELEOP_MJLAB_RUNTIME_DEPENDENCY_MJLAB,
        TELEOP_MJLAB_RUNTIME_DEPENDENCY_MUJOCO,
    }


def test_teleop_mjlab_validation_builds_motion_bundle_for_smooth_episode() -> None:
    thresholds = TeleopMjlabMotionThresholds(require_self_collision_check=False)

    result = validate_teleop_mjlab_motion(
        _kinematic_recording(),
        thresholds=thresholds,
    )

    assert result.success is True
    assert result.schema_version == TELEOP_MJLAB_SCHEMA_VERSION
    assert result.recording_id == TEST_RECORDING_ID
    assert result.trajectory_sample_count == 2
    assert result.self_collision_checked is False
    assert result.self_collision_count == 0
    assert result.trajectory[0].source == TELEOP_MJLAB_TRAJECTORY_SOURCE_STUDIO_JOINT_TARGETS
    assert result.joint_names == [TEST_JOINT_NAME]
    assert result.max_joint_velocity_rad_per_sec > 0
    assert result.manifest["bundle_kind"] == TELEOP_MJLAB_BUNDLE_KIND
    assert (
        result.manifest["timestamp_semantics"]
        == TELEOP_MJLAB_TIMESTAMP_SEMANTICS_COMMAND_SOURCE
    )
    assert result.manifest["self_collision"] == {
        "checked": False,
        "sample_count": 0,
        "collision_count": 0,
    }


def test_teleop_mjlab_rollout_simulates_dynamic_cube_contact() -> None:
    pytest.importorskip("mujoco")

    result = rollout_teleop_mjlab_physics(
        _kinematic_recording(),
        world_layout=_dynamic_cube_world_layout_payload(),
        end_effector_samples=_pickup_end_effector_samples(),
        frame_map="identity",
        include_mjcf=True,
        rollout_step_ms=5.0,
    )

    assert result.success is True
    assert result.schema_version == TELEOP_MJLAB_ROLLOUT_SCHEMA_VERSION
    assert result.dynamic_object_count == 1
    assert result.frame_count == len(_pickup_end_effector_samples())
    assert result.mjcf_xml is not None
    assert "mjlab_left_finger" in result.mjcf_xml
    first_pose = result.frames[0].object_poses[0]
    last_pose = result.frames[-1].object_poses[0]
    assert first_pose.object_id == TEST_DYNAMIC_CUBE_ID
    assert last_pose.position_xyz[2] > first_pose.position_xyz[2]
    assert any(
        contact.with_gripper
        for frame in result.frames
        for contact in frame.contacts
    )


def test_teleop_mjlab_validation_warns_when_self_collision_model_is_missing() -> None:
    result = validate_teleop_mjlab_motion(_kinematic_recording())

    assert result.success is True
    assert result.self_collision_checked is False
    assert result.issues[0].severity == "warning"
    assert result.issues[0].code == TELEOP_MJLAB_ISSUE_CODE_SELF_COLLISION_MODEL_MISSING


def test_teleop_mjlab_validation_checks_self_collision_when_robot_model_is_available() -> None:
    result = validate_teleop_mjlab_motion(
        _kinematic_recording(),
        robot_model=TeleopMjlabRobotModel(
            name="primitive_check",
            urdf_xml=TEST_PRIMITIVE_COLLISION_URDF,
        ),
    )

    assert result.success is True
    assert result.self_collision_checked is True
    assert result.self_collision_sample_count == result.trajectory_sample_count
    assert result.self_collision_count == 0


def test_teleop_mjlab_validation_stages_mesh_assets_before_self_collision_check() -> None:
    result = validate_teleop_mjlab_motion(
        _kinematic_recording(),
        robot_model=TeleopMjlabRobotModel(
            name="mesh_check",
            urdf_xml=TEST_MESH_COLLISION_URDF,
            mesh_files=[
                TeleopMjlabRobotMeshFile(
                    path="loaded/robot/meshes/tetra.obj",
                    base64_content=base64.b64encode(
                        TEST_MESH_COLLISION_OBJ.encode("utf-8")
                    ).decode("ascii"),
                    mime_type="model/obj",
                )
            ],
        ),
    )

    assert result.success is True
    assert result.self_collision_checked is True
    assert result.self_collision_sample_count == result.trajectory_sample_count
    assert result.self_collision_count == 0


def test_teleop_mjlab_validation_flags_joint_velocity_spikes() -> None:
    payload = _kinematic_recording_payload()
    second_sample = payload["samples"][1]
    assert isinstance(second_sample, dict)
    second_sample["command"]["jointTargets"] = {
        TEST_JOINT_NAME: TEST_SPIKE_TARGET_RAD,
    }
    thresholds = TeleopMjlabMotionThresholds(
        max_joint_velocity_rad_per_sec=TEST_STRICT_MAX_JOINT_VELOCITY_RAD_PER_SEC,
        max_joint_acceleration_rad_per_sec2=(
            TEST_MAX_JOINT_ACCELERATION_RAD_PER_SEC2
        ),
        max_timestamp_gap_ms=TEST_MAX_TIMESTAMP_GAP_MS,
        require_self_collision_check=False,
    )

    result = validate_teleop_mjlab_motion(
        TeleopReplayRecording.model_validate(payload),
        thresholds=thresholds,
    )

    assert result.success is False
    assert result.issues[0].code == TELEOP_MJLAB_ISSUE_CODE_JOINT_VELOCITY_LIMIT
    assert result.issues[0].joint_name == TEST_JOINT_NAME


def test_teleop_mjlab_validation_flags_joint_acceleration_spikes() -> None:
    payload = _kinematic_recording_payload()
    third_sample = deepcopy(payload["samples"][1])
    assert isinstance(third_sample, dict)
    third_sample["sampleIndex"] = TEST_THIRD_SAMPLE_INDEX
    third_sample["command"]["jointTargets"] = {
        TEST_JOINT_NAME: TEST_ACCELERATION_SPIKE_TARGET_RAD,
    }
    third_sample["metadata"]["sequence"] = TEST_THIRD_COMMAND_SEQUENCE
    third_sample["metadata"]["source_ts_ms"] = TEST_THIRD_SOURCE_TS_MS
    third_sample["recordedAtMs"] = TEST_THIRD_SOURCE_TS_MS
    payload["samples"].append(third_sample)
    payload["endedAtMs"] = TEST_THIRD_SOURCE_TS_MS
    payload["durationMs"] = TEST_THIRD_SOURCE_TS_MS - TEST_STARTED_AT_MS
    payload["sampleCount"] = len(payload["samples"])
    thresholds = TeleopMjlabMotionThresholds(
        max_joint_velocity_rad_per_sec=TEST_HIGH_MAX_JOINT_VELOCITY_RAD_PER_SEC,
        max_joint_acceleration_rad_per_sec2=(
            TEST_STRICT_MAX_JOINT_ACCELERATION_RAD_PER_SEC2
        ),
        max_timestamp_gap_ms=TEST_MAX_TIMESTAMP_GAP_MS,
        require_self_collision_check=False,
    )

    result = validate_teleop_mjlab_motion(
        TeleopReplayRecording.model_validate(payload),
        thresholds=thresholds,
    )

    assert result.success is False
    assert result.issues[0].code == TELEOP_MJLAB_ISSUE_CODE_JOINT_ACCELERATION_LIMIT
    assert result.issues[0].joint_name == TEST_JOINT_NAME


def test_teleop_mjlab_validate_endpoint_returns_motion_quality_report() -> None:
    client = TestClient(create_app(), client=TEST_LOOPBACK_CLIENT)

    response = client.post(
        "/teleop/mjlab/validate",
        json={
            "recording": _kinematic_recording_payload(),
            "thresholds": {"requireSelfCollisionCheck": False},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["recordingId"] == TEST_RECORDING_ID
    assert payload["trajectorySampleCount"] == 2
    assert payload["selfCollisionChecked"] is False
    assert payload["selfCollisionCount"] == 0
    assert payload["manifest"]["bundle_kind"] == TELEOP_MJLAB_BUNDLE_KIND
