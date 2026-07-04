from __future__ import annotations

from typing import TypeAlias

from pydantic import BaseModel, Field

from backend.models.ik_tasks import IkConstraint, IkTask


JointValueMap: TypeAlias = dict[str, float]
KinematicsMetadataValue: TypeAlias = (
    str | int | float | bool | None | list[str | int | float | bool | None]
)
KinematicsMetadata: TypeAlias = dict[str, KinematicsMetadataValue]
QuaternionWxyz: TypeAlias = list[float]
RotationMatrix3x3: TypeAlias = list[list[float]]
Vector3: TypeAlias = list[float]


class FKRequest(BaseModel):
    urdf: str = Field(..., description="URDF XML as a string.")
    joint_values: JointValueMap = Field(
        default_factory=dict,
        description="Mapping joint_name -> value (radians).",
    )


class FKLink(BaseModel):
    name: str
    position: Vector3  # [x, y, z]
    quaternion_wxyz: QuaternionWxyz  # [w, x, y, z]


class FKResponse(BaseModel):
    links: list[FKLink]
    metadata: KinematicsMetadata


class IKRequest(BaseModel):
    urdf: str = Field(..., description="URDF XML as a string.")
    joint_values: JointValueMap = Field(
        default_factory=dict, description="Mapping joint_name -> value (radians)."
    )
    target_link: str = Field(..., description="End-effector link name.")
    target_position: Vector3 = Field(
        ..., description="Target position [x, y, z] in meters."
    )
    target_wxyz: QuaternionWxyz | None = Field(
        default=None, description="Target orientation [w, x, y, z]. Defaults to identity."
    )
    target_rotation: RotationMatrix3x3 | None = Field(
        default=None,
        description="Target orientation as 3x3 rotation matrix (row-major). Overrides target_wxyz when provided.",
    )
    position_weight: float | None = Field(
        default=None, description="Optional position weight override for the solve."
    )
    orientation_weight: float | None = Field(
        default=None, description="Optional orientation weight override for the solve."
    )
    limit_weight: float | None = Field(
        default=None, description="Optional joint-limit penalty weight override."
    )
    posture_weight: float | None = Field(
        default=None, description="Optional posture regularization weight override."
    )
    posture_joint_values: JointValueMap | None = Field(
        default=None, description="Optional posture target for regularization."
    )
    position_tolerance: float | None = Field(
        default=None, description="Optional position tolerance for solve success."
    )
    orientation_tolerance: float | None = Field(
        default=None, description="Optional orientation tolerance for solve success."
    )


class IkSolveRequest(IKRequest):
    solver_id: str = Field(
        default="amik",
        description="Solver id to use (e.g., amik, placo).",
    )
    solver_chain: list[str] | None = Field(
        default=None,
        description="Ordered list of solver ids to try. Overrides solver_id when provided.",
    )
    orientation_mode: str | None = Field(
        default=None,
        description=(
            "Orientation policy: required, optional, prefer, ignore, or position_first."
        ),
    )
    mode: str | None = Field(
        default=None,
        description="Solve mode hint (e.g., tracking, single_shot, batch).",
    )
    tasks: list[IkTask] | None = Field(
        default=None, description="Optional task IR to drive IK solves."
    )
    constraints: list[IkConstraint] | None = Field(
        default=None, description="Optional constraint IR for IK solves."
    )


class IKDiagnostics(BaseModel):
    termination_reason: str
    termination_flags: list[bool]
    iterations: int
    cost: float
    lambda_final: float
    validity: str
    stability: str
    degeneracy: str
    branch_maybe: bool
    branch_metric: float
    branch_message: str
    solver_id: str | None = None
    seed_source: str | None = None
    continuity_penalty: float | None = None
    residual_position: float | None = None
    residual_orientation: float | None = None
    position_error: float | None = None
    escalation_blocked_reason: str | None = None


class IKResponse(BaseModel):
    solution: JointValueMap
    diagnostics: IKDiagnostics
    metadata: KinematicsMetadata
