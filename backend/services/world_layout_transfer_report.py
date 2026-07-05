from __future__ import annotations

from collections import Counter
from typing import Sequence, TypeAlias, TypedDict

import numpy as np

from backend.services.world_layout_transfer_constants import (
    COLOR_TOLERANCE,
    POSITION_TOLERANCE_M,
    QUATERNION_TOLERANCE,
    SIZE_TOLERANCE_M,
)
from backend.services.world_layout_transfer_types import LoadedPrimitive, SimPrimitive

_JsonFloatVector: TypeAlias = list[float]


class PrimitiveCheckObjectReport(TypedDict):
    source_id: str
    sim_name: str
    source_type: str
    sim_type: str
    loaded_sim_type: str | None
    expected_position_xyz: _JsonFloatVector
    loaded_position_xyz: _JsonFloatVector
    position_error_m: float
    expected_quat_wxyz: _JsonFloatVector
    loaded_quat_wxyz: _JsonFloatVector | None
    quat_error: float | None
    expected_size_xyz: _JsonFloatVector
    loaded_size_xyz: _JsonFloatVector | None
    size_error_m: float | None
    expected_rgba: _JsonFloatVector
    loaded_rgba: _JsonFloatVector | None
    color_error: float | None
    collision: bool
    loaded_collision: bool | None
    type_matches: bool
    collision_matches: bool
    color_matches: bool


class _PrimitiveCheckReportRequired(TypedDict):
    ok: bool
    expected_count: int
    loaded_count: int
    missing_source_ids: list[str]
    type_mismatch_source_ids: list[str]
    collision_mismatch_source_ids: list[str]
    color_mismatch_source_ids: list[str]
    duplicate_loaded_sim_names: list[str]
    max_position_error_m: float
    max_size_error_m: float
    max_quat_error: float
    max_color_error: float
    position_tolerance_m: float
    size_tolerance_m: float
    quat_tolerance: float
    color_tolerance: float
    objects: list[PrimitiveCheckObjectReport]


class PrimitiveCheckReport(_PrimitiveCheckReportRequired, total=False):
    compiled_geom_count: int


def _quat_error(lhs: Sequence[float] | None, rhs: Sequence[float]) -> float | None:
    if lhs is None:
        return None
    lhs_array = np.array(lhs, dtype=float)
    rhs_array = np.array(rhs, dtype=float)
    direct = np.linalg.norm(lhs_array - rhs_array)
    negated = np.linalg.norm(lhs_array + rhs_array)
    return float(min(direct, negated))


def _position_error(lhs: Sequence[float], rhs: Sequence[float]) -> float:
    return float(np.linalg.norm(np.array(lhs, dtype=float) - np.array(rhs, dtype=float)))


def _size_error(lhs: Sequence[float] | None, rhs: Sequence[float]) -> float | None:
    if lhs is None:
        return None
    return float(np.linalg.norm(np.array(lhs, dtype=float) - np.array(rhs, dtype=float)))


def _rgba_error(
    lhs: Sequence[float] | None,
    rhs: Sequence[float],
) -> float | None:
    if lhs is None:
        return None
    return float(np.linalg.norm(np.array(lhs, dtype=float) - np.array(rhs, dtype=float)))


def _optional_vector(values: Sequence[float] | None) -> list[float] | None:
    return list(values) if values is not None else None


def build_primitive_check_report(
    primitives: Sequence[SimPrimitive],
    loaded: Sequence[LoadedPrimitive],
    *,
    position_tolerance_m: float = POSITION_TOLERANCE_M,
    size_tolerance_m: float = SIZE_TOLERANCE_M,
    quaternion_tolerance: float = QUATERNION_TOLERANCE,
    color_tolerance: float = COLOR_TOLERANCE,
) -> PrimitiveCheckReport:
    loaded_name_counts = Counter(item.sim_name for item in loaded)
    duplicate_loaded_sim_names = sorted(
        sim_name for sim_name, count in loaded_name_counts.items() if count > 1
    )
    loaded_by_name = {item.sim_name: item for item in loaded}
    objects: list[PrimitiveCheckObjectReport] = []
    max_position_error = 0.0
    max_size_error = 0.0
    max_quat_error = 0.0
    max_color_error = 0.0
    missing: list[str] = []
    type_mismatches: list[str] = []
    collision_mismatches: list[str] = []
    color_mismatches: list[str] = []
    for primitive in primitives:
        loaded_primitive = loaded_by_name.get(primitive.sim_name)
        if loaded_primitive is None:
            missing.append(primitive.source_id)
            continue
        position_error = _position_error(primitive.position_xyz, loaded_primitive.position_xyz)
        quat_error = _quat_error(loaded_primitive.quat_wxyz, primitive.quat_wxyz)
        size_error = _size_error(loaded_primitive.size_xyz, primitive.size_xyz)
        color_error = _rgba_error(loaded_primitive.rgba, primitive.rgba)
        type_matches = loaded_primitive.sim_type == primitive.sim_type
        collision_matches = (
            loaded_primitive.collision is None or loaded_primitive.collision == primitive.collision
        )
        color_matches = color_error is None or color_error <= color_tolerance
        max_position_error = max(max_position_error, position_error)
        if quat_error is not None:
            max_quat_error = max(max_quat_error, quat_error)
        if size_error is not None:
            max_size_error = max(max_size_error, size_error)
        if color_error is not None:
            max_color_error = max(max_color_error, color_error)
        if not type_matches:
            type_mismatches.append(primitive.source_id)
        if not collision_matches:
            collision_mismatches.append(primitive.source_id)
        if not color_matches:
            color_mismatches.append(primitive.source_id)
        objects.append(
            {
                "source_id": primitive.source_id,
                "sim_name": primitive.sim_name,
                "source_type": primitive.source_type,
                "sim_type": primitive.sim_type,
                "loaded_sim_type": loaded_primitive.sim_type,
                "expected_position_xyz": list(primitive.position_xyz),
                "loaded_position_xyz": list(loaded_primitive.position_xyz),
                "position_error_m": position_error,
                "expected_quat_wxyz": list(primitive.quat_wxyz),
                "loaded_quat_wxyz": _optional_vector(loaded_primitive.quat_wxyz),
                "quat_error": quat_error,
                "expected_size_xyz": list(primitive.size_xyz),
                "loaded_size_xyz": _optional_vector(loaded_primitive.size_xyz),
                "size_error_m": size_error,
                "expected_rgba": list(primitive.rgba),
                "loaded_rgba": _optional_vector(loaded_primitive.rgba),
                "color_error": color_error,
                "collision": primitive.collision,
                "loaded_collision": loaded_primitive.collision,
                "type_matches": type_matches,
                "collision_matches": collision_matches,
                "color_matches": color_matches,
            }
        )
    ok = (
        not missing
        and not type_mismatches
        and not collision_mismatches
        and not color_mismatches
        and not duplicate_loaded_sim_names
        and len(loaded) == len(primitives)
        and max_position_error <= position_tolerance_m
        and max_size_error <= size_tolerance_m
        and max_quat_error <= quaternion_tolerance
        and max_color_error <= color_tolerance
    )
    return {
        "ok": ok,
        "expected_count": len(primitives),
        "loaded_count": len(loaded),
        "missing_source_ids": missing,
        "type_mismatch_source_ids": type_mismatches,
        "collision_mismatch_source_ids": collision_mismatches,
        "color_mismatch_source_ids": color_mismatches,
        "duplicate_loaded_sim_names": duplicate_loaded_sim_names,
        "max_position_error_m": max_position_error,
        "max_size_error_m": max_size_error,
        "max_quat_error": max_quat_error,
        "max_color_error": max_color_error,
        "position_tolerance_m": position_tolerance_m,
        "size_tolerance_m": size_tolerance_m,
        "quat_tolerance": quaternion_tolerance,
        "color_tolerance": color_tolerance,
        "objects": objects,
    }
