from __future__ import annotations

import hashlib
import math

from fastapi import HTTPException

from backend.models.kinematics import IKResponse, IkSolveRequest
from backend.services.ik_config import get_ik_config, get_solver_tuning
from backend.services.ik_orchestrator_utils import (
    build_orientation_attempts,
    build_seed_list,
    position_gate_for_orientation_label,
)
from backend.services.ik_registry import default_solver_chain
from backend.services.kinematics import (
    compute_link_pose,
    rotation_matrix_to_wxyz,
)
from backend.services.amik_kinematics import inverse_kinematics as amik_ik
from backend.services.placo_kinematics import (
    inverse_kinematics as placo_inverse_kinematics,
)
from backend.services.task_compiler import compile_ik_request


REMOTE_SOLVERS = {"placo", "amik"}
JointSolution = dict[str, float]
SolutionCacheKey = tuple[str, str]
StageSeedKey = tuple[str, int]
_LAST_SOLUTION_CACHE: dict[SolutionCacheKey, JointSolution] = {}


def _hash_urdf(urdf_xml: str) -> str:
    return hashlib.sha256(urdf_xml.encode("utf-8")).hexdigest()


def _score_solution(
    solution: JointSolution, seed: JointSolution
) -> float:
    if not seed:
        return 0.0
    diffs = [
        abs(float(solution.get(name, 0.0)) - float(seed.get(name, 0.0)))
        for name in solution.keys()
    ]
    return max(diffs) if diffs else 0.0


def solve_ik(solve_request: IkSolveRequest) -> IKResponse:
    compiled_request = compile_ik_request(solve_request)
    has_orientation = bool(compiled_request.target_rotation) or bool(
        compiled_request.target_wxyz
    )
    orientation_mode = (solve_request.orientation_mode or "prefer").lower()
    if orientation_mode in ("required", "position_first") and not has_orientation:
        raise HTTPException(status_code=400, detail="Orientation required but not provided.")

    solver_chain = (
        solve_request.solver_chain
        if solve_request.solver_chain
        else (
            [solve_request.solver_id]
            if solve_request.solver_id
            else default_solver_chain()
        )
    )
    if not solver_chain:
        raise HTTPException(status_code=400, detail="No IK solvers configured.")

    attempts = build_orientation_attempts(orientation_mode, has_orientation)
    urdf_hash = _hash_urdf(solve_request.urdf)
    cache_key = (urdf_hash, compiled_request.target_link)
    cached_solution = _LAST_SOLUTION_CACHE.get(cache_key)
    seed_candidates = build_seed_list(compiled_request.joint_values, cached_solution)

    best_response: IKResponse | None = None
    best_score = float("inf")
    best_solver_id: str | None = None
    best_seed_source: str | None = None
    best_orientation_label: str | None = None
    best_orientation_weight: float | None = None
    best_position_error: float | None = None
    best_seed_index: int | None = None
    last_error: HTTPException | None = None

    previous_stage_solution: dict[StageSeedKey, JointSolution] = {}
    blocked_reason_by_seed: dict[StageSeedKey, str] = {}
    require_chained = orientation_mode == "position_first"
    config = get_ik_config()
    position_tolerance = (
        float(compiled_request.position_tolerance)
        if compiled_request.position_tolerance is not None
        else float(config.tolerances.position_tolerance)
    )
    orientation_tolerance = (
        float(compiled_request.orientation_tolerance)
        if compiled_request.orientation_tolerance is not None
        else float(config.tolerances.orientation_tolerance)
    )
    absolute_position_gate = 0.002
    relaxed_position_gate = max(0.003, 5.0 * position_tolerance)
    strict_position_gate = max(absolute_position_gate, 3.0 * position_tolerance)

    def _quat_angle_error(target_wxyz: list[float], actual_wxyz: list[float]) -> float:
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
                float(compiled_request.orientation_weight)
                if compiled_request.orientation_weight is not None
                else float(tuning.orientation_weight)
            )
            scaled_orientation_weight = (
                0.0 if ignore_orientation else base_orientation_weight * orientation_scale
            )
            for seed_index, (seed_source, seed) in enumerate(seed_candidates):
                seed_key = (solver_id, seed_index)
                chained_seed = previous_stage_solution.get(seed_key)
                if require_chained and stage_index > 0 and chained_seed is None:
                    blocked_reason_by_seed[seed_key] = "no_prev_solution"
                    continue
                if require_chained and stage_index > 0 and chained_seed is not None:
                    seed_to_use = chained_seed
                else:
                    seed_to_use = seed
                attempt_request = compiled_request.model_copy(
                    update={"joint_values": seed_to_use}
                )
                if ignore_orientation:
                    attempt_request = attempt_request.model_copy(
                        update={
                            "target_rotation": None,
                            "target_wxyz": None,
                            "orientation_weight": 0.0,
                        }
                    )
                else:
                    attempt_request = attempt_request.model_copy(
                        update={"orientation_weight": scaled_orientation_weight}
                    )
                try:
                    if solver_id == "placo":
                        response = placo_inverse_kinematics(attempt_request)
                    elif solver_id == "amik":
                        response = amik_ik(attempt_request)
                    else:
                        continue
                except HTTPException as exc:
                    last_error = exc
                    continue

                try:
                    actual_position, actual_wxyz = compute_link_pose(
                        compiled_request.urdf,
                        response.solution,
                        compiled_request.target_link,
                    )
                    position_error = math.dist(
                        actual_position, compiled_request.target_position
                    )
                except HTTPException:
                    position_error = None
                    actual_wxyz = None

                target_wxyz = compiled_request.target_wxyz
                if target_wxyz is None and compiled_request.target_rotation is not None:
                    try:
                        target_wxyz = rotation_matrix_to_wxyz(
                            compiled_request.target_rotation
                        )
                    except HTTPException:
                        target_wxyz = None

                orientation_error = None
                if (
                    target_wxyz is not None
                    and actual_wxyz is not None
                    and not ignore_orientation
                ):
                    orientation_error = _quat_angle_error(target_wxyz, actual_wxyz)

                position_gate = position_gate_for_orientation_label(
                    orientation_label,
                    relaxed_gate=relaxed_position_gate,
                    strict_gate=strict_position_gate,
                )

                if (
                    require_chained
                    and position_error is not None
                    and position_error <= position_gate
                ):
                    previous_stage_solution[seed_key] = response.solution
                elif (
                    require_chained
                    and position_error is not None
                    and position_error > position_gate
                ):
                    blocked_reason_by_seed[seed_key] = (
                        "pos_gate_relaxed"
                        if position_gate == relaxed_position_gate
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
                    best_position_error = position_error
                    best_seed_index = seed_index

                if position_error is not None and position_error <= position_tolerance:
                    should_return = False
                    if orientation_label in ("ignore", "no_orientation"):
                        should_return = True
                    elif (
                        orientation_label == "relaxed"
                        and orientation_error is not None
                    ):
                        should_return = orientation_error <= (
                            2.0 * orientation_tolerance
                        )
                    elif (
                        orientation_label == "strict"
                        and orientation_error is not None
                    ):
                        should_return = orientation_error <= orientation_tolerance

                    if should_return:
                        diagnostics = response.diagnostics.model_copy(
                            update={
                                "solver_id": solver_id,
                                "seed_source": seed_source,
                                "continuity_penalty": score,
                                "position_error": position_error,
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
                                "position_tolerance": position_tolerance,
                                "orientation_tolerance": orientation_tolerance,
                                "position_gate_relaxed": relaxed_position_gate,
                                "position_gate_strict": strict_position_gate,
                                "escalation_blocked_reason": f"early_exit_{orientation_label}",
                            }
                        )
                        response.diagnostics = diagnostics
                        response.metadata = metadata
                        cache_hash = metadata.get("urdf_hash", urdf_hash)
                        cache_key = (cache_hash, compiled_request.target_link)
                        _LAST_SOLUTION_CACHE[cache_key] = response.solution
                        return response

    if best_response is None:
        if last_error is not None:
            raise last_error
        raise HTTPException(status_code=500, detail="IK solve failed.")

    blocked_reason = None
    if best_solver_id is not None and best_seed_index is not None:
        blocked_reason = blocked_reason_by_seed.get((best_solver_id, best_seed_index))

    diagnostics = best_response.diagnostics.model_copy(
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
            "position_tolerance": position_tolerance,
            "orientation_tolerance": orientation_tolerance,
            "position_gate_relaxed": relaxed_position_gate,
            "position_gate_strict": strict_position_gate,
            "escalation_blocked_reason": blocked_reason,
        }
    )

    best_response.diagnostics = diagnostics
    best_response.metadata = metadata

    cache_hash = metadata.get("urdf_hash", urdf_hash)
    cache_key = (cache_hash, compiled_request.target_link)
    _LAST_SOLUTION_CACHE[cache_key] = best_response.solution
    return best_response
