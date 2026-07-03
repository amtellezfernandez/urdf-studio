from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Tuple

JointSeed = Dict[str, float]
NamedJointSeed = Tuple[str, JointSeed]


def build_orientation_attempts(
    mode: str, has_orientation: bool
) -> List[Tuple[bool, float, str]]:
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
) -> List[Tuple[str, bool, float, str]]:
    attempts = build_orientation_attempts(orientation_mode, has_orientation)
    return [
        (solver_id, ignore, scale, label)
        for ignore, scale, label in attempts
        for solver_id in solver_chain
    ]


def build_seed_list(
    base_seed: JointSeed, cached_seed: Optional[JointSeed]
) -> List[NamedJointSeed]:
    seed_candidates: List[NamedJointSeed] = []
    if base_seed:
        seed_candidates.append(("current", base_seed))
    if cached_seed and all(cached_seed != seed for _, seed in seed_candidates):
        seed_candidates.append(("last_success", cached_seed))
    if not seed_candidates:
        seed_candidates.append(("zeros", {}))

    jitter_base = seed_candidates[0][1]
    for jitter_index, jitter_seed in enumerate(generate_jitter_seeds(jitter_base)):
        seed_candidates.append((f"jitter_{jitter_index}", jitter_seed))
    return seed_candidates


def generate_jitter_seeds(
    seed: JointSeed, count: int = 2, magnitude: float = 0.05
) -> List[JointSeed]:
    if not seed:
        return []
    names = sorted(seed.keys())
    jittered_seeds: List[JointSeed] = []
    for jitter_index in range(count):
        jittered_seed = dict(seed)
        for joint_offset_index, joint_name in enumerate(names[: min(3, len(names))]):
            direction = 1.0 if (jitter_index + joint_offset_index) % 2 == 0 else -1.0
            jittered_seed[joint_name] = (
                float(jittered_seed.get(joint_name, 0.0)) + direction * magnitude
            )
        jittered_seeds.append(jittered_seed)
    return jittered_seeds
