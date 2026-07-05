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


def render_mujoco_camera_image(
    mujoco: Any,
    model: Any,
    data: Any,
    camera: SimCameraSpec,
) -> np.ndarray:
    image = _render_mujoco_camera_rgba(
        mujoco,
        model,
        data,
        camera,
    )
    if image.ndim != 3 or image.shape[-1] < 3:
        raise ValueError(
            f"MuJoCo camera '{camera.sim_name}' returned unsupported image shape {image.shape}."
        )
    return np.clip(image[..., :3], 0, 255).astype(np.uint8)


def _render_mujoco_camera_rgba(
    mujoco: Any,
    model: Any,
    data: Any,
    camera: SimCameraSpec,
) -> np.ndarray:
    renderer = mujoco.Renderer(model, height=camera.height, width=camera.width)
    try:
        renderer.update_scene(data, camera=camera.sim_name)
        return renderer.render()
    finally:
        renderer.close()


def write_mujoco_camera_screenshots(
    mujoco: Any,
    model: Any,
    data: Any,
    cameras: Sequence[SimCameraSpec],
    output_dir: Path,
) -> int:
    output_dir.mkdir(parents=True, exist_ok=True)
    written_count = 0
    for index, camera in enumerate(cameras, start=1):
        image = render_mujoco_camera_image(mujoco, model, data, camera)
        write_rgb_image(
            camera_artifact_path(output_dir, index=index, camera_name=camera.sim_name),
            image,
        )
        written_count += 1
    return written_count
