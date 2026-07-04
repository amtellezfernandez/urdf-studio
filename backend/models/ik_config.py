from __future__ import annotations

from pydantic import BaseModel


class IkTimeouts(BaseModel):
    request_ms: int
    drag_ms: int
    orbit_ms: int


class IkDragConfig(BaseModel):
    max_drag_speed: float
    min_solve_distance: float
    spring_strength: float
    spring_damping: float
    snap_distance: float
    reach_margin: float
    ik_throttle_ms: int
    max_link_traversal: int


class IkOrbitDefaults(BaseModel):
    radius: float
    inclination_deg: float
    phase_deg: float
    secondary_offset_deg: float


class IkSolverTuning(BaseModel):
    position_weight: float
    orientation_weight: float
    posture_weight: float
    velocity_dt: float
    limit_weight: float
    smooth_alpha: float
    max_step_delta: float
    max_blend_delta: float
    solve_iterations: int


class IkTolerances(BaseModel):
    position_tolerance: float
    orientation_tolerance: float


class IkConfigResponse(BaseModel):
    version: str
    timeouts: IkTimeouts
    drag: IkDragConfig
    orbit: IkOrbitDefaults
    solver_tuning: dict[str, IkSolverTuning]
    tolerances: IkTolerances
