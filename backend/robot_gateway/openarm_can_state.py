from __future__ import annotations

from dataclasses import dataclass

from backend.robot_gateway.params import (
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_MOTOR_LIMITS,
    ROBOT_GATEWAY_OPENARM_CAN_HIGH_BYTE_SHIFT,
    ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_BITS,
    ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_PACK_SHIFT,
    ROBOT_GATEWAY_OPENARM_CAN_MIT_POSITION_BITS,
    ROBOT_GATEWAY_OPENARM_CAN_NIBBLE_MASK,
    ROBOT_GATEWAY_OPENARM_CAN_STATE_MIN_BYTES,
    ROBOT_GATEWAY_OPENARM_CAN_STATE_POSITION_HIGH_BYTE_INDEX,
    ROBOT_GATEWAY_OPENARM_CAN_STATE_POSITION_LOW_BYTE_INDEX,
    ROBOT_GATEWAY_OPENARM_CAN_STATE_TEMP_MOS_BYTE_INDEX,
    ROBOT_GATEWAY_OPENARM_CAN_STATE_TEMP_ROTOR_BYTE_INDEX,
    ROBOT_GATEWAY_OPENARM_CAN_STATE_TORQUE_LOW_BYTE_INDEX,
    ROBOT_GATEWAY_OPENARM_CAN_STATE_VELOCITY_HIGH_BYTE_INDEX,
    ROBOT_GATEWAY_OPENARM_CAN_STATE_VELOCITY_LOW_TORQUE_HIGH_BYTE_INDEX,
)


class OpenArmCanStateDecodeError(ValueError):
    pass


@dataclass(frozen=True)
class OpenArmCanJointState:
    position_rad: float
    velocity_rad_per_sec: float
    torque_nm: float
    temp_mos_c: float
    temp_rotor_c: float
    fault_code: int | None = None


def decode_damiao_mit_joint_state(
    data: bytes | bytearray,
    motor_type: str,
) -> OpenArmCanJointState:
    if len(data) < ROBOT_GATEWAY_OPENARM_CAN_STATE_MIN_BYTES:
        raise OpenArmCanStateDecodeError("OpenArm CAN state response is too short.")
    position_limit_rad, velocity_limit_rad_per_sec, torque_limit_nm = (
        _resolve_damiao_motor_limits(motor_type)
    )
    position_uint = _read_uint16(
        data,
        high_index=ROBOT_GATEWAY_OPENARM_CAN_STATE_POSITION_HIGH_BYTE_INDEX,
        low_index=ROBOT_GATEWAY_OPENARM_CAN_STATE_POSITION_LOW_BYTE_INDEX,
    )
    velocity_uint = (
        data[ROBOT_GATEWAY_OPENARM_CAN_STATE_VELOCITY_HIGH_BYTE_INDEX]
        << ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_PACK_SHIFT
    ) | (
        data[ROBOT_GATEWAY_OPENARM_CAN_STATE_VELOCITY_LOW_TORQUE_HIGH_BYTE_INDEX]
        >> ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_PACK_SHIFT
    )
    torque_uint = (
        (
            data[ROBOT_GATEWAY_OPENARM_CAN_STATE_VELOCITY_LOW_TORQUE_HIGH_BYTE_INDEX]
            & ROBOT_GATEWAY_OPENARM_CAN_NIBBLE_MASK
        )
        << ROBOT_GATEWAY_OPENARM_CAN_HIGH_BYTE_SHIFT
    ) | data[ROBOT_GATEWAY_OPENARM_CAN_STATE_TORQUE_LOW_BYTE_INDEX]
    return OpenArmCanJointState(
        position_rad=_uint_to_float(
            position_uint,
            -position_limit_rad,
            position_limit_rad,
            ROBOT_GATEWAY_OPENARM_CAN_MIT_POSITION_BITS,
        ),
        velocity_rad_per_sec=_uint_to_float(
            velocity_uint,
            -velocity_limit_rad_per_sec,
            velocity_limit_rad_per_sec,
            ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_BITS,
        ),
        torque_nm=_uint_to_float(
            torque_uint,
            -torque_limit_nm,
            torque_limit_nm,
            ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_BITS,
        ),
        temp_mos_c=float(data[ROBOT_GATEWAY_OPENARM_CAN_STATE_TEMP_MOS_BYTE_INDEX]),
        temp_rotor_c=float(data[ROBOT_GATEWAY_OPENARM_CAN_STATE_TEMP_ROTOR_BYTE_INDEX]),
    )


def _read_uint16(
    data: bytes | bytearray,
    *,
    high_index: int,
    low_index: int,
) -> int:
    return (
        data[high_index] << ROBOT_GATEWAY_OPENARM_CAN_HIGH_BYTE_SHIFT
    ) | data[low_index]


def _uint_to_float(value: int, minimum: float, maximum: float, bits: int) -> float:
    max_uint = (1 << bits) - 1
    return float(value) / max_uint * (maximum - minimum) + minimum


def _resolve_damiao_motor_limits(motor_type: str) -> tuple[float, float, float]:
    limits = ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_MOTOR_LIMITS.get(motor_type)
    if limits is None:
        raise OpenArmCanStateDecodeError(
            f"OpenArm CAN state response uses unsupported motor type: {motor_type}"
        )
    return limits
