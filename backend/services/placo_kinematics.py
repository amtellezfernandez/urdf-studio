from __future__ import annotations

import hashlib
import math
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
from fastapi import HTTPException

from backend.models.kinematics import IKDiagnostics, IKRequest, IKResponse
from backend.services.ik_config import get_solver_tuning
from backend.services.ilu_urdf import strip_urdf_for_kinematics


@dataclass
class PlacoRobotEntry:
    urdf_hash: str
    urdf_xml: str
    robot: Any
    solver: Any
    joint_names: List[str]
    joints_task: Any | None
    task_cache: Dict[str, Any] = field(default_factory=dict)


_robot_cache: Dict[str, PlacoRobotEntry] = {}


def _hash_urdf(urdf_xml: str) -> str:
    return hashlib.sha256(urdf_xml.encode("utf-8")).hexdigest()


def _quat_to_matrix(wxyz: List[float]) -> np.ndarray:
    if len(wxyz) != 4:
        raise HTTPException(
            status_code=400,
            detail="target_wxyz must have length 4 when provided",
        )
    w, x, y, z = wxyz
    quaternion_norm = math.sqrt(w * w + x * x + y * y + z * z)
    if quaternion_norm == 0:
        return np.eye(3, dtype=np.float64)
    w /= quaternion_norm
    x /= quaternion_norm
    y /= quaternion_norm
    z /= quaternion_norm
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ],
        dtype=np.float64,
    )


def _load_placo(urdf_xml: str) -> PlacoRobotEntry:
    try:
        import placo  # type: ignore
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="placo is not available; install it to enable the Placo IK solver.",
        ) from exc

    if not urdf_xml.strip():
        raise HTTPException(status_code=400, detail="URDF content is empty")

    sanitized_urdf = strip_urdf_for_kinematics(urdf_xml)
    urdf_hash = _hash_urdf(sanitized_urdf)
    cached_entry = _robot_cache.get(urdf_hash)
    if cached_entry is not None:
        return cached_entry

    with tempfile.NamedTemporaryFile("w", suffix=".urdf", delete=False) as urdf_file:
        urdf_file.write(sanitized_urdf)
        temporary_urdf_path = urdf_file.name

    try:
        robot = placo.RobotWrapper(temporary_urdf_path)
        solver = placo.KinematicsSolver(robot)
        solver.mask_fbase(True)
        tuning = get_solver_tuning("placo")
        enable_joint_limits = float(tuning.limit_weight) > 0.0
        solver.enable_joint_limits(enable_joint_limits)
        enable_velocity_limits = float(tuning.velocity_dt) > 0.0
        if enable_velocity_limits and hasattr(solver, "dt"):
            solver.dt = float(tuning.velocity_dt)
            solver.enable_velocity_limits(True)
        else:
            solver.enable_velocity_limits(False)
        joint_names = list(robot.joint_names())
        joints_task = None
        if float(tuning.posture_weight) > 0.0:
            joints_task = solver.add_joints_task()
            joints_task.configure("posture", "soft", float(tuning.posture_weight))
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=f"Failed to build Placo robot: {exc}"
        ) from exc
    finally:
        try:
            Path(temporary_urdf_path).unlink(missing_ok=True)
        except OSError:
            pass

    entry = PlacoRobotEntry(
        urdf_hash=urdf_hash,
        urdf_xml=sanitized_urdf,
        robot=robot,
        solver=solver,
        joint_names=joint_names,
        joints_task=joints_task,
    )
    _robot_cache[urdf_hash] = entry
    return entry


def _get_or_create_frame_task(entry: PlacoRobotEntry, target_link: str) -> Any:
    cached_task = entry.task_cache.get(target_link)
    if cached_task is not None:
        return cached_task

    try:
        frame_task = entry.solver.add_frame_task(target_link, np.eye(4))
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Target link '{target_link}' not found in URDF.",
        ) from exc

    entry.task_cache[target_link] = frame_task
    return frame_task


def _request_weight(request_value: float | None, fallback_value: float) -> float:
    return float(request_value) if request_value is not None else float(fallback_value)


def inverse_kinematics(ik_request: IKRequest) -> IKResponse:
    entry = _load_placo(ik_request.urdf)
    robot = entry.robot

    if len(ik_request.target_position) != 3:
        raise HTTPException(
            status_code=400,
            detail="target_position must have length 3",
        )
    if ik_request.target_rotation is not None:
        has_invalid_rotation_shape = len(ik_request.target_rotation) != 3 or any(
            len(row) != 3 for row in ik_request.target_rotation
        )
        if has_invalid_rotation_shape:
            raise HTTPException(
                status_code=400,
                detail="target_rotation must be a 3x3 matrix when provided (row-major).",
            )

    seed_joint_values = {
        joint_name: float(ik_request.joint_values.get(joint_name, 0.0))
        for joint_name in entry.joint_names
    }
    for joint_name, joint_value in seed_joint_values.items():
        robot.set_joint(joint_name, joint_value)
    robot.update_kinematics()

    tuning = get_solver_tuning("placo")
    position_weight = _request_weight(
        ik_request.position_weight, tuning.position_weight
    )
    orientation_weight = _request_weight(
        ik_request.orientation_weight, tuning.orientation_weight
    )
    posture_weight = _request_weight(ik_request.posture_weight, tuning.posture_weight)
    limit_weight = _request_weight(ik_request.limit_weight, tuning.limit_weight)

    rotation = (
        np.array(ik_request.target_rotation, dtype=np.float64)
        if ik_request.target_rotation is not None
        else _quat_to_matrix(ik_request.target_wxyz or [1.0, 0.0, 0.0, 0.0])
    )
    target_pose = np.eye(4, dtype=np.float64)
    target_pose[:3, :3] = rotation
    target_pose[:3, 3] = np.array(ik_request.target_position, dtype=np.float64)

    try:
        frame_task = _get_or_create_frame_task(entry, ik_request.target_link)
        frame_task.T_world_frame = target_pose

        has_orientation = (
            ik_request.target_rotation is not None or ik_request.target_wxyz is not None
        )
        frame_task.configure(
            ik_request.target_link,
            "soft",
            position_weight,
            orientation_weight if has_orientation else 0.0,
        )
        if posture_weight > 0.0:
            if entry.joints_task is None:
                entry.joints_task = entry.solver.add_joints_task()
            entry.joints_task.configure("posture", "soft", posture_weight)
            posture_target = ik_request.posture_joint_values or seed_joint_values
            try:
                entry.joints_task.set_joints(posture_target)
            except Exception:
                joint_seed = [
                    posture_target.get(joint_name, 0.0)
                    for joint_name in entry.joint_names
                ]
                try:
                    entry.joints_task.set_joints(joint_seed)
                except Exception:
                    joint_seed_array = np.array(joint_seed, dtype=np.float64)
                    entry.joints_task.set_joints(joint_seed_array)

        entry.solver.enable_joint_limits(limit_weight > 0.0)
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Placo IK setup failed: {exc}"
        ) from exc

    try:
        iterations = max(1, int(tuning.solve_iterations))
        for _solve_iteration in range(iterations):
            entry.solver.solve(True)
            robot.update_kinematics()
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Placo IK solve failed: {exc}"
        ) from exc

    solution = {
        joint_name: float(robot.get_joint(joint_name))
        for joint_name in entry.joint_names
    }

    diagnostics = IKDiagnostics(
        termination_reason="placo",
        termination_flags=[True, False, False, False],
        iterations=1,
        cost=0.0,
        lambda_final=0.0,
        validity="valid",
        stability="stable",
        degeneracy="unknown",
        branch_maybe=False,
        branch_metric=0.0,
        branch_message="Placo solver does not report branch diagnostics.",
    )

    metadata: Dict[str, Any] = {
        "urdf_hash": entry.urdf_hash,
        "target_link": ik_request.target_link,
        "actuated_joint_names": entry.joint_names,
    }

    return IKResponse(solution=solution, diagnostics=diagnostics, metadata=metadata)
