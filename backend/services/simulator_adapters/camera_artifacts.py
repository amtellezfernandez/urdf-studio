from __future__ import annotations

import re
from pathlib import Path

import numpy as np


def camera_artifact_path(output_dir: Path, *, index: int, camera_name: str) -> Path:
    return output_dir / f"{index:02d}_{safe_artifact_name(camera_name, default_name='camera')}.png"


def safe_artifact_name(value: str, *, default_name: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip()).strip("._")
    return normalized or default_name


def write_rgb_image(path: Path, image: np.ndarray) -> None:
    from PIL import Image

    if image.ndim != 3 or image.shape[-1] < 3:
        raise ValueError(f"Expected RGB image array, got shape {image.shape}.")
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(image[..., :3], 0, 255).astype(np.uint8)).save(path)
