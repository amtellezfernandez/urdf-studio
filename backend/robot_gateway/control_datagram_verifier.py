from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import json
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen

from backend.models.robot_gateway import (
    RobotGatewayControlDatagramPacket,
    RobotGatewayControlTransportDescriptor,
)
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_CONTROL_TRANSPORT_TELEOP_CAPABILITY_VERIFY_TIMEOUT_SEC,
)
from backend.robot_gateway.runtime import RobotGatewayRuntime

RobotGatewayTeleopCapabilityVerifier = Callable[[str, dict[str, str]], bool]


@dataclass(frozen=True)
class RobotGatewayControlDatagramVerification:
    accepted: bool
    reason: str = ""


def build_teleop_capability_verify_url(
    *,
    backend_base_url: str,
    descriptor: RobotGatewayControlTransportDescriptor,
    collaboration_session_id: str,
) -> str:
    normalized_base_url = backend_base_url.rstrip("/") + "/"
    verify_path = descriptor.teleop_capability_verify_path.replace(
        "{sessionId}",
        quote(collaboration_session_id, safe=""),
    ).lstrip("/")
    return urljoin(normalized_base_url, verify_path)


class RobotGatewayHttpTeleopCapabilityVerifier:
    def __init__(
        self,
        *,
        backend_base_url: str,
        descriptor: RobotGatewayControlTransportDescriptor,
        timeout_sec: float = ROBOT_GATEWAY_CONTROL_TRANSPORT_TELEOP_CAPABILITY_VERIFY_TIMEOUT_SEC,
    ) -> None:
        self._backend_base_url = backend_base_url
        self._descriptor = descriptor
        self._timeout_sec = timeout_sec

    def __call__(
        self,
        collaboration_session_id: str,
        payload: dict[str, str],
    ) -> bool:
        url = build_teleop_capability_verify_url(
            backend_base_url=self._backend_base_url,
            descriptor=self._descriptor,
            collaboration_session_id=collaboration_session_id,
        )
        request = Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=self._timeout_sec) as response:
                response_payload = json.loads(response.read().decode("utf-8"))
        except Exception:
            return False
        return bool(response_payload.get("active") is True)


def verify_robot_gateway_control_datagram(
    packet: RobotGatewayControlDatagramPacket,
    *,
    descriptor: RobotGatewayControlTransportDescriptor,
    runtime: RobotGatewayRuntime,
    verify_teleop_capability: RobotGatewayTeleopCapabilityVerifier,
) -> RobotGatewayControlDatagramVerification:
    session = runtime.get_session()
    if packet.role != "operator":
        return RobotGatewayControlDatagramVerification(
            accepted=False,
            reason="Control datagrams must come from an operator peer.",
        )
    if not runtime.control_enabled:
        return RobotGatewayControlDatagramVerification(
            accepted=False,
            reason="Gateway is in observe mode.",
        )
    if packet.session_id != session.current_session_id:
        return RobotGatewayControlDatagramVerification(
            accepted=False,
            reason="Control datagram session does not match the active gateway session.",
        )
    if descriptor.requires_lease and session.control_lease_owner != packet.peer_id:
        return RobotGatewayControlDatagramVerification(
            accepted=False,
            reason="Control datagram peer does not hold the active lease.",
        )
    if descriptor.requires_teleop_capability:
        try:
            collaboration_session_id = packet.require_teleop_capability_session_id()
            verify_payload = packet.build_teleop_capability_verify_payload()
        except ValueError as exc:
            return RobotGatewayControlDatagramVerification(
                accepted=False,
                reason=str(exc),
            )
        if not verify_teleop_capability(collaboration_session_id, verify_payload):
            return RobotGatewayControlDatagramVerification(
                accepted=False,
                reason="Teleop capability verification failed.",
            )
    return RobotGatewayControlDatagramVerification(accepted=True)
