from __future__ import annotations

import json
from time import time
from typing import Callable

from pydantic import ValidationError

from backend.models.robot_gateway import (
    RobotGatewayControlAck,
    RobotGatewayControlCommandKind,
    RobotGatewayControlDatagramAck,
    RobotGatewayControlDatagramPacket,
    RobotGatewayControlTransportDescriptor,
    RobotGatewayJointJogRequest,
    RobotGatewayTwistRequest,
)
from backend.robot_gateway.control_datagram_verifier import (
    RobotGatewayTeleopCapabilityVerifier,
    verify_robot_gateway_control_datagram,
)
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_CONTROL_DATAGRAM_FUTURE_TIMESTAMP_REASON,
    ROBOT_GATEWAY_CONTROL_DATAGRAM_INVALID_PAYLOAD_REASON_PREFIX,
    ROBOT_GATEWAY_CONTROL_DATAGRAM_MAX_AGE_MS,
    ROBOT_GATEWAY_CONTROL_DATAGRAM_MAX_FUTURE_SKEW_MS,
    ROBOT_GATEWAY_CONTROL_DATAGRAM_STALE_REASON,
    ROBOT_GATEWAY_CONTROL_DATAGRAM_UNSUPPORTED_COMMAND_REASON_PREFIX,
    ROBOT_GATEWAY_CONTROL_DATAGRAM_UNIX_MS_PER_SECOND,
    ROBOT_GATEWAY_DEFAULT_LINEAR_SPEED_MPS,
    ROBOT_GATEWAY_DEFAULT_YAW_SPEED_RPS,
)
from backend.robot_gateway.runtime import RobotGatewayRuntime

RobotGatewayControlDatagramHandler = Callable[
    [RobotGatewayControlDatagramPacket, RobotGatewayRuntime],
    RobotGatewayControlAck,
]


def decode_robot_gateway_control_datagram(
    frame: bytes,
) -> RobotGatewayControlDatagramPacket:
    return RobotGatewayControlDatagramPacket.model_validate_json(frame)


def encode_robot_gateway_control_datagram_ack(
    ack: RobotGatewayControlDatagramAck,
) -> bytes:
    return ack.model_dump_json().encode("utf-8")


def _server_received_unix_ms() -> int:
    return int(time() * ROBOT_GATEWAY_CONTROL_DATAGRAM_UNIX_MS_PER_SECOND)


def _validate_datagram_freshness(
    packet: RobotGatewayControlDatagramPacket,
    *,
    server_received_unix_ms: int,
) -> str | None:
    age_ms = server_received_unix_ms - packet.source_ts_ms
    if age_ms > ROBOT_GATEWAY_CONTROL_DATAGRAM_MAX_AGE_MS:
        return ROBOT_GATEWAY_CONTROL_DATAGRAM_STALE_REASON
    if -age_ms > ROBOT_GATEWAY_CONTROL_DATAGRAM_MAX_FUTURE_SKEW_MS:
        return ROBOT_GATEWAY_CONTROL_DATAGRAM_FUTURE_TIMESTAMP_REASON
    return None


def _build_datagram_ack(
    packet: RobotGatewayControlDatagramPacket,
    *,
    accepted: bool,
    reason: str = "",
    server_sequence: int | None = None,
    server_received_unix_ms: int | None = None,
) -> RobotGatewayControlDatagramAck:
    return RobotGatewayControlDatagramAck(
        session_id=packet.session_id,
        peer_id=packet.peer_id,
        sequence=packet.sequence,
        server_sequence=packet.sequence if server_sequence is None else server_sequence,
        accepted=accepted,
        reason=reason,
        server_received_unix_ms=(
            _server_received_unix_ms()
            if server_received_unix_ms is None
            else server_received_unix_ms
        ),
    )


def _ack_from_control_result(
    packet: RobotGatewayControlDatagramPacket,
    result: RobotGatewayControlAck,
    *,
    server_received_unix_ms: int,
) -> RobotGatewayControlDatagramAck:
    return _build_datagram_ack(
        packet,
        accepted=result.accepted,
        reason=result.reason,
        server_sequence=result.sequence,
        server_received_unix_ms=server_received_unix_ms,
    )


def _record_accepted_datagram(
    *,
    ack: RobotGatewayControlDatagramAck,
    packet: RobotGatewayControlDatagramPacket,
    runtime: RobotGatewayRuntime,
) -> None:
    if not ack.accepted:
        return
    runtime.record_accepted_control_datagram(
        session_id=packet.session_id,
        peer_id=packet.peer_id,
        sequence=packet.sequence,
    )


def _build_twist_request(packet: RobotGatewayControlDatagramPacket) -> RobotGatewayTwistRequest:
    payload = packet.payload
    return RobotGatewayTwistRequest(
        command_kind="twist",
        x=payload.get("x", ROBOT_GATEWAY_DEFAULT_LINEAR_SPEED_MPS),
        y=payload.get("y", ROBOT_GATEWAY_DEFAULT_LINEAR_SPEED_MPS),
        omega=payload.get("omega", ROBOT_GATEWAY_DEFAULT_YAW_SPEED_RPS),
        sequence=packet.sequence,
        source_ts_ms=packet.source_ts_ms,
        ack_requested=packet.ack_requested,
    )


def _build_joint_jog_request(
    packet: RobotGatewayControlDatagramPacket,
) -> RobotGatewayJointJogRequest:
    return RobotGatewayJointJogRequest(
        command_kind="joint_jog",
        joint_name=packet.payload.get("joint_name"),
        operator_id=packet.peer_id,
        current_position_rad=packet.payload.get("current_position_rad"),
        delta_rad=packet.payload.get("delta_rad"),
        sequence=packet.sequence,
        # Datagram freshness is verified before dispatch against server receipt time.
        # Avoid rechecking it in the runtime where test clocks and relay clocks can differ.
        source_ts_ms=0,
        ack_requested=packet.ack_requested,
    )


def _apply_twist_datagram(
    packet: RobotGatewayControlDatagramPacket,
    runtime: RobotGatewayRuntime,
) -> RobotGatewayControlAck:
    return runtime.apply_twist(_build_twist_request(packet))


def _apply_joint_jog_datagram(
    packet: RobotGatewayControlDatagramPacket,
    runtime: RobotGatewayRuntime,
) -> RobotGatewayControlAck:
    return runtime.apply_joint_jog(_build_joint_jog_request(packet))


def _apply_stop_datagram(
    packet: RobotGatewayControlDatagramPacket,
    runtime: RobotGatewayRuntime,
) -> RobotGatewayControlAck:
    return runtime.stop(sequence=packet.sequence)


def _apply_estop_datagram(
    packet: RobotGatewayControlDatagramPacket,
    runtime: RobotGatewayRuntime,
) -> RobotGatewayControlAck:
    return runtime.estop(sequence=packet.sequence)


_CONTROL_DATAGRAM_HANDLERS: dict[
    RobotGatewayControlCommandKind,
    RobotGatewayControlDatagramHandler,
] = {
    "twist": _apply_twist_datagram,
    "stop": _apply_stop_datagram,
    "estop": _apply_estop_datagram,
    "joint_jog": _apply_joint_jog_datagram,
}


def dispatch_robot_gateway_control_datagram(
    packet: RobotGatewayControlDatagramPacket,
    *,
    descriptor: RobotGatewayControlTransportDescriptor,
    runtime: RobotGatewayRuntime,
    verify_teleop_capability: RobotGatewayTeleopCapabilityVerifier,
    server_received_unix_ms: int | None = None,
) -> RobotGatewayControlDatagramAck:
    received_unix_ms = (
        _server_received_unix_ms()
        if server_received_unix_ms is None
        else server_received_unix_ms
    )
    verification = verify_robot_gateway_control_datagram(
        packet,
        descriptor=descriptor,
        runtime=runtime,
        verify_teleop_capability=verify_teleop_capability,
    )
    if not verification.accepted:
        return _build_datagram_ack(
            packet,
            accepted=False,
            reason=verification.reason,
            server_received_unix_ms=received_unix_ms,
        )
    freshness_rejection_reason = _validate_datagram_freshness(
        packet,
        server_received_unix_ms=received_unix_ms,
    )
    if freshness_rejection_reason is not None:
        return _build_datagram_ack(
            packet,
            accepted=False,
            reason=freshness_rejection_reason,
            server_received_unix_ms=received_unix_ms,
        )
    replay_rejection_reason = runtime.reject_replayed_control_datagram(
        session_id=packet.session_id,
        peer_id=packet.peer_id,
        sequence=packet.sequence,
    )
    if replay_rejection_reason is not None:
        return _build_datagram_ack(
            packet,
            accepted=False,
            reason=replay_rejection_reason,
            server_received_unix_ms=received_unix_ms,
        )

    handler = _CONTROL_DATAGRAM_HANDLERS.get(packet.command_kind)
    if handler is None:
        return _build_datagram_ack(
            packet,
            accepted=False,
            reason=(
                f"{ROBOT_GATEWAY_CONTROL_DATAGRAM_UNSUPPORTED_COMMAND_REASON_PREFIX} "
                f"{packet.command_kind}."
            ),
            server_received_unix_ms=received_unix_ms,
        )

    try:
        ack = _ack_from_control_result(
            packet,
            handler(packet, runtime),
            server_received_unix_ms=received_unix_ms,
        )
    except (TypeError, ValueError, ValidationError) as exc:
        return _build_datagram_ack(
            packet,
            accepted=False,
            reason=f"{ROBOT_GATEWAY_CONTROL_DATAGRAM_INVALID_PAYLOAD_REASON_PREFIX} {exc}",
            server_received_unix_ms=received_unix_ms,
        )

    _record_accepted_datagram(ack=ack, packet=packet, runtime=runtime)
    return ack


def dispatch_robot_gateway_control_datagram_frame(
    frame: bytes,
    *,
    descriptor: RobotGatewayControlTransportDescriptor,
    runtime: RobotGatewayRuntime,
    verify_teleop_capability: RobotGatewayTeleopCapabilityVerifier,
    server_received_unix_ms: int | None = None,
) -> RobotGatewayControlDatagramAck | None:
    try:
        packet = decode_robot_gateway_control_datagram(frame)
    except (json.JSONDecodeError, ValueError, ValidationError):
        return None
    return dispatch_robot_gateway_control_datagram(
        packet,
        descriptor=descriptor,
        runtime=runtime,
        verify_teleop_capability=verify_teleop_capability,
        server_received_unix_ms=server_received_unix_ms,
    )
