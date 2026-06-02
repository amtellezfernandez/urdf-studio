from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

import numpy as np
from fastapi import HTTPException

import yourdfpy  # type: ignore

from backend.models.kinematics import IKDiagnostics, IKRequest, IKResponse
from backend.services.ilu_urdf import strip_urdf_for_kinematics
from backend.services.kinematics import _load_urdf_from_xml


DEFAULT_MAX_ITERATIONS = 28
DEFAULT_TOLERANCE = 0.006
MAX_STEP_RAD = 0.35
MAX_STEP_LINEAR = 0.02


@dataclass
class AmikEntry:
    urdf_hash: str
    urdf_xml: str
    urdf: yourdfpy.URDF
    chain_cache: Dict[str, List[yourdfpy.urdf.Joint]] = field(default_factory=dict)


_amik_cache: Dict[str, AmikEntry] = {}


def _hash_urdf(urdf_xml: str) -> str:
    return hashlib.sha256(urdf_xml.encode("utf-8")).hexdigest()


def _get_or_create_entry(urdf_xml: str) -> AmikEntry:
    if not urdf_xml.strip():
        raise HTTPException(status_code=400, detail="URDF content is empty")
    sanitized = strip_urdf_for_kinematics(urdf_xml)
    urdf_hash = _hash_urdf(sanitized)
    entry = _amik_cache.get(urdf_hash)
    if entry is not None:
        return entry
    try:
        urdf = _load_urdf_from_xml(sanitized)
    except Exception as exc:  # defensive; surfaced as HTTP error
        raise HTTPException(status_code=400, detail=f"Failed to load URDF: {exc}") from exc
    entry = AmikEntry(urdf_hash=urdf_hash, urdf_xml=sanitized, urdf=urdf)
    _amik_cache[urdf_hash] = entry
    return entry


def _build_joint_values(urdf: yourdfpy.URDF, joint_values: Dict[str, float]) -> Dict[str, float]:
    return {
        name: np.float32(joint_values.get(name, 0.0))
        for name in urdf.actuated_joint_names
    }


def _joint_chain(entry: AmikEntry, target_link: str) -> List[yourdfpy.urdf.Joint]:
    cached = entry.chain_cache.get(target_link)
    if cached is not None:
        return cached

    urdf = entry.urdf
    if target_link not in urdf.link_map:
        raise HTTPException(
            status_code=400,
            detail=f"Target link '{target_link}' not found in URDF.",
        )

    child_to_joint: Dict[str, yourdfpy.urdf.Joint] = {
        joint.child: joint for joint in urdf.joint_map.values()
    }

    chain: List[yourdfpy.urdf.Joint] = []
    link = target_link
    visited = set()
    while link in child_to_joint:
        joint = child_to_joint[link]
        if joint.name in visited:
            break
        visited.add(joint.name)
        if (
            joint.type in ("revolute", "prismatic", "continuous")
            and joint.name in urdf.actuated_joint_names
            and joint.mimic is None
        ):
            chain.append(joint)
        link = joint.parent

    entry.chain_cache[target_link] = chain
    return chain


def _clamp(value: float, lower: float, upper: float) -> float:
    return min(upper, max(lower, value))


def _get_joint_limits(joint: yourdfpy.urdf.Joint) -> Tuple[float | None, float | None]:
    if joint.limit is None:
        return None, None
    lower = joint.limit.lower
    upper = joint.limit.upper
    if lower is None or upper is None:
        return None, None
    return float(lower), float(upper)


def _get_joint_pose(
    urdf: yourdfpy.URDF, joint: yourdfpy.urdf.Joint
) -> Tuple[np.ndarray, np.ndarray]:
    parent_tf = urdf.get_transform(joint.parent)
    origin = joint.origin if joint.origin is not None else np.eye(4)
    joint_tf = parent_tf @ origin
    position = joint_tf[:3, 3]
    axis = np.asarray(joint.axis, dtype=float)
    axis_world = joint_tf[:3, :3] @ axis
    return position, axis_world


def inverse_kinematics(req: IKRequest) -> IKResponse:
    entry = _get_or_create_entry(req.urdf)
    urdf = entry.urdf

    if len(req.target_position) != 3:
        raise HTTPException(status_code=400, detail="target_position must have length 3")

    chain = _joint_chain(entry, req.target_link)
    if not chain:
        raise HTTPException(status_code=400, detail="IK chain empty")

    joint_values = _build_joint_values(urdf, req.joint_values)
    urdf.update_cfg(joint_values)

    target = np.asarray(req.target_position, dtype=float)
    iterations = 0
    cost = float("inf")
    start = time.perf_counter()

    for iter_idx in range(DEFAULT_MAX_ITERATIONS):
        end_tf = urdf.get_transform(req.target_link)
        end_pos = end_tf[:3, 3]
        cost = float(np.linalg.norm(end_pos - target))
        iterations = iter_idx + 1
        if cost <= DEFAULT_TOLERANCE:
            break

        for joint in chain:
            joint_pos, axis_world = _get_joint_pose(urdf, joint)
            axis_len = float(np.linalg.norm(axis_world))
            if not np.isfinite(axis_len) or axis_len < 1e-8:
                continue
            axis_world = axis_world / axis_len

            to_end = end_pos - joint_pos
            to_target = target - joint_pos

            current = float(joint_values.get(joint.name, 0.0))
            lower, upper = _get_joint_limits(joint)

            if joint.type == "prismatic":
                along_axis = float(np.dot(axis_world, to_target) - np.dot(axis_world, to_end))
                delta = float(_clamp(along_axis, -MAX_STEP_LINEAR, MAX_STEP_LINEAR))
                next_value = current + delta
                if lower is not None and upper is not None:
                    next_value = _clamp(next_value, lower, upper)
            else:
                proj_end = to_end - axis_world * np.dot(to_end, axis_world)
                proj_target = to_target - axis_world * np.dot(to_target, axis_world)
                end_len = float(np.linalg.norm(proj_end))
                target_len = float(np.linalg.norm(proj_target))
                if end_len < 1e-8 or target_len < 1e-8:
                    continue
                proj_end = proj_end / end_len
                proj_target = proj_target / target_len
                dot = float(np.dot(proj_end, proj_target))
                dot = _clamp(dot, -1.0, 1.0)
                angle = float(np.arccos(dot))
                if not np.isfinite(angle) or angle < 1e-4:
                    continue
                cross = np.cross(proj_end, proj_target)
                direction = float(np.sign(np.dot(cross, axis_world))) or 1.0
                delta = float(_clamp(direction * angle, -MAX_STEP_RAD, MAX_STEP_RAD))
                next_value = current + delta
                if joint.type != "continuous" and lower is not None and upper is not None:
                    next_value = _clamp(next_value, lower, upper)

            joint_values[joint.name] = np.float32(next_value)
            urdf.update_cfg(joint_values)
            end_tf = urdf.get_transform(req.target_link)
            end_pos = end_tf[:3, 3]
            cost = float(np.linalg.norm(end_pos - target))
            if cost <= DEFAULT_TOLERANCE:
                break

    solution = {name: float(value) for name, value in joint_values.items()}
    if not solution:
        raise HTTPException(status_code=500, detail="IK solve returned no solution")

    diagnostics = IKDiagnostics(
        termination_reason="amik",
        termination_flags=[],
        iterations=iterations,
        cost=float(cost) if np.isfinite(cost) else 0.0,
        lambda_final=0.0,
        validity="unknown",
        stability="unknown",
        degeneracy="unknown",
        branch_maybe=False,
        branch_metric=0.0,
        branch_message="orientation_ignored",
    )
    metadata = {
        "target_link": req.target_link,
        "actuated_joint_names": list(urdf.actuated_joint_names),
        "urdf_hash": entry.urdf_hash,
        "solve_ms": (time.perf_counter() - start) * 1000.0,
    }
    return IKResponse(solution=solution, diagnostics=diagnostics, metadata=metadata)
