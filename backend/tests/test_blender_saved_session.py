from __future__ import annotations

import subprocess
from pathlib import Path

from backend.services.simulator_adapters.blender_saved_session import (
    BLENDER_BLEND_VALIDATE_MARKER,
    validate_blender_blend_artifact,
)


def test_blender_blend_validator_checks_saved_layout_counts(monkeypatch, tmp_path: Path) -> None:
    blend_path = tmp_path / "layout.blend"
    blend_path.write_text("fake blend", encoding="utf-8")

    def fake_run(command, **_kwargs):
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=(
                f"{BLENDER_BLEND_VALIDATE_MARKER}"
                '{"camera_count": 3, "world_object_count": 2}\n'
            ),
            stderr="",
        )

    monkeypatch.setattr(
        "backend.services.simulator_adapters.blender_saved_session.subprocess.run",
        fake_run,
    )

    assert (
        validate_blender_blend_artifact(
            blend_path,
            blender_executable="/usr/bin/blender",
            expected_object_count=2,
            expected_camera_count=3,
        )
        is None
    )


def test_blender_blend_validator_rejects_missing_saved_layout_objects(
    monkeypatch, tmp_path: Path
) -> None:
    blend_path = tmp_path / "layout.blend"
    blend_path.write_text("fake blend", encoding="utf-8")

    def fake_run(command, **_kwargs):
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=(
                f"{BLENDER_BLEND_VALIDATE_MARKER}"
                '{"camera_count": 3, "world_object_count": 0}\n'
            ),
            stderr="",
        )

    monkeypatch.setattr(
        "backend.services.simulator_adapters.blender_saved_session.subprocess.run",
        fake_run,
    )

    assert validate_blender_blend_artifact(
        blend_path,
        blender_executable="/usr/bin/blender",
        expected_object_count=2,
        expected_camera_count=3,
    ) == "Blender saved-session world object count mismatch: 0, expected 2"
