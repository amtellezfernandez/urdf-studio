from __future__ import annotations

import math
import os
from collections.abc import Mapping
from typing import TypeAlias

from backend.models.ik_config import (
    IkConfigResponse,
    IkDragConfig,
    IkOrbitDefaults,
    IkSolverTuning,
    IkTolerances,
    IkTimeouts,
)

from backend.core.app_config import get_config_value, read_app_config

IK_CONFIG_VERSION = "1"
IkConfigOverrides: TypeAlias = Mapping[str, object]
SolverTuningDefaults: TypeAlias = dict[str, IkSolverTuning]

_DEFAULT_TIMEOUTS = IkTimeouts(request_ms=1200, drag_ms=300, orbit_ms=250)
_DEFAULT_DRAG = IkDragConfig(
    max_drag_speed=0.8,
    min_solve_distance=0.005,
    spring_strength=30.0,
    spring_damping=18.0,
    snap_distance=0.004,
    reach_margin=1.2,
    ik_throttle_ms=60,
    max_link_traversal=200,
)
_DEFAULT_ORBIT = IkOrbitDefaults(
    radius=0.3,
    inclination_deg=45.0,
    phase_deg=0.0,
    secondary_offset_deg=180.0,
)
_DEFAULT_TOLERANCES = IkTolerances(position_tolerance=0.002, orientation_tolerance=0.05)

_DEFAULT_SOLVER_TUNING: SolverTuningDefaults = {
    "placo": IkSolverTuning(
        position_weight=100.0,
        orientation_weight=0.5,
        posture_weight=0.0,
        velocity_dt=0.0,
        limit_weight=1.0,
        smooth_alpha=0.12,
        max_step_delta=0.04,
        max_blend_delta=0.18,
        solve_iterations=5,
    ),
    "amik": IkSolverTuning(
        position_weight=100.0,
        orientation_weight=0.0,
        posture_weight=0.0,
        velocity_dt=0.0,
        limit_weight=1.0,
        smooth_alpha=0.2,
        max_step_delta=0.35,
        max_blend_delta=0.35,
        solve_iterations=28,
    ),
}


def _read_int(key: str, default_value: int) -> int:
    raw = os.getenv(key)
    if not raw:
        return default_value
    try:
        return int(raw)
    except ValueError:
        return default_value


def _read_float(key: str, default_value: float) -> float:
    raw = os.getenv(key)
    if not raw:
        return default_value
    try:
        parsed = float(raw)
    except ValueError:
        return default_value
    if not math.isfinite(parsed):
        return default_value
    return parsed


def _apply_config_overrides_timeouts(
    base: IkTimeouts, config: IkConfigOverrides
) -> IkTimeouts:
    request_ms = get_config_value(config, ["ik", "timeouts", "requestMs"], None)
    if request_ms is None:
        request_ms = get_config_value(config, ["ik", "timeouts", "request_ms"], base.request_ms)
    drag_ms = get_config_value(config, ["ik", "timeouts", "dragMs"], None)
    if drag_ms is None:
        drag_ms = get_config_value(config, ["ik", "timeouts", "drag_ms"], base.drag_ms)
    orbit_ms = get_config_value(config, ["ik", "timeouts", "orbitMs"], None)
    if orbit_ms is None:
        orbit_ms = get_config_value(config, ["ik", "timeouts", "orbit_ms"], base.orbit_ms)
    return IkTimeouts(
        request_ms=int(request_ms),
        drag_ms=int(drag_ms),
        orbit_ms=int(orbit_ms),
    )


def _apply_config_overrides_drag(
    base: IkDragConfig, config: IkConfigOverrides
) -> IkDragConfig:
    return IkDragConfig(
        max_drag_speed=float(
            get_config_value(config, ["ik", "drag", "maxDragSpeed"], base.max_drag_speed)
        ),
        min_solve_distance=float(
            get_config_value(config, ["ik", "drag", "minSolveDistance"], base.min_solve_distance)
        ),
        spring_strength=float(
            get_config_value(config, ["ik", "drag", "springStrength"], base.spring_strength)
        ),
        spring_damping=float(
            get_config_value(config, ["ik", "drag", "springDamping"], base.spring_damping)
        ),
        snap_distance=float(
            get_config_value(config, ["ik", "drag", "snapDistance"], base.snap_distance)
        ),
        reach_margin=float(
            get_config_value(config, ["ik", "drag", "reachMargin"], base.reach_margin)
        ),
        ik_throttle_ms=int(
            get_config_value(config, ["ik", "drag", "ikThrottleMs"], base.ik_throttle_ms)
        ),
        max_link_traversal=int(
            get_config_value(config, ["ik", "drag", "maxLinkTraversal"], base.max_link_traversal)
        ),
    )


def _apply_config_overrides_orbit(
    base: IkOrbitDefaults, config: IkConfigOverrides
) -> IkOrbitDefaults:
    return IkOrbitDefaults(
        radius=float(get_config_value(config, ["ik", "orbit", "radius"], base.radius)),
        inclination_deg=float(
            get_config_value(config, ["ik", "orbit", "inclinationDeg"], base.inclination_deg)
        ),
        phase_deg=float(get_config_value(config, ["ik", "orbit", "phaseDeg"], base.phase_deg)),
        secondary_offset_deg=float(
            get_config_value(
                config,
                ["ik", "orbit", "secondaryOffsetDeg"],
                base.secondary_offset_deg,
            )
        ),
    )


def _read_solver_tuning_config_value(
    solver_id: str,
    setting_key: str,
    default_value: float | int,
    config: IkConfigOverrides,
) -> float | int:
    normalized_solver_id = solver_id.replace("-", "")
    return get_config_value(
        config,
        ["ik", "solverTuning", solver_id, setting_key],
        get_config_value(
            config,
            ["ik", "solverTuning", normalized_solver_id, setting_key],
            default_value,
        ),
    )


def _apply_config_overrides_solver(
    solver_id: str, base: IkSolverTuning, config: IkConfigOverrides
) -> IkSolverTuning:
    return IkSolverTuning(
        position_weight=float(
            _read_solver_tuning_config_value(
                solver_id, "positionWeight", base.position_weight, config
            )
        ),
        orientation_weight=float(
            _read_solver_tuning_config_value(
                solver_id, "orientationWeight", base.orientation_weight, config
            )
        ),
        posture_weight=float(
            _read_solver_tuning_config_value(
                solver_id, "postureWeight", base.posture_weight, config
            )
        ),
        velocity_dt=float(
            _read_solver_tuning_config_value(
                solver_id, "velocityDt", base.velocity_dt, config
            )
        ),
        limit_weight=float(
            _read_solver_tuning_config_value(
                solver_id, "limitWeight", base.limit_weight, config
            )
        ),
        smooth_alpha=float(
            _read_solver_tuning_config_value(
                solver_id, "smoothAlpha", base.smooth_alpha, config
            )
        ),
        max_step_delta=float(
            _read_solver_tuning_config_value(
                solver_id, "maxStepDelta", base.max_step_delta, config
            )
        ),
        max_blend_delta=float(
            _read_solver_tuning_config_value(
                solver_id, "maxBlendDelta", base.max_blend_delta, config
            )
        ),
        solve_iterations=int(
            _read_solver_tuning_config_value(
                solver_id, "solveIterations", base.solve_iterations, config
            )
        ),
    )


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


def _apply_config_overrides_tolerances(
    base: IkTolerances, config: IkConfigOverrides
) -> IkTolerances:
    return IkTolerances(
        position_tolerance=float(
            get_config_value(
                config, ["ik", "tolerances", "positionTolerance"], base.position_tolerance
            )
        ),
        orientation_tolerance=float(
            get_config_value(
                config,
                ["ik", "tolerances", "orientationTolerance"],
                base.orientation_tolerance,
            )
        ),
    )


def _apply_env_overrides_tolerances(base: IkTolerances) -> IkTolerances:
    return IkTolerances(
        position_tolerance=_read_float("URDF_IK_POS_TOL", base.position_tolerance),
        orientation_tolerance=_read_float("URDF_IK_ORI_TOL", base.orientation_tolerance),
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
        smooth_alpha=_read_float(f"URDF_IK_{prefix}_SMOOTH_ALPHA", base.smooth_alpha),
        max_step_delta=_read_float(f"URDF_IK_{prefix}_MAX_STEP_DELTA", base.max_step_delta),
        max_blend_delta=_read_float(f"URDF_IK_{prefix}_MAX_BLEND_DELTA", base.max_blend_delta),
        solve_iterations=_read_int(
            f"URDF_IK_{prefix}_SOLVE_ITER", base.solve_iterations
        ),
    )


def get_ik_config() -> IkConfigResponse:
    config = read_app_config()
    timeouts = _apply_env_overrides_timeouts(
        _apply_config_overrides_timeouts(_DEFAULT_TIMEOUTS, config)
    )
    drag = _apply_env_overrides_drag(
        _apply_config_overrides_drag(_DEFAULT_DRAG, config)
    )
    orbit = _apply_env_overrides_orbit(
        _apply_config_overrides_orbit(_DEFAULT_ORBIT, config)
    )
    tolerances = _apply_env_overrides_tolerances(
        _apply_config_overrides_tolerances(_DEFAULT_TOLERANCES, config)
    )
    solver_tuning: SolverTuningDefaults = {}
    for solver_id, tuning in _DEFAULT_SOLVER_TUNING.items():
        config_tuning = _apply_config_overrides_solver(solver_id, tuning, config)
        solver_tuning[solver_id] = _apply_env_overrides_solver(solver_id, config_tuning)
    return IkConfigResponse(
        version=IK_CONFIG_VERSION,
        timeouts=timeouts,
        drag=drag,
        orbit=orbit,
        tolerances=tolerances,
        solver_tuning=solver_tuning,
    )


def get_solver_tuning(solver_id: str) -> IkSolverTuning:
    config = get_ik_config()
    return config.solver_tuning.get(solver_id, _DEFAULT_SOLVER_TUNING["amik"])
