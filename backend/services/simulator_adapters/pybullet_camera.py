from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

from backend.services.simulator_adapters.camera_artifacts import (
    camera_artifact_path,
    write_rgb_image,
)
from backend.services.simulator_adapters.camera_transfer import SimCameraSpec


def pybullet_camera_view_matrix(pybullet: Any, camera: SimCameraSpec) -> Sequence[float]:
    target = tuple(
        camera.position_xyz[axis] + camera.render_forward_xyz[axis]
        for axis in range(3)
    )
    return pybullet.computeViewMatrix(
        cameraEyePosition=camera.position_xyz,
        cameraTargetPosition=target,
        cameraUpVector=camera.render_up_xyz,
    )


def pybullet_camera_projection_matrix(
    pybullet: Any,
    camera: SimCameraSpec,
    *,
    near_m: float,
    far_m: float,
) -> Sequence[float]:
    if camera.intrinsics is None:
        return pybullet.computeProjectionMatrixFOV(
            fov=camera.fov_deg,
            aspect=camera.width / camera.height,
            nearVal=near_m,
            farVal=far_m,
        )

    matrix = camera.intrinsics.matrix
    fx = max(float(matrix[0][0]), 1e-9)
    fy = max(float(matrix[1][1]), 1e-9)
    cx = float(matrix[0][2])
    cy = float(matrix[1][2])
    left = -cx * near_m / fx
    right = (camera.width - cx) * near_m / fx
    top = cy * near_m / fy
    bottom = -(camera.height - cy) * near_m / fy
    return pybullet.computeProjectionMatrix(
        left=left,
        right=right,
        bottom=bottom,
        top=top,
        nearVal=near_m,
        farVal=far_m,
    )


def render_pybullet_camera_image(
    pybullet: Any,
    camera: SimCameraSpec,
    *,
    near_m: float,
    far_m: float,
) -> np.ndarray:
    view_matrix = pybullet_camera_view_matrix(pybullet, camera)
    projection_matrix = pybullet_camera_projection_matrix(
        pybullet,
        camera,
        near_m=near_m,
        far_m=far_m,
    )
    renderer = getattr(pybullet, "ER_TINY_RENDERER", None)
    camera_image_kwargs: dict[str, object] = {}
    if renderer is not None:
        camera_image_kwargs["renderer"] = renderer
    _width, _height, rgba, *_rest = pybullet.getCameraImage(
        camera.width,
        camera.height,
        viewMatrix=view_matrix,
        projectionMatrix=projection_matrix,
        **camera_image_kwargs,
    )
    image = np.asarray(rgba)
    if image.ndim == 1:
        image = image.reshape((camera.height, camera.width, -1))
    if image.ndim != 3 or image.shape[-1] < 3:
        raise ValueError(
            f"PyBullet camera '{camera.sim_name}' returned unsupported image shape {image.shape}."
        )
    return np.clip(image[..., :3], 0, 255).astype(np.uint8)


def write_pybullet_camera_screenshots(
    pybullet: Any,
    cameras: Sequence[SimCameraSpec],
    output_dir: Path,
    *,
    near_m: float,
    far_m: float,
) -> int:
    output_dir.mkdir(parents=True, exist_ok=True)
    written_count = 0
    for index, camera in enumerate(cameras, start=1):
        image = render_pybullet_camera_image(
            pybullet,
            camera,
            near_m=near_m,
            far_m=far_m,
        )
        write_rgb_image(
            camera_artifact_path(output_dir, index=index, camera_name=camera.sim_name),
            image,
        )
        written_count += 1
    return written_count
