from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Sequence

Vector3 = tuple[float, float, float]
Aabb = tuple[Vector3, Vector3]


@dataclass(frozen=True)
class SceneBounds:
    center_xyz: Vector3
    radius_m: float
    min_xyz: Vector3
    max_xyz: Vector3
    item_count: int


def scene_bounds_from_aabbs(
    aabbs: Sequence[Aabb],
    *,
    default_center_xyz: Sequence[float],
    default_radius_m: float,
    min_radius_m: float,
) -> SceneBounds:
    if not aabbs:
        center = _vector3(default_center_xyz)
        radius = float(default_radius_m)
        return SceneBounds(
            center_xyz=center,
            radius_m=radius,
            min_xyz=(
                center[0] - radius,
                center[1] - radius,
                center[2] - radius,
            ),
            max_xyz=(
                center[0] + radius,
                center[1] + radius,
                center[2] + radius,
            ),
            item_count=0,
        )

    mins = tuple(min(aabb[0][axis] for aabb in aabbs) for axis in range(3))
    maxs = tuple(max(aabb[1][axis] for aabb in aabbs) for axis in range(3))
    center = tuple((mins[axis] + maxs[axis]) * 0.5 for axis in range(3))
    half_span = tuple((maxs[axis] - mins[axis]) * 0.5 for axis in range(3))
    radius = max(
        float(min_radius_m),
        math.sqrt(sum(component * component for component in half_span)),
    )
    return SceneBounds(
        center_xyz=_vector3(center),
        radius_m=radius,
        min_xyz=_vector3(mins),
        max_xyz=_vector3(maxs),
        item_count=len(aabbs),
    )


def combine_aabbs(aabbs: Sequence[Aabb]) -> Aabb | None:
    if not aabbs:
        return None
    return (
        tuple(min(aabb[0][axis] for aabb in aabbs) for axis in range(3)),
        tuple(max(aabb[1][axis] for aabb in aabbs) for axis in range(3)),
    )


def _vector3(value: Sequence[float]) -> Vector3:
    if len(value) != 3:
        raise ValueError("Expected a 3D vector.")
    parsed = tuple(float(component) for component in value)
    if not all(math.isfinite(component) for component in parsed):
        raise ValueError("Expected a finite 3D vector.")
    return parsed[0], parsed[1], parsed[2]
