from __future__ import annotations

from pydantic import BaseModel, Field


class ButterClawRuntimeObjectSnapshot(BaseModel):
    object_id: str
    class_label: str
    cluster_id: str
    position_xyz: tuple[float, float, float]
    size_xyz: tuple[float, float, float]
    color_hex: str
    observation_count: int
    best_confidence: float
    last_seen_at: str


class ButterClawRuntimeObjectsResponse(BaseModel):
    source_path: str
    objects: list[ButterClawRuntimeObjectSnapshot] = Field(default_factory=list)


class ButterClawRuntimePoseSnapshot(BaseModel):
    ts: float
    x: float
    y: float
    yaw_deg: float


class ButterClawRuntimePoseResponse(BaseModel):
    source_path: str
    pose: ButterClawRuntimePoseSnapshot | None = None
