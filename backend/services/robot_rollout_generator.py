"""Generic URDF-backed robot rollout generator for the WSP pipeline.

Produces PhysicalRolloutTrace objects from any serial-chain robot defined
in URDF format, using yourdfpy for FK without hardcoded link lengths or limits.
"""
from __future__ import annotations

import hashlib
import math
import random
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import yourdfpy  # type: ignore

from backend.models.physical_state import (
    ActionToken,
    ConstraintToken,
    PhysicalEntity,
    PhysicalRelation,
    PhysicalRolloutTrace,
    PhysicalStateFrame,
)


@dataclass
class UrdfEntry:
    urdf: yourdfpy.URDF
    joint_names: list[str]
    joint_lower: list[float]
    joint_upper: list[float]


_URDF_CACHE: dict[str, UrdfEntry] = {}


def load_urdf_entry(urdf_xml: str) -> UrdfEntry:
    """Load and cache a URDF; extract actuated joint names and limits."""
    key = hashlib.sha256(urdf_xml.encode()).hexdigest()
    cached = _URDF_CACHE.get(key)
    if cached is not None:
        return cached
    with tempfile.NamedTemporaryFile("w", suffix=".urdf", delete=False) as tmp:
        tmp.write(urdf_xml)
        tmp_path = tmp.name
    try:
        urdf = yourdfpy.URDF.load(tmp_path)
    finally:
        Path(tmp_path).unlink(missing_ok=True)
    joint_names = list(urdf.actuated_joint_names)
    joint_lower: list[float] = []
    joint_upper: list[float] = []
    for name in joint_names:
        j = urdf.joint_map[name]
        lo = float(j.limit.lower) if j.limit else -math.pi
        hi = float(j.limit.upper) if j.limit else math.pi
        joint_lower.append(lo)
        joint_upper.append(hi)
    entry = UrdfEntry(
        urdf=urdf,
        joint_names=joint_names,
        joint_lower=joint_lower,
        joint_upper=joint_upper,
    )
    _URDF_CACHE[key] = entry
    return entry


def fk_position(
    entry: UrdfEntry,
    joint_dict: dict[str, float],
    target_link: str,
) -> list[float]:
    """Return [x, y, z] of target_link for the given joint configuration."""
    cfg = {name: joint_dict.get(name, 0.0) for name in entry.joint_names}
    entry.urdf.update_cfg(cfg)
    transform = np.asarray(entry.urdf.get_transform(target_link), dtype=np.float64)
    return [round(float(v), 5) for v in transform[:3, 3]]


@dataclass
class WorldObject:
    object_id: str
    position_xyz: list[float]
    size_xyz: list[float]
    mass_kg: float = 1.0
    friction: float = 0.5
    movable: bool = True


@dataclass
class WorkSurface:
    entity_id: str = "work_surface"
    position_xyz: list[float] = field(default_factory=lambda: [0.0, 0.0, -0.025])
    size_xyz: list[float] = field(default_factory=lambda: [1.0, 0.8, 0.05])


@dataclass
class RobotRolloutConfig:
    urdf_xml: str
    end_effector_link: str
    entity_id: str
    work_surface: WorkSurface
    world_objects: list[WorldObject] = field(default_factory=list)
    collision_injection_joints: dict[str, float] = field(default_factory=dict)
    workspace_bounds: dict[str, tuple[float, float]] = field(default_factory=dict)
    min_ee_z: float = 0.02
    contact_dist_m: float = 0.07
    robot_half_size_m: float = 0.015
    frame_dt_ms: int = 100
    max_effort_n: float = 35.0

SCENARIO_VALID = "valid"
SCENARIO_JOINT_LIMIT = "joint_limit_violation"
SCENARIO_CONTACT_INSTABILITY = "contact_instability"
SCENARIO_COLLISION = "collision"
ALL_SCENARIOS = [
    SCENARIO_VALID,
    SCENARIO_JOINT_LIMIT,
    SCENARIO_CONTACT_INSTABILITY,
    SCENARIO_COLLISION,
]

DEFAULT_FRAME_COUNT = 20
DEFAULT_SEED = 42

_CONTACT_INSTABILITY_MASS_KG = 45.0
_VEL_DECAY = 0.60


def _effective_bounds(
    entry: UrdfEntry,
    workspace_bounds: dict[str, tuple[float, float]],
) -> dict[str, tuple[float, float]]:
    bounds: dict[str, tuple[float, float]] = {}
    for i, name in enumerate(entry.joint_names):
        lo, hi = entry.joint_lower[i], entry.joint_upper[i]
        if name in workspace_bounds:
            lo, hi = workspace_bounds[name]
        bounds[name] = (lo, hi)
    return bounds


def _midpoint_pose(bounds: dict[str, tuple[float, float]]) -> dict[str, float]:
    return {name: (bounds[name][0] + bounds[name][1]) / 2.0 for name in bounds}


def generate_joint_trajectory_dicts(
    entry: UrdfEntry,
    config: RobotRolloutConfig,
    frame_count: int,
    rng: random.Random,
    *,
    inject_joint_violation_at: int | None = None,
    collision_frame: int | None = None,
) -> list[dict[str, float]]:
    """Generate a trajectory as a list of {joint_name: angle} dicts.

    Samples random waypoints within workspace_bounds (or URDF limits),
    filters out waypoints where the EE is below min_ee_z, then interpolates.
    """
    bounds = _effective_bounds(entry, config.workspace_bounds)
    rest = _midpoint_pose(bounds)

    def _random_waypoint() -> dict[str, float]:
        for _ in range(30):
            q = {
                name: round(rng.uniform(bounds[name][0], bounds[name][1]), 4)
                for name in entry.joint_names
            }
            if fk_position(entry, q, config.end_effector_link)[2] >= config.min_ee_z:
                return q
        return dict(rest)

    n_waypoints = 3
    waypoints = [dict(rest)] + [_random_waypoint() for _ in range(n_waypoints)]
    frames_per_seg = max(1, frame_count // n_waypoints)

    trajectory: list[dict[str, float]] = []
    for seg in range(n_waypoints):
        q_start  = waypoints[seg]
        q_end    = waypoints[seg + 1]
        seg_len  = (
            frames_per_seg
            if seg < n_waypoints - 1
            else frame_count - len(trajectory)
        )
        for step in range(seg_len):
            t = step / max(seg_len - 1, 1)
            q = {
                name: round(q_start[name] + t * (q_end[name] - q_start[name]), 5)
                for name in entry.joint_names
            }
            for i, name in enumerate(entry.joint_names):
                q[name] = max(entry.joint_lower[i], min(entry.joint_upper[i], q[name]))
            trajectory.append(q)

    while len(trajectory) < frame_count:
        trajectory.append(dict(trajectory[-1]))
    trajectory = trajectory[:frame_count]

    if inject_joint_violation_at is not None and 0 <= inject_joint_violation_at < frame_count:
        frame = dict(trajectory[inject_joint_violation_at])
        first_joint = entry.joint_names[0]
        frame[first_joint] = round(entry.joint_upper[0] * 1.10, 4)
        trajectory[inject_joint_violation_at] = frame

    if (
        collision_frame is not None
        and 0 <= collision_frame < frame_count
        and config.collision_injection_joints
    ):
        frame = dict(trajectory[collision_frame])
        frame.update(config.collision_injection_joints)
        trajectory[collision_frame] = frame

    return trajectory


@dataclass
class _BoxState:
    pos: list[float]
    vel: list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])

    def apply_contact(
        self,
        ee_xyz: list[float],
        ee_vel: list[float],
        contact_dist: float,
    ) -> bool:
        dist_xy = math.hypot(self.pos[0] - ee_xyz[0], self.pos[1] - ee_xyz[1])
        if dist_xy < contact_dist and ee_xyz[2] < 0.20:
            impulse = 0.35
            self.vel[0] += -ee_vel[0] * impulse
            self.vel[1] += -ee_vel[1] * impulse
            return True
        return False

    def step(self, dt_s: float) -> None:
        self.pos[0] = round(self.pos[0] + self.vel[0] * dt_s, 5)
        self.pos[1] = round(self.pos[1] + self.vel[1] * dt_s, 5)
        self.vel[0] = round(self.vel[0] * _VEL_DECAY, 5)
        self.vel[1] = round(self.vel[1] * _VEL_DECAY, 5)

    def snapshot(self) -> tuple[list[float], list[float]]:
        return self.pos[:], self.vel[:]


def _robot_entity(
    config: RobotRolloutConfig,
    joint_dict: dict[str, float],
    ee_xyz: list[float],
    vel_xyz: list[float],
) -> PhysicalEntity:
    h = config.robot_half_size_m
    return PhysicalEntity(
        entity_id=config.entity_id,
        entity_type="robot",
        label=config.entity_id,
        geometry_type="box",
        position_xyz=list(ee_xyz),
        velocity_xyz=vel_xyz[:3],
        size_xyz=[h * 2, h * 2, h * 2],
        metadata={"joint_angles_rad": dict(joint_dict)},
    )


def _world_object_entity(
    obj: WorldObject,
    pos: list[float],
    vel: list[float],
    mass_kg: float,
) -> PhysicalEntity:
    return PhysicalEntity(
        entity_id=obj.object_id,
        entity_type="object",
        label=obj.object_id,
        geometry_type="box",
        position_xyz=pos[:],
        velocity_xyz=vel[:],
        size_xyz=list(obj.size_xyz),
        mass_kg=mass_kg,
        friction=obj.friction,
        movable=obj.movable,
    )


def _surface_entity(surface: WorkSurface) -> PhysicalEntity:
    return PhysicalEntity(
        entity_id=surface.entity_id,
        entity_type="surface",
        label=surface.entity_id,
        geometry_type="box",
        position_xyz=list(surface.position_xyz),
        size_xyz=list(surface.size_xyz),
        movable=False,
    )


def _joint_limit_constraint(
    frame_idx: int,
    joint_name: str,
    position: float,
    lower: float,
    upper: float,
    robot_entity_id: str,
) -> ConstraintToken:
    return ConstraintToken(
        constraint_id=f"jlim_{frame_idx:04d}_{joint_name}",
        constraint_type="joint_limit",
        subject_id=robot_entity_id,
        target_entity_ids=[robot_entity_id],
        params={
            "joint_name": joint_name,
            "position": round(position, 5),
            "lower": lower,
            "upper": upper,
        },
    )


def _push_action(
    frame_idx: int,
    robot_entity_id: str,
    object_id: str,
    ee_vel: list[float],
    max_force_n: float,
    dt_ms: int,
) -> ActionToken:
    dt_s = dt_ms / 1000.0
    return ActionToken(
        action_id=f"push_{frame_idx:04d}",
        action_type="push",
        actor_id=robot_entity_id,
        object_id=object_id,
        duration_ms=dt_ms,
        params={
            "delta_xyz": [round(v * dt_s, 5) for v in ee_vel[:3]],
            "max_force_n": max_force_n,
        },
    )


def _contact_relation(robot_entity_id: str, object_id: str) -> PhysicalRelation:
    return PhysicalRelation(
        source_id=robot_entity_id,
        target_id=object_id,
        relation_type="contacts",
    )


def generate_rollout_trace(
    config: RobotRolloutConfig,
    entry: UrdfEntry,
    *,
    trace_id: str,
    scenario: str,
    frame_count: int,
    rng: random.Random,
) -> PhysicalRolloutTrace:
    """Build a multi-frame PhysicalRolloutTrace for one robot rollout."""
    inject_jlim_at = frame_count // 2 if scenario == SCENARIO_JOINT_LIMIT else None
    collision_frame = frame_count // 2 if scenario == SCENARIO_COLLISION else None
    first_obj_mass = (
        _CONTACT_INSTABILITY_MASS_KG
        if scenario == SCENARIO_CONTACT_INSTABILITY
        else (config.world_objects[0].mass_kg if config.world_objects else 0.3)
    )

    trajectory = generate_joint_trajectory_dicts(
        entry, config, frame_count, rng,
        inject_joint_violation_at=inject_jlim_at,
        collision_frame=collision_frame,
    )

    box_states = [_BoxState(pos=list(obj.position_xyz)) for obj in config.world_objects]

    dt_s = config.frame_dt_ms / 1000.0
    frames: list[PhysicalStateFrame] = []
    actions: list[ActionToken] = []

    prev_ee = fk_position(entry, trajectory[0], config.end_effector_link)

    for frame_idx, q in enumerate(trajectory):
        ee = fk_position(entry, q, config.end_effector_link)
        ee_vel = [round((ee[i] - prev_ee[i]) / dt_s, 5) for i in range(3)]
        is_collision_frame = scenario == SCENARIO_COLLISION and frame_idx == collision_frame

        constraints: list[ConstraintToken] = []
        relations: list[PhysicalRelation] = []

        if scenario == SCENARIO_JOINT_LIMIT and frame_idx == inject_jlim_at:
            first_joint = entry.joint_names[0]
            constraints.append(_joint_limit_constraint(
                frame_idx, first_joint, q[first_joint],
                entry.joint_lower[0], entry.joint_upper[0],
                config.entity_id,
            ))

        box_entities: list[PhysicalEntity] = []
        contacted_any = False
        for i, (obj, box) in enumerate(zip(config.world_objects, box_states)):
            obj_mass = first_obj_mass if i == 0 else obj.mass_kg
            contacted = box.apply_contact(ee, ee_vel, config.contact_dist_m)
            box_pos, box_vel = box.snapshot()
            box.step(dt_s)
            if contacted:
                contacted_any = True
                actions.append(_push_action(
                    frame_idx, config.entity_id, obj.object_id,
                    ee_vel, config.max_effort_n, config.frame_dt_ms,
                ))
                if not is_collision_frame:
                    relations.append(_contact_relation(config.entity_id, obj.object_id))
            box_entities.append(_world_object_entity(obj, box_pos, box_vel, obj_mass))

        entities = [
            _robot_entity(config, q, ee, ee_vel),
            *box_entities,
            _surface_entity(config.work_surface),
        ]

        frames.append(PhysicalStateFrame(
            frame_id=f"{trace_id}:{frame_idx:04d}",
            t_ms=frame_idx * config.frame_dt_ms,
            frame_convention="studio-y-up",
            entities=entities,
            relations=relations,
            constraints=constraints,
            metadata={
                "scenario": scenario,
                "frame_index": frame_idx,
                "contact": contacted_any,
            },
        ))
        prev_ee = ee

    return PhysicalRolloutTrace(
        trace_id=trace_id,
        frames=frames,
        actions=actions,
        metadata={
            "source": "robot_rollout_generator",
            "scenario": scenario,
            "frame_count": frame_count,
            "frame_dt_ms": config.frame_dt_ms,
        },
    )


def generate_rollout_batch(
    config: RobotRolloutConfig,
    entry: UrdfEntry,
    count: int,
    *,
    seed: int = DEFAULT_SEED,
    frame_count: int = DEFAULT_FRAME_COUNT,
    scenario_weights: dict[str, float] | None = None,
) -> list[PhysicalRolloutTrace]:
    """Generate a mixed batch of rollout traces for the given robot config."""
    rng = random.Random(seed)
    weights = scenario_weights or {
        SCENARIO_VALID: 0.40,
        SCENARIO_JOINT_LIMIT: 0.20,
        SCENARIO_CONTACT_INSTABILITY: 0.20,
        SCENARIO_COLLISION: 0.20,
    }
    population = list(weights.keys())
    w_values = [weights[k] for k in population]
    traces: list[PhysicalRolloutTrace] = []
    for i in range(count):
        scenario = rng.choices(population, weights=w_values, k=1)[0]
        traces.append(generate_rollout_trace(
            config, entry,
            trace_id=f"rollout-{seed}-{i:04d}",
            scenario=scenario,
            frame_count=frame_count,
            rng=rng,
        ))
    return traces
