from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, Field, field_validator


GenesisDynamicContainerMode = Literal["mesh", "box", "visual-only"]


class GenesisWorldOpenRequest(BaseModel):
    dynamic_container_mode: GenesisDynamicContainerMode = Field(default="box")


class GenesisWorldOpenResponse(BaseModel):
    started: bool
    pid: int
    command: list[str]
    dynamic_container_mode: GenesisDynamicContainerMode


class GenesisJointStateRequest(BaseModel):
    joint_values: dict[str, float] = Field(default_factory=dict)

    @field_validator("joint_values")
    @classmethod
    def validate_joint_values(cls, values: dict[str, float]) -> dict[str, float]:
        if len(values) > 128:
            raise ValueError("joint_values has too many entries")
        cleaned: dict[str, float] = {}
        for name, value in values.items():
            normalized_name = name.strip()
            if not normalized_name:
                raise ValueError("joint_values contains an empty joint name")
            if not math.isfinite(value):
                raise ValueError(f"joint value for {normalized_name!r} must be finite")
            cleaned[normalized_name] = float(value)
        return cleaned


class GenesisJointStateResponse(BaseModel):
    sequence: int
    joint_values: dict[str, float] = Field(default_factory=dict)
    updated_at_monotonic_sec: float


class GenesisWorldPose(BaseModel):
    element_id: str
    position_xyz: tuple[float, float, float]
    orientation_wxyz: tuple[float, float, float, float]

    @field_validator("element_id")
    @classmethod
    def validate_element_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("element_id must be non-empty")
        return normalized

    @field_validator("position_xyz")
    @classmethod
    def validate_position_xyz(
        cls, value: tuple[float, float, float]
    ) -> tuple[float, float, float]:
        if not all(math.isfinite(component) for component in value):
            raise ValueError("position_xyz must contain finite values")
        return tuple(float(component) for component in value)

    @field_validator("orientation_wxyz")
    @classmethod
    def validate_orientation_wxyz(
        cls, value: tuple[float, float, float, float]
    ) -> tuple[float, float, float, float]:
        if not all(math.isfinite(component) for component in value):
            raise ValueError("orientation_wxyz must contain finite values")
        norm = math.sqrt(sum(component * component for component in value))
        if norm <= 0:
            raise ValueError("orientation_wxyz must be a non-zero quaternion")
        return tuple(float(component / norm) for component in value)


class GenesisWorldStateRequest(BaseModel):
    source_sequence: int = 0
    poses: list[GenesisWorldPose] = Field(default_factory=list)

    @field_validator("poses")
    @classmethod
    def validate_poses(cls, values: list[GenesisWorldPose]) -> list[GenesisWorldPose]:
        if len(values) > 512:
            raise ValueError("poses has too many entries")
        return values


class GenesisWorldStateResponse(BaseModel):
    sequence: int
    source_sequence: int
    poses: list[GenesisWorldPose] = Field(default_factory=list)
    updated_at_monotonic_sec: float


class GenesisLiveStateRequest(BaseModel):
    robot_joint_values: dict[str, float] = Field(default_factory=dict)
    world_source_sequence: int = 0
    poses: list[GenesisWorldPose] = Field(default_factory=list)

    @field_validator("robot_joint_values")
    @classmethod
    def validate_robot_joint_values(cls, values: dict[str, float]) -> dict[str, float]:
        return GenesisJointStateRequest(joint_values=values).joint_values

    @field_validator("poses")
    @classmethod
    def validate_live_poses(cls, values: list[GenesisWorldPose]) -> list[GenesisWorldPose]:
        return GenesisWorldStateRequest(poses=values).poses


class GenesisLiveStateResponse(BaseModel):
    sequence: int
    robot_joint_values: dict[str, float] = Field(default_factory=dict)
    world_source_sequence: int = 0
    poses: list[GenesisWorldPose] = Field(default_factory=list)
    updated_at_monotonic_sec: float
