from __future__ import annotations

import os

from backend.models.ik_config import (
    IkConfigResponse,
    IkDragConfig,
    IkOrbitDefaults,
    IkSolverTuning,
    IkTimeouts,
)

IK_CONFIG_VERSION = "1"

_DEFAULT_TIMEOUTS = IkTimeouts(request_ms=1200, drag_ms=300, orbit_ms=250)
_DEFAULT_DRAG = IkDragConfig(
    max_drag_speed=1.2,
    min_solve_distance=0.003,
    spring_strength=45.0,
    spring_damping=12.0,
    snap_distance=0.003,
    reach_margin=1.25,
    ik_throttle_ms=40,
    max_link_traversal=200,
)
_DEFAULT_ORBIT = IkOrbitDefaults(
    radius=0.3,
    inclination_deg=45.0,
    phase_deg=0.0,
    secondary_offset_deg=180.0,
)

_DEFAULT_SOLVER_TUNING = {
    "pyroki-http": IkSolverTuning(
        position_weight=100.0,
        orientation_weight=1.0,
        posture_weight=0.0,
        velocity_dt=1.0 / 60.0,
        limit_weight=50.0,
    ),
    "lerobot-placo": IkSolverTuning(
        position_weight=100.0,
        orientation_weight=1.0,
        posture_weight=0.05,
        velocity_dt=1.0 / 60.0,
        limit_weight=0.0,
    ),
}


def _read_int(key: str, fallback: int) -> int:
    raw = os.getenv(key)
    if not raw:
        return fallback
    try:
        return int(raw)
    except ValueError:
        return fallback


def _read_float(key: str, fallback: float) -> float:
    raw = os.getenv(key)
    if not raw:
        return fallback
    try:
        return float(raw)
    except ValueError:
        return fallback


def _apply_env_overrides_timeouts(base: IkTimeouts) -> IkTimeouts:
    return IkTimeouts(
        request_ms=_read_int("URDF_IK_TIMEOUT_REQUEST_MS", base.request_ms),
        drag_ms=_read_int("URDF_IK_TIMEOUT_DRAG_MS", base.drag_ms),
        orbit_ms=_read_int("URDF_IK_TIMEOUT_ORBIT_MS", base.orbit_ms),
    )


def _apply_env_overrides_drag(base: IkDragConfig) -> IkDragConfig:
    return IkDragConfig(
        max_drag_speed=_read_float("URDF_IK_DRAG_MAX_SPEED", base.max_drag_speed),
        min_solve_distance=_read_float("URDF_IK_DRAG_MIN_DISTANCE", base.min_solve_distance),
        spring_strength=_read_float("URDF_IK_DRAG_SPRING_STRENGTH", base.spring_strength),
        spring_damping=_read_float("URDF_IK_DRAG_SPRING_DAMPING", base.spring_damping),
        snap_distance=_read_float("URDF_IK_DRAG_SNAP_DISTANCE", base.snap_distance),
        reach_margin=_read_float("URDF_IK_DRAG_REACH_MARGIN", base.reach_margin),
        ik_throttle_ms=_read_int("URDF_IK_DRAG_THROTTLE_MS", base.ik_throttle_ms),
        max_link_traversal=_read_int("URDF_IK_DRAG_MAX_LINK_TRAVERSAL", base.max_link_traversal),
    )


def _apply_env_overrides_orbit(base: IkOrbitDefaults) -> IkOrbitDefaults:
    return IkOrbitDefaults(
        radius=_read_float("URDF_IK_ORBIT_RADIUS", base.radius),
        inclination_deg=_read_float("URDF_IK_ORBIT_INCLINATION_DEG", base.inclination_deg),
        phase_deg=_read_float("URDF_IK_ORBIT_PHASE_DEG", base.phase_deg),
        secondary_offset_deg=_read_float(
            "URDF_IK_ORBIT_SECONDARY_OFFSET_DEG", base.secondary_offset_deg
        ),
    )


def _apply_env_overrides_solver(
    solver_id: str, base: IkSolverTuning
) -> IkSolverTuning:
    prefix = solver_id.upper().replace("-", "_")
    return IkSolverTuning(
        position_weight=_read_float(f"URDF_IK_{prefix}_POS_WEIGHT", base.position_weight),
        orientation_weight=_read_float(
            f"URDF_IK_{prefix}_ORI_WEIGHT", base.orientation_weight
        ),
        posture_weight=_read_float(
            f"URDF_IK_{prefix}_POSTURE_WEIGHT", base.posture_weight
        ),
        velocity_dt=_read_float(f"URDF_IK_{prefix}_VELOCITY_DT", base.velocity_dt),
        limit_weight=_read_float(f"URDF_IK_{prefix}_LIMIT_WEIGHT", base.limit_weight),
    )


def get_ik_config() -> IkConfigResponse:
    timeouts = _apply_env_overrides_timeouts(_DEFAULT_TIMEOUTS)
    drag = _apply_env_overrides_drag(_DEFAULT_DRAG)
    orbit = _apply_env_overrides_orbit(_DEFAULT_ORBIT)
    solver_tuning = {
        solver_id: _apply_env_overrides_solver(solver_id, tuning)
        for solver_id, tuning in _DEFAULT_SOLVER_TUNING.items()
    }
    return IkConfigResponse(
        version=IK_CONFIG_VERSION,
        timeouts=timeouts,
        drag=drag,
        orbit=orbit,
        solver_tuning=solver_tuning,
    )


def get_solver_tuning(solver_id: str) -> IkSolverTuning:
    config = get_ik_config()
    return config.solver_tuning.get(solver_id, _DEFAULT_SOLVER_TUNING["pyroki-http"])
