from __future__ import annotations

import os
import shutil
from pathlib import Path

from backend.robot_gateway.params import (
    ROBOT_GATEWAY_DORA_BIN_DEFAULT,
    ROBOT_GATEWAY_DORA_BIN_ENV,
    ROBOT_GATEWAY_DORA_DATAFLOW_ENV,
    ROBOT_GATEWAY_DORA_NODE_ID_ENV,
    ROBOT_GATEWAY_PROVIDER_DORA_ID,
    ROBOT_GATEWAY_PROVIDER_DORA_LABEL,
)
from backend.robot_gateway.providers.provider_contract import (
    RobotGatewayRuntimeProviderInfo,
)


def get_dora_runtime_provider_info() -> RobotGatewayRuntimeProviderInfo:
    dora_bin = _read_dora_bin()
    resolved_dora_bin = shutil.which(dora_bin)
    dataflow_path = _read_optional_env_path(ROBOT_GATEWAY_DORA_DATAFLOW_ENV)
    node_id = _read_optional_env_value(ROBOT_GATEWAY_DORA_NODE_ID_ENV)

    if resolved_dora_bin is None:
        return RobotGatewayRuntimeProviderInfo(
            id=ROBOT_GATEWAY_PROVIDER_DORA_ID,
            label=ROBOT_GATEWAY_PROVIDER_DORA_LABEL,
            kind="dataflow",
            status="missing",
            connectable=False,
            summary=(
                "dora is not on PATH. Install dora and configure a dataflow "
                "before using dora as a teleop runtime provider."
            ),
            config_ref=str(dataflow_path) if dataflow_path is not None else None,
            node_id=node_id,
        )

    if dataflow_path is None:
        return RobotGatewayRuntimeProviderInfo(
            id=ROBOT_GATEWAY_PROVIDER_DORA_ID,
            label=ROBOT_GATEWAY_PROVIDER_DORA_LABEL,
            kind="dataflow",
            status="needs_config",
            connectable=False,
            summary=(
                "dora is installed, but no dataflow is configured. Set "
                f"{ROBOT_GATEWAY_DORA_DATAFLOW_ENV} to a concrete dataflow file."
            ),
            node_id=node_id,
        )

    return RobotGatewayRuntimeProviderInfo(
        id=ROBOT_GATEWAY_PROVIDER_DORA_ID,
        label=ROBOT_GATEWAY_PROVIDER_DORA_LABEL,
        kind="dataflow",
        status="available",
        connectable=bool(node_id),
        summary=(
            "dora dataflow provider is configured. Studio will require an "
            "explicit node binding before connecting controls."
        ),
        config_ref=str(dataflow_path),
        node_id=node_id,
    )


def _read_dora_bin() -> str:
    return os.getenv(ROBOT_GATEWAY_DORA_BIN_ENV, ROBOT_GATEWAY_DORA_BIN_DEFAULT).strip() or ROBOT_GATEWAY_DORA_BIN_DEFAULT


def _read_optional_env_value(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    return value or None


def _read_optional_env_path(name: str) -> Path | None:
    value = _read_optional_env_value(name)
    if value is None:
        return None
    return Path(value).expanduser()

