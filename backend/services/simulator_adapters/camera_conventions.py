from __future__ import annotations

from typing import Literal

import numpy as np
from scipy.spatial.transform import Rotation

CameraFrameConvention = Literal["world", "opengl", "ros"]

# Camera convention contract ported from RoboVerse MetaSim
# metasim.utils.math.convert_camera_frame_orientation_convention.
# MetaSim is Apache-2.0 licensed. See https://github.com/RoboVerseOrg/MetaSim.
WORLD_CAMERA_FORWARD_LOCAL_XYZ = (1.0, 0.0, 0.0)
WORLD_CAMERA_UP_LOCAL_XYZ = (0.0, 0.0, 1.0)
OPENGL_CAMERA_FORWARD_LOCAL_XYZ = (0.0, 0.0, -1.0)
OPENGL_CAMERA_UP_LOCAL_XYZ = (0.0, 1.0, 0.0)
ROS_CAMERA_FORWARD_LOCAL_XYZ = (0.0, 0.0, 1.0)
ROS_CAMERA_UP_LOCAL_XYZ = (0.0, -1.0, 0.0)

WORLD_CAMERA_TO_OPENGL_CAMERA_MATRIX = np.array(
    [
        [0.0, 0.0, -1.0],
        [-1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
    ],
    dtype=np.float64,
)
OPENGL_CAMERA_TO_ROS_CAMERA_MATRIX = np.array(
    [
        [1.0, 0.0, 0.0],
        [0.0, -1.0, 0.0],
        [0.0, 0.0, -1.0],
    ],
    dtype=np.float64,
)
CAMERA_FRAME_TO_OPENGL_MATRIX = {
    "world": WORLD_CAMERA_TO_OPENGL_CAMERA_MATRIX,
    "opengl": np.eye(3, dtype=np.float64),
    "ros": OPENGL_CAMERA_TO_ROS_CAMERA_MATRIX,
}
CAMERA_FRAME_TO_OPENGL_ROTATION = {
    convention: Rotation.from_matrix(matrix)
    for convention, matrix in CAMERA_FRAME_TO_OPENGL_MATRIX.items()
}


def camera_frame_conversion_rotation(
    origin: CameraFrameConvention,
    target: CameraFrameConvention,
) -> Rotation:
    if origin == target:
        return Rotation.identity()
    origin_to_opengl = _camera_frame_to_opengl_rotation(origin)
    opengl_to_target = _opengl_to_camera_frame_rotation(target)
    return origin_to_opengl * opengl_to_target


def world_camera_to_opengl_camera_rotation() -> Rotation:
    return camera_frame_conversion_rotation("world", "opengl")


def _camera_frame_to_opengl_rotation(convention: CameraFrameConvention) -> Rotation:
    try:
        return CAMERA_FRAME_TO_OPENGL_ROTATION[convention]
    except KeyError:
        raise ValueError(f"Unsupported camera frame convention: {convention}") from None


def _opengl_to_camera_frame_rotation(convention: CameraFrameConvention) -> Rotation:
    return _camera_frame_to_opengl_rotation(convention).inv()
