from __future__ import annotations

from dataclasses import dataclass
import math

from backend.models.robot_gateway import (
    RobotGatewayOpenArmCanDryRunFrame,
    RobotGatewayOpenArmCanDryRunMitParam,
)
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_DEFAULT_DQ,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_DEFAULT_KD,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_DEFAULT_KP,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_DEFAULT_TAU,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_KD_MAX,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_KD_MIN,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_KP_MAX,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_KP_MIN,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_POSITION_LIMIT_RAD,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_TORQUE_LIMIT_NM,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_VELOCITY_LIMIT_RAD_PER_SEC,
    ROBOT_GATEWAY_OPENARM_CAN_DLC_BYTES,
    ROBOT_GATEWAY_OPENARM_CAN_DRY_RUN_TRANSMISSION_STATE,
    ROBOT_GATEWAY_OPENARM_CAN_HEX_PREFIX,
    ROBOT_GATEWAY_OPENARM_CAN_HEX_WIDTH,
    ROBOT_GATEWAY_OPENARM_CAN_HIGH_BYTE_SHIFT,
    ROBOT_GATEWAY_OPENARM_CAN_ID_HEX_WIDTH,
    ROBOT_GATEWAY_OPENARM_CAN_JOINT_SUFFIXES,
    ROBOT_GATEWAY_OPENARM_CAN_LEFT_ARM_SIDE,
    ROBOT_GATEWAY_OPENARM_CAN_LEFT_JOINT_PREFIX,
    ROBOT_GATEWAY_OPENARM_CAN_LEFT_LOGICAL_BUS,
    ROBOT_GATEWAY_OPENARM_CAN_MIN_PACKED_UINT,
    ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_BITS,
    ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_PACK_SHIFT,
    ROBOT_GATEWAY_OPENARM_CAN_MIT_POSITION_BITS,
    ROBOT_GATEWAY_OPENARM_CAN_MOTOR_TYPES,
    ROBOT_GATEWAY_OPENARM_CAN_NIBBLE_MASK,
    ROBOT_GATEWAY_OPENARM_CAN_PROTOCOL,
    ROBOT_GATEWAY_OPENARM_CAN_RECV_IDS,
    ROBOT_GATEWAY_OPENARM_CAN_RIGHT_ARM_SIDE,
    ROBOT_GATEWAY_OPENARM_CAN_RIGHT_JOINT_PREFIX,
    ROBOT_GATEWAY_OPENARM_CAN_RIGHT_LOGICAL_BUS,
    ROBOT_GATEWAY_OPENARM_CAN_SEND_IDS,
)


@dataclass(frozen=True)
class OpenArmCanJointMapping:
    arm_side: str
    logical_bus: str
    motor_type: str
    send_can_id: int
    recv_can_id: int


def build_openarm_joint_jog_can_dry_run_frame(
    *,
    joint_name: str,
    current_position_rad: float,
    delta_rad: float,
) -> RobotGatewayOpenArmCanDryRunFrame | None:
    mapping = resolve_openarm_can_joint_mapping(joint_name)
    if mapping is None:
        return None
    target_position_rad = _clamp(
        current_position_rad + delta_rad,
        -ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_POSITION_LIMIT_RAD,
        ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_POSITION_LIMIT_RAD,
    )
    mit_param = RobotGatewayOpenArmCanDryRunMitParam(
        kp=ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_DEFAULT_KP,
        kd=ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_DEFAULT_KD,
        q=target_position_rad,
        dq=ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_DEFAULT_DQ,
        tau=ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_DEFAULT_TAU,
    )
    data_bytes = _pack_damiao_mit_control_bytes(mit_param)
    return RobotGatewayOpenArmCanDryRunFrame(
        joint_name=joint_name,
        arm_side=mapping.arm_side,
        logical_bus=mapping.logical_bus,
        motor_type=mapping.motor_type,
        protocol=ROBOT_GATEWAY_OPENARM_CAN_PROTOCOL,
        send_can_id=mapping.send_can_id,
        recv_can_id=mapping.recv_can_id,
        send_can_id_hex=_format_can_id(mapping.send_can_id),
        recv_can_id_hex=_format_can_id(mapping.recv_can_id),
        dlc=ROBOT_GATEWAY_OPENARM_CAN_DLC_BYTES,
        data_bytes=data_bytes,
        data_hex="".join(_format_byte(byte) for byte in data_bytes),
        mit_param=mit_param,
        transmission_state=ROBOT_GATEWAY_OPENARM_CAN_DRY_RUN_TRANSMISSION_STATE,
    )


def resolve_openarm_can_joint_mapping(
    joint_name: str,
) -> OpenArmCanJointMapping | None:
    if joint_name.startswith(ROBOT_GATEWAY_OPENARM_CAN_LEFT_JOINT_PREFIX):
        suffix = joint_name.removeprefix(ROBOT_GATEWAY_OPENARM_CAN_LEFT_JOINT_PREFIX)
        arm_side = ROBOT_GATEWAY_OPENARM_CAN_LEFT_ARM_SIDE
        logical_bus = ROBOT_GATEWAY_OPENARM_CAN_LEFT_LOGICAL_BUS
    elif joint_name.startswith(ROBOT_GATEWAY_OPENARM_CAN_RIGHT_JOINT_PREFIX):
        suffix = joint_name.removeprefix(ROBOT_GATEWAY_OPENARM_CAN_RIGHT_JOINT_PREFIX)
        arm_side = ROBOT_GATEWAY_OPENARM_CAN_RIGHT_ARM_SIDE
        logical_bus = ROBOT_GATEWAY_OPENARM_CAN_RIGHT_LOGICAL_BUS
    else:
        return None

    try:
        motor_index = ROBOT_GATEWAY_OPENARM_CAN_JOINT_SUFFIXES.index(suffix)
    except ValueError:
        return None

    return OpenArmCanJointMapping(
        arm_side=arm_side,
        logical_bus=logical_bus,
        motor_type=ROBOT_GATEWAY_OPENARM_CAN_MOTOR_TYPES[motor_index],
        send_can_id=ROBOT_GATEWAY_OPENARM_CAN_SEND_IDS[motor_index],
        recv_can_id=ROBOT_GATEWAY_OPENARM_CAN_RECV_IDS[motor_index],
    )


def _pack_damiao_mit_control_bytes(
    mit_param: RobotGatewayOpenArmCanDryRunMitParam,
) -> list[int]:
    q_uint = _double_to_uint(
        mit_param.q,
        -ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_POSITION_LIMIT_RAD,
        ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_POSITION_LIMIT_RAD,
        ROBOT_GATEWAY_OPENARM_CAN_MIT_POSITION_BITS,
    )
    dq_uint = _double_to_uint(
        mit_param.dq,
        -ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_VELOCITY_LIMIT_RAD_PER_SEC,
        ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_VELOCITY_LIMIT_RAD_PER_SEC,
        ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_BITS,
    )
    kp_uint = _double_to_uint(
        mit_param.kp,
        ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_KP_MIN,
        ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_KP_MAX,
        ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_BITS,
    )
    kd_uint = _double_to_uint(
        mit_param.kd,
        ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_KD_MIN,
        ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_KD_MAX,
        ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_BITS,
    )
    tau_uint = _double_to_uint(
        mit_param.tau,
        -ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_TORQUE_LIMIT_NM,
        ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_TORQUE_LIMIT_NM,
        ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_BITS,
    )
    return [
        (q_uint >> ROBOT_GATEWAY_OPENARM_CAN_HIGH_BYTE_SHIFT) & ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
        q_uint & ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
        (dq_uint >> ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_PACK_SHIFT)
        & ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
        (
            ((dq_uint & ROBOT_GATEWAY_OPENARM_CAN_NIBBLE_MASK) << ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_PACK_SHIFT)
            | (
                (kp_uint >> ROBOT_GATEWAY_OPENARM_CAN_HIGH_BYTE_SHIFT)
                & ROBOT_GATEWAY_OPENARM_CAN_NIBBLE_MASK
            )
        )
        & ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
        kp_uint & ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
        (kd_uint >> ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_PACK_SHIFT)
        & ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
        (
            ((kd_uint & ROBOT_GATEWAY_OPENARM_CAN_NIBBLE_MASK) << ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_PACK_SHIFT)
            | (
                (tau_uint >> ROBOT_GATEWAY_OPENARM_CAN_HIGH_BYTE_SHIFT)
                & ROBOT_GATEWAY_OPENARM_CAN_NIBBLE_MASK
            )
        )
        & ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
        tau_uint & ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
    ]


def _double_to_uint(value: float, minimum: float, maximum: float, bits: int) -> int:
    clamped_value = _clamp(value, minimum, maximum)
    span = maximum - minimum
    max_uint = (1 << bits) - 1
    normalized_value = (clamped_value - minimum) / span
    packed_value = int(normalized_value * max_uint)
    return max(ROBOT_GATEWAY_OPENARM_CAN_MIN_PACKED_UINT, min(packed_value, max_uint))


def _clamp(value: float, minimum: float, maximum: float) -> float:
    if not math.isfinite(value):
        return minimum
    return max(minimum, min(value, maximum))


def _format_can_id(can_id: int) -> str:
    return f"{ROBOT_GATEWAY_OPENARM_CAN_HEX_PREFIX}{can_id:0{ROBOT_GATEWAY_OPENARM_CAN_ID_HEX_WIDTH}X}"


def _format_byte(byte: int) -> str:
    return f"{byte:0{ROBOT_GATEWAY_OPENARM_CAN_HEX_WIDTH}X}"
