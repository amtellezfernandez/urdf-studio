from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Sequence

Vector3 = tuple[float, float, float]
Aabb = tuple[Vector3, Vector3]
VECTOR3_AXES = range(3)


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
        return _default_scene_bounds(
            center_xyz=default_center_xyz,
            radius_m=default_radius_m,
        )

    return _scene_bounds_for_aabb(
        enclosing_aabb=_enclosing_aabb(aabbs),
        item_count=len(aabbs),
        min_radius_m=min_radius_m,
    )


def combine_aabbs(aabbs: Sequence[Aabb]) -> Aabb | None:
    if not aabbs:
        return None
    return _enclosing_aabb(aabbs)


def _default_scene_bounds(
    *,
    center_xyz: Sequence[float],
    radius_m: float,
) -> SceneBounds:
    center = _vector3(center_xyz)
    radius = float(radius_m)
    return SceneBounds(
        center_xyz=center,
        radius_m=radius,
        min_xyz=_offset_vector3(center, -radius),
        max_xyz=_offset_vector3(center, radius),
        item_count=0,
    )


def _scene_bounds_for_aabb(
    *,
    enclosing_aabb: Aabb,
    item_count: int,
    min_radius_m: float,
) -> SceneBounds:
    mins, maxs = enclosing_aabb
    center = _midpoint_vector3(mins, maxs)
    radius = max(
        float(min_radius_m),
        _vector_length(_half_span_vector3(mins, maxs)),
    )
    return SceneBounds(
        center_xyz=center,
        radius_m=radius,
        min_xyz=_vector3(mins),
        max_xyz=_vector3(maxs),
        item_count=item_count,
    )


def _enclosing_aabb(aabbs: Sequence[Aabb]) -> Aabb:
    return (
        tuple(min(aabb[0][axis] for aabb in aabbs) for axis in VECTOR3_AXES),
        tuple(max(aabb[1][axis] for aabb in aabbs) for axis in VECTOR3_AXES),
    )


def _offset_vector3(value: Vector3, offset: float) -> Vector3:
    return (
        value[0] + offset,
        value[1] + offset,
        value[2] + offset,
    )


def _midpoint_vector3(left: Sequence[float], right: Sequence[float]) -> Vector3:
    return tuple((left[axis] + right[axis]) * 0.5 for axis in VECTOR3_AXES)


def _half_span_vector3(mins: Sequence[float], maxs: Sequence[float]) -> Vector3:
    return tuple((maxs[axis] - mins[axis]) * 0.5 for axis in VECTOR3_AXES)


def _vector_length(value: Sequence[float]) -> float:
    return math.sqrt(sum(component * component for component in value))


def _vector3(value: Sequence[float]) -> Vector3:
    if len(value) != 3:
        raise ValueError("Expected a 3D vector.")
    parsed = tuple(float(component) for component in value)
    if not all(math.isfinite(component) for component in parsed):
        raise ValueError("Expected a finite 3D vector.")
    return parsed[0], parsed[1], parsed[2]
