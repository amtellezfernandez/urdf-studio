from __future__ import annotations

from collections.abc import Iterable
from typing import TypeAlias

from backend.models.kinematics import JointValueMap

JointSeed: TypeAlias = JointValueMap
NamedJointSeed: TypeAlias = tuple[str, JointSeed]
OrientationAttempt: TypeAlias = tuple[bool, float, str]
SolverStrategy: TypeAlias = tuple[str, bool, float, str]


def position_gate_for_orientation_label(
    orientation_label: str, relaxed_gate: float, strict_gate: float
) -> float:
    if orientation_label in ("ignore", "no_orientation"):
        return relaxed_gate
    return strict_gate


def build_orientation_attempts(
    mode: str, has_orientation: bool
) -> list[OrientationAttempt]:
    if not has_orientation:
        return [(True, 0.0, "no_orientation")]
    if mode == "ignore":
        return [(True, 0.0, "ignore")]
    if mode == "required":
        return [(False, 1.0, "strict")]
    if mode == "optional":
        return [
            (False, 1.0, "strict"),
            (False, 0.2, "relaxed"),
            (True, 0.0, "ignore"),
        ]
    if mode == "position_first":
        return [
            (True, 0.0, "ignore"),
            (False, 0.2, "relaxed"),
            (False, 1.0, "strict"),
        ]
    # "prefer" - strict orientation then relax then ignore
    return [
        (False, 1.0, "strict"),
        (False, 0.2, "relaxed"),
        (True, 0.0, "ignore"),
    ]


def build_strategies(
    solver_chain: Iterable[str], orientation_mode: str, has_orientation: bool
) -> list[SolverStrategy]:
    solver_ids = tuple(solver_chain)
    orientation_attempts = build_orientation_attempts(orientation_mode, has_orientation)
    return [
        (solver_id, ignore, scale, label)
        for ignore, scale, label in orientation_attempts
        for solver_id in solver_ids
    ]


def build_seed_list(
    base_seed: JointSeed, cached_seed: JointSeed | None
) -> list[NamedJointSeed]:
    named_seed_candidates: list[NamedJointSeed] = []
    if base_seed:
        named_seed_candidates.append(("current", base_seed))
    if cached_seed and all(cached_seed != seed for _, seed in named_seed_candidates):
        named_seed_candidates.append(("last_success", cached_seed))
    if not named_seed_candidates:
        named_seed_candidates.append(("zeros", {}))

    jitter_base = named_seed_candidates[0][1]
    for jitter_index, jitter_seed in enumerate(generate_jitter_seeds(jitter_base)):
        named_seed_candidates.append((f"jitter_{jitter_index}", jitter_seed))
    return named_seed_candidates


def generate_jitter_seeds(
    seed: JointSeed, count: int = 2, magnitude: float = 0.05
) -> list[JointSeed]:
    if not seed:
        return []
    joint_names = sorted(seed.keys())
    jittered_seeds: list[JointSeed] = []
    for jitter_index in range(count):
        jittered_seed = dict(seed)
        for joint_offset_index, joint_name in enumerate(
            joint_names[: min(3, len(joint_names))]
        ):
            direction = 1.0 if (jitter_index + joint_offset_index) % 2 == 0 else -1.0
            jittered_seed[joint_name] = (
                float(jittered_seed.get(joint_name, 0.0)) + direction * magnitude
            )
        jittered_seeds.append(jittered_seed)
    return jittered_seeds
