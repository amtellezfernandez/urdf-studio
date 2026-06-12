from __future__ import annotations

import hashlib
import math
from typing import Dict, List, Optional, Tuple

from fastapi import HTTPException

from backend.models.kinematics import IKResponse, IkSolveRequest
from backend.services.ik_config import get_ik_config, get_solver_tuning
from backend.services.ik_orchestrator_utils import (
    build_orientation_attempts,
    build_seed_list,
)
from backend.services.ik_registry import default_solver_chain
from backend.services.kinematics import (
    compute_link_pose,
    rotation_matrix_to_wxyz,
)
from backend.services.amik_kinematics import inverse_kinematics as amik_ik
from backend.services.lerobot_kinematics import (
    inverse_kinematics as lerobot_inverse_kinematics,
)
from backend.services.task_compiler import compile_ik_request


REMOTE_SOLVERS = {"lerobot-placo", "amik"}
_LAST_SOLUTION_CACHE: Dict[Tuple[str, str], Dict[str, float]] = {}


def _hash_urdf(urdf_xml: str) -> str:
    return hashlib.sha256(urdf_xml.encode("utf-8")).hexdigest()


def _score_solution(
    solution: Dict[str, float], seed: Dict[str, float]
) -> float:
    if not seed:
        return 0.0
    diffs = [
        abs(float(solution.get(name, 0.0)) - float(seed.get(name, 0.0)))
        for name in solution.keys()
    ]
    return max(diffs) if diffs else 0.0


def solve_ik(req: IkSolveRequest) -> IKResponse:
    base_req = compile_ik_request(req)
    has_orientation = bool(base_req.target_rotation) or bool(base_req.target_wxyz)
    orientation_mode = (req.orientation_mode or "prefer").lower()
    if orientation_mode in ("required", "position_first") and not has_orientation:
        raise HTTPException(status_code=400, detail="Orientation required but not provided.")

    solver_chain = (
        req.solver_chain
        if req.solver_chain
        else ([req.solver_id] if req.solver_id else default_solver_chain())
    )
    if not solver_chain:
        raise HTTPException(status_code=400, detail="No IK solvers configured.")

    attempts = build_orientation_attempts(orientation_mode, has_orientation)
    urdf_hash = _hash_urdf(req.urdf)
    cache_key = (urdf_hash, base_req.target_link)
    cached_solution = _LAST_SOLUTION_CACHE.get(cache_key)
    seeds = build_seed_list(base_req.joint_values, cached_solution)

    best_response: Optional[IKResponse] = None
    best_score = float("inf")
    best_solver_id: Optional[str] = None
    best_seed_source: Optional[str] = None
    best_orientation_label: Optional[str] = None
    best_orientation_weight: Optional[float] = None
    best_position_error: Optional[float] = None
    best_seed_index: Optional[int] = None
    best_stage_index: Optional[int] = None
    last_error: Optional[HTTPException] = None

    previous_stage_solution: Dict[Tuple[str, int], Dict[str, float]] = {}
    blocked_reason_by_seed: Dict[Tuple[str, int], str] = {}
    require_chained = orientation_mode == "position_first"
    config = get_ik_config()
    pos_tol = (
        float(base_req.position_tolerance)
        if base_req.position_tolerance is not None
        else float(config.tolerances.position_tolerance)
    )
    rot_tol = (
        float(base_req.orientation_tolerance)
        if base_req.orientation_tolerance is not None
        else float(config.tolerances.orientation_tolerance)
    )
    pos_gate_abs = 0.002
    pos_gate_relaxed = max(0.003, 5.0 * pos_tol)
    pos_gate_strict = max(pos_gate_abs, 3.0 * pos_tol)

    def _quat_angle_error(target_wxyz: List[float], actual_wxyz: List[float]) -> float:
        tw, tx, ty, tz = target_wxyz
        aw, ax, ay, az = actual_wxyz
        t_norm = math.sqrt(tw * tw + tx * tx + ty * ty + tz * tz)
        a_norm = math.sqrt(aw * aw + ax * ax + ay * ay + az * az)
        if t_norm == 0.0 or a_norm == 0.0:
            return math.inf
        tw, tx, ty, tz = tw / t_norm, tx / t_norm, ty / t_norm, tz / t_norm
        aw, ax, ay, az = aw / a_norm, ax / a_norm, ay / a_norm, az / a_norm
        dot = abs(tw * aw + tx * ax + ty * ay + tz * az)
        dot = min(1.0, max(-1.0, dot))
        return 2.0 * math.acos(dot)

    for stage_index, (ignore_orientation, orientation_scale, orientation_label) in enumerate(
        attempts
    ):
        for solver_id in solver_chain:
            if solver_id not in REMOTE_SOLVERS:
                continue
            tuning = get_solver_tuning(solver_id)
            base_orientation_weight = (
                float(base_req.orientation_weight)
                if base_req.orientation_weight is not None
                else float(tuning.orientation_weight)
            )
            scaled_orientation_weight = (
                0.0 if ignore_orientation else base_orientation_weight * orientation_scale
            )
            for seed_index, (seed_source, seed) in enumerate(seeds):
                seed_key = (solver_id, seed_index)
                chained_seed = previous_stage_solution.get(seed_key)
                if require_chained and stage_index > 0 and chained_seed is None:
                    blocked_reason_by_seed[seed_key] = "no_prev_solution"
                    continue
                if require_chained and stage_index > 0 and chained_seed is not None:
                    seed_to_use = chained_seed
                else:
                    seed_to_use = seed
                attempt_req = base_req.copy(update={"joint_values": seed_to_use})
                if ignore_orientation:
                    attempt_req = attempt_req.copy(
                        update={
                            "target_rotation": None,
                            "target_wxyz": None,
                            "orientation_weight": 0.0,
                        }
                    )
                else:
                    attempt_req = attempt_req.copy(
                        update={"orientation_weight": scaled_orientation_weight}
                    )
                try:
                    if solver_id == "lerobot-placo":
                        response = lerobot_inverse_kinematics(attempt_req)
                    elif solver_id == "amik":
                        response = amik_ik(attempt_req)
                    else:
                        continue
                except HTTPException as exc:
                    last_error = exc
                    continue

                try:
                    pos_actual, wxyz_actual = compute_link_pose(
                        base_req.urdf, response.solution, base_req.target_link
                    )
                    pos_error = (
                        ((pos_actual[0] - base_req.target_position[0]) ** 2
                        + (pos_actual[1] - base_req.target_position[1]) ** 2
                        + (pos_actual[2] - base_req.target_position[2]) ** 2) ** 0.5
                    )
                except HTTPException:
                    pos_error = None
                    wxyz_actual = None

                target_wxyz = base_req.target_wxyz
                if target_wxyz is None and base_req.target_rotation is not None:
                    try:
                        target_wxyz = rotation_matrix_to_wxyz(base_req.target_rotation)
                    except Exception:
                        target_wxyz = None

                rot_error = None
                if (
                    target_wxyz is not None
                    and wxyz_actual is not None
                    and not ignore_orientation
                ):
                    rot_error = _quat_angle_error(target_wxyz, wxyz_actual)

                gate = pos_gate_strict
                if orientation_label in ("ignore", "no_orientation"):
                    gate = pos_gate_relaxed
                elif orientation_label == "relaxed":
                    gate = pos_gate_strict

                if require_chained and pos_error is not None and pos_error <= gate:
                    previous_stage_solution[seed_key] = response.solution
                elif require_chained and pos_error is not None and pos_error > gate:
                    blocked_reason_by_seed[seed_key] = (
                        "pos_gate_relaxed"
                        if gate == pos_gate_relaxed
                        else "pos_gate_strict"
                    )
                score = _score_solution(response.solution, seed_to_use)
                if score < best_score:
                    best_response = response
                    best_score = score
                    best_solver_id = solver_id
                    best_seed_source = seed_source
                    best_orientation_label = orientation_label
                    best_orientation_weight = float(scaled_orientation_weight)
                    best_position_error = pos_error
                    best_seed_index = seed_index
                    best_stage_index = stage_index

                if pos_error is not None and pos_error <= pos_tol:
                    should_return = False
                    if orientation_label in ("ignore", "no_orientation"):
                        should_return = True
                    elif orientation_label == "relaxed" and rot_error is not None:
                        should_return = rot_error <= (2.0 * rot_tol)
                    elif orientation_label == "strict" and rot_error is not None:
                        should_return = rot_error <= rot_tol

                    if should_return:
                        diagnostics = response.diagnostics.copy(
                            update={
                                "solver_id": solver_id,
                                "seed_source": seed_source,
                                "continuity_penalty": score,
                                "position_error": pos_error,
                                "escalation_blocked_reason": f"early_exit_{orientation_label}",
                            }
                        )
                        metadata = dict(response.metadata or {})
                        metadata.update(
                            {
                                "solver_id": solver_id,
                                "seed_source": seed_source,
                                "solver_chain": solver_chain,
                                "orientation_strategy": orientation_label,
                                "orientation_weight_effective": float(
                                    scaled_orientation_weight
                                ),
                                "position_tolerance": pos_tol,
                                "orientation_tolerance": rot_tol,
                                "position_gate_relaxed": pos_gate_relaxed,
                                "position_gate_strict": pos_gate_strict,
                                "escalation_blocked_reason": f"early_exit_{orientation_label}",
                            }
                        )
                        response.diagnostics = diagnostics
                        response.metadata = metadata
                        cache_hash = metadata.get("urdf_hash", urdf_hash)
                        cache_key = (cache_hash, base_req.target_link)
                        _LAST_SOLUTION_CACHE[cache_key] = response.solution
                        return response

    if best_response is None:
        if last_error is not None:
            raise last_error
        raise HTTPException(status_code=500, detail="IK solve failed.")

    blocked_reason = None
    if best_solver_id is not None and best_seed_index is not None:
        blocked_reason = blocked_reason_by_seed.get((best_solver_id, best_seed_index))

    diagnostics = best_response.diagnostics.copy(
        update={
            "solver_id": best_solver_id,
            "seed_source": best_seed_source,
            "continuity_penalty": best_score,
            "position_error": best_position_error,
            "escalation_blocked_reason": blocked_reason,
        }
    )
    metadata = dict(best_response.metadata or {})
    metadata.update(
        {
            "solver_id": best_solver_id,
            "seed_source": best_seed_source,
            "solver_chain": solver_chain,
            "orientation_strategy": best_orientation_label,
            "orientation_weight_effective": best_orientation_weight,
            "position_tolerance": pos_tol,
            "orientation_tolerance": rot_tol,
            "position_gate_relaxed": pos_gate_relaxed,
            "position_gate_strict": pos_gate_strict,
            "escalation_blocked_reason": blocked_reason,
        }
    )

    best_response.diagnostics = diagnostics
    best_response.metadata = metadata

    cache_hash = metadata.get("urdf_hash", urdf_hash)
    cache_key = (cache_hash, base_req.target_link)
    _LAST_SOLUTION_CACHE[cache_key] = best_response.solution
    return best_response
