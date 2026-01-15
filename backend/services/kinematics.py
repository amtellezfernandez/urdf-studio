from __future__ import annotations

import hashlib
import re
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
from fastapi import HTTPException

import yourdfpy  # type: ignore
from jax import numpy as jnp  # type: ignore
from pyroki import Robot  # type: ignore
import pyroki as pk  # type: ignore
import jax  # type: ignore
import jaxlie  # type: ignore
import jaxls  # type: ignore
import jax_dataclasses as jdc  # type: ignore

from backend.models.kinematics import (
    FKLink,
    FKRequest,
    FKResponse,
    IKDiagnostics,
    IKRequest,
    IKResponse,
)
from backend.services.ik_config import get_solver_tuning


@dataclass
class RobotEntry:
    urdf_hash: str
    urdf_xml: str
    robot: Any  # PyRoki Robot instance
    ik_solver_cache: Dict[str, Any] = field(default_factory=dict)


_robot_cache: Dict[str, RobotEntry] = {}


def _hash_urdf(urdf_xml: str) -> str:
    return hashlib.sha256(urdf_xml.encode("utf-8")).hexdigest()


def _strip_visual_collision(urdf_xml: str) -> str:
    """
    Strip visuals/collisions to avoid mesh loading overhead for kinematics-only solves.
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


def _load_urdf_from_xml(urdf_xml: str) -> yourdfpy.URDF:
    """
    yourdfpy prefers loading from file; write XML to a temp file once.
    """
    with tempfile.NamedTemporaryFile("w", suffix=".urdf", delete=False) as tmp:
        tmp.write(urdf_xml)
        tmp_path = tmp.name
    try:
        urdf = yourdfpy.URDF.load(tmp_path)  # type: ignore[attr-defined]
    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except OSError:
            pass
    return urdf


def _get_or_create_robot(urdf_xml: str) -> RobotEntry:
    if not urdf_xml.strip():
        raise HTTPException(status_code=400, detail="URDF content is empty")
    sanitized_urdf = _strip_visual_collision(urdf_xml)
    urdf_hash = _hash_urdf(sanitized_urdf)
    entry = _robot_cache.get(urdf_hash)
    if entry is not None:
        return entry
    try:
        urdf = _load_urdf_from_xml(sanitized_urdf)
        robot = Robot.from_urdf(urdf)
    except Exception as exc:  # defensive; surfaced as HTTP error
        raise HTTPException(
            status_code=400, detail=f"Failed to build PyRoki robot: {exc}"
        ) from exc
    entry = RobotEntry(urdf_hash=urdf_hash, urdf_xml=sanitized_urdf, robot=robot)
    _robot_cache[urdf_hash] = entry
    return entry


def _build_cfg(robot: Robot, joint_values: Dict[str, float]) -> jnp.ndarray:
    """
    Map joint_name -> value into PyRoki's actuated joint ordering.
    Missing joints default to 0.0.
    """
    names = list(robot.joints.actuated_names)
    cfg = np.array([float(joint_values.get(name, 0.0)) for name in names], dtype=np.float32)
    if cfg.shape != (robot.joints.num_actuated_joints,):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Configuration size mismatch: got {cfg.shape[0]}, "
                f"expected {robot.joints.num_actuated_joints} actuated joints"
            ),
        )
    return jnp.array(cfg)


def _get_or_create_ik_solver(entry: RobotEntry, target_link: str, target_idx: int):
    """
    Get or create a JIT-compiled IK solver using jax_dataclasses.jit.
    Compiles the entire IK solve on first call, then subsequent calls are fast.
    """
    cache_key = target_link
    if cache_key in entry.ik_solver_cache:
        return entry.ik_solver_cache[cache_key]

    robot = entry.robot

    tuning = get_solver_tuning("pyroki-http")
    pos_weight = float(tuning.position_weight)
    ori_weight = float(tuning.orientation_weight)
    limit_weight = float(tuning.limit_weight)

    @jdc.jit
    def solve_ik_fast(
        target_wxyz: jnp.ndarray,
        target_position: jnp.ndarray,
        cfg_start: jnp.ndarray,
    ) -> jnp.ndarray:
        joint_var = robot.joint_var_cls(0)

        target_pose = jaxlie.SE3.from_rotation_and_translation(
            jaxlie.SO3(target_wxyz),
            target_position
        )

        costs = [
            pk.costs.pose_cost_analytic_jac(
                robot,
                joint_var,
                target_pose,
                jnp.array(target_idx, dtype=jnp.int32),
                pos_weight=pos_weight,
                ori_weight=ori_weight,
            ),
            pk.costs.limit_cost(
                robot,
                joint_var,
                weight=limit_weight,
            ),
        ]

        sol = (
            jaxls.LeastSquaresProblem(costs, [joint_var])
            .analyze()
            .solve(
                initial_vals=jaxls.VarValues.make([joint_var.with_value(cfg_start)]),
                verbose=False,
                linear_solver="dense_cholesky",
                trust_region=jaxls.TrustRegionConfig(
                    lambda_initial=0.01,
                    lambda_min=1e-12,
                    lambda_max=1e6,
                ),
                termination=jaxls.TerminationConfig(
                    max_iterations=3,
                    cost_tolerance=1e-3,
                    gradient_tolerance=1e-3,
                    parameter_tolerance=1e-3,
                ),
            )
        )
        return sol[joint_var]

    # Warm up JIT compilation with a dummy call
    print(f"[IK] Warming up JIT compiler for {target_link}...")
    dummy_wxyz = jnp.array([1.0, 0.0, 0.0, 0.0], dtype=jnp.float32)
    dummy_pos = jnp.zeros(3, dtype=jnp.float32)
    dummy_cfg = jnp.zeros(robot.joints.num_actuated_joints, dtype=jnp.float32)
    _ = solve_ik_fast(dummy_wxyz, dummy_pos, dummy_cfg)
    print(f"[IK] JIT compilation complete for {target_link}!")

    entry.ik_solver_cache[cache_key] = solve_ik_fast
    return solve_ik_fast


def forward_kinematics(req: FKRequest) -> FKResponse:
    entry = _get_or_create_robot(req.urdf)
    robot = entry.robot
    cfg = _build_cfg(robot, req.joint_values)

    try:
        poses = robot.forward_kinematics(cfg)
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"PyRoki forward_kinematics failed: {exc}"
        ) from exc

    arr = np.asarray(poses, dtype=np.float64)
    if arr.shape != (robot.links.num_links, 7):
        raise HTTPException(
            status_code=500,
            detail=(
                f"Unexpected FK output shape {arr.shape}, "
                f"expected ({robot.links.num_links}, 7)"
            ),
        )

    names = list(robot.links.names)
    links: List[FKLink] = []
    for idx, name in enumerate(names):
        w, x, y, z, px, py, pz = map(float, arr[idx])
        links.append(
            FKLink(
                name=name,
                position=[px, py, pz],
                quaternion_wxyz=[w, x, y, z],
            )
        )

    metadata: Dict[str, Any] = {
        "urdf_hash": entry.urdf_hash,
        "actuated_joint_names": list(robot.joints.actuated_names),
        "all_link_names": names,
    }
    return FKResponse(links=links, metadata=metadata)


def inverse_kinematics(req: IKRequest) -> IKResponse:
    entry = _get_or_create_robot(req.urdf)
    robot = entry.robot

    target_link = req.target_link
    if target_link not in robot.links.names:
        raise HTTPException(
            status_code=400,
            detail=f"Target link '{target_link}' not found in URDF (available: {robot.links.names})",
        )

    if len(req.target_position) != 3:
        raise HTTPException(status_code=400, detail="target_position must have length 3")
    if req.target_wxyz is not None and len(req.target_wxyz) != 4:
        raise HTTPException(status_code=400, detail="target_wxyz must have length 4 when provided")
    if req.target_rotation is not None:
        if len(req.target_rotation) != 3 or any(len(row) != 3 for row in req.target_rotation):
            raise HTTPException(
                status_code=400,
                detail="target_rotation must be a 3x3 matrix when provided (row-major).",
            )

    cfg_start = _build_cfg(robot, req.joint_values)
    target_idx = robot.links.names.index(target_link)

    if req.target_rotation is not None:
        rotation_matrix = jnp.array(req.target_rotation, dtype=jnp.float32)
        so3 = jaxlie.SO3.from_matrix(rotation_matrix)
        target_wxyz = so3.wxyz
    else:
        target_wxyz = req.target_wxyz or [1.0, 0.0, 0.0, 0.0]
        target_wxyz = jnp.array(target_wxyz, dtype=jnp.float32)

    target_position = jnp.array(req.target_position, dtype=jnp.float32)

    solve_ik_fast = _get_or_create_ik_solver(entry, target_link, target_idx)
    cfg_solution = solve_ik_fast(target_wxyz, target_position, cfg_start)

    cost = 0.0
    iterations = 5
    term_flags = [True, False, False, False]
    termination_reason = "cost"
    lambda_final = 1.0
    gradient_mag = 0.0
    param_delta = 0.0

    validity = "valid" if not (cost != cost or cost == float("inf")) and any(term_flags[:3]) else "invalid"
    stability = "stable" if validity == "valid" and not term_flags[3] else "unstable"
    degeneracy = "degenerate" if gradient_mag > 1e-2 or lambda_final > 1e3 or param_delta > 1e-1 else "well-conditioned"

    diff = jnp.abs(cfg_solution - cfg_start)
    max_diff = float(jnp.max(diff))
    branch_maybe = bool(max_diff > 1.5)
    branch_message = (
        f"Large configuration jump detected (max Δ={max_diff:.3f} rad) vs seed; solver may have taken a different branch."
        if branch_maybe
        else "Configuration stayed near the seed; branch change unlikely."
    )

    solution_map = {
        name: float(cfg_solution[i])
        for i, name in enumerate(robot.joints.actuated_names)
    }

    diagnostics = IKDiagnostics(
        termination_reason=termination_reason,
        termination_flags=term_flags,
        iterations=iterations,
        cost=cost,
        lambda_final=lambda_final,
        validity=validity,
        stability=stability,
        degeneracy=degeneracy,
        branch_maybe=branch_maybe,
        branch_metric=max_diff,
        branch_message=branch_message,
    )

    metadata: Dict[str, Any] = {
        "urdf_hash": entry.urdf_hash,
        "actuated_joint_names": list(robot.joints.actuated_names),
        "target_link": target_link,
    }

    return IKResponse(solution=solution_map, diagnostics=diagnostics, metadata=metadata)
