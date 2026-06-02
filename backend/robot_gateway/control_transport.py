from __future__ import annotations

import os

from backend.models.robot_gateway import RobotGatewayControlTransportDescriptor
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_CONTROL_TRANSPORT_DEFAULT_NATIVE_QUIC_ADDRESS,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_DEFAULT_WEBTRANSPORT_BIND,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_DEFAULT_WEBTRANSPORT_PATH,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_MANIFEST_PATH,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_NATIVE_QUIC_ADDRESS_ENV,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_NATIVE_QUIC_ALPN,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_SIDECAR_NATIVE_QUIC_BIND_ENV,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_SIDECAR_READY_ENV,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_SIDECAR_READY_TRUE_VALUES,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_SIDECAR_WEBTRANSPORT_BIND_ENV,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_SIDECAR_WEBTRANSPORT_PATH_ENV,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_STATS_PATH,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_WEBTRANSPORT_URL_ENV,
)


def _read_env_string(env_key: str, default_value: str) -> str:
    return os.getenv(env_key, default_value).strip() or default_value


def _read_optional_env_string(env_key: str) -> str | None:
    value = os.getenv(env_key)
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _read_webtransport_url() -> str:
    configured_url = _read_optional_env_string(
        ROBOT_GATEWAY_CONTROL_TRANSPORT_WEBTRANSPORT_URL_ENV
    )
    if configured_url:
        return configured_url
    bind_address = _read_env_string(
        ROBOT_GATEWAY_CONTROL_TRANSPORT_SIDECAR_WEBTRANSPORT_BIND_ENV,
        ROBOT_GATEWAY_CONTROL_TRANSPORT_DEFAULT_WEBTRANSPORT_BIND,
    )
    path = _read_env_string(
        ROBOT_GATEWAY_CONTROL_TRANSPORT_SIDECAR_WEBTRANSPORT_PATH_ENV,
        ROBOT_GATEWAY_CONTROL_TRANSPORT_DEFAULT_WEBTRANSPORT_PATH,
    )
    normalized_path = path if path.startswith("/") else f"/{path}"
    return f"https://{bind_address}{normalized_path}"


def _read_native_quic_address() -> str:
    configured_address = _read_optional_env_string(
        ROBOT_GATEWAY_CONTROL_TRANSPORT_NATIVE_QUIC_ADDRESS_ENV
    )
    if configured_address:
        return configured_address
    return _read_env_string(
        ROBOT_GATEWAY_CONTROL_TRANSPORT_SIDECAR_NATIVE_QUIC_BIND_ENV,
        ROBOT_GATEWAY_CONTROL_TRANSPORT_DEFAULT_NATIVE_QUIC_ADDRESS,
    )


def _read_sidecar_ready() -> bool:
    configured_ready = _read_optional_env_string(
        ROBOT_GATEWAY_CONTROL_TRANSPORT_SIDECAR_READY_ENV
    )
    return (
        configured_ready is not None
        and configured_ready.lower()
        in ROBOT_GATEWAY_CONTROL_TRANSPORT_SIDECAR_READY_TRUE_VALUES
    )


def build_robot_gateway_control_transport() -> RobotGatewayControlTransportDescriptor:
    return RobotGatewayControlTransportDescriptor(
        manifest_path=ROBOT_GATEWAY_CONTROL_TRANSPORT_MANIFEST_PATH,
        stats_path=ROBOT_GATEWAY_CONTROL_TRANSPORT_STATS_PATH,
        webtransport_url=_read_webtransport_url(),
        native_quic_address=_read_native_quic_address(),
        native_quic_alpn=ROBOT_GATEWAY_CONTROL_TRANSPORT_NATIVE_QUIC_ALPN,
        sidecar_ready=_read_sidecar_ready(),
    )
