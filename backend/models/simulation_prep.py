from __future__ import annotations

from pydantic import BaseModel


class SimulationPrepGeometryResult(BaseModel):
    geom_name: str
    mesh_file: str
    staged: bool
    mujoco_loaded: bool | None
    authored_position: list[float] | None
    authored_quaternion: list[float] | None
    scale: list[float] | None
    error: str | None


class SimulationPrepSmokeSimResult(BaseModel):
    ran: bool
    steps: int
    passed: bool
    error: str | None


class SimulationPrepValidationReport(BaseModel):
    success: bool
    error: str | None
    geometry_count: int
    geometries: list[SimulationPrepGeometryResult]
    smoke_simulation: SimulationPrepSmokeSimResult | None
    mujoco_available: bool
    warnings: list[str]
