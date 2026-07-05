from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field

import numpy as np
from fastapi import HTTPException

import yourdfpy  # type: ignore

from backend.models.kinematics import (
    IKDiagnostics,
    IKRequest,
    IKResponse,
    KinematicsMetadata,
)
from backend.services.ilu_urdf import strip_urdf_for_kinematics
from backend.services.kinematics import _load_urdf_from_xml


DEFAULT_MAX_ITERATIONS = 28
DEFAULT_TOLERANCE = 0.006
MAX_STEP_RAD = 0.35
MAX_STEP_LINEAR = 0.02
JointValueMap = dict[str, float]


@dataclass
class AmikEntry:
    urdf_hash: str
    urdf_xml: str
    urdf: yourdfpy.URDF
    chain_cache: dict[str, list[yourdfpy.urdf.Joint]] = field(default_factory=dict)


_amik_cache: dict[str, AmikEntry] = {}


def _hash_urdf(urdf_xml: str) -> str:
    return hashlib.sha256(urdf_xml.encode("utf-8")).hexdigest()


def _get_or_create_entry(urdf_xml: str) -> AmikEntry:
    if not urdf_xml.strip():
        raise HTTPException(status_code=400, detail="URDF content is empty")
    sanitized_urdf = strip_urdf_for_kinematics(urdf_xml)
    urdf_hash = _hash_urdf(sanitized_urdf)
    cached_entry = _amik_cache.get(urdf_hash)
    if cached_entry is not None:
        return cached_entry
    try:
        robot_model = _load_urdf_from_xml(sanitized_urdf)
    except (ValueError, OSError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail=f"Failed to load URDF: {exc}") from exc
    entry = AmikEntry(
        urdf_hash=urdf_hash,
        urdf_xml=sanitized_urdf,
        urdf=robot_model,
    )
    _amik_cache[urdf_hash] = entry
    return entry


def _build_joint_values(
    robot_model: yourdfpy.URDF, joint_values: JointValueMap
) -> JointValueMap:
    return {
        joint_name: np.float32(joint_values.get(joint_name, 0.0))
        for joint_name in robot_model.actuated_joint_names
    }


def _joint_chain(entry: AmikEntry, target_link: str) -> list[yourdfpy.urdf.Joint]:
    cached_chain = entry.chain_cache.get(target_link)
    if cached_chain is not None:
        return cached_chain

    robot_model = entry.urdf
    if target_link not in robot_model.link_map:
        raise HTTPException(
            status_code=400,
            detail=f"Target link '{target_link}' not found in URDF.",
        )

    joint_by_child_link: dict[str, yourdfpy.urdf.Joint] = {
        joint.child: joint for joint in robot_model.joint_map.values()
    }

    joint_chain: list[yourdfpy.urdf.Joint] = []
    link_name = target_link
    visited_joint_names = set()
    while link_name in joint_by_child_link:
        joint = joint_by_child_link[link_name]
        if joint.name in visited_joint_names:
            break
        visited_joint_names.add(joint.name)
        if (
            joint.type in ("revolute", "prismatic", "continuous")
            and joint.name in robot_model.actuated_joint_names
            and joint.mimic is None
        ):
            joint_chain.append(joint)
        link_name = joint.parent

    entry.chain_cache[target_link] = joint_chain
    return joint_chain


def _clamp(value: float, lower: float, upper: float) -> float:
    return min(upper, max(lower, value))


def _get_joint_limits(joint: yourdfpy.urdf.Joint) -> tuple[float | None, float | None]:
    if joint.limit is None:
        return None, None
    lower = joint.limit.lower
    upper = joint.limit.upper
    if lower is None or upper is None:
        return None, None
    return float(lower), float(upper)


def _get_joint_pose(
    robot_model: yourdfpy.URDF, joint: yourdfpy.urdf.Joint
) -> tuple[np.ndarray, np.ndarray]:
    parent_transform = robot_model.get_transform(joint.parent)
    origin = joint.origin if joint.origin is not None else np.eye(4)
    joint_transform = parent_transform @ origin
    position = joint_transform[:3, 3]
    axis = np.asarray(joint.axis, dtype=float)
    axis_world = joint_transform[:3, :3] @ axis
    return position, axis_world


def inverse_kinematics(ik_request: IKRequest) -> IKResponse:
    entry = _get_or_create_entry(ik_request.urdf)
    robot_model = entry.urdf

    if len(ik_request.target_position) != 3:
        raise HTTPException(
            status_code=400,
            detail="target_position must have length 3",
        )

    joint_chain = _joint_chain(entry, ik_request.target_link)
    if not joint_chain:
        raise HTTPException(status_code=400, detail="IK chain empty")

    joint_values = _build_joint_values(robot_model, ik_request.joint_values)
    robot_model.update_cfg(joint_values)

    target_position = np.asarray(ik_request.target_position, dtype=float)
    iterations = 0
    cost = float("inf")
    started_at = time.perf_counter()

    for iteration_index in range(DEFAULT_MAX_ITERATIONS):
        end_effector_transform = robot_model.get_transform(ik_request.target_link)
        end_effector_position = end_effector_transform[:3, 3]
        cost = float(np.linalg.norm(end_effector_position - target_position))
        iterations = iteration_index + 1
        if cost <= DEFAULT_TOLERANCE:
            break

        for joint in joint_chain:
            joint_position, axis_world = _get_joint_pose(robot_model, joint)
            axis_length = float(np.linalg.norm(axis_world))
            if not np.isfinite(axis_length) or axis_length < 1e-8:
                continue
            axis_world = axis_world / axis_length

            joint_to_end_effector = end_effector_position - joint_position
            joint_to_target = target_position - joint_position

            current_joint_value = float(joint_values.get(joint.name, 0.0))
            lower, upper = _get_joint_limits(joint)

            if joint.type == "prismatic":
                along_axis = float(
                    np.dot(axis_world, joint_to_target)
                    - np.dot(axis_world, joint_to_end_effector)
                )
                delta = float(_clamp(along_axis, -MAX_STEP_LINEAR, MAX_STEP_LINEAR))
                next_value = current_joint_value + delta
                if lower is not None and upper is not None:
                    next_value = _clamp(next_value, lower, upper)
            else:
                projected_end = joint_to_end_effector - axis_world * np.dot(
                    joint_to_end_effector, axis_world
                )
                projected_target = joint_to_target - axis_world * np.dot(
                    joint_to_target, axis_world
                )
                projected_end_length = float(np.linalg.norm(projected_end))
                projected_target_length = float(np.linalg.norm(projected_target))
                if projected_end_length < 1e-8 or projected_target_length < 1e-8:
                    continue
                projected_end = projected_end / projected_end_length
                projected_target = projected_target / projected_target_length
                dot = float(np.dot(projected_end, projected_target))
                dot = _clamp(dot, -1.0, 1.0)
                angle = float(np.arccos(dot))
                if not np.isfinite(angle) or angle < 1e-4:
                    continue
                cross = np.cross(projected_end, projected_target)
                direction = float(np.sign(np.dot(cross, axis_world))) or 1.0
                delta = float(_clamp(direction * angle, -MAX_STEP_RAD, MAX_STEP_RAD))
                next_value = current_joint_value + delta
                if joint.type != "continuous" and lower is not None and upper is not None:
                    next_value = _clamp(next_value, lower, upper)

            joint_values[joint.name] = np.float32(next_value)
            robot_model.update_cfg(joint_values)
            end_effector_transform = robot_model.get_transform(ik_request.target_link)
            end_effector_position = end_effector_transform[:3, 3]
            cost = float(np.linalg.norm(end_effector_position - target_position))
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
    metadata: KinematicsMetadata = {
        "target_link": ik_request.target_link,
        "actuated_joint_names": list(robot_model.actuated_joint_names),
        "urdf_hash": entry.urdf_hash,
        "solve_ms": (time.perf_counter() - started_at) * 1000.0,
    }
    return IKResponse(solution=solution, diagnostics=diagnostics, metadata=metadata)
