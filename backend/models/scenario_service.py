from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ScenarioRunStatus = Literal["queued", "running", "completed", "failed"]


class ScenarioSummary(BaseModel):
    scenario_id: str
    title: str | None = None
    task_family: str
    instruction: str
    world_package: str
    default_sims: list[str] = Field(default_factory=list)
    episodes: int
    success_condition_count: int


class ScenarioListResponse(BaseModel):
    scenarios: list[ScenarioSummary] = Field(default_factory=list)


class ScenarioRunRequest(BaseModel):
    sims: list[str] = Field(..., min_length=1, max_length=8)
    episodes: int | None = Field(default=None, ge=1, le=64)


class ScenarioRunSummary(BaseModel):
    run_id: str
    scenario_id: str
    sims: list[str]
    status: ScenarioRunStatus
    created_at: str
    updated_at: str
    error: str | None = None


class ScenarioRunDetail(ScenarioRunSummary):
    comparison: dict | None = None
    has_report: bool = False


class ScenarioRunListResponse(BaseModel):
    runs: list[ScenarioRunSummary] = Field(default_factory=list)


class ScenarioAuthoringRequest(BaseModel):
    """Save a browser-recorded motion as a runnable scenario."""

    name: str = Field(..., min_length=1, max_length=120)
    world: dict = Field(..., description="A world registry envelope payload (the current scene).")
    waypoints: dict = Field(..., description="A WaypointPolicy document: {waypoints: [...]}.")
    target_object_id: str = Field(..., min_length=1)
    container_object_id: str = Field(..., min_length=1)
    attach_link: str | None = None
    robot_urdf: str | None = Field(
        default=None,
        description="URDF of the posed robot; defines the recorded joints. Falls back to "
        "the world snapshot's urdf_xml when omitted.",
    )

