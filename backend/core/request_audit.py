from __future__ import annotations

import logging
import re
from typing import Final
from uuid import uuid4

from fastapi import Request, WebSocket

from backend.core.simulator_security import (
    BACKEND_ROUTE_POLICY_PUBLIC,
    SIMULATOR_TOKEN_HEADER,
    SIMULATOR_TOKEN_QUERY_PARAM,
    classify_backend_http_route_policy,
    resolve_backend_client_host,
)

SECURITY_AUDIT_LOGGER_NAME: Final = "urdf.security"
REQUEST_ID_HEADER: Final = "X-Request-ID"
REQUEST_ID_MAX_CHARS: Final = 128
REQUEST_ID_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def _normalize_request_id(raw_value: str | None) -> str | None:
    if not isinstance(raw_value, str):
        return None
    normalized = raw_value.strip()
    if not normalized or len(normalized) > REQUEST_ID_MAX_CHARS:
        return None
    if not REQUEST_ID_PATTERN.fullmatch(normalized):
        return None
    return normalized


def resolve_request_id(raw_value: str | None = None) -> str:
    normalized = _normalize_request_id(raw_value)
    if normalized is not None:
        return normalized
    return uuid4().hex


def get_request_id_for_http_request(request: Request) -> str:
    request_id = getattr(request.state, "request_id", None)
    if isinstance(request_id, str) and request_id:
        return request_id
    resolved_request_id = resolve_request_id(request.headers.get(REQUEST_ID_HEADER))
    request.state.request_id = resolved_request_id
    return resolved_request_id


def resolve_websocket_request_id(websocket: WebSocket) -> str:
    return resolve_request_id(websocket.headers.get(REQUEST_ID_HEADER))


def should_audit_http_request(request: Request) -> bool:
    route_policy = classify_backend_http_route_policy(request.url.path, method=request.method)
    return route_policy != BACKEND_ROUTE_POLICY_PUBLIC


def _auth_hint_summary(headers, query_params) -> str:
    hints = []
    if headers.get("authorization"):
        hints.append("bearer")
    if headers.get("sec-websocket-protocol"):
        hints.append("ws-subprotocol")
    if headers.get(SIMULATOR_TOKEN_HEADER):
        hints.append("simulator-header")
    if query_params.get(SIMULATOR_TOKEN_QUERY_PARAM):
        hints.append("query-token")
    return ",".join(hints) if hints else "none"


def log_http_security_event(
    request: Request,
    *,
    status_code: int,
    decision: str,
) -> None:
    logger = logging.getLogger(SECURITY_AUDIT_LOGGER_NAME)
    request_id = get_request_id_for_http_request(request)
    route_policy = classify_backend_http_route_policy(request.url.path, method=request.method)
    client_host = resolve_backend_client_host(request)
    auth_hints = _auth_hint_summary(request.headers, request.query_params)
    log_method = logger.warning if decision == "denied" or status_code >= 400 else logger.info
    log_method(
        "security.http request_id=%s decision=%s method=%s path=%s status=%s route_policy=%s client=%s auth_hints=%s",
        request_id,
        decision,
        request.method,
        request.url.path,
        status_code,
        route_policy,
        client_host,
        auth_hints,
    )


def log_websocket_security_event(
    websocket: WebSocket,
    *,
    request_id: str,
    decision: str,
    reason: str,
) -> None:
    logger = logging.getLogger(SECURITY_AUDIT_LOGGER_NAME)
    client_host = resolve_backend_client_host(websocket)
    auth_hints = _auth_hint_summary(websocket.headers, websocket.query_params)
    log_method = logger.warning if decision != "accepted" else logger.info
    log_method(
        "security.ws request_id=%s decision=%s path=%s client=%s auth_hints=%s reason=%s",
        request_id,
        decision,
        websocket.url.path,
        client_host,
        auth_hints,
        reason,
    )
