from __future__ import annotations

import hashlib
import math
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
from fastapi import HTTPException
import re
import xml.etree.ElementTree as ET

from backend.models.kinematics import IKDiagnostics, IKRequest, IKResponse
from backend.services.ik_config import get_solver_tuning


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
        raise HTTPException(status_code=400, detail="target_wxyz must have length 4 when provided")
    w, x, y, z = wxyz
    norm = math.sqrt(w * w + x * x + y * y + z * z)
    if norm == 0:
        return np.eye(3, dtype=np.float64)
    w /= norm
    x /= norm
    y /= norm
    z /= norm
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ],
        dtype=np.float64,
    )


def _strip_visual_collision(urdf_xml: str) -> str:
    """
    Placo loads mesh assets eagerly; strip visuals/collisions to avoid missing files.
    """

    def regex_strip(xml: str) -> str:
        xml = re.sub(r"<visual\\b[^>]*>.*?</visual>", "", xml, flags=re.DOTALL | re.IGNORECASE)
        xml = re.sub(r"<collision\\b[^>]*>.*?</collision>", "", xml, flags=re.DOTALL | re.IGNORECASE)
        xml = re.sub(r"<mesh\\b[^>]*/>", "", xml, flags=re.DOTALL | re.IGNORECASE)
        xml = re.sub(r"<mesh\\b[^>]*>.*?</mesh>", "", xml, flags=re.DOTALL | re.IGNORECASE)
        return xml

    try:
        root = ET.fromstring(urdf_xml)
    except ET.ParseError:
        return regex_strip(urdf_xml)

    def tag_name(element: ET.Element) -> str:
        return element.tag.split("}", 1)[-1]

    for parent in root.iter():
        for child in list(parent):
            if tag_name(child) in ("visual", "collision"):
                parent.remove(child)

    sanitized = ET.tostring(root, encoding="unicode")
    if "<mesh" in sanitized:
        sanitized = regex_strip(sanitized)
    return sanitized


def _load_placo(urdf_xml: str) -> PlacoRobotEntry:
    try:
        import placo  # type: ignore
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="placo is not available; install it to enable the LeRobot IK solver.",
        ) from exc

    if not urdf_xml.strip():
        raise HTTPException(status_code=400, detail="URDF content is empty")

    sanitized_urdf = _strip_visual_collision(urdf_xml)
    urdf_hash = _hash_urdf(sanitized_urdf)
    cached = _robot_cache.get(urdf_hash)
    if cached is not None:
        return cached

    with tempfile.NamedTemporaryFile("w", suffix=".urdf", delete=False) as tmp:
        tmp.write(sanitized_urdf)
        tmp_path = tmp.name

    try:
        robot = placo.RobotWrapper(tmp_path)
        solver = placo.KinematicsSolver(robot)
        solver.mask_fbase(True)
        tuning = get_solver_tuning("lerobot-placo")
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
            Path(tmp_path).unlink(missing_ok=True)
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


def _get_or_create_frame_task(entry: PlacoRobotEntry, target_link: str):
    cached = entry.task_cache.get(target_link)
    if cached is not None:
        return cached

    try:
        task = entry.solver.add_frame_task(target_link, np.eye(4))
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Target link '{target_link}' not found in URDF.",
        ) from exc

    entry.task_cache[target_link] = task
    return task


def inverse_kinematics(req: IKRequest) -> IKResponse:
    entry = _load_placo(req.urdf)
    robot = entry.robot

    if len(req.target_position) != 3:
        raise HTTPException(status_code=400, detail="target_position must have length 3")
    if req.target_rotation is not None:
        if len(req.target_rotation) != 3 or any(len(row) != 3 for row in req.target_rotation):
            raise HTTPException(
                status_code=400,
                detail="target_rotation must be a 3x3 matrix when provided (row-major).",
            )

    seed_map = {name: float(req.joint_values.get(name, 0.0)) for name in entry.joint_names}
    for joint_name, value in seed_map.items():
        robot.set_joint(joint_name, value)
    robot.update_kinematics()

    rotation = (
        np.array(req.target_rotation, dtype=np.float64)
        if req.target_rotation is not None
        else _quat_to_matrix(req.target_wxyz or [1.0, 0.0, 0.0, 0.0])
    )
    target_pose = np.eye(4, dtype=np.float64)
    target_pose[:3, :3] = rotation
    target_pose[:3, 3] = np.array(req.target_position, dtype=np.float64)

    try:
        frame_task = _get_or_create_frame_task(entry, req.target_link)
        frame_task.T_world_frame = target_pose

        tuning = get_solver_tuning("lerobot-placo")
        has_orientation = req.target_rotation is not None or req.target_wxyz is not None
        frame_task.configure(
            req.target_link,
            "soft",
            float(tuning.position_weight),
            float(tuning.orientation_weight) if has_orientation else 0.0,
        )
        if entry.joints_task is not None:
            try:
                entry.joints_task.set_joints(seed_map)
            except Exception:
                joint_seed = [seed_map.get(name, 0.0) for name in entry.joint_names]
                try:
                    entry.joints_task.set_joints(joint_seed)
                except Exception:
                    joint_seed_array = np.array(joint_seed, dtype=np.float64)
                    entry.joints_task.set_joints(joint_seed_array)
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Placo IK setup failed: {exc}"
        ) from exc

    try:
        tuning = get_solver_tuning("lerobot-placo")
        iterations = max(1, int(tuning.solve_iterations))
        for _ in range(iterations):
            entry.solver.solve(True)
            robot.update_kinematics()
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Placo IK solve failed: {exc}"
        ) from exc

    solution = {name: float(robot.get_joint(name)) for name in entry.joint_names}

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
        "target_link": req.target_link,
        "actuated_joint_names": entry.joint_names,
    }

    return IKResponse(solution=solution, diagnostics=diagnostics, metadata=metadata)
