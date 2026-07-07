from __future__ import annotations

from dataclasses import dataclass, field

Vector3 = tuple[float, float, float]
QuatWxyz = tuple[float, float, float, float]


@dataclass(frozen=True)
class ObjectPose:
    position_xyz: Vector3
    quat_wxyz: QuatWxyz


@dataclass(frozen=True)
class ContactRecord:
    body_a: str
    body_b: str
    position_xyz: Vector3


@dataclass(frozen=True)
class Observation:
    sim_time_s: float
    joint_positions: dict[str, float] = field(default_factory=dict)
    object_poses: dict[str, ObjectPose] = field(default_factory=dict)


@dataclass(frozen=True)
class SimState:
    """Full dynamic snapshot for tracing, divergence metrics, and set_state."""

    sim_time_s: float
    joint_positions: dict[str, float]
    joint_velocities: dict[str, float]
    object_poses: dict[str, ObjectPose]
