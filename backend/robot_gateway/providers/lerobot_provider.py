from __future__ import annotations

import importlib.util

from backend.robot_gateway.params import (
    ROBOT_GATEWAY_PROVIDER_LEROBOT_ID,
    ROBOT_GATEWAY_PROVIDER_LEROBOT_LABEL,
)
from backend.robot_gateway.providers.provider_contract import (
    RobotGatewayRuntimeProviderInfo,
)


def get_lerobot_runtime_provider_info() -> RobotGatewayRuntimeProviderInfo:
    if importlib.util.find_spec("lerobot") is None:
        return RobotGatewayRuntimeProviderInfo(
            id=ROBOT_GATEWAY_PROVIDER_LEROBOT_ID,
            label=ROBOT_GATEWAY_PROVIDER_LEROBOT_LABEL,
            kind="hardware",
            status="missing",
            connectable=False,
            summary=(
                "LeRobot package is not installed. Native provider families "
                "remain available; install LeRobot only for compatibility mode."
            ),
        )
    return RobotGatewayRuntimeProviderInfo(
        id=ROBOT_GATEWAY_PROVIDER_LEROBOT_ID,
        label=ROBOT_GATEWAY_PROVIDER_LEROBOT_LABEL,
        kind="hardware",
        status="available",
        connectable=True,
        summary=(
            "Uses LeRobot motor buses, motor calibration objects, and selected "
            "teleoperator/robot calibration refs for local serial hardware."
        ),
    )
