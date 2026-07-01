from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.robot_gateway.params import (
    ROBOT_GATEWAY_CONTRACT_VERSION,
    ROBOT_GATEWAY_PROVIDER_VERSION,
)


RobotGatewayRuntimeProviderKind = Literal["hardware", "dataflow"]
RobotGatewayRuntimeProviderStatus = Literal[
    "available",
    "needs_config",
    "missing",
]
RobotGatewayProviderHealthStatus = Literal[
    "ok",
    "degraded",
    "unavailable",
    "error",
]
RobotGatewayJointUnit = Literal["rad"]


class RobotGatewayProviderCapabilities(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    read_state: bool = Field(default=True, alias="readState")
    jog_joints: bool = Field(default=False, alias="jogJoints")
    gripper: bool = False
    calibration: bool = False
    cameras: bool = False
    point_cloud: bool = Field(default=False, alias="pointCloud")


class RobotGatewayProviderHealth(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    status: RobotGatewayProviderHealthStatus = "ok"
    message: str = ""
    error_code: str | None = Field(default=None, alias="errorCode")
    error_source: str | None = Field(default=None, alias="errorSource")
    last_state_ts_ms: int | None = Field(default=None, ge=0, alias="lastStateTsMs")


class RobotGatewayTeleopProviderContract(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    contract_version: Literal["urdf-studio.teleop-provider.v1"] = Field(
        default=ROBOT_GATEWAY_CONTRACT_VERSION,
        alias="contractVersion",
    )
    provider_id: str = Field(..., min_length=1, alias="providerId")
    provider_version: str = Field(
        default=ROBOT_GATEWAY_PROVIDER_VERSION,
        min_length=1,
        alias="providerVersion",
    )
    robot_model_id: str = Field(..., min_length=1, alias="robotModelId")
    joint_names: list[str] = Field(default_factory=list, alias="jointNames")
    joint_units: RobotGatewayJointUnit = Field(default="rad", alias="jointUnits")
    capabilities: RobotGatewayProviderCapabilities = Field(
        default_factory=RobotGatewayProviderCapabilities
    )
    health: RobotGatewayProviderHealth = Field(
        default_factory=RobotGatewayProviderHealth
    )

    @field_validator("joint_names")
    @classmethod
    def _validate_joint_names(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for raw_name in value:
            name = raw_name.strip() if isinstance(raw_name, str) else ""
            if not name:
                raise ValueError("Provider joint names must be non-empty.")
            if name in seen:
                raise ValueError(f"Duplicate provider joint name: {name}")
            seen.add(name)
            normalized.append(name)
        return normalized


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


def reject_stale_provider_state_timestamp(
    *,
    source_ts_ms: int,
    now_ms: int,
    max_age_ms: int,
    max_future_skew_ms: int,
) -> str | None:
    if source_ts_ms <= 0:
        return "Provider state timestamp is missing."
    if source_ts_ms < now_ms - max_age_ms:
        return "Provider state timestamp is stale."
    if source_ts_ms > now_ms + max_future_skew_ms:
        return "Provider state timestamp is too far in the future."
    return None


def validate_provider_joint_positions_rad(
    joint_positions_rad: dict[str, float],
) -> None:
    for joint_name, position_rad in joint_positions_rad.items():
        if not joint_name.strip():
            raise ValueError("Provider joint name must be non-empty.")
        if not math.isfinite(position_rad):
            raise ValueError(
                f"Provider joint position for {joint_name!r} must be finite radians."
            )
