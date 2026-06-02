from __future__ import annotations

from dataclasses import dataclass
import importlib
import os
import time
from types import ModuleType
from typing import Any, Callable, Mapping

from backend.models.robot_gateway import RobotGatewayOpenArmCanDryRunFrame
from backend.robot_gateway.openarm_can import (
    OpenArmCanJointMapping,
    resolve_openarm_can_joint_mapping,
)
from backend.robot_gateway.openarm_can_state import (
    OpenArmCanJointState,
    OpenArmCanStateDecodeError,
    decode_damiao_mit_joint_state,
)
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_OPENARM_CAN_DEPENDENCY_HINT,
    ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
    ROBOT_GATEWAY_OPENARM_CAN_DLC_BYTES,
    ROBOT_GATEWAY_OPENARM_CAN_ENABLE_COMMAND,
    ROBOT_GATEWAY_OPENARM_CAN_FD_ENABLED_DEFAULT,
    ROBOT_GATEWAY_OPENARM_CAN_FD_ENABLED_ENV,
    ROBOT_GATEWAY_OPENARM_CAN_HIGH_BYTE_SHIFT,
    ROBOT_GATEWAY_OPENARM_CAN_INTERFACE_DEFAULT,
    ROBOT_GATEWAY_OPENARM_CAN_INTERFACE_ENV,
    ROBOT_GATEWAY_OPENARM_CAN_LEFT_LOGICAL_BUS,
    ROBOT_GATEWAY_OPENARM_CAN_LEFT_PORT_DEFAULT,
    ROBOT_GATEWAY_OPENARM_CAN_LEFT_PORT_ENV,
    ROBOT_GATEWAY_OPENARM_CAN_PARAM_ID,
    ROBOT_GATEWAY_OPENARM_CAN_PYTHON_MODULE,
    ROBOT_GATEWAY_OPENARM_CAN_REFRESH_COMMAND,
    ROBOT_GATEWAY_OPENARM_CAN_RIGHT_LOGICAL_BUS,
    ROBOT_GATEWAY_OPENARM_CAN_RIGHT_PORT_DEFAULT,
    ROBOT_GATEWAY_OPENARM_CAN_RIGHT_PORT_ENV,
    ROBOT_GATEWAY_OPENARM_CAN_STATE_POLL_TIMEOUT_SEC,
    ROBOT_GATEWAY_OPENARM_CAN_STATE_READ_TIMEOUT_SEC,
    ROBOT_GATEWAY_OPENARM_CAN_TRUE_VALUES,
)


class OpenArmCanTransportError(RuntimeError):
    pass


@dataclass(frozen=True)
class OpenArmCanBridgeConfig:
    interface: str | None
    can_fd: bool
    bus_channels: Mapping[str, str]

    def channel_for_logical_bus(self, logical_bus: str) -> str:
        channel = self.bus_channels.get(logical_bus, "").strip()
        if not channel:
            raise OpenArmCanTransportError(
                f"OpenArm CAN bus {logical_bus!r} is not configured."
            )
        return channel


class OpenArmCanBridge:
    def __init__(
        self,
        config: OpenArmCanBridgeConfig | None = None,
        *,
        can_module: ModuleType | object | None = None,
        state_decoder: Callable[
            [bytes | bytearray, str], OpenArmCanJointState
        ] = decode_damiao_mit_joint_state,
    ) -> None:
        self._config = config or build_openarm_can_bridge_config_from_env()
        self._can_module = can_module
        self._state_decoder = state_decoder
        self._buses: dict[str, object] = {}

    def send_frame(self, frame: RobotGatewayOpenArmCanDryRunFrame) -> None:
        bus = self._get_bus(frame.logical_bus)
        message = self._build_message(frame)
        send = getattr(bus, "send", None)
        if not callable(send):
            raise OpenArmCanTransportError("OpenArm CAN bus does not expose send().")
        try:
            send(message)
        except Exception as exc:  # pragma: no cover - hardware driver boundary
            raise OpenArmCanTransportError(
                f"OpenArm CAN send failed on {frame.logical_bus}: {exc}"
            ) from exc

    def enable_joint(self, joint_name: str) -> None:
        mapping = resolve_openarm_can_joint_mapping(joint_name)
        if mapping is None:
            raise OpenArmCanTransportError(
                f"Joint is not mapped to an OpenArm CAN motor: {joint_name}"
            )
        self._send_simple_motor_command(
            mapping=mapping,
            command_byte=ROBOT_GATEWAY_OPENARM_CAN_ENABLE_COMMAND,
            action="enable",
        )

    def read_joint_positions_rad(
        self,
        joint_names: tuple[str, ...],
    ) -> dict[str, float]:
        return {
            joint_name: state.position_rad
            for joint_name, state in self.read_joint_states(joint_names).items()
        }

    def read_joint_states(
        self,
        joint_names: tuple[str, ...],
    ) -> dict[str, OpenArmCanJointState]:
        grouped_joints = _group_joint_recv_ids_by_bus(joint_names)
        joint_states: dict[str, OpenArmCanJointState] = {}
        for logical_bus, joints in grouped_joints.items():
            bus = self._get_bus(logical_bus)
            self._send_state_refreshes(logical_bus, bus, joints)
            joint_states.update(
                self._receive_state_refreshes(logical_bus, bus, joints)
            )
        return joint_states

    def close(self) -> None:
        for bus in self._buses.values():
            shutdown = getattr(bus, "shutdown", None)
            if callable(shutdown):
                shutdown()
        self._buses.clear()

    def _get_bus(self, logical_bus: str) -> object:
        bus = self._buses.get(logical_bus)
        if bus is not None:
            return bus
        channel = self._config.channel_for_logical_bus(logical_bus)
        created_bus = self._create_bus(channel)
        self._buses[logical_bus] = created_bus
        return created_bus

    def _create_bus(self, channel: str) -> object:
        can_module = self._load_can_module()
        bus_factory = getattr(can_module, "Bus", None)
        if not callable(bus_factory):
            interface_module = getattr(can_module, "interface", None)
            bus_factory = getattr(interface_module, "Bus", None)
        if not callable(bus_factory):
            raise OpenArmCanTransportError(
                "OpenArm CAN module does not expose a python-can compatible Bus."
            )

        kwargs: dict[str, object] = {"channel": channel, "fd": self._config.can_fd}
        if self._config.interface:
            kwargs["interface"] = self._config.interface
        try:
            return bus_factory(**kwargs)
        except TypeError:
            kwargs.pop("fd", None)
            try:
                return bus_factory(**kwargs)
            except TypeError:
                kwargs.pop("interface", None)
                return bus_factory(**kwargs)
        except Exception as exc:  # pragma: no cover - hardware driver boundary
            raise OpenArmCanTransportError(
                f"OpenArm CAN bus creation failed for channel {channel!r}: {exc}"
            ) from exc

    def _build_message(self, frame: RobotGatewayOpenArmCanDryRunFrame) -> object:
        return self._build_can_message(
            arbitration_id=frame.send_can_id,
            data_bytes=bytes(frame.data_bytes),
        )

    def _build_can_message(self, *, arbitration_id: int, data_bytes: bytes) -> object:
        can_module = self._load_can_module()
        message_factory = getattr(can_module, "Message", None)
        if not callable(message_factory):
            raise OpenArmCanTransportError(
                "OpenArm CAN module does not expose a python-can compatible Message."
            )
        kwargs: dict[str, Any] = {
            "arbitration_id": arbitration_id,
            "data": data_bytes,
            "is_extended_id": False,
            "is_fd": self._config.can_fd,
        }
        try:
            return message_factory(**kwargs)
        except TypeError:
            kwargs.pop("is_fd", None)
            return message_factory(**kwargs)

    def _send_simple_motor_command(
        self,
        *,
        mapping: OpenArmCanJointMapping,
        command_byte: int,
        action: str,
    ) -> None:
        bus = self._get_bus(mapping.logical_bus)
        send = getattr(bus, "send", None)
        if not callable(send):
            raise OpenArmCanTransportError("OpenArm CAN bus does not expose send().")
        message = self._build_can_message(
            arbitration_id=mapping.send_can_id,
            data_bytes=bytes(
                [ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK]
                * (ROBOT_GATEWAY_OPENARM_CAN_DLC_BYTES - 1)
                + [command_byte & ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK]
            ),
        )
        try:
            send(message)
        except Exception as exc:  # pragma: no cover - hardware driver boundary
            raise OpenArmCanTransportError(
                f"OpenArm CAN {action} failed for {mapping.arm_side} "
                f"{mapping.motor_type} motor {mapping.send_can_id}: {exc}"
            ) from exc

    def _send_state_refreshes(
        self,
        logical_bus: str,
        bus: object,
        joints: Mapping[str, OpenArmCanJointMapping],
    ) -> None:
        send = getattr(bus, "send", None)
        if not callable(send):
            raise OpenArmCanTransportError("OpenArm CAN bus does not expose send().")
        for joint_name, mapping in joints.items():
            refresh_frame = self._build_can_message(
                arbitration_id=ROBOT_GATEWAY_OPENARM_CAN_PARAM_ID,
                data_bytes=bytes(
                    [
                        mapping.send_can_id & ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
                        (mapping.send_can_id >> ROBOT_GATEWAY_OPENARM_CAN_HIGH_BYTE_SHIFT)
                        & ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
                        ROBOT_GATEWAY_OPENARM_CAN_REFRESH_COMMAND,
                    ]
                    + [0]
                    * (ROBOT_GATEWAY_OPENARM_CAN_DLC_BYTES - 3)
                ),
            )
            try:
                send(refresh_frame)
            except Exception as exc:  # pragma: no cover - hardware driver boundary
                raise OpenArmCanTransportError(
                    f"OpenArm CAN state refresh failed for {joint_name} on {logical_bus}: {exc}"
                ) from exc

    def _receive_state_refreshes(
        self,
        logical_bus: str,
        bus: object,
        joints: Mapping[str, OpenArmCanJointMapping],
    ) -> dict[str, OpenArmCanJointState]:
        recv = getattr(bus, "recv", None)
        if not callable(recv):
            raise OpenArmCanTransportError("OpenArm CAN bus does not expose recv().")

        recv_id_to_joint = {
            mapping.recv_can_id: joint_name
            for joint_name, mapping in joints.items()
        }
        pending_recv_ids = set(recv_id_to_joint)
        joint_states: dict[str, OpenArmCanJointState] = {}
        deadline = time.monotonic() + ROBOT_GATEWAY_OPENARM_CAN_STATE_READ_TIMEOUT_SEC
        try:
            while pending_recv_ids and time.monotonic() < deadline:
                message = recv(timeout=ROBOT_GATEWAY_OPENARM_CAN_STATE_POLL_TIMEOUT_SEC)
                if message is None:
                    continue
                arbitration_id = getattr(message, "arbitration_id", None)
                if arbitration_id not in pending_recv_ids:
                    continue
                joint_name = recv_id_to_joint[arbitration_id]
                try:
                    joint_states[joint_name] = self._state_decoder(
                        getattr(message, "data", b""),
                        joints[joint_name].motor_type,
                    )
                except OpenArmCanStateDecodeError as exc:
                    raise OpenArmCanTransportError(str(exc)) from exc
                pending_recv_ids.remove(arbitration_id)
        except OpenArmCanTransportError:
            raise
        except Exception as exc:  # pragma: no cover - hardware driver boundary
            raise OpenArmCanTransportError(
                f"OpenArm CAN state read failed on {logical_bus}: {exc}"
            ) from exc

        if pending_recv_ids:
            missing_joints = ", ".join(
                recv_id_to_joint[recv_id] for recv_id in sorted(pending_recv_ids)
            )
            raise OpenArmCanTransportError(
                f"OpenArm CAN state read timed out on {logical_bus} for: {missing_joints}"
            )
        return joint_states

    def _load_can_module(self) -> ModuleType | object:
        if self._can_module is not None:
            return self._can_module
        try:
            self._can_module = importlib.import_module(
                ROBOT_GATEWAY_OPENARM_CAN_PYTHON_MODULE
            )
        except ModuleNotFoundError as exc:
            raise OpenArmCanTransportError(
                "OpenArm CAN transport is unavailable. "
                f"{ROBOT_GATEWAY_OPENARM_CAN_DEPENDENCY_HINT}"
            ) from exc
        return self._can_module


def build_openarm_can_bridge_config_from_env() -> OpenArmCanBridgeConfig:
    interface = os.getenv(
        ROBOT_GATEWAY_OPENARM_CAN_INTERFACE_ENV,
        ROBOT_GATEWAY_OPENARM_CAN_INTERFACE_DEFAULT,
    ).strip()
    can_fd = (
        os.getenv(
            ROBOT_GATEWAY_OPENARM_CAN_FD_ENABLED_ENV,
            str(ROBOT_GATEWAY_OPENARM_CAN_FD_ENABLED_DEFAULT),
        )
        .strip()
        .lower()
        in ROBOT_GATEWAY_OPENARM_CAN_TRUE_VALUES
    )
    return OpenArmCanBridgeConfig(
        interface=interface or None,
        can_fd=can_fd,
        bus_channels={
            ROBOT_GATEWAY_OPENARM_CAN_LEFT_LOGICAL_BUS: os.getenv(
                ROBOT_GATEWAY_OPENARM_CAN_LEFT_PORT_ENV,
                ROBOT_GATEWAY_OPENARM_CAN_LEFT_PORT_DEFAULT,
            ),
            ROBOT_GATEWAY_OPENARM_CAN_RIGHT_LOGICAL_BUS: os.getenv(
                ROBOT_GATEWAY_OPENARM_CAN_RIGHT_PORT_ENV,
                ROBOT_GATEWAY_OPENARM_CAN_RIGHT_PORT_DEFAULT,
            ),
        },
    )


def _group_joint_recv_ids_by_bus(
    joint_names: tuple[str, ...],
) -> dict[str, dict[str, OpenArmCanJointMapping]]:
    grouped_joints: dict[str, dict[str, OpenArmCanJointMapping]] = {}
    for joint_name in joint_names:
        mapping = resolve_openarm_can_joint_mapping(joint_name)
        if mapping is None:
            continue
        grouped_joints.setdefault(mapping.logical_bus, {})[joint_name] = mapping
    return grouped_joints
