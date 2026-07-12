from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.services.scenario_trace_divergence import (
    compare_trajectories,
    load_trajectory,
)


def _write_trace(path: Path, frames: list[dict]) -> None:
    """frames: [{t_ms, joints: {name: pos}, objects: {id: (pos_xyz, quat_wxyz)}}]."""
    lines: list[str] = []
    for frame in frames:
        t_ms = frame["t_ms"]
        if "joints" in frame:
            lines.append(
                json.dumps(
                    {
                        "t_ms": t_ms,
                        "stream": "robot_joints",
                        "state": {"joint_positions": frame["joints"]},
                    }
                )
            )
        if "objects" in frame:
            lines.append(
                json.dumps(
                    {
                        "t_ms": t_ms,
                        "stream": "objects",
                        "state": {
                            object_id: {
                                "position_xyz": list(position),
                                "quat_wxyz": list(quat),
                            }
                            for object_id, (position, quat) in frame["objects"].items()
                        },
                    }
                )
            )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _linear_frames(*, carton_drift_per_step: float, n: int = 10) -> list[dict]:
    frames = []
    for step in range(n):
        t_ms = step * 20  # 50 Hz control step
        frames.append(
            {
                "t_ms": t_ms,
                "joints": {"gantry_x": 0.01 * step, "gantry_y": 0.0},
                "objects": {
                    "carton_1": (
                        (0.45, 0.30 + carton_drift_per_step * step, 0.80),
                        (1.0, 0.0, 0.0, 0.0),
                    )
                },
            }
        )
    return frames


def test_load_trajectory_merges_streams_by_t_ms(tmp_path: Path) -> None:
    path = tmp_path / "trace.ndjson"
    _write_trace(path, _linear_frames(carton_drift_per_step=0.0, n=3))
    frames = load_trajectory(path)
    assert [f.t_ms for f in frames] == [0, 20, 40]
    assert frames[0].joints == {"gantry_x": 0.0, "gantry_y": 0.0}
    assert frames[0].objects["carton_1"]["position_xyz"] == [0.45, 0.30, 0.80]


def test_identical_trajectories_have_no_split(tmp_path: Path) -> None:
    frames = _linear_frames(carton_drift_per_step=0.0)
    _write_trace(tmp_path / "a.ndjson", frames)
    _write_trace(tmp_path / "b.ndjson", frames)

    result = compare_trajectories(tmp_path / "a.ndjson", tmp_path / "b.ndjson")

    assert result is not None
    assert result["split"] is None
    assert result["object_position_delta_m"]["max"] == pytest.approx(0.0)
    assert result["joint_rmse_rad"]["max"] == pytest.approx(0.0)
    assert result["compared_frames"] == 10


def test_divergence_localizes_split_point(tmp_path: Path) -> None:
    # A holds the carton still; B drifts it 4mm/step. Crosses the 1cm default
    # split threshold at step 3 (12mm) -> t_ms == 60.
    _write_trace(tmp_path / "a.ndjson", _linear_frames(carton_drift_per_step=0.0))
    _write_trace(tmp_path / "b.ndjson", _linear_frames(carton_drift_per_step=0.004))

    result = compare_trajectories(tmp_path / "a.ndjson", tmp_path / "b.ndjson")

    assert result is not None
    assert result["split"] is not None
    assert result["split"]["t_ms"] == 60
    assert result["split"]["metric"] == "object_position_delta_m"
    assert result["object_position_delta_m"]["final"] == pytest.approx(0.036, abs=1e-6)


def test_missing_trace_returns_none(tmp_path: Path) -> None:
    _write_trace(tmp_path / "a.ndjson", _linear_frames(carton_drift_per_step=0.0))
    assert compare_trajectories(tmp_path / "a.ndjson", tmp_path / "missing.ndjson") is None


def test_time_grids_align_within_tolerance(tmp_path: Path) -> None:
    # B is offset by 1ms per frame (sub-step jitter); frames should still pair
    # up rather than being dropped.
    frames_a = _linear_frames(carton_drift_per_step=0.0, n=5)
    frames_b = [{**f, "t_ms": f["t_ms"] + 1} for f in _linear_frames(carton_drift_per_step=0.0, n=5)]
    _write_trace(tmp_path / "a.ndjson", frames_a)
    _write_trace(tmp_path / "b.ndjson", frames_b)

    result = compare_trajectories(tmp_path / "a.ndjson", tmp_path / "b.ndjson")

    assert result is not None
    assert result["compared_frames"] == 5
