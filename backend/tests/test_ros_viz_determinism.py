from __future__ import annotations

from backend.models.ros_viz import RosVizResolvedFramePose
from backend.ros_viz.determinism import rolling_session_hash, resolved_pose_batch_hash


def test_resolved_pose_batch_hash_is_order_invariant() -> None:
    poses_a = [
        RosVizResolvedFramePose(
            robot_id="r0",
            frame_id="tool0",
            parent_frame_id="elbow",
            translation_xyz=[0.3, 0.1, 0.2],
            quaternion_xyzw=[0.0, 0.0, 0.0, 1.0],
        ),
        RosVizResolvedFramePose(
            robot_id="r0",
            frame_id="base_link",
            parent_frame_id="world",
            translation_xyz=[0.0, 0.0, 0.0],
            quaternion_xyzw=[0.0, 0.0, 0.0, 1.0],
        ),
    ]
    poses_b = list(reversed(poses_a))

    hash_a = resolved_pose_batch_hash(fixed_frame="map", t_ns=1000, poses=poses_a)
    hash_b = resolved_pose_batch_hash(fixed_frame="map", t_ns=1000, poses=poses_b)

    assert hash_a == hash_b


def test_rolling_session_hash_changes_with_new_batches() -> None:
    first = rolling_session_hash("", "abc")
    second = rolling_session_hash(first, "def")

    assert first
    assert second
    assert first != second
