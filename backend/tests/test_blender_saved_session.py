from __future__ import annotations

import subprocess
from pathlib import Path

from backend.services.simulator_adapters.blender_saved_session import (
    BLENDER_BLEND_VALIDATE_MARKER,
    read_blender_validate_payload,
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
                '{"bounded_world_object_count": 2, "camera_count": 3, '
                '"visible_world_object_count": 2, "world_object_count": 2}\n'
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
                '{"bounded_world_object_count": 0, "camera_count": 3, '
                '"visible_world_object_count": 0, "world_object_count": 0}\n'
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


def test_blender_blend_validator_rejects_invisible_saved_layout_objects(
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
                '{"bounded_world_object_count": 2, "camera_count": 3, '
                '"visible_world_object_count": 1, "world_object_count": 2}\n'
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
    ) == "Blender saved-session visible world object count mismatch: 1, expected 2"


def test_blender_blend_validator_rejects_zero_bound_saved_layout_objects(
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
                '{"bounded_world_object_count": 1, "camera_count": 3, '
                '"visible_world_object_count": 2, "world_object_count": 2}\n'
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
    ) == "Blender saved-session bounded world object count mismatch: 1, expected 2"


def test_read_blender_validate_payload_ignores_malformed_marker_before_valid_payload() -> None:
    payload = read_blender_validate_payload(
        "\n".join(
            (
                f"{BLENDER_BLEND_VALIDATE_MARKER}{{not-json}}",
                "Blender log noise",
                (
                    f"{BLENDER_BLEND_VALIDATE_MARKER}"
                    '{"bounded_world_object_count": 2, "camera_count": 3, '
                    '"visible_world_object_count": 2, "world_object_count": 2}'
                ),
            )
        )
    )

    assert payload == {
        "bounded_world_object_count": 2,
        "camera_count": 3,
        "visible_world_object_count": 2,
        "world_object_count": 2,
    }


def test_blender_blend_validator_reports_timeout(monkeypatch, tmp_path: Path) -> None:
    blend_path = tmp_path / "layout.blend"
    blend_path.write_text("fake blend", encoding="utf-8")

    def fake_run(command, **_kwargs):
        raise subprocess.TimeoutExpired(command, timeout=60.0)

    monkeypatch.setattr(
        "backend.services.simulator_adapters.blender_saved_session.subprocess.run",
        fake_run,
    )

    assert validate_blender_blend_artifact(
        blend_path,
        blender_executable="/usr/bin/blender",
        expected_object_count=2,
        expected_camera_count=3,
    ) == "Blender saved-session validation timed out after 60.0s"


def test_blender_blend_validator_script_only_suppresses_bound_math_errors(
    monkeypatch,
    tmp_path: Path,
) -> None:
    blend_path = tmp_path / "layout.blend"
    blend_path.write_text("fake blend", encoding="utf-8")
    captured_command: list[str] = []

    def fake_run(command, **_kwargs):
        captured_command.extend(command)
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=(
                f"{BLENDER_BLEND_VALIDATE_MARKER}"
                '{"bounded_world_object_count": 1, "camera_count": 1, '
                '"visible_world_object_count": 1, "world_object_count": 1}\n'
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
            expected_object_count=1,
            expected_camera_count=1,
        )
        is None
    )

    script_argument = captured_command[captured_command.index("--python-expr") + 1]
    assert "except (AttributeError, TypeError, ValueError):" in script_argument
    assert ("except " + "Exception:") not in script_argument
