"""WSP Evaluation Baselines — five detection methods for corrupted robot traces.

Each method returns (score: float, runtime_ms: float) where score 1.0 = corrupted.
No sklearn — uses numpy only for any statistical computations.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass

import numpy as np

from backend.models.physical_state import PhysicalRolloutTrace


# ── ZscoreStats ───────────────────────────────────────────────────────────────

@dataclass
class ZscoreStats:
    mean_ee_vel: float
    std_ee_vel: float
    mean_max_vel: float
    std_max_vel: float
    mean_traj_len: float
    std_traj_len: float


# ── Helpers ───────────────────────────────────────────────────────────────────

def _dist3(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


def _find_robot_entity(trace: PhysicalRolloutTrace):
    """Return first robot-type entity found across all frames, or None."""
    for frame in trace.frames:
        for entity in frame.entities:
            if entity.entity_type == "robot":
                return entity
    return None


def _robot_positions(trace: PhysicalRolloutTrace) -> list[list[float]]:
    """Return list of robot entity positions across frames, in frame order."""
    positions = []
    for frame in trace.frames:
        for entity in frame.entities:
            if entity.entity_type == "robot":
                positions.append(list(entity.position_xyz))
                break
    return positions


def _frame_timestamps(trace: PhysicalRolloutTrace) -> list[int]:
    return [f.t_ms for f in trace.frames]


# ── Method 1: schema_check_score ─────────────────────────────────────────────

def schema_check_score(trace: PhysicalRolloutTrace) -> tuple[float, float]:
    """Structural schema checks: NaN/inf, empty frames, wrong joint count, duplicate IDs.

    Returns (score, runtime_ms). score=1.0 means corrupted detected.
    """
    t0 = time.perf_counter()

    for frame in trace.frames:
        # Empty frame check
        if not frame.entities:
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            return 1.0, elapsed_ms

        # Duplicate entity IDs within a frame
        ids = [e.entity_id for e in frame.entities]
        if len(ids) != len(set(ids)):
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            return 1.0, elapsed_ms

        for entity in frame.entities:
            # NaN or inf in position_xyz
            for v in entity.position_xyz:
                if not math.isfinite(v):
                    elapsed_ms = (time.perf_counter() - t0) * 1000.0
                    return 1.0, elapsed_ms

            # joint_state_deg length check (must be 6 if present)
            joint_state = entity.metadata.get("joint_state_deg")
            if joint_state is not None and len(joint_state) != 6:
                elapsed_ms = (time.perf_counter() - t0) * 1000.0
                return 1.0, elapsed_ms

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    return 0.0, elapsed_ms


# ── Method 2: range_check_score ──────────────────────────────────────────────

def range_check_score(trace: PhysicalRolloutTrace) -> tuple[float, float]:
    """Range checks: joint limits, timestamp monotonicity, position bounds.

    Returns (score, runtime_ms). score=1.0 means corrupted detected.
    """
    t0 = time.perf_counter()

    _MAX_JOINT_DEG = 200.0   # physical max for any SO-1xx joint
    _MAX_POS_M = 1.5          # max absolute position component

    timestamps = _frame_timestamps(trace)
    # Check monotonically increasing timestamps
    for i in range(1, len(timestamps)):
        if timestamps[i] < timestamps[i - 1]:
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            return 1.0, elapsed_ms

    for frame in trace.frames:
        for entity in frame.entities:
            # Position bounds
            for v in entity.position_xyz:
                if abs(v) > _MAX_POS_M:
                    elapsed_ms = (time.perf_counter() - t0) * 1000.0
                    return 1.0, elapsed_ms

            # Joint value range
            joint_state = entity.metadata.get("joint_state_deg")
            if joint_state is not None:
                for val in joint_state:
                    if abs(float(val)) > _MAX_JOINT_DEG:
                        elapsed_ms = (time.perf_counter() - t0) * 1000.0
                        return 1.0, elapsed_ms

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    return 0.0, elapsed_ms


# ── Method 3: kinematic_check_score ──────────────────────────────────────────

def kinematic_check_score(
    trace: PhysicalRolloutTrace,
    *,
    max_ee_vel_m_per_ms: float = 0.015,
    contact_proximity_m: float = 0.20,
) -> tuple[float, float]:
    """Kinematic checks: EE velocity, contact relation validity, duplicate timestamps.

    Returns (score, runtime_ms). score=1.0 means corrupted, 0.5 suspicious.
    """
    t0 = time.perf_counter()

    timestamps = _frame_timestamps(trace)
    positions = _robot_positions(trace)

    # Check impossible EE velocity: consecutive delta / dt > threshold
    for i in range(1, len(positions)):
        dt = timestamps[i] - timestamps[i - 1] if i < len(timestamps) else 1
        if dt <= 0:
            dt = 1  # avoid division by zero; monotonicity already caught by range_check
        dist = _dist3(positions[i], positions[i - 1])
        vel = dist / float(dt)
        if vel > max_ee_vel_m_per_ms:
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            return 1.0, elapsed_ms

    # Check contact relations for impossible distance
    for frame in trace.frames:
        entity_map = {e.entity_id: e for e in frame.entities}
        for rel in frame.relations:
            if rel.relation_type == "contacts":
                src = entity_map.get(rel.source_id)
                tgt = entity_map.get(rel.target_id)
                if src is not None and tgt is not None:
                    dist = _dist3(src.position_xyz, tgt.position_xyz)
                    if dist > contact_proximity_m:
                        elapsed_ms = (time.perf_counter() - t0) * 1000.0
                        return 1.0, elapsed_ms

    # Check duplicate consecutive timestamps with identical positions (suspicious)
    for i in range(1, len(timestamps)):
        if timestamps[i] == timestamps[i - 1]:
            if i < len(positions) and i - 1 < len(positions):
                if positions[i] == positions[i - 1]:
                    elapsed_ms = (time.perf_counter() - t0) * 1000.0
                    return 0.5, elapsed_ms

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    return 0.0, elapsed_ms


# ── Method 4: wsp_audit_score ────────────────────────────────────────────────

def wsp_audit_score(trace: PhysicalRolloutTrace) -> tuple[float, float]:
    """Run WSP deterministic audit on the trace.

    Returns (score, runtime_ms):
      - 1.0 if any reject or stop decision
      - 0.5 if any warn
      - 0.0 if all allow
    """
    from backend.services.executability_audit import audit_physical_rollout_trace

    t0 = time.perf_counter()

    try:
        report = audit_physical_rollout_trace(trace)
    except Exception:
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        # If audit raises (e.g. due to bad entity refs), treat as corrupted
        return 1.0, elapsed_ms

    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    if report.reject_count > 0 or report.stop_count > 0:
        return 1.0, elapsed_ms
    if report.warn_count > 0:
        return 0.5, elapsed_ms
    return 0.0, elapsed_ms


# ── Method 5: learned_zscore_score ───────────────────────────────────────────

def _trace_features(trace: PhysicalRolloutTrace) -> tuple[float, float, float]:
    """Compute (mean_ee_vel, max_ee_vel, total_traj_len) for a trace."""
    positions = _robot_positions(trace)
    timestamps = _frame_timestamps(trace)

    if len(positions) < 2:
        return 0.0, 0.0, 0.0

    vels: list[float] = []
    traj_len = 0.0
    for i in range(1, len(positions)):
        dt = timestamps[i] - timestamps[i - 1] if i < len(timestamps) else 1
        if dt <= 0:
            dt = 1
        dist = _dist3(positions[i], positions[i - 1])
        traj_len += dist
        vels.append(dist / float(dt))

    if not vels:
        return 0.0, 0.0, traj_len

    mean_vel = float(np.mean(vels))
    max_vel = float(np.max(vels))
    return mean_vel, max_vel, traj_len


def fit_zscore_stats(clean_traces: list[PhysicalRolloutTrace]) -> ZscoreStats:
    """Fit Z-score statistics from a set of clean traces."""
    ee_vels: list[float] = []
    max_vels: list[float] = []
    traj_lens: list[float] = []

    for trace in clean_traces:
        mean_v, max_v, tlen = _trace_features(trace)
        ee_vels.append(mean_v)
        max_vels.append(max_v)
        traj_lens.append(tlen)

    def _safe_std(vals: list[float]) -> float:
        s = float(np.std(vals)) if vals else 1.0
        return s if s > 1e-9 else 1.0

    return ZscoreStats(
        mean_ee_vel=float(np.mean(ee_vels)) if ee_vels else 0.0,
        std_ee_vel=_safe_std(ee_vels),
        mean_max_vel=float(np.mean(max_vels)) if max_vels else 0.0,
        std_max_vel=_safe_std(max_vels),
        mean_traj_len=float(np.mean(traj_lens)) if traj_lens else 0.0,
        std_traj_len=_safe_std(traj_lens),
    )


def learned_zscore_score(
    trace: PhysicalRolloutTrace,
    stats: ZscoreStats,
) -> tuple[float, float]:
    """Z-score anomaly detector using trace kinematics.

    Returns (score, runtime_ms). score = sigmoid(max(0, z-2)).
    """
    t0 = time.perf_counter()

    robot = _find_robot_entity(trace)
    if robot is None:
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return 0.0, elapsed_ms

    mean_v, max_v, tlen = _trace_features(trace)

    z_mean_vel = abs(mean_v - stats.mean_ee_vel) / stats.std_ee_vel
    z_max_vel = abs(max_v - stats.mean_max_vel) / stats.std_max_vel
    z_traj = abs(tlen - stats.mean_traj_len) / stats.std_traj_len

    max_z = max(z_mean_vel, z_max_vel, z_traj)
    # Sigmoid: 1 / (1 + exp(-max(0, z-2)))
    shifted = max(0.0, max_z - 2.0)
    score = 1.0 / (1.0 + math.exp(-shifted))

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    return float(score), elapsed_ms
