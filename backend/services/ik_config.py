from __future__ import annotations

import json
import os
from pathlib import Path

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
        orientation_weight=0.5,
        posture_weight=0.15,
        velocity_dt=1.0 / 60.0,
        limit_weight=1.0,
    ),
}


def _read_config() -> dict:
    root_dir = Path(__file__).resolve().parents[2]
    config_path = root_dir / "config" / "app.config.json"
    if not config_path.exists():
        return {}
    try:
        return json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _get(config: dict, path: list[str], fallback):
    current = config
    for key in path:
        if not isinstance(current, dict) or key not in current:
            return fallback
        current = current[key]
    return current if current is not None else fallback


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


def _apply_config_overrides_timeouts(base: IkTimeouts, config: dict) -> IkTimeouts:
    request_ms = _get(config, ["ik", "timeouts", "requestMs"], None)
    if request_ms is None:
        request_ms = _get(config, ["ik", "timeouts", "request_ms"], base.request_ms)
    drag_ms = _get(config, ["ik", "timeouts", "dragMs"], None)
    if drag_ms is None:
        drag_ms = _get(config, ["ik", "timeouts", "drag_ms"], base.drag_ms)
    orbit_ms = _get(config, ["ik", "timeouts", "orbitMs"], None)
    if orbit_ms is None:
        orbit_ms = _get(config, ["ik", "timeouts", "orbit_ms"], base.orbit_ms)
    return IkTimeouts(
        request_ms=int(request_ms),
        drag_ms=int(drag_ms),
        orbit_ms=int(orbit_ms),
    )


def _apply_config_overrides_drag(base: IkDragConfig, config: dict) -> IkDragConfig:
    return IkDragConfig(
        max_drag_speed=float(
            _get(config, ["ik", "drag", "maxDragSpeed"], base.max_drag_speed)
        ),
        min_solve_distance=float(
            _get(config, ["ik", "drag", "minSolveDistance"], base.min_solve_distance)
        ),
        spring_strength=float(
            _get(config, ["ik", "drag", "springStrength"], base.spring_strength)
        ),
        spring_damping=float(
            _get(config, ["ik", "drag", "springDamping"], base.spring_damping)
        ),
        snap_distance=float(
            _get(config, ["ik", "drag", "snapDistance"], base.snap_distance)
        ),
        reach_margin=float(
            _get(config, ["ik", "drag", "reachMargin"], base.reach_margin)
        ),
        ik_throttle_ms=int(
            _get(config, ["ik", "drag", "ikThrottleMs"], base.ik_throttle_ms)
        ),
        max_link_traversal=int(
            _get(config, ["ik", "drag", "maxLinkTraversal"], base.max_link_traversal)
        ),
    )


def _apply_config_overrides_orbit(base: IkOrbitDefaults, config: dict) -> IkOrbitDefaults:
    return IkOrbitDefaults(
        radius=float(_get(config, ["ik", "orbit", "radius"], base.radius)),
        inclination_deg=float(
            _get(config, ["ik", "orbit", "inclinationDeg"], base.inclination_deg)
        ),
        phase_deg=float(_get(config, ["ik", "orbit", "phaseDeg"], base.phase_deg)),
        secondary_offset_deg=float(
            _get(
                config,
                ["ik", "orbit", "secondaryOffsetDeg"],
                base.secondary_offset_deg,
            )
        ),
    )


def _apply_config_overrides_solver(
    solver_id: str, base: IkSolverTuning, config: dict
) -> IkSolverTuning:
    solver_key = solver_id.replace("-", "")
    solver_key_alt = solver_id
    return IkSolverTuning(
        position_weight=float(
            _get(
                config,
                ["ik", "solverTuning", solver_key_alt, "positionWeight"],
                _get(
                    config,
                    ["ik", "solverTuning", solver_key, "positionWeight"],
                    base.position_weight,
                ),
            )
        ),
        orientation_weight=float(
            _get(
                config,
                ["ik", "solverTuning", solver_key_alt, "orientationWeight"],
                _get(
                    config,
                    ["ik", "solverTuning", solver_key, "orientationWeight"],
                    base.orientation_weight,
                ),
            )
        ),
        posture_weight=float(
            _get(
                config,
                ["ik", "solverTuning", solver_key_alt, "postureWeight"],
                _get(
                    config,
                    ["ik", "solverTuning", solver_key, "postureWeight"],
                    base.posture_weight,
                ),
            )
        ),
        velocity_dt=float(
            _get(
                config,
                ["ik", "solverTuning", solver_key_alt, "velocityDt"],
                _get(
                    config,
                    ["ik", "solverTuning", solver_key, "velocityDt"],
                    base.velocity_dt,
                ),
            )
        ),
        limit_weight=float(
            _get(
                config,
                ["ik", "solverTuning", solver_key_alt, "limitWeight"],
                _get(
                    config,
                    ["ik", "solverTuning", solver_key, "limitWeight"],
                    base.limit_weight,
                ),
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
    config = _read_config()
    timeouts = _apply_env_overrides_timeouts(
        _apply_config_overrides_timeouts(_DEFAULT_TIMEOUTS, config)
    )
    drag = _apply_env_overrides_drag(
        _apply_config_overrides_drag(_DEFAULT_DRAG, config)
    )
    orbit = _apply_env_overrides_orbit(
        _apply_config_overrides_orbit(_DEFAULT_ORBIT, config)
    )
    solver_tuning = {}
    for solver_id, tuning in _DEFAULT_SOLVER_TUNING.items():
        config_tuning = _apply_config_overrides_solver(solver_id, tuning, config)
        solver_tuning[solver_id] = _apply_env_overrides_solver(solver_id, config_tuning)
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
