from __future__ import annotations

import hmac
from ipaddress import ip_address

from fastapi import HTTPException, Request

from backend.core.settings import settings
from backend.core.simulator_security import HTTP_UNAUTHORIZED, SIMULATOR_TOKEN_HEADER
from backend.models.collaboration import CollaborationCapabilityVerifyRequest
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_AUTHORIZATION_HEADER,
    ROBOT_GATEWAY_BEARER_AUTH_PREFIX,
    ROBOT_GATEWAY_COLLABORATION_SESSION_HEADER,
    ROBOT_GATEWAY_COLLABORATION_TELEOP_CAPABILITY_HEADER,
    ROBOT_GATEWAY_CONTROL_AUTH_INVALID_DETAIL,
    ROBOT_GATEWAY_CONTROL_AUTH_REQUIRED_DETAIL,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_TELEOP_CAPABILITY_REQUIRED_ROLE,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_TELEOP_CAPABILITY_TRANSPORT,
    ROBOT_GATEWAY_DEV_PROXY_CLIENT_HOST_HEADER,
    ROBOT_GATEWAY_IPV6_MAPPED_IPV4_PREFIX,
    ROBOT_GATEWAY_LOCALHOST_NAME,
)
from backend.services.collaboration import collaboration_service
from backend.services.collaboration_params import COLLABORATION_SESSION_TOKEN_HEADER


def _normalize_token(value: str | None) -> str | None:
    token = (value or "").strip()
    return token or None


def _normalize_host(value: str | None) -> str:
    host = (value or "").strip().lower()
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]
    if host.startswith(ROBOT_GATEWAY_IPV6_MAPPED_IPV4_PREFIX):
        host = host.removeprefix(ROBOT_GATEWAY_IPV6_MAPPED_IPV4_PREFIX)
    return host


def _is_loopback_host(value: str | None) -> bool:
    host = _normalize_host(value)
    if not host:
        return False
    if host == ROBOT_GATEWAY_LOCALHOST_NAME:
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


def _client_host(request: Request) -> str | None:
    if request.client is None:
        return None
    return request.client.host


def _is_local_workstation_request(request: Request) -> bool:
    if not _is_loopback_host(_client_host(request)):
        return False
    proxied_client_host = _normalize_token(
        request.headers.get(ROBOT_GATEWAY_DEV_PROXY_CLIENT_HOST_HEADER)
    )
    return proxied_client_host is None or _is_loopback_host(proxied_client_host)


def _read_simulator_token(request: Request) -> str | None:
    authorization = request.headers.get(ROBOT_GATEWAY_AUTHORIZATION_HEADER)
    if isinstance(authorization, str):
        normalized = authorization.strip()
        if normalized.lower().startswith(ROBOT_GATEWAY_BEARER_AUTH_PREFIX):
            bearer_token = _normalize_token(
                normalized[len(ROBOT_GATEWAY_BEARER_AUTH_PREFIX) :]
            )
            if bearer_token:
                return bearer_token
    return _normalize_token(request.headers.get(SIMULATOR_TOKEN_HEADER))


def _has_simulator_operator_token(request: Request) -> bool:
    expected_token = _normalize_token(settings.simulator_api_token)
    provided_token = _read_simulator_token(request)
    return bool(
        expected_token
        and provided_token
        and hmac.compare_digest(provided_token, expected_token)
    )


def _collaboration_session_id(request: Request) -> str | None:
    return _normalize_token(
        request.headers.get(ROBOT_GATEWAY_COLLABORATION_SESSION_HEADER)
    )


def _has_collaboration_owner_access(request: Request, session_id: str) -> bool:
    session_token = _normalize_token(
        request.headers.get(COLLABORATION_SESSION_TOKEN_HEADER)
    )
    if not session_token:
        return False
    return collaboration_service.verify_owner_token(
        session_id,
        session_token=session_token,
    )


def _has_collaboration_teleop_access(request: Request, session_id: str) -> bool:
    capability_token = _normalize_token(
        request.headers.get(ROBOT_GATEWAY_COLLABORATION_TELEOP_CAPABILITY_HEADER)
    )
    if not capability_token:
        return False
    result = collaboration_service.verify_capability(
        session_id,
        CollaborationCapabilityVerifyRequest(
            capability_token=capability_token,
            required_role=ROBOT_GATEWAY_CONTROL_TRANSPORT_TELEOP_CAPABILITY_REQUIRED_ROLE,
            transport=ROBOT_GATEWAY_CONTROL_TRANSPORT_TELEOP_CAPABILITY_TRANSPORT,
        ),
    )
    return result.active


def require_robot_gateway_control_access(request: Request) -> None:
    if _is_local_workstation_request(request) or _has_simulator_operator_token(request):
        return

    session_id = _collaboration_session_id(request)
    if session_id and (
        _has_collaboration_owner_access(request, session_id)
        or _has_collaboration_teleop_access(request, session_id)
    ):
        return

    status_code = HTTP_UNAUTHORIZED
    detail = (
        ROBOT_GATEWAY_CONTROL_AUTH_INVALID_DETAIL
        if session_id
        else ROBOT_GATEWAY_CONTROL_AUTH_REQUIRED_DETAIL
    )
    raise HTTPException(status_code=status_code, detail=detail)


async def require_robot_gateway_control_access_async(request: Request) -> None:
    require_robot_gateway_control_access(request)


def require_robot_gateway_local_workstation_access(request: Request) -> None:
    if _is_local_workstation_request(request):
        return
    raise HTTPException(
        status_code=HTTP_UNAUTHORIZED,
        detail="Robot gateway backend file editing requires the local workstation UI.",
    )


async def require_robot_gateway_local_workstation_access_async(request: Request) -> None:
    require_robot_gateway_local_workstation_access(request)
