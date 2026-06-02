from __future__ import annotations

from typing import Dict, List, Optional, Union, Literal

from pydantic import BaseModel, Field


class PoseTask(BaseModel):
    type: Literal["pose"] = "pose"
    link: str = Field(..., description="Target link frame name.")
    position: List[float] = Field(..., description="Target position [x, y, z].")
    rotation: Optional[List[List[float]]] = Field(
        default=None, description="Target rotation as 3x3 matrix (row-major)."
    )
    wxyz: Optional[List[float]] = Field(
        default=None, description="Target orientation quaternion [w, x, y, z]."
    )
    weight_position: float = Field(default=1.0, description="Position weight.")
    weight_orientation: float = Field(default=1.0, description="Orientation weight.")


class PositionTask(BaseModel):
    type: Literal["position"] = "position"
    link: str = Field(..., description="Target link frame name.")
    position: List[float] = Field(..., description="Target position [x, y, z].")
    weight: float = Field(default=1.0, description="Task weight.")


class OrientationTask(BaseModel):
    type: Literal["orientation"] = "orientation"
    link: str = Field(..., description="Target link frame name.")
    rotation: Optional[List[List[float]]] = Field(
        default=None, description="Target rotation as 3x3 matrix (row-major)."
    )
    wxyz: Optional[List[float]] = Field(
        default=None, description="Target orientation quaternion [w, x, y, z]."
    )
    weight: float = Field(default=1.0, description="Task weight.")


class PostureTask(BaseModel):
    type: Literal["posture"] = "posture"
    joint_values: Dict[str, float] = Field(
        default_factory=dict, description="Preferred joint posture."
    )
    weight: float = Field(default=1.0, description="Task weight.")


class JointLimitConstraint(BaseModel):
    type: Literal["joint_limits"] = "joint_limits"
    enabled: bool = Field(default=True, description="Enable joint limit constraint.")


class VelocityLimitConstraint(BaseModel):
    type: Literal["velocity_limits"] = "velocity_limits"
    max_velocity: Optional[Dict[str, float]] = Field(
        default=None, description="Optional per-joint velocity limits."
    )


IkTask = Union[PoseTask, PositionTask, OrientationTask, PostureTask]
IkConstraint = Union[JointLimitConstraint, VelocityLimitConstraint]
