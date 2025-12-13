from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


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


class IKResponse(BaseModel):
    solution: Dict[str, float]
    diagnostics: IKDiagnostics
    metadata: Dict[str, Any]
