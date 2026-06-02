from __future__ import annotations

from pydantic import BaseModel, Field


class VerifiableRoboticsPositionSample(BaseModel):
    x: float
    y: float
    t_ms: int = Field(..., ge=0)


class VerifiableRoboticsRestrictedRegion(BaseModel):
    xmin: float
    xmax: float
    ymin: float
    ymax: float


class VerifiableRoboticsWorkspaceBounds(BaseModel):
    min_x: float
    max_x: float
    min_y: float
    max_y: float


class VerifiableRoboticsProofRequest(BaseModel):
    robot_id: str = Field(..., min_length=1)
    session_id: str = Field(..., min_length=1)
    mode: str = Field(default="prove", pattern="^(execute|prove)$")
    samples: list[VerifiableRoboticsPositionSample] = Field(default_factory=list)
    workspace: VerifiableRoboticsWorkspaceBounds
    forbidden_regions: list[VerifiableRoboticsRestrictedRegion] = Field(default_factory=list)
    max_step_l1_distance: float = Field(..., gt=0)
    max_step_delta_l1_distance: float | None = Field(default=None, gt=0)
    quantization_scale: int = Field(default=100, gt=0)


class VerifiableRoboticsProofResponse(BaseModel):
    accepted: bool
    mode: str
    trace_length: int
    policy_satisfied: bool | None = None
    trace_digest_hex: str | None = None
    execution_millis: int | None = None
    proving_millis: int | None = None
    trace_path: str | None = None
    policy_path: str | None = None
    report_path: str | None = None
    messages: list[str] = Field(default_factory=list)
