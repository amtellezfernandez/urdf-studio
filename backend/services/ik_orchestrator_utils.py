from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Tuple


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
    base_seed: Dict[str, float], cached_seed: Optional[Dict[str, float]]
) -> List[Tuple[str, Dict[str, float]]]:
    seeds: List[Tuple[str, Dict[str, float]]] = []
    if base_seed:
        seeds.append(("current", base_seed))
    if cached_seed and cached_seed not in [seed for _, seed in seeds]:
        seeds.append(("last_success", cached_seed))
    if not seeds:
        seeds.append(("zeros", {}))

    jitter_base = seeds[0][1]
    for idx, jitter in enumerate(generate_jitter_seeds(jitter_base)):
        seeds.append((f"jitter_{idx}", jitter))
    return seeds


def generate_jitter_seeds(
    seed: Dict[str, float], count: int = 2, magnitude: float = 0.05
) -> List[Dict[str, float]]:
    if not seed:
        return []
    names = sorted(seed.keys())
    seeds: List[Dict[str, float]] = []
    for idx in range(count):
        next_seed = dict(seed)
        for offset_idx, name in enumerate(names[: min(3, len(names))]):
            direction = 1.0 if (idx + offset_idx) % 2 == 0 else -1.0
            next_seed[name] = float(next_seed.get(name, 0.0)) + direction * magnitude
        seeds.append(next_seed)
    return seeds
