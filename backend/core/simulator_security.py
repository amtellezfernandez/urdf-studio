from __future__ import annotations

import hmac
import re
from ipaddress import ip_address
from typing import Final

from fastapi import HTTPException, Request, WebSocket

from backend.core.settings import settings

SIMULATOR_TOKEN_HEADER: Final = "X-URDF-Simulator-Token"
RUNTIME_SESSION_TOKEN_HEADER: Final = "X-Runtime-Session-Token"
CAM_TO_SIM_PROXY_TOKEN_HEADER: Final = "X-URDF-Cam-To-Sim-Proxy-Token"
SIMULATOR_TOKEN_QUERY_PARAM: Final = "token"
HTTP_FORBIDDEN = 403
HTTP_UNAUTHORIZED = 401
HTTP_OPTIONS_METHOD: Final = "OPTIONS"
BACKEND_ROUTE_POLICY_PUBLIC: Final = "public"
BACKEND_ROUTE_POLICY_CAM_TO_SIM_SESSION: Final = "cam-to-sim-session"
BACKEND_ROUTE_POLICY_COLLABORATION_SESSION: Final = "collaboration-session"
BACKEND_ROUTE_POLICY_OPERATOR: Final = "operator"
PUBLIC_BACKEND_EXACT_PATHS: Final[frozenset[str]] = frozenset(("/health", "/version"))
PUBLIC_BACKEND_PREFIXES: Final[tuple[str, ...]] = ("/samples",)
CAM_TO_SIM_SESSION_INGRESS_RULES: Final[tuple[tuple[str, re.Pattern[str]], ...]] = (
    ("GET", re.compile(r"^/cam-to-sim/connect/[^/]+$")),
    ("GET", re.compile(r"^/cam-to-sim/sessions/[^/]+/capture-coach$")),
    ("POST", re.compile(r"^/cam-to-sim/sessions/[^/]+/stream$")),
    ("POST", re.compile(r"^/cam-to-sim/sessions/[^/]+/phone-frame$")),
)
COLLABORATION_SESSION_HTTP_RULES: Final[tuple[tuple[str, re.Pattern[str]], ...]] = (
    ("GET", re.compile(r"^/collaboration/sessions/[^/]+$")),
    ("GET", re.compile(r"^/collaboration/sessions/[^/]+/events$")),
    ("POST", re.compile(r"^/collaboration/sessions/[^/]+/events$")),
    ("POST", re.compile(r"^/collaboration/sessions/[^/]+/capabilities$")),
    ("POST", re.compile(r"^/collaboration/sessions/[^/]+/capabilities/revoke$")),
    ("GET", re.compile(r"^/collaboration/sessions/[^/]+/stats$")),
    ("PATCH", re.compile(r"^/collaboration/sessions/[^/]+/access$")),
)


def _client_host(connection: Request | WebSocket) -> str:
    client = connection.client
    host = client.host if client is not None else ""
    return host.strip().lower()


def _is_loopback_client(connection: Request | WebSocket) -> bool:
    normalized = _client_host(connection)
    if not normalized:
        return False
    if normalized == "localhost":
        return True
    try:
        return ip_address(normalized).is_loopback
    except ValueError:
        return False


def _read_header_token(
    connection: Request | WebSocket,
    *,
    allow_runtime_session_header: bool,
) -> str | None:
    authorization = connection.headers.get("authorization")
    if isinstance(authorization, str):
        normalized = authorization.strip()
        prefix = "bearer "
        if normalized.lower().startswith(prefix):
            bearer_token = normalized[len(prefix):].strip()
            if bearer_token:
                return bearer_token

    header_names = [SIMULATOR_TOKEN_HEADER]
    if allow_runtime_session_header:
        header_names.append(RUNTIME_SESSION_TOKEN_HEADER)
    for header_name in header_names:
        raw = connection.headers.get(header_name)
        if isinstance(raw, str):
            token = raw.strip()
            if token:
                return token
    return None


def _read_query_token(connection: Request | WebSocket) -> str | None:
    raw = connection.query_params.get(SIMULATOR_TOKEN_QUERY_PARAM)
    if not isinstance(raw, str):
        return None
    token = raw.strip()
    return token or None


def _is_valid_cam_to_sim_proxy_request(connection: Request | WebSocket) -> bool:
    expected_proxy_token = (getattr(settings, "cam_to_sim_proxy_token", None) or "").strip()
    provided_proxy_token = connection.headers.get(CAM_TO_SIM_PROXY_TOKEN_HEADER)
    if not isinstance(provided_proxy_token, str):
        return False
    normalized_proxy_token = provided_proxy_token.strip()
    if not normalized_proxy_token or not expected_proxy_token:
        return False
    return hmac.compare_digest(normalized_proxy_token, expected_proxy_token)


def is_public_backend_route(path: str, *, method: str | None = None) -> bool:
    normalized_method = (method or "").strip().upper()
    if normalized_method == HTTP_OPTIONS_METHOD:
        return True
    if path in PUBLIC_BACKEND_EXACT_PATHS:
        return True
    return any(path == prefix or path.startswith(f"{prefix}/") for prefix in PUBLIC_BACKEND_PREFIXES)


def is_cam_to_sim_session_ingress_route(path: str, *, method: str | None = None) -> bool:
    normalized_method = (method or "").strip().upper()
    return any(
        normalized_method == expected_method and pattern.match(path)
        for expected_method, pattern in CAM_TO_SIM_SESSION_INGRESS_RULES
    )


def is_collaboration_session_route(path: str, *, method: str | None = None) -> bool:
    normalized_method = (method or "").strip().upper()
    return any(
        normalized_method == expected_method and pattern.match(path)
        for expected_method, pattern in COLLABORATION_SESSION_HTTP_RULES
    )


def classify_backend_http_route_policy(path: str, *, method: str | None = None) -> str:
    if is_public_backend_route(path, method=method):
        return BACKEND_ROUTE_POLICY_PUBLIC
    if is_cam_to_sim_session_ingress_route(path, method=method):
        return BACKEND_ROUTE_POLICY_CAM_TO_SIM_SESSION
    if is_collaboration_session_route(path, method=method):
        return BACKEND_ROUTE_POLICY_COLLABORATION_SESSION
    return BACKEND_ROUTE_POLICY_OPERATOR


def enforce_backend_http_access_policy(request: Request) -> None:
    path = request.url.path
    method = request.method
    route_policy = classify_backend_http_route_policy(path, method=method)
    if route_policy == BACKEND_ROUTE_POLICY_PUBLIC:
        return
    if route_policy == BACKEND_ROUTE_POLICY_CAM_TO_SIM_SESSION:
        return
    if route_policy == BACKEND_ROUTE_POLICY_COLLABORATION_SESSION:
        return
    require_simulator_operator_access(request)


def require_simulator_operator_access(request: Request) -> None:
    if _is_loopback_client(request):
        return

    expected_token = (settings.simulator_api_token or "").strip()
    if not expected_token:
        raise HTTPException(
            status_code=HTTP_FORBIDDEN,
            detail=(
                "Remote simulator access is disabled. Bind the backend locally or "
                "configure URDF_SIMULATOR_API_TOKEN for authenticated remote access."
            ),
        )

    provided_token = _read_header_token(request, allow_runtime_session_header=False)
    if provided_token and hmac.compare_digest(provided_token, expected_token):
        return

    raise HTTPException(
        status_code=HTTP_UNAUTHORIZED,
        detail="Simulator API token required for remote simulator access.",
    )


def require_simulator_session_access(request: Request, *, session_token: str | None) -> None:
    if _is_loopback_client(request) and not _is_valid_cam_to_sim_proxy_request(request):
        return

    global_token = (settings.simulator_api_token or "").strip() or None
    provided_token = _read_header_token(
        request,
        allow_runtime_session_header=True,
    ) or _read_query_token(request)

    if session_token and provided_token and hmac.compare_digest(provided_token, session_token):
        return
    if global_token and provided_token and hmac.compare_digest(provided_token, global_token):
        return

    if session_token or global_token:
        raise HTTPException(
            status_code=HTTP_UNAUTHORIZED,
            detail="Simulator session token required for remote cam-to-sim access.",
        )

    raise HTTPException(
        status_code=HTTP_FORBIDDEN,
        detail=(
            "Remote cam-to-sim access is disabled. Use the local workstation UI or "
            "configure URDF_SIMULATOR_API_TOKEN."
        ),
    )
