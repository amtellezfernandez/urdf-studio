from __future__ import annotations

import importlib.util
import os
from typing import Mapping, Protocol

from backend.robot_gateway.params import (
    ROBOT_GATEWAY_FEETECH_DEFAULT_BAUDRATE,
    ROBOT_GATEWAY_FEETECH_DRIVER_MODULE,
    ROBOT_GATEWAY_FEETECH_MOTOR_MODEL_ENV,
    ROBOT_GATEWAY_FEETECH_PORT_ENV,
    ROBOT_GATEWAY_PROVIDER_FEETECH_ID,
    ROBOT_GATEWAY_PROVIDER_FEETECH_LABEL,
)
from backend.robot_gateway.providers.provider_contract import (
    RobotGatewayRuntimeProviderInfo,
)


class RobotGatewayFeetechBus(Protocol):
    def read_present_positions(self, motor_ids: tuple[int, ...]) -> Mapping[int, float]:
        raise NotImplementedError

    def disconnect(self) -> None:
        raise NotImplementedError


class RobotGatewayFeetechBusError(RuntimeError):
    pass


def get_feetech_runtime_provider_info() -> RobotGatewayRuntimeProviderInfo:
    port = os.getenv(ROBOT_GATEWAY_FEETECH_PORT_ENV, "").strip()
    motor_model = os.getenv(ROBOT_GATEWAY_FEETECH_MOTOR_MODEL_ENV, "").strip()
    if importlib.util.find_spec(ROBOT_GATEWAY_FEETECH_DRIVER_MODULE) is None:
        return RobotGatewayRuntimeProviderInfo(
            id=ROBOT_GATEWAY_PROVIDER_FEETECH_ID,
            label=ROBOT_GATEWAY_PROVIDER_FEETECH_LABEL,
            kind="hardware",
            status="missing",
            connectable=False,
            summary=(
                "Feetech native provider requires the scservo_sdk Python package. "
                "Install the Feetech SDK to read serial bus positions without LeRobot."
            ),
            config_ref=port or None,
            node_id=motor_model or None,
        )
    if not port:
        return RobotGatewayRuntimeProviderInfo(
            id=ROBOT_GATEWAY_PROVIDER_FEETECH_ID,
            label=ROBOT_GATEWAY_PROVIDER_FEETECH_LABEL,
            kind="hardware",
            status="needs_config",
            connectable=False,
            summary=(
                f"Set {ROBOT_GATEWAY_FEETECH_PORT_ENV} to the Feetech serial bus "
                "before selecting the native Feetech provider."
            ),
            node_id=motor_model or None,
        )
    return RobotGatewayRuntimeProviderInfo(
        id=ROBOT_GATEWAY_PROVIDER_FEETECH_ID,
        label=ROBOT_GATEWAY_PROVIDER_FEETECH_LABEL,
        kind="hardware",
        status="available",
        connectable=True,
        summary=(
            "Native Feetech serial bus provider is configured for read-only "
            "leader mirroring."
        ),
        config_ref=port,
        node_id=motor_model or None,
    )


def build_native_feetech_bus(
    *,
    port: str,
    baudrate: int = ROBOT_GATEWAY_FEETECH_DEFAULT_BAUDRATE,
) -> RobotGatewayFeetechBus:
    return _ScsServoSdkFeetechBus(port=port, baudrate=baudrate)


class _ScsServoSdkFeetechBus:
    def __init__(self, *, port: str, baudrate: int) -> None:
        self.port = port
        self.baudrate = baudrate
        self._port_handler = None
        self._packet_handler = None

    def read_present_positions(self, motor_ids: tuple[int, ...]) -> Mapping[int, float]:
        packet_handler = self._connect()
        positions: dict[int, float] = {}
        for motor_id in motor_ids:
            try:
                position, _speed, comm_result, packet_error = (
                    packet_handler.ReadPosSpeed(motor_id)
                )
            except Exception as exc:  # pragma: no cover - hardware driver boundary
                raise RobotGatewayFeetechBusError(
                    f"Feetech port unavailable while reading motor {motor_id}: {exc}"
                ) from exc
            if comm_result != 0:
                message = _format_sdk_result(packet_handler, comm_result)
                raise RobotGatewayFeetechBusError(
                    f"Feetech read failed for motor {motor_id}: {message}"
                )
            if packet_error != 0:
                message = _format_sdk_packet_error(packet_handler, packet_error)
                raise RobotGatewayFeetechBusError(
                    f"Feetech packet error for motor {motor_id}: {message}"
                )
            positions[motor_id] = float(position)
        return positions

    def disconnect(self) -> None:
        port_handler = self._port_handler
        self._port_handler = None
        self._packet_handler = None
        close_port = getattr(port_handler, "closePort", None)
        if callable(close_port):
            close_port()

    def _connect(self):
        if self._packet_handler is not None:
            return self._packet_handler
        try:
            from scservo_sdk import PortHandler, sms_sts
        except Exception as exc:  # pragma: no cover - optional dependency
            raise RobotGatewayFeetechBusError(
                "Feetech native bus requires scservo_sdk; install the Feetech "
                "SDK or select the LeRobot compatibility provider."
            ) from exc
        port_handler = PortHandler(self.port)
        if not port_handler.openPort():
            raise RobotGatewayFeetechBusError(
                f"Feetech port unavailable: could not open {self.port}"
            )
        if not port_handler.setBaudRate(self.baudrate):
            port_handler.closePort()
            raise RobotGatewayFeetechBusError(
                f"Feetech port unavailable: could not set baudrate {self.baudrate}"
            )
        self._port_handler = port_handler
        self._packet_handler = sms_sts(port_handler)
        return self._packet_handler


def _format_sdk_result(packet_handler, comm_result: int) -> str:
    formatter = getattr(packet_handler, "getTxRxResult", None)
    if callable(formatter):
        return str(formatter(comm_result))
    return f"comm_result={comm_result}"


def _format_sdk_packet_error(packet_handler, packet_error: int) -> str:
    formatter = getattr(packet_handler, "getRxPacketError", None)
    if callable(formatter):
        return str(formatter(packet_error))
    return f"packet_error={packet_error}"
