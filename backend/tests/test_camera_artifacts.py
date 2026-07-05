from __future__ import annotations

from pathlib import Path

import numpy as np

from backend.services.simulator_adapters.camera_artifacts import (
    camera_artifact_name,
    safe_artifact_name,
    validate_visible_rgb_image,
    write_rgb_image,
)


def test_safe_artifact_name_sanitizes_default_name_when_camera_name_is_blank() -> None:
    assert safe_artifact_name("   ", default_name="scene camera") == "scene_camera"


def test_safe_artifact_name_falls_back_to_stable_default_when_names_are_blank() -> None:
    assert safe_artifact_name("...", default_name="   ") == "artifact"


def test_camera_artifact_name_uses_sanitized_fallback_name() -> None:
    assert (
        camera_artifact_name(index=3, camera_name="...", default_name="scene camera")
        == "03_scene_camera.png"
    )


def test_validate_visible_rgb_image_accepts_written_rgb_image(tmp_path: Path) -> None:
    image_path = tmp_path / "camera.png"
    write_rgb_image(
        image_path,
        np.array(
            [
                [[0, 0, 0], [10, 10, 10]],
                [[20, 20, 20], [255, 255, 255]],
            ],
            dtype=np.uint8,
        ),
    )

    assert validate_visible_rgb_image(image_path, expected_size=(2, 2)) is None
