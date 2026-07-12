"""Trajectory-divergence analysis between two simulators' episode traces.

The cross-sim comparison in ``scenario_compare`` diffs *final* state — it answers
"they ended N mm apart" but not *when* or *around what event* two simulators
began to disagree. The per-step ``trace.ndjson`` each episode already records
(robot joint positions + object poses per control step, same ``t_ms`` grid)
holds that information; this module reads two such traces, time-aligns them, and
emits a divergence-over-time series plus the first "split point" where the
trajectories cross a divergence threshold.

That is the difference between *measuring* divergence (final delta) and
*localizing* it ("they tracked identically until the grasp at t=1.3s, then
split") — the latter points attribution at a moment/event rather than a number.

Input records are ``WorldRolloutTraceRecord`` NDJSON lines with streams
``robot_joints`` (``state.joint_positions``) and ``objects``
(``state[object_id] = {position_xyz, quat_wxyz}``). Both streams are written
with the same ``t_ms`` in one control step, so records group into per-step
frames keyed by ``t_ms``.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Stream names mirror scenario_runtime.trace_writer; duplicated here to keep this
# analysis module free of a runtime import (it consumes on-disk artifacts only).
_STREAM_ROBOT_JOINTS = "robot_joints"
_STREAM_OBJECTS = "objects"

# Default split thresholds. A trajectory pair is "split" at the first timestamp
# where either metric exceeds its threshold: 1 cm of object position drift or
# ~2.9 deg (0.05 rad) of joint RMSE. Chosen well above float/step jitter but
# below the scale of a genuine behavioral divergence (dropped object, missed
# grasp). Callers can override both.
_DEFAULT_POSITION_SPLIT_M = 0.01
_DEFAULT_JOINT_SPLIT_RAD = 0.05

# Cap on emitted series points so the comparison JSON (and the HTML report that
# plots it) stays bounded regardless of episode length; the series is uniformly
# downsampled to at most this many samples, always keeping the last frame.
_MAX_SERIES_POINTS = 200


@dataclass
class _Frame:
    t_ms: int
    joints: dict[str, float]
    objects: dict[str, dict[str, list[float]]]


def load_trajectory(trace_path: Path) -> list[_Frame]:
    """Parse a ``trace.ndjson`` into time-ordered per-step frames.

    Records sharing a ``t_ms`` are merged into one frame (joints + objects are
    logged separately within the same control step). Malformed lines and
    unrelated streams (e.g. ``policy_action``) are skipped. Returns frames
    sorted by ``t_ms``.
    """
    frames: dict[int, _Frame] = {}
    with trace_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            stream = record.get("stream")
            state = record.get("state")
            t_ms = record.get("t_ms")
            if not isinstance(t_ms, int) or not isinstance(state, dict):
                continue
            frame = frames.get(t_ms)
            if frame is None:
                frame = _Frame(t_ms=t_ms, joints={}, objects={})
                frames[t_ms] = frame
            if stream == _STREAM_ROBOT_JOINTS:
                positions = state.get("joint_positions")
                if isinstance(positions, dict):
                    frame.joints.update(
                        {name: float(value) for name, value in positions.items()}
                    )
            elif stream == _STREAM_OBJECTS:
                for object_id, pose in state.items():
                    if isinstance(pose, dict) and "position_xyz" in pose:
                        frame.objects[object_id] = pose
    return [frames[t_ms] for t_ms in sorted(frames)]


def _joint_rmse(joints_a: dict[str, float], joints_b: dict[str, float]) -> float | None:
    shared = sorted(set(joints_a) & set(joints_b))
    if not shared:
        return None
    return math.sqrt(
        sum((joints_a[name] - joints_b[name]) ** 2 for name in shared) / len(shared)
    )


def _object_deltas(
    objects_a: dict[str, dict[str, list[float]]],
    objects_b: dict[str, dict[str, list[float]]],
) -> tuple[float | None, float | None]:
    """Max position (m) and rotation (rad) delta across shared objects."""
    shared = sorted(set(objects_a) & set(objects_b))
    if not shared:
        return None, None
    max_position = 0.0
    max_rotation = 0.0
    for object_id in shared:
        pose_a = objects_a[object_id]
        pose_b = objects_b[object_id]
        position_a = pose_a["position_xyz"]
        position_b = pose_b["position_xyz"]
        max_position = max(
            max_position,
            math.sqrt(sum((a - b) ** 2 for a, b in zip(position_a, position_b))),
        )
        quat_a = pose_a.get("quat_wxyz")
        quat_b = pose_b.get("quat_wxyz")
        if quat_a and quat_b:
            # Quaternion geodesic angle, invariant to sign (q and -q are equal).
            dot = abs(sum(a * b for a, b in zip(quat_a, quat_b)))
            max_rotation = max(max_rotation, 2.0 * math.acos(min(1.0, max(-1.0, dot))))
    return max_position, max_rotation


def _align(times_a: list[int], times_b: list[int], tol_ms: float) -> list[tuple[int, int]]:
    """Match each A timestamp to the nearest B timestamp within ``tol_ms``.

    Two-pointer sweep over sorted timestamps: O(n+m). Both traces share the same
    nominal control grid, so most matches are exact; the tolerance absorbs
    sub-step jitter between engines. Unmatched A frames are dropped.
    """
    if not times_b:
        return []
    pairs: list[tuple[int, int]] = []
    j = 0
    for ta in times_a:
        while j + 1 < len(times_b) and abs(times_b[j + 1] - ta) <= abs(times_b[j] - ta):
            j += 1
        if abs(times_b[j] - ta) <= tol_ms:
            pairs.append((ta, times_b[j]))
    return pairs


def _median_step_ms(times: list[int]) -> float:
    if len(times) < 2:
        return 1.0
    steps = sorted(times[i + 1] - times[i] for i in range(len(times) - 1))
    mid = len(steps) // 2
    if len(steps) % 2:
        return float(steps[mid])
    return (steps[mid - 1] + steps[mid]) / 2.0


def _downsample(series: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(series) <= _MAX_SERIES_POINTS:
        return series
    stride = math.ceil(len(series) / _MAX_SERIES_POINTS)
    sampled = series[::stride]
    if sampled[-1] is not series[-1]:
        sampled.append(series[-1])
    return sampled


def compare_trajectories(
    trace_path_a: Path,
    trace_path_b: Path,
    *,
    position_split_m: float = _DEFAULT_POSITION_SPLIT_M,
    joint_split_rad: float = _DEFAULT_JOINT_SPLIT_RAD,
) -> dict[str, Any] | None:
    """Time-align two episode traces and localize where they diverge.

    Returns a JSON-serializable divergence report, or ``None`` if either trace is
    missing/unreadable or the two share no comparable, time-alignable frames.
    """
    if not trace_path_a.is_file() or not trace_path_b.is_file():
        return None
    frames_a = load_trajectory(trace_path_a)
    frames_b = load_trajectory(trace_path_b)
    if not frames_a or not frames_b:
        return None

    by_t_b = {frame.t_ms: frame for frame in frames_b}
    times_a = [frame.t_ms for frame in frames_a]
    times_b = [frame.t_ms for frame in frames_b]
    # Half a control step tolerance: close enough to be "the same instant",
    # tight enough not to pair adjacent steps.
    tol_ms = max(1.0, _median_step_ms(times_a) / 2.0)
    pairs = _align(times_a, times_b, tol_ms)

    frame_a_by_t = {frame.t_ms: frame for frame in frames_a}
    series: list[dict[str, Any]] = []
    max_joint_rmse = 0.0
    max_position = 0.0
    max_rotation = 0.0
    split: dict[str, Any] | None = None
    for ta, tb in pairs:
        frame_a = frame_a_by_t[ta]
        frame_b = by_t_b[tb]
        joint_rmse = _joint_rmse(frame_a.joints, frame_b.joints)
        position_delta, rotation_delta = _object_deltas(frame_a.objects, frame_b.objects)
        if joint_rmse is None and position_delta is None:
            continue
        sample = {
            "t_ms": ta,
            "joint_rmse_rad": joint_rmse,
            "object_position_delta_m": position_delta,
            "object_rotation_delta_rad": rotation_delta,
        }
        series.append(sample)
        if joint_rmse is not None:
            max_joint_rmse = max(max_joint_rmse, joint_rmse)
        if position_delta is not None:
            max_position = max(max_position, position_delta)
        if rotation_delta is not None:
            max_rotation = max(max_rotation, rotation_delta)
        if split is None:
            if position_delta is not None and position_delta > position_split_m:
                split = {
                    "t_ms": ta,
                    "metric": "object_position_delta_m",
                    "value": position_delta,
                    "threshold": position_split_m,
                }
            elif joint_rmse is not None and joint_rmse > joint_split_rad:
                split = {
                    "t_ms": ta,
                    "metric": "joint_rmse_rad",
                    "value": joint_rmse,
                    "threshold": joint_split_rad,
                }

    if not series:
        return None

    final = series[-1]
    return {
        "schema": "scenario_trajectory_divergence.v1",
        "compared_frames": len(series),
        "duration_ms": final["t_ms"],
        "joint_rmse_rad": {"max": max_joint_rmse, "final": final["joint_rmse_rad"]},
        "object_position_delta_m": {"max": max_position, "final": final["object_position_delta_m"]},
        "object_rotation_delta_rad": {"max": max_rotation, "final": final["object_rotation_delta_rad"]},
        "split": split,
        "series": _downsample(series),
    }
