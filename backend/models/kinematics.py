from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from backend.models.ik_tasks import IkConstraint, IkTask

class FKRequest(BaseModel):
    urdf: str = Field(..., description="URDF XML as a string.")
    joint_values: Dict[str, float] = Field(
        default_factory=dict,
        description="Mapping joint_name -> value (radians).",
    )


class FKLink(BaseModel):
    name: str
    position: List[float]  # [x, y, z]
    quaternion_wxyz: List[float]  # [w, x, y, z]


class FKResponse(BaseModel):
    links: List[FKLink]
    metadata: Dict[str, Any]


class IKRequest(BaseModel):
    urdf: str = Field(..., description="URDF XML as a string.")
    joint_values: Dict[str, float] = Field(
        default_factory=dict, description="Mapping joint_name -> value (radians)."
    )
    target_link: str = Field(..., description="End-effector link name.")
    target_position: List[float] = Field(
        ..., description="Target position [x, y, z] in meters."
    )
    target_wxyz: Optional[List[float]] = Field(
        default=None, description="Target orientation [w, x, y, z]. Defaults to identity."
    )
    target_rotation: Optional[List[List[float]]] = Field(
        default=None,
        description="Target orientation as 3x3 rotation matrix (row-major). Overrides target_wxyz when provided.",
    )
    position_weight: Optional[float] = Field(
        default=None, description="Optional position weight override for the solve."
    )
    orientation_weight: Optional[float] = Field(
        default=None, description="Optional orientation weight override for the solve."
    )
    limit_weight: Optional[float] = Field(
        default=None, description="Optional joint-limit penalty weight override."
    )
    posture_weight: Optional[float] = Field(
        default=None, description="Optional posture regularization weight override."
    )
    posture_joint_values: Optional[Dict[str, float]] = Field(
        default=None, description="Optional posture target for regularization."
    )
    position_tolerance: Optional[float] = Field(
        default=None, description="Optional position tolerance for solve success."
    )
    orientation_tolerance: Optional[float] = Field(
        default=None, description="Optional orientation tolerance for solve success."
    )


class IkSolveRequest(IKRequest):
    solver_id: str = Field(
        default="amik",
        description="Solver id to use (e.g., amik, placo).",
    )
    solver_chain: Optional[List[str]] = Field(
        default=None,
        description="Ordered list of solver ids to try. Overrides solver_id when provided.",
    )
    orientation_mode: Optional[str] = Field(
        default=None,
        description=(
            "Orientation policy: required, optional, prefer, ignore, or position_first."
        ),
    )
    mode: Optional[str] = Field(
        default=None,
        description="Solve mode hint (e.g., tracking, single_shot, batch).",
    )
    tasks: Optional[List[IkTask]] = Field(
        default=None, description="Optional task IR to drive IK solves."
    )
    constraints: Optional[List[IkConstraint]] = Field(
        default=None, description="Optional constraint IR for IK solves."
    )


class IKDiagnostics(BaseModel):
    termination_reason: str
    termination_flags: List[bool]
    iterations: int
    cost: float
    lambda_final: float
    validity: str
    stability: str
    degeneracy: str
    branch_maybe: bool
    branch_metric: float
    branch_message: str
    solver_id: Optional[str] = None
    seed_source: Optional[str] = None
    continuity_penalty: Optional[float] = None
    residual_position: Optional[float] = None
    residual_orientation: Optional[float] = None
    position_error: Optional[float] = None
    escalation_blocked_reason: Optional[str] = None


class IKResponse(BaseModel):
    solution: Dict[str, float]
    diagnostics: IKDiagnostics
    metadata: Dict[str, Any]
