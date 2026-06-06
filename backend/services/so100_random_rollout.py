"""SO-100 arm rollout — thin wrapper over robot_rollout_generator.

Reads joint names and limits from the SO-100 URDF via yourdfpy.
Preserves the original public API for backward compatibility.
"""
from __future__ import annotations

import random
from pathlib import Path
from typing import Any

from backend.models.physical_state import PhysicalRolloutTrace
from backend.services.robot_rollout_generator import (
    ALL_SCENARIOS,
    DEFAULT_FRAME_COUNT,
    DEFAULT_SEED,
    SCENARIO_COLLISION,
    SCENARIO_CONTACT_INSTABILITY,
    SCENARIO_JOINT_LIMIT,
    SCENARIO_VALID,
    RobotRolloutConfig,
    UrdfEntry,
    WorkSurface,
    WorldObject,
    fk_position,
    generate_joint_trajectory_dicts,
    generate_rollout_batch,
    generate_rollout_trace,
    load_urdf_entry,
)

# ── SO-100 URDF ───────────────────────────────────────────────────────────────

_SO100_URDF_PATH = (
    Path(__file__).parents[2] / "third_party/so-arm100/Simulation/SO100/so100.urdf"
)
_SO100_EE_LINK = "jaw"

_SO100_URDF_XML: str = _SO100_URDF_PATH.read_text(encoding="utf-8")
_SO100_ENTRY: UrdfEntry = load_urdf_entry(_SO100_URDF_XML)

# ── Public constants derived from URDF ────────────────────────────────────────

JOINT_NAMES: list[str]   = _SO100_ENTRY.joint_names
JOINT_LOWER: list[float] = _SO100_ENTRY.joint_lower
JOINT_UPPER: list[float] = _SO100_ENTRY.joint_upper

MAX_VEL_RAD_S = 1.0
MAX_EFFORT_N  = 35.0

# Comfortable working pose — arm forward in the −Y direction at safe height.
# At pan=0 the SO-100 reaches in −Y; pan sweeps the X axis.
REST_POSE: list[float] = [0.0, 2.0, -0.5, 0.0, 0.0, 0.5]

FRAME_DT_MS = 100

# ── SO-100 rollout config ──────────────────────────────────────────────────────

_SO100_CONFIG = RobotRolloutConfig(
    urdf_xml=_SO100_URDF_XML,
    end_effector_link=_SO100_EE_LINK,
    entity_id="so100_arm",
    work_surface=WorkSurface(
        entity_id="work_surface",
        position_xyz=[0.0, 0.0, -0.025],
        size_xyz=[1.0, 0.8, 0.05],
    ),
    world_objects=[
        WorldObject(
            object_id="target_box",
            # Box placed in the arm's natural reach direction (−Y axis at pan=0)
            position_xyz=[0.0, -0.20, 0.025],
            size_xyz=[0.05, 0.05, 0.05],
            mass_kg=0.30,
            friction=0.45,
        )
    ],
    # lift=2.4, elbow=−0.7 → jaw z≈−0.022 m (verified via yourdfpy)
    collision_injection_joints={"shoulder_lift": 2.4, "elbow_flex": -0.7},
    workspace_bounds={
        "shoulder_pan":  (-0.7, 0.7),
        "shoulder_lift": (0.8, 1.8),
        "elbow_flex":    (-2.0, -0.5),
        "wrist_flex":    (-0.5, 0.5),
        "wrist_roll":    (-1.0, 1.0),
        "gripper":       (0.0, 1.5),
    },
    min_ee_z=0.02,
    contact_dist_m=0.07,
    robot_half_size_m=0.015,
    frame_dt_ms=FRAME_DT_MS,
    max_effort_n=MAX_EFFORT_N,
)


# ── Public backward-compatible API ─────────────────────────────────────────────

def fk_end_effector(q: list[float]) -> tuple[float, float, float]:
    """Return end-effector (x, y, z) in metres using yourdfpy FK."""
    joint_dict = dict(zip(JOINT_NAMES, q))
    pos = fk_position(_SO100_ENTRY, joint_dict, _SO100_EE_LINK)
    return (pos[0], pos[1], pos[2])


def joint_velocity_rad_s(
    q_prev: list[float], q_next: list[float], dt_s: float
) -> list[float]:
    return [round((q_next[i] - q_prev[i]) / dt_s, 5) for i in range(len(q_prev))]


def generate_joint_trajectory(
    frame_count: int,
    *,
    rng: random.Random,
    start: list[float] | None = None,   # ignored — kept for API compatibility
    inject_joint_violation_at: int | None = None,
    inject_collision_z_at: int | None = None,
) -> list[list[float]]:
    """Generate a joint trajectory as a list-of-lists (backward-compatible format)."""
    dict_traj = generate_joint_trajectory_dicts(
        _SO100_ENTRY,
        _SO100_CONFIG,
        frame_count,
        rng,
        inject_joint_violation_at=inject_joint_violation_at,
        collision_frame=inject_collision_z_at,
    )
    return [[q[name] for name in JOINT_NAMES] for q in dict_traj]


def generate_so100_rollout_trace(
    *,
    trace_id: str,
    scenario: str,
    frame_count: int = DEFAULT_FRAME_COUNT,
    rng: random.Random,
) -> PhysicalRolloutTrace:
    return generate_rollout_trace(
        _SO100_CONFIG,
        _SO100_ENTRY,
        trace_id=trace_id,
        scenario=scenario,
        frame_count=frame_count,
        rng=rng,
    )


def generate_so100_rollout_batch(
    count: int,
    *,
    seed: int = DEFAULT_SEED,
    frame_count: int = DEFAULT_FRAME_COUNT,
    scenario_weights: dict[str, float] | None = None,
) -> list[PhysicalRolloutTrace]:
    return generate_rollout_batch(
        _SO100_CONFIG,
        _SO100_ENTRY,
        count,
        seed=seed,
        frame_count=frame_count,
        scenario_weights=scenario_weights,
    )


def summarize_rollout_batch(traces: list[PhysicalRolloutTrace]) -> dict[str, Any]:
    scenario_counts: dict[str, int] = {}
    total_contact = 0
    for t in traces:
        s = str(t.metadata.get("scenario", "unknown"))
        scenario_counts[s] = scenario_counts.get(s, 0) + 1
        total_contact += sum(1 for f in t.frames if f.metadata.get("contact"))
    return {
        "total_traces": len(traces),
        "total_frames": sum(len(t.frames) for t in traces),
        "scenario_counts": scenario_counts,
        "total_contact_frames": total_contact,
    }
