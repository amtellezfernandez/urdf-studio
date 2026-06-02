from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


LiveTransportType = Literal["moq"]
LiveTrackKind = Literal[
    "video",
    "depth",
    "metadata",
    "pointCloud",
    "jointTelemetry",
    "canTelemetry",
    "robotState",
    "presence",
    "cursor",
    "viewport",
    "sceneDelta",
]


class LiveTrackDescriptor(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: str = Field(..., min_length=1)
    kind: LiveTrackKind
    track_name: str = Field(..., min_length=1, alias="trackName")
    encoding: str = Field(..., min_length=1)
    source_id: str | None = Field(default=None, alias="sourceId")
    camera_id: str | None = Field(default=None, alias="cameraId")
    bus_id: str | None = Field(default=None, alias="busId")


class LiveTransportDescriptor(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    type: LiveTransportType = "moq"
    relay_url: str = Field(..., min_length=1, alias="relayUrl")
    namespace: str = Field(..., min_length=1)
    connect_module_path: str | None = Field(default=None, alias="connectModulePath")
    tracks: list[LiveTrackDescriptor] = Field(default_factory=list)
