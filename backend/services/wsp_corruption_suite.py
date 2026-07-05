"""WSP Corruption Suite — ten named corruptions applied to PhysicalRolloutTrace.

Each corruption returns a deep-copied, modified trace wrapped in CorruptedTrace.
Used to build the paper-grade evaluation corpus.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Any

from backend.models.physical_state import (
    PhysicalRelation,
    PhysicalRolloutTrace,
)
from backend.services.robot_rollout_generator import UrdfEntry, fk_position

# ── Corruption type constants ─────────────────────────────────────────────────

CORRUPTION_NONE = "none"
CORRUPTION_DEGREE_RADIAN = "degree_radian_mismatch"         # C1
CORRUPTION_CONVENTION_FLIP = "frame_convention_flip"         # C2 — swap Y/Z in position_xyz
CORRUPTION_JOINT_PERMUTATION = "joint_order_permutation"     # C3 — shuffle joint→value mapping
CORRUPTION_TIMESTAMP_JITTER = "timestamp_jitter"             # C4 — ±500ms, some frames out of order
CORRUPTION_MISSING_CHANNEL = "missing_joint_channel"         # C5 — drop last joint from metadata
CORRUPTION_DUPLICATE_FRAME = "duplicated_frame"              # C6 — copy one frame at t+1
CORRUPTION_EE_VELOCITY = "impossible_ee_velocity"            # C7 — teleport robot entity 1.5m
CORRUPTION_CONTACT = "impossible_contact_transition"         # C8 — "contacts" rel 0.8m apart
CORRUPTION_INTERPENETRATION = "robot_object_interpenetration" # C9 — robot entity inside table
CORRUPTION_ACTION_LAG = "action_state_lag"                   # C10 — shift actions list +1

ALL_CORRUPTIONS = [
    CORRUPTION_DEGREE_RADIAN,
    CORRUPTION_CONVENTION_FLIP,
    CORRUPTION_JOINT_PERMUTATION,
    CORRUPTION_TIMESTAMP_JITTER,
    CORRUPTION_MISSING_CHANNEL,
    CORRUPTION_DUPLICATE_FRAME,
    CORRUPTION_EE_VELOCITY,
    CORRUPTION_CONTACT,
    CORRUPTION_INTERPENETRATION,
    CORRUPTION_ACTION_LAG,
]
FK_FALLBACK_ERROR_TYPES = (ValueError, TypeError, KeyError, IndexError)


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class CorruptedTrace:
    trace: PhysicalRolloutTrace
    corruption: str          # corruption type name or "none"
    is_corrupted: bool
    corruption_params: dict[str, Any] = field(default_factory=dict)


# ── Helper: find robot / table entity IDs ────────────────────────────────────

def _find_robot_entity_id(trace: PhysicalRolloutTrace) -> str | None:
    """Return entity_id of the first robot-type entity in frame 0, or None."""
    if not trace.frames:
        return None
    for entity in trace.frames[0].entities:
        if entity.entity_type == "robot":
            return entity.entity_id
    return None


def _find_table_entity_id(trace: PhysicalRolloutTrace) -> str | None:
    """Return entity_id of the first surface/table entity in frame 0, or None."""
    if not trace.frames:
        return None
    for entity in trace.frames[0].entities:
        if entity.entity_type == "surface":
            return entity.entity_id
    return None


def _get_entity(frame, entity_id: str):
    for e in frame.entities:
        if e.entity_id == entity_id:
            return e
    return None


# ── Individual corruption implementations ────────────────────────────────────

def _corrupt_degree_radian(
    trace: PhysicalRolloutTrace,
    rng: random.Random,
    *,
    urdf_entry: UrdfEntry | None,
) -> tuple[PhysicalRolloutTrace, dict]:
    """C1: Treat raw degree values as radians (or multiply positions by 10)."""
    t = trace.model_copy(deep=True)
    params: dict[str, Any] = {"method": "fk_recompute" if urdf_entry else "scale_xyz"}

    if urdf_entry is not None:
        from backend.services.wsp_lerobot_hf_ingest import SO101_DATASET_JOINT_NAMES
        ee_link = "gripper_link"
        # Try to detect the EE link from the trace metadata
        meta_ee = trace.metadata.get("ee_link")
        if meta_ee:
            ee_link = meta_ee

        robot_id = _find_robot_entity_id(t)
        for frame in t.frames:
            if robot_id is None:
                break
            robot = _get_entity(frame, robot_id)
            if robot is None:
                continue
            joint_state = robot.metadata.get("joint_state_deg")
            if joint_state is None:
                continue
            # Use raw degree values directly as radians (incorrect)
            jnames = robot.metadata.get("joint_names", SO101_DATASET_JOINT_NAMES)
            jdict = {name: float(val) for name, val in zip(jnames, joint_state)}
            try:
                wrong_pos = fk_position(urdf_entry, jdict, ee_link)
                robot.position_xyz = wrong_pos
            except FK_FALLBACK_ERROR_TYPES:
                robot.position_xyz = [v * 10.0 for v in robot.position_xyz]
    else:
        # Multiply all entity positions by 10 (workspace violation)
        for frame in t.frames:
            for entity in frame.entities:
                entity.position_xyz = [v * 10.0 for v in entity.position_xyz]

    return t, params


def _corrupt_convention_flip(
    trace: PhysicalRolloutTrace,
    rng: random.Random,
) -> tuple[PhysicalRolloutTrace, dict]:
    """C2: Swap Y and Z in position_xyz for all entities."""
    t = trace.model_copy(deep=True)
    for frame in t.frames:
        for entity in frame.entities:
            x, y, z = entity.position_xyz
            entity.position_xyz = [x, z, y]
    return t, {"swapped_axes": "y_z"}


def _corrupt_joint_permutation(
    trace: PhysicalRolloutTrace,
    rng: random.Random,
    *,
    urdf_entry: UrdfEntry | None,
) -> tuple[PhysicalRolloutTrace, dict]:
    """C3: Reverse the joint order mapping (first val → last joint name), recompute FK."""
    t = trace.model_copy(deep=True)
    params: dict[str, Any] = {"method": "fk_recompute" if urdf_entry else "position_reverse"}

    if urdf_entry is not None:
        from backend.services.wsp_lerobot_hf_ingest import SO101_DATASET_JOINT_NAMES
        ee_link = "gripper_link"
        meta_ee = trace.metadata.get("ee_link")
        if meta_ee:
            ee_link = meta_ee

        robot_id = _find_robot_entity_id(t)
        for frame in t.frames:
            if robot_id is None:
                break
            robot = _get_entity(frame, robot_id)
            if robot is None:
                continue
            joint_state = robot.metadata.get("joint_state_deg")
            if joint_state is None:
                continue
            jnames = robot.metadata.get("joint_names", SO101_DATASET_JOINT_NAMES)
            # Reverse: first joint value goes to last joint name
            reversed_values = list(reversed(joint_state))
            jdict = {
                name: math.radians(float(val))
                for name, val in zip(jnames, reversed_values)
            }
            try:
                wrong_pos = fk_position(urdf_entry, jdict, ee_link)
                robot.position_xyz = wrong_pos
            except FK_FALLBACK_ERROR_TYPES:
                x, y, z = robot.position_xyz
                robot.position_xyz = [z, y, x]
    else:
        # Reverse x↔z component of all entity positions
        for frame in t.frames:
            for entity in frame.entities:
                x, y, z = entity.position_xyz
                entity.position_xyz = [z, y, x]

    return t, params


def _corrupt_timestamp_jitter(
    trace: PhysicalRolloutTrace,
    rng: random.Random,
) -> tuple[PhysicalRolloutTrace, dict]:
    """C4: Add ±500ms random jitter to each frame timestamp, causing disorder."""
    t = trace.model_copy(deep=True)
    jitter_ms = 500
    for frame in t.frames:
        offset = rng.randint(-jitter_ms, jitter_ms)
        new_t = max(0, frame.t_ms + offset)
        frame.t_ms = new_t
    return t, {"max_jitter_ms": jitter_ms}


def _corrupt_missing_channel(
    trace: PhysicalRolloutTrace,
    rng: random.Random,
) -> tuple[PhysicalRolloutTrace, dict]:
    """C5: Drop last joint from metadata joint_state_deg; mark missing_joint_channel=True."""
    t = trace.model_copy(deep=True)
    robot_id = _find_robot_entity_id(t)
    for frame in t.frames:
        for entity in frame.entities:
            if entity.entity_type == "robot" or entity.entity_id == robot_id:
                if "joint_state_deg" in entity.metadata:
                    vals = list(entity.metadata["joint_state_deg"])
                    if vals:
                        vals.pop()
                    entity.metadata["joint_state_deg"] = vals
                entity.metadata["missing_joint_channel"] = True
    return t, {"dropped_joint_index": -1}


def _corrupt_duplicate_frame(
    trace: PhysicalRolloutTrace,
    rng: random.Random,
) -> tuple[PhysicalRolloutTrace, dict]:
    """C6: Copy one frame and insert it at t+1ms, duplicating a frame."""
    t = trace.model_copy(deep=True)
    if not t.frames:
        return t, {}
    # Pick a random frame to duplicate (not the last)
    idx = rng.randint(0, max(0, len(t.frames) - 2))
    src = t.frames[idx]
    # Create duplicate with same t_ms (exact duplicate timestamps)
    dup = src.model_copy(deep=True)
    dup.frame_id = src.frame_id + "_dup"
    dup.t_ms = src.t_ms  # exact duplicate timestamp
    t.frames.insert(idx + 1, dup)
    return t, {"duplicated_frame_index": idx, "duplicated_frame_id": src.frame_id}


def _corrupt_ee_velocity(
    trace: PhysicalRolloutTrace,
    rng: random.Random,
) -> tuple[PhysicalRolloutTrace, dict]:
    """C7: Teleport robot entity 1.5m in the last frame (impossible EE velocity)."""
    t = trace.model_copy(deep=True)
    if not t.frames:
        return t, {}
    robot_id = _find_robot_entity_id(t)
    last_frame = t.frames[-1]
    teleport_dist = 1.5
    if robot_id is not None:
        robot = _get_entity(last_frame, robot_id)
        if robot is not None:
            robot.position_xyz = [
                robot.position_xyz[0] + teleport_dist,
                robot.position_xyz[1],
                robot.position_xyz[2],
            ]
    else:
        # Teleport first entity
        if last_frame.entities:
            e = last_frame.entities[0]
            e.position_xyz = [
                e.position_xyz[0] + teleport_dist,
                e.position_xyz[1],
                e.position_xyz[2],
            ]
    return t, {"teleport_m": teleport_dist}


def _corrupt_contact(
    trace: PhysicalRolloutTrace,
    rng: random.Random,
) -> tuple[PhysicalRolloutTrace, dict]:
    """C8: Add 'contacts' relation in last frame between entities >0.5m apart."""
    t = trace.model_copy(deep=True)
    if not t.frames:
        return t, {}

    last_frame = t.frames[-1]
    robot_id = _find_robot_entity_id(t)
    table_id = _find_table_entity_id(t)

    # Find two entities that are far apart (>0.5m)
    src_id: str | None = None
    tgt_id: str | None = None

    if robot_id and table_id:
        robot = _get_entity(last_frame, robot_id)
        table = _get_entity(last_frame, table_id)
        if robot is not None and table is not None:
            dist = math.sqrt(sum(
                (robot.position_xyz[i] - table.position_xyz[i]) ** 2 for i in range(3)
            ))
            if dist > 0.5:
                src_id = robot_id
                tgt_id = table_id
            else:
                # Move robot away 0.8m to force distance
                robot.position_xyz = [
                    robot.position_xyz[0] + 0.8,
                    robot.position_xyz[1],
                    robot.position_xyz[2],
                ]
                src_id = robot_id
                tgt_id = table_id

    if src_id is None and len(last_frame.entities) >= 2:
        e0 = last_frame.entities[0]
        e1 = last_frame.entities[1]
        # Move them apart if needed
        dist = math.sqrt(sum(
            (e0.position_xyz[i] - e1.position_xyz[i]) ** 2 for i in range(3)
        ))
        if dist <= 0.5:
            e0.position_xyz = [e0.position_xyz[0] + 0.8, e0.position_xyz[1], e0.position_xyz[2]]
        src_id = e0.entity_id
        tgt_id = e1.entity_id

    if src_id is not None and tgt_id is not None:
        # Add the bogus "contacts" relation
        rel = PhysicalRelation(
            source_id=src_id,
            target_id=tgt_id,
            relation_type="contacts",
            confidence=0.95,
        )
        last_frame.relations.append(rel)

    return t, {"contact_pair": (src_id, tgt_id), "min_dist_m": 0.5}


def _corrupt_interpenetration(
    trace: PhysicalRolloutTrace,
    rng: random.Random,
) -> tuple[PhysicalRolloutTrace, dict]:
    """C9: Move robot entity to table entity's center (robot inside table)."""
    t = trace.model_copy(deep=True)
    robot_id = _find_robot_entity_id(t)
    table_id = _find_table_entity_id(t)

    for frame in t.frames:
        if robot_id is not None and table_id is not None:
            robot = _get_entity(frame, robot_id)
            table = _get_entity(frame, table_id)
            if robot is not None and table is not None:
                robot.position_xyz = list(table.position_xyz)
        elif robot_id is not None and len(frame.entities) >= 2:
            robot = _get_entity(frame, robot_id)
            other = next((e for e in frame.entities if e.entity_id != robot_id), None)
            if robot is not None and other is not None:
                robot.position_xyz = list(other.position_xyz)
        elif len(frame.entities) >= 2:
            e0, e1 = frame.entities[0], frame.entities[1]
            e0.position_xyz = list(e1.position_xyz)

    return t, {"robot_id": robot_id, "table_id": table_id}


def _corrupt_action_lag(
    trace: PhysicalRolloutTrace,
    rng: random.Random,
) -> tuple[PhysicalRolloutTrace, dict]:
    """C10: Shift actions list +1 (prepend a dummy action copy, drop last action)."""
    t = trace.model_copy(deep=True)
    if not t.actions:
        return t, {"shift": 0}
    # Insert a copy of first action at position 0 (shift by +1)
    first_copy = t.actions[0].model_copy(deep=True)
    first_copy = first_copy.model_copy(update={"action_id": t.actions[0].action_id + "_lag"})
    t.actions = [first_copy] + list(t.actions[:-1])
    return t, {"shift": 1}


# ── Main dispatch ─────────────────────────────────────────────────────────────

def apply_corruption(
    trace: PhysicalRolloutTrace,
    corruption_type: str,
    rng: random.Random,
    *,
    urdf_entry: UrdfEntry | None = None,
) -> CorruptedTrace:
    """Apply a named corruption to a trace and return a CorruptedTrace.

    Always deep-copies the trace before modification.
    """
    if corruption_type == CORRUPTION_NONE:
        return CorruptedTrace(
            trace=trace.model_copy(deep=True),
            corruption=CORRUPTION_NONE,
            is_corrupted=False,
            corruption_params={},
        )

    dispatch = {
        CORRUPTION_DEGREE_RADIAN: lambda t, r: _corrupt_degree_radian(t, r, urdf_entry=urdf_entry),
        CORRUPTION_CONVENTION_FLIP: _corrupt_convention_flip,
        CORRUPTION_JOINT_PERMUTATION: lambda t, r: _corrupt_joint_permutation(t, r, urdf_entry=urdf_entry),
        CORRUPTION_TIMESTAMP_JITTER: _corrupt_timestamp_jitter,
        CORRUPTION_MISSING_CHANNEL: _corrupt_missing_channel,
        CORRUPTION_DUPLICATE_FRAME: _corrupt_duplicate_frame,
        CORRUPTION_EE_VELOCITY: _corrupt_ee_velocity,
        CORRUPTION_CONTACT: _corrupt_contact,
        CORRUPTION_INTERPENETRATION: _corrupt_interpenetration,
        CORRUPTION_ACTION_LAG: _corrupt_action_lag,
    }

    fn = dispatch.get(corruption_type)
    if fn is None:
        raise ValueError(f"Unknown corruption type: {corruption_type!r}")

    corrupted_trace, params = fn(trace, rng)
    return CorruptedTrace(
        trace=corrupted_trace,
        corruption=corruption_type,
        is_corrupted=True,
        corruption_params=params,
    )


# ── Corpus builder ────────────────────────────────────────────────────────────

def build_eval_corpus(
    clean_traces: list[PhysicalRolloutTrace],
    corruption_types: list[str] | None = None,
    *,
    n_clean_copies: int = 1,
    seed: int = 42,
    urdf_entry: UrdfEntry | None = None,
) -> list[CorruptedTrace]:
    """Build a full eval corpus: n_clean_copies of each clean trace + one corrupted copy
    per corruption_type per trace.

    Returns:
        list[CorruptedTrace] ordered: all clean copies first, then all corrupted.
    """
    if corruption_types is None:
        corruption_types = ALL_CORRUPTIONS

    rng = random.Random(seed)
    corpus: list[CorruptedTrace] = []

    for trace in clean_traces:
        # Clean copies
        for _ in range(n_clean_copies):
            corpus.append(
                CorruptedTrace(
                    trace=trace.model_copy(deep=True),
                    corruption=CORRUPTION_NONE,
                    is_corrupted=False,
                    corruption_params={},
                )
            )
        # Corrupted copies
        for ctype in corruption_types:
            corpus.append(
                apply_corruption(trace, ctype, rng, urdf_entry=urdf_entry)
            )

    return corpus
