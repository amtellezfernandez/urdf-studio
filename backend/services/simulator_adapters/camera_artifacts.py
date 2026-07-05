from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np

MIN_VISIBLE_CHANNEL_SPAN = 5
IMAGE_ARTIFACT_SUFFIX = ".png"
SAFE_ARTIFACT_NAME_PATTERN = re.compile(r"[^A-Za-z0-9_.-]+")
DEFAULT_SAFE_ARTIFACT_NAME = "artifact"


@dataclass(frozen=True)
class ImageArtifactStats:
    size: tuple[int, int]
    channel_span: int


def camera_artifact_name(
    *,
    index: int,
    camera_name: str,
    default_name: str = "camera",
) -> str:
    return (
        f"{index:02d}_"
        f"{safe_artifact_name(camera_name, default_name=default_name)}"
        f"{IMAGE_ARTIFACT_SUFFIX}"
    )


def camera_artifact_path(
    output_dir: Path,
    *,
    index: int,
    camera_name: str,
    default_name: str = "camera",
) -> Path:
    return output_dir / camera_artifact_name(
        index=index,
        camera_name=camera_name,
        default_name=default_name,
    )


def safe_artifact_name(value: str, *, default_name: str) -> str:
    normalized = _normalized_artifact_name(value)
    if normalized:
        return normalized
    fallback_name = _normalized_artifact_name(default_name)
    return fallback_name or DEFAULT_SAFE_ARTIFACT_NAME


def _normalized_artifact_name(value: str) -> str:
    return SAFE_ARTIFACT_NAME_PATTERN.sub("_", value.strip()).strip("._")


def write_rgb_image(path: Path, image: np.ndarray) -> None:
    from PIL import Image

    rgb_image = _rgb_uint8_image(image)
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb_image).save(path)


def inspect_rgb_image(path: Path) -> ImageArtifactStats:
    from PIL import Image

    with Image.open(path) as image:
        rgb_image = image.convert("RGB")
        extrema = rgb_image.getextrema()
        channel_span = max(high - low for low, high in extrema)
        return ImageArtifactStats(
            size=rgb_image.size,
            channel_span=int(channel_span),
        )


def validate_visible_rgb_image(
    path: Path,
    *,
    expected_size: tuple[int, int] | None = None,
) -> str | None:
    if not path.exists():
        return f"missing image artifact: {path}"
    try:
        stats = inspect_rgb_image(path)
    except (OSError, ValueError) as exc:
        return f"invalid image artifact {path}: {exc}"
    size_error = _validate_image_size(
        path,
        stats=stats,
        expected_size=expected_size,
    )
    if size_error:
        return size_error
    return _validate_image_visibility(path, stats=stats)


def _rgb_uint8_image(image: np.ndarray) -> np.ndarray:
    if image.ndim != 3 or image.shape[-1] < 3:
        raise ValueError(f"Expected RGB image array, got shape {image.shape}.")
    return np.clip(image[..., :3], 0, 255).astype(np.uint8)


def _validate_image_size(
    path: Path,
    *,
    stats: ImageArtifactStats,
    expected_size: tuple[int, int] | None,
) -> str | None:
    if expected_size is None or stats.size == expected_size:
        return None
    return (
        f"image artifact has wrong size: {path} "
        f"{stats.size[0]}x{stats.size[1]}, expected {expected_size[0]}x{expected_size[1]}"
    )


def _validate_image_visibility(
    path: Path,
    *,
    stats: ImageArtifactStats,
) -> str | None:
    if stats.channel_span > MIN_VISIBLE_CHANNEL_SPAN:
        return None
    return f"blank image artifact: {path}"
