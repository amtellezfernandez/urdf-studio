from __future__ import annotations

import numpy as np

from backend.services.so100_sysid.benchmark import (
    assert_so100_sysid_result_is_healthy,
    run_so100_synthetic_sysid_benchmark,
)
from backend.services.so100_sysid.geometry_repair import (
    assert_so100_geometry_repair_result_is_healthy,
    parse_so100_kinematic_model,
    run_so100_geometry_repair_benchmark,
)
from backend.services.so100_sysid.hf_dataset import (
    build_so100_hf_trajectory_from_rows,
    load_so100_hf_trajectory_from_parquet,
    parse_so100_hf_dataset_metadata,
)
from backend.services.so100_sysid.keypoint_observations import (
    build_dense_so100_keypoint_targets,
    build_so100_geometry_keypoint_observations,
)
from backend.services.so100_sysid.model import load_so100_mujoco_model
from backend.services.so100_sysid.params import (
    SO100_EXPECTED_JOINT_COUNT,
    SO100_GEOMETRY_REPAIR_OPTIMIZER_STEPS,
    SO100_GEOMETRY_REPAIR_STEP_COUNT,
    SO100_GEOMETRY_REPAIR_TARGET_ORIGIN_OFFSETS_M,
    SO100_HF_DEFAULT_FPS,
    SO100_HF_JOINT_NAMES,
    SO100_JOINT_NAMES,
    SO100_ROBOT_TYPE,
    SO100_SYNTHETIC_OPTIMIZER_STEPS,
    SO100_SYNTHETIC_STEP_COUNT,
    SO100_URDF_OPS_KEYPOINT_MIN_CONFIDENCE,
    URDF_OPS_KEYPOINT_OBSERVATION_SCHEMA_VERSION,
)

TEST_FRAME_COUNT = 3
TEST_OBSERVATION_OFFSET = 0.5
TEST_ACTION_OFFSET = 1.5
TEST_KEYPOINT_EPISODE_INDEX = 4
TEST_KEYPOINT_FRAME_INDEX = 8
TEST_KEYPOINT_CAMERA_NAME = "wrist_camera"
TEST_KEYPOINT_LABEL = "moving_jaw_tip"
TEST_UNKNOWN_SO100_LINK_NAME = "not_an_so100_link"
TEST_KEYPOINT_POSITION_XYZ_M = (0.15, -0.025, 0.33)
TEST_LOW_KEYPOINT_CONFIDENCE = SO100_URDF_OPS_KEYPOINT_MIN_CONFIDENCE / 2.0


def test_load_so100_mujoco_model_uses_ilove_urdf_kinematic_strip() -> None:
    model = load_so100_mujoco_model()

    assert "<visual" not in model.stripped_urdf_xml
    assert "<collision" not in model.stripped_urdf_xml
    assert "<mesh" not in model.stripped_urdf_xml
    assert model.joint_names == SO100_JOINT_NAMES
    assert model.model.nq == SO100_EXPECTED_JOINT_COUNT
    assert model.model.nu == 0
    assert not model.model.jnt_limited.any()


def test_parse_so100_kinematic_model_uses_real_joint_origins() -> None:
    model = parse_so100_kinematic_model()

    assert tuple(joint.name for joint in model.joints if joint.qpos_index is not None) == SO100_JOINT_NAMES
    assert model.link_names[0] == "base_link"
    assert "moving_jaw_so101_v1_link" in model.tracked_link_names
    assert set(SO100_GEOMETRY_REPAIR_TARGET_ORIGIN_OFFSETS_M).issubset(
        {joint.name for joint in model.joints}
    )


def test_parse_so100_hf_dataset_metadata_validates_joint_schema() -> None:
    metadata = parse_so100_hf_dataset_metadata(
        {
            "robot_type": SO100_ROBOT_TYPE,
            "features": {
                "action": {"names": SO100_HF_JOINT_NAMES, "fps": SO100_HF_DEFAULT_FPS},
                "observation.state": {"names": SO100_HF_JOINT_NAMES, "fps": SO100_HF_DEFAULT_FPS},
            },
        }
    )

    assert metadata.robot_type == SO100_ROBOT_TYPE
    assert metadata.action_names == SO100_HF_JOINT_NAMES
    assert metadata.state_names == SO100_HF_JOINT_NAMES
    assert metadata.fps == SO100_HF_DEFAULT_FPS


def test_so100_urdf_ops_keypoints_convert_to_geometry_targets() -> None:
    model = parse_so100_kinematic_model()
    tracked_link_name = model.tracked_link_names[-1]
    tracked_link_index = model.tracked_link_names.index(tracked_link_name)
    payload = {
        "schema_version": URDF_OPS_KEYPOINT_OBSERVATION_SCHEMA_VERSION,
        "source_dataset_repo": "lerobot/svla_so100_pickplace",
        "robot_id": SO100_ROBOT_TYPE,
        "observations": [
            {
                "episode_index": TEST_KEYPOINT_EPISODE_INDEX,
                "frame_index": TEST_KEYPOINT_FRAME_INDEX,
                "camera_name": TEST_KEYPOINT_CAMERA_NAME,
                "keypoints": [
                    {
                        "label": TEST_KEYPOINT_LABEL,
                        "confidence": SO100_URDF_OPS_KEYPOINT_MIN_CONFIDENCE,
                        "position_xyz_m": TEST_KEYPOINT_POSITION_XYZ_M,
                        "link_name": tracked_link_name,
                    },
                    {
                        "label": "low_confidence_duplicate",
                        "confidence": TEST_LOW_KEYPOINT_CONFIDENCE,
                        "position_xyz_m": TEST_KEYPOINT_POSITION_XYZ_M,
                        "link_name": tracked_link_name,
                    },
                ],
            }
        ],
    }

    observations = build_so100_geometry_keypoint_observations(payload, model=model)
    targets = build_dense_so100_keypoint_targets(observations, model=model)

    assert observations.observation_count == 1
    assert observations.link_names == (tracked_link_name,)
    assert observations.frame_keys[0].episode_index == TEST_KEYPOINT_EPISODE_INDEX
    assert observations.frame_keys[0].frame_index == TEST_KEYPOINT_FRAME_INDEX
    assert observations.frame_keys[0].camera_name == TEST_KEYPOINT_CAMERA_NAME
    assert np.allclose(observations.position_xyz_m[0], TEST_KEYPOINT_POSITION_XYZ_M)
    assert targets.position_xyz_m.shape == (
        len(observations.frame_keys),
        len(model.tracked_link_names),
        len(TEST_KEYPOINT_POSITION_XYZ_M),
    )
    assert np.isclose(targets.weights[0, tracked_link_index], SO100_URDF_OPS_KEYPOINT_MIN_CONFIDENCE)
    assert np.allclose(targets.position_xyz_m[0, tracked_link_index], TEST_KEYPOINT_POSITION_XYZ_M)


def test_so100_urdf_ops_keypoints_reject_unknown_links() -> None:
    payload = {
        "schema_version": URDF_OPS_KEYPOINT_OBSERVATION_SCHEMA_VERSION,
        "observations": [
            {
                "episode_index": TEST_KEYPOINT_EPISODE_INDEX,
                "frame_index": TEST_KEYPOINT_FRAME_INDEX,
                "keypoints": [
                    {
                        "label": TEST_KEYPOINT_LABEL,
                        "confidence": SO100_URDF_OPS_KEYPOINT_MIN_CONFIDENCE,
                        "position_xyz_m": TEST_KEYPOINT_POSITION_XYZ_M,
                        "link_name": TEST_UNKNOWN_SO100_LINK_NAME,
                    }
                ],
            }
        ],
    }

    try:
        build_so100_geometry_keypoint_observations(payload)
    except ValueError as error:
        assert "unknown SO100 link" in str(error)
    else:
        raise AssertionError("Expected unknown SO100 link to be rejected.")


def test_build_so100_hf_trajectory_from_rows_extracts_transitions() -> None:
    rows = []
    for frame_index in range(TEST_FRAME_COUNT):
        base_vector = np.arange(SO100_EXPECTED_JOINT_COUNT, dtype=np.float32)
        rows.append(
            {
                "action": base_vector + TEST_ACTION_OFFSET + frame_index,
                "observation": {"state": base_vector + TEST_OBSERVATION_OFFSET + frame_index},
                "timestamp": frame_index / SO100_HF_DEFAULT_FPS,
                "frame_index": frame_index,
            }
        )

    trajectory = build_so100_hf_trajectory_from_rows(rows)

    assert trajectory.joint_names == SO100_JOINT_NAMES
    assert trajectory.hf_joint_names == SO100_HF_JOINT_NAMES
    assert trajectory.action.shape == (TEST_FRAME_COUNT, SO100_EXPECTED_JOINT_COUNT)
    assert trajectory.observation_state.shape == (TEST_FRAME_COUNT, SO100_EXPECTED_JOINT_COUNT)
    assert trajectory.transition_action.shape == (TEST_FRAME_COUNT - 1, SO100_EXPECTED_JOINT_COUNT)
    assert np.allclose(trajectory.transition_next_qpos, trajectory.observation_state[1:])


def test_load_so100_hf_trajectory_from_parquet(tmp_path) -> None:
    import pyarrow as pa
    import pyarrow.parquet as pq

    base_vector = np.arange(SO100_EXPECTED_JOINT_COUNT, dtype=np.float32)
    table = pa.table(
        {
            "action": [base_vector + TEST_ACTION_OFFSET + frame_index for frame_index in range(TEST_FRAME_COUNT)],
            "observation.state": [
                base_vector + TEST_OBSERVATION_OFFSET + frame_index for frame_index in range(TEST_FRAME_COUNT)
            ],
            "timestamp": [frame_index / SO100_HF_DEFAULT_FPS for frame_index in range(TEST_FRAME_COUNT)],
            "frame_index": list(range(TEST_FRAME_COUNT)),
        }
    )
    parquet_path = tmp_path / "so100.parquet"
    pq.write_table(table, parquet_path)

    trajectory = load_so100_hf_trajectory_from_parquet(parquet_path)

    assert trajectory.action.shape == (TEST_FRAME_COUNT, SO100_EXPECTED_JOINT_COUNT)
    assert np.allclose(trajectory.transition_qpos[0], base_vector + TEST_OBSERVATION_OFFSET)


def test_so100_synthetic_sysid_benchmark_recovers_pd_parameters() -> None:
    result = run_so100_synthetic_sysid_benchmark(
        optimizer_steps=SO100_SYNTHETIC_OPTIMIZER_STEPS,
        rollout_steps=SO100_SYNTHETIC_STEP_COUNT,
    )

    assert_so100_sysid_result_is_healthy(result)


def test_so100_geometry_repair_benchmark_recovers_origin_offsets() -> None:
    result = run_so100_geometry_repair_benchmark(
        optimizer_steps=SO100_GEOMETRY_REPAIR_OPTIMIZER_STEPS,
        rollout_steps=SO100_GEOMETRY_REPAIR_STEP_COUNT,
    )

    assert_so100_geometry_repair_result_is_healthy(result)
