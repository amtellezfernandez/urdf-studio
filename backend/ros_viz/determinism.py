from __future__ import annotations

import hashlib
import struct
from typing import Iterable

from backend.models.ros_viz import RosVizResolvedFramePose

_FLOAT64 = "<d"


def _pack_f64(value: float) -> bytes:
    return struct.pack(_FLOAT64, float(value))


def resolved_pose_batch_hash(
    *,
    fixed_frame: str,
    t_ns: int,
    poses: Iterable[RosVizResolvedFramePose],
) -> str:
    """Build a stable hash over resolved poses in fixed frame at a given time."""
    digest = hashlib.sha256()
    digest.update(fixed_frame.encode("utf-8"))
    digest.update(b"\x1f")
    digest.update(str(int(t_ns)).encode("ascii"))

    sorted_poses = sorted(
        poses,
        key=lambda pose: (pose.robot_id, pose.parent_frame_id, pose.frame_id),
    )
    for pose in sorted_poses:
        digest.update(b"\x1e")
        digest.update(pose.robot_id.encode("utf-8"))
        digest.update(b"\x1f")
        digest.update(pose.parent_frame_id.encode("utf-8"))
        digest.update(b"\x1f")
        digest.update(pose.frame_id.encode("utf-8"))
        for value in pose.translation_xyz:
            digest.update(_pack_f64(value))
        for value in pose.quaternion_xyzw:
            digest.update(_pack_f64(value))

    return digest.hexdigest()


def rolling_session_hash(previous_hex: str, batch_hash_hex: str) -> str:
    digest = hashlib.sha256()
    digest.update(previous_hex.encode("ascii"))
    digest.update(b"\x1f")
    digest.update(batch_hash_hex.encode("ascii"))
    return digest.hexdigest()
