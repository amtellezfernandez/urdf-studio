from __future__ import annotations

import hmac
from ipaddress import ip_address
from typing import Final

from fastapi import HTTPException, Request, WebSocket

from backend.core.settings import settings

SIMULATOR_TOKEN_HEADER: Final = "X-URDF-Simulator-Token"
SIMULATOR_TOKEN_QUERY_PARAM: Final = "token"
DEV_PROXY_CLIENT_HOST_HEADER: Final = "X-URDF-Dev-Proxy-Client-Host"
HTTP_FORBIDDEN = 403
HTTP_UNAUTHORIZED = 401
HTTP_OPTIONS_METHOD: Final = "OPTIONS"
BACKEND_ROUTE_POLICY_PUBLIC: Final = "public"
BACKEND_ROUTE_POLICY_OPERATOR: Final = "operator"
PUBLIC_BACKEND_EXACT_PATHS: Final[frozenset[str]] = frozenset(("/health", "/version"))
PUBLIC_BACKEND_PREFIXES: Final[tuple[str, ...]] = ("/samples",)


def _normalize_client_host(host: str | None) -> str:
    normalized = (host or "").strip().lower()
    if normalized.startswith("[") and normalized.endswith("]"):
        normalized = normalized[1:-1]
    if normalized.startswith("::ffff:"):
        normalized = normalized.removeprefix("::ffff:")
    return normalized


def _direct_client_host(connection: Request | WebSocket) -> str:
    client = connection.client
    host = client.host if client is not None else ""
    return _normalize_client_host(host)


def _is_loopback_host(host: str | None) -> bool:
    normalized = _normalize_client_host(host)
    if not normalized:
        return False
    if normalized == "localhost":
        return True
    try:
        return ip_address(normalized).is_loopback
    except ValueError:
        return False


def resolve_backend_client_host(connection: Request | WebSocket) -> str:
    direct_host = _direct_client_host(connection)
    proxied_host = connection.headers.get(DEV_PROXY_CLIENT_HOST_HEADER)
    if isinstance(proxied_host, str) and _is_loopback_host(direct_host):
        normalized_proxied_host = _normalize_client_host(proxied_host)
        if normalized_proxied_host:
            return normalized_proxied_host
    return direct_host


def _is_loopback_client(connection: Request | WebSocket) -> bool:
    return _is_loopback_host(resolve_backend_client_host(connection))


def _read_header_token(connection: Request | WebSocket) -> str | None:
    authorization = connection.headers.get("authorization")
    if isinstance(authorization, str):
        normalized = authorization.strip()
        prefix = "bearer "
        if normalized.lower().startswith(prefix):
            bearer_token = normalized[len(prefix):].strip()
            if bearer_token:
                return bearer_token

    raw = connection.headers.get(SIMULATOR_TOKEN_HEADER)
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


def is_public_backend_route(path: str, *, method: str | None = None) -> bool:
    normalized_method = (method or "").strip().upper()
    if normalized_method == HTTP_OPTIONS_METHOD:
        return True
    if path in PUBLIC_BACKEND_EXACT_PATHS:
        return True
    return any(path == prefix or path.startswith(f"{prefix}/") for prefix in PUBLIC_BACKEND_PREFIXES)


def classify_backend_http_route_policy(path: str, *, method: str | None = None) -> str:
    if is_public_backend_route(path, method=method):
        return BACKEND_ROUTE_POLICY_PUBLIC
    return BACKEND_ROUTE_POLICY_OPERATOR


def enforce_backend_http_access_policy(request: Request) -> None:
    route_policy = classify_backend_http_route_policy(request.url.path, method=request.method)
    if route_policy == BACKEND_ROUTE_POLICY_PUBLIC:
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

    provided_token = _read_header_token(request) or _read_query_token(request)
    if provided_token and hmac.compare_digest(provided_token, expected_token):
        return

    raise HTTPException(
        status_code=HTTP_UNAUTHORIZED,
        detail="Simulator API token required for remote simulator access.",
    )


async def require_simulator_operator_access_async(request: Request) -> None:
    require_simulator_operator_access(request)
