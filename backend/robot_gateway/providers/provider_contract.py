from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


RobotGatewayRuntimeProviderKind = Literal["hardware", "dataflow"]
RobotGatewayRuntimeProviderStatus = Literal[
    "available",
    "needs_config",
    "missing",
]


class RobotGatewayRuntimeProviderInfo(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    kind: RobotGatewayRuntimeProviderKind
    status: RobotGatewayRuntimeProviderStatus
    connectable: bool = False
    summary: str = ""
    config_ref: str | None = Field(default=None, alias="configRef")
    node_id: str | None = Field(default=None, alias="nodeId")

