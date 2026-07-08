"""Per-episode MP4 rendering from a recorded trace (headless-safe)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

pytest.importorskip("imageio")
pytest.importorskip("imageio_ffmpeg")
pytest.importorskip("PIL")

from backend.services.scenario_video import ScenarioVideoError, render_episode_video

_WORLD = {
    "world": {
        "objects": [
            {
                "id": "table",
                "type": "cube",
                "position_xyz": [0.45, 0.0, 0.36],
                "size_xyz": [0.7, 0.9, 0.72],
                "color": "#8b5cf6",
                "physics": {"fixed": True},
            },
            {
                "id": "carton_1",
                "type": "cube",
                "position_xyz": [0.4, -0.15, 0.75],
                "size_xyz": [0.07, 0.07, 0.07],
                "color": "#ef4444",
                "physics": {"fixed": False},
            },
        ]
    }
}


def _write_trace(path: Path, frames: int = 30) -> None:
    lines = []
    for i in range(frames):
        y = -0.15 + 0.45 * (i / (frames - 1))
        lines.append(
            json.dumps(
                {
                    "t_ms": i * 20,
                    "stream": "objects",
                    "state": {"carton_1": {"position_xyz": [0.42, y, 0.78], "quat_wxyz": [1, 0, 0, 0]}},
                }
            )
        )
        lines.append(json.dumps({"t_ms": i * 20, "stream": "robot_joints", "state": {"joint_positions": {}}}))
    path.write_text("\n".join(lines), encoding="utf-8")


def test_renders_valid_mp4(tmp_path: Path) -> None:
    trace = tmp_path / "trace.ndjson"
    _write_trace(trace)

    output = render_episode_video(
        trace_path=trace, world_payload=_WORLD, output_path=tmp_path / "episode.mp4"
    )

    assert output is not None and output.is_file()
    # MP4 container starts with an ftyp box.
    header = output.read_bytes()[:12]
    assert b"ftyp" in header
    assert output.stat().st_size > 0


def test_raises_when_trace_has_no_object_frames(tmp_path: Path) -> None:
    trace = tmp_path / "trace.ndjson"
    trace.write_text(
        json.dumps({"t_ms": 0, "stream": "robot_joints", "state": {"joint_positions": {}}}),
        encoding="utf-8",
    )

    with pytest.raises(ScenarioVideoError, match="no object frames"):
        render_episode_video(trace_path=trace, world_payload=_WORLD, output_path=tmp_path / "x.mp4")


def test_downsamples_long_traces(tmp_path: Path) -> None:
    trace = tmp_path / "trace.ndjson"
    _write_trace(trace, frames=2000)

    output = render_episode_video(
        trace_path=trace, world_payload=_WORLD, output_path=tmp_path / "episode.mp4", fps=20
    )

    assert output is not None and output.is_file()
