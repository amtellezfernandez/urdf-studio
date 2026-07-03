from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketException
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from backend.core.request_audit import log_websocket_security_event, resolve_websocket_request_id
from backend.models.collaboration import (
    CollaborationAccessUpdateRequest,
    CollaborationAccessUpdateResponse,
    CollaborationErrorMessage,
    CollaborationEventMessage,
    CollaborationEventRequest,
    CollaborationEventSnapshot,
    CollaborationSessionCreateRequest,
    CollaborationSessionCreateResponse,
    CollaborationSessionJoinMessage,
    CollaborationSessionSnapshot,
    CollaborationSessionStats,
)
from backend.services.collaboration import (
    CollaborationAccessError,
    CollaborationCapacityError,
    CollaborationPeerDisconnect,
    CollaborationValidationError,
    collaboration_service,
)
from backend.services.collaboration_params import (
    COLLABORATION_CLIENT_ID_QUERY_PARAM,
    COLLABORATION_BROADCAST_PEER_TIMEOUT_SECONDS,
    COLLABORATION_SESSION_TOKEN_HEADER,
    COLLABORATION_WEBSOCKET_ACCESS_REVOKED_CLOSE_CODE,
    COLLABORATION_WEBSOCKET_CAPACITY_CLOSE_CODE,
    COLLABORATION_WEBSOCKET_PROTOCOL,
    COLLABORATION_WEBSOCKET_TOKEN_PROTOCOL_PREFIX,
    COLLABORATION_WEBSOCKET_UNAUTHORIZED_CLOSE_CODE,
    COLLABORATION_SESSION_ENDED_MESSAGE,
)


http_router = APIRouter(prefix="/collaboration", tags=["collaboration"])
ws_router = APIRouter(tags=["collaboration"])
HTTP_NOT_FOUND = 404
HTTP_UNAUTHORIZED = 401
HTTP_UNPROCESSABLE_ENTITY = 422
HTTP_TOO_MANY_REQUESTS = 429


def _translate_collaboration_error(exc: Exception) -> HTTPException:
    if isinstance(exc, KeyError):
        return HTTPException(status_code=HTTP_NOT_FOUND, detail=COLLABORATION_SESSION_ENDED_MESSAGE)
    if isinstance(exc, CollaborationAccessError):
        return HTTPException(status_code=HTTP_UNAUTHORIZED, detail=str(exc))
    if isinstance(exc, CollaborationValidationError):
        return HTTPException(status_code=HTTP_UNPROCESSABLE_ENTITY, detail=str(exc))
    if isinstance(exc, CollaborationCapacityError):
        return HTTPException(status_code=HTTP_TOO_MANY_REQUESTS, detail=str(exc))
    raise exc


def _websocket_close_code(exc: Exception) -> int:
    if isinstance(exc, CollaborationCapacityError):
        return COLLABORATION_WEBSOCKET_CAPACITY_CLOSE_CODE
    return COLLABORATION_WEBSOCKET_UNAUTHORIZED_CLOSE_CODE


def _session_token(request: Request) -> str | None:
    raw = request.headers.get(COLLABORATION_SESSION_TOKEN_HEADER)
    if not isinstance(raw, str):
        return None
    normalized = raw.strip()
    return normalized or None


def _websocket_session_token(websocket: WebSocket) -> str | None:
    raw = websocket.headers.get(COLLABORATION_SESSION_TOKEN_HEADER)
    if not isinstance(raw, str):
        raw_protocols = websocket.headers.get("sec-websocket-protocol")
        if isinstance(raw_protocols, str):
            for raw_protocol in raw_protocols.split(","):
                protocol = raw_protocol.strip()
                if protocol.startswith(COLLABORATION_WEBSOCKET_TOKEN_PROTOCOL_PREFIX):
                    raw = protocol.removeprefix(COLLABORATION_WEBSOCKET_TOKEN_PROTOCOL_PREFIX)
                    break
    if not isinstance(raw, str):
        return None
    normalized = raw.strip()
    return normalized or None


def _websocket_subprotocol(websocket: WebSocket) -> str | None:
    raw_protocols = websocket.headers.get("sec-websocket-protocol")
    if not isinstance(raw_protocols, str):
        return None
    protocols = {raw_protocol.strip() for raw_protocol in raw_protocols.split(",")}
    if COLLABORATION_WEBSOCKET_PROTOCOL in protocols:
        return COLLABORATION_WEBSOCKET_PROTOCOL
    return None


async def _send_collaboration_message(websocket: WebSocket, message) -> None:
    await websocket.send_text(message.model_dump_json())


async def _send_preencoded_event(
    session_id: str,
    peer_id: str,
    websocket: WebSocket,
    message_json: str,
) -> None:
    try:
        await asyncio.wait_for(
            websocket.send_text(message_json),
            timeout=COLLABORATION_BROADCAST_PEER_TIMEOUT_SECONDS,
        )
    except Exception:
        collaboration_service.disconnect_peer(session_id, peer_id)


async def _broadcast_event(session_id: str, event: CollaborationEventSnapshot) -> None:
    message_json = CollaborationEventMessage(event=event).model_dump_json()
    await asyncio.gather(
        *(
            _send_preencoded_event(session_id, peer_id, peer, message_json)
            for peer_id, peer in collaboration_service.list_peer_websockets(session_id)
        )
    )


async def _close_revoked_collaboration_peer(peer: CollaborationPeerDisconnect) -> None:
    try:
        await asyncio.wait_for(
            peer.websocket.close(
                code=COLLABORATION_WEBSOCKET_ACCESS_REVOKED_CLOSE_CODE,
                reason=peer.reason,
            ),
            timeout=COLLABORATION_BROADCAST_PEER_TIMEOUT_SECONDS,
        )
    except Exception:
        return


async def _close_revoked_collaboration_peers(
    peers: tuple[CollaborationPeerDisconnect, ...],
) -> None:
    await asyncio.gather(*(_close_revoked_collaboration_peer(peer) for peer in peers))


@http_router.post("/sessions", response_model=CollaborationSessionCreateResponse)
async def create_collaboration_session(
    request: CollaborationSessionCreateRequest,
) -> CollaborationSessionCreateResponse:
    try:
        return collaboration_service.create_session(request)
    except Exception as exc:
        raise _translate_collaboration_error(exc) from exc


@http_router.get("/sessions/{session_id}", response_model=CollaborationSessionSnapshot)
async def get_collaboration_session(request_context: Request, session_id: str) -> CollaborationSessionSnapshot:
    try:
        return collaboration_service.get_session(session_id, session_token=_session_token(request_context))
    except Exception as exc:
        raise _translate_collaboration_error(exc) from exc


@http_router.get("/sessions/{session_id}/events", response_model=list[CollaborationEventSnapshot])
async def list_collaboration_events(
    request_context: Request,
    session_id: str,
) -> list[CollaborationEventSnapshot]:
    try:
        return collaboration_service.recent_events(session_id, session_token=_session_token(request_context))
    except Exception as exc:
        raise _translate_collaboration_error(exc) from exc


@http_router.get("/sessions/{session_id}/stats", response_model=CollaborationSessionStats)
async def get_collaboration_session_stats(
    request_context: Request,
    session_id: str,
) -> CollaborationSessionStats:
    try:
        return collaboration_service.session_stats(
            session_id,
            session_token=_session_token(request_context),
        )
    except Exception as exc:
        raise _translate_collaboration_error(exc) from exc


@http_router.patch("/sessions/{session_id}/access", response_model=CollaborationAccessUpdateResponse)
async def update_collaboration_access(
    request_context: Request,
    session_id: str,
    request: CollaborationAccessUpdateRequest,
) -> CollaborationAccessUpdateResponse:
    try:
        result = collaboration_service.update_access(
            session_id,
            request,
            session_token=_session_token(request_context),
        )
    except Exception as exc:
        raise _translate_collaboration_error(exc) from exc
    await _close_revoked_collaboration_peers(result.revoked_peers)
    return result.response


@http_router.post("/sessions/{session_id}/events", response_model=CollaborationEventSnapshot)
async def post_collaboration_event(
    request_context: Request,
    session_id: str,
    request: CollaborationEventRequest,
) -> CollaborationEventSnapshot:
    try:
        event = collaboration_service.record_event(
            session_id,
            request,
            session_token=_session_token(request_context),
        )
    except Exception as exc:
        raise _translate_collaboration_error(exc) from exc
    await _broadcast_event(session_id, event)
    return event


@ws_router.websocket("/ws/collaboration/{session_id}")
async def collaborate(websocket: WebSocket, session_id: str) -> None:
    request_id = resolve_websocket_request_id(websocket)
    client_id = websocket.query_params.get(COLLABORATION_CLIENT_ID_QUERY_PARAM)
    session_token = _websocket_session_token(websocket)
    try:
        peer_id, snapshot, recent_events = collaboration_service.connect_peer(
            session_id,
            session_token=session_token,
            client_id=client_id,
            websocket=websocket,
        )
    except Exception as exc:
        reason = str(exc)
        log_websocket_security_event(
            websocket,
            request_id=request_id,
            decision="denied",
            reason=reason,
        )
        raise WebSocketException(
            code=_websocket_close_code(exc),
            reason=reason,
        ) from exc

    try:
        log_websocket_security_event(
            websocket,
            request_id=request_id,
            decision="accepted",
            reason="collaboration session token accepted",
        )
        await websocket.accept(subprotocol=_websocket_subprotocol(websocket))
        await _send_collaboration_message(
            websocket,
            CollaborationSessionJoinMessage(snapshot=snapshot, recent_events=recent_events),
        )

        while True:
            try:
                request = CollaborationEventRequest.model_validate(await websocket.receive_json())
            except ValidationError as exc:
                await _send_collaboration_message(
                    websocket,
                    CollaborationErrorMessage(message=f"Invalid collaboration event: {exc.errors()[0]['msg']}"),
                )
                continue

            try:
                event = collaboration_service.record_event(
                    session_id,
                    request,
                    session_token=session_token,
                )
            except (CollaborationAccessError, CollaborationValidationError) as exc:
                await _send_collaboration_message(websocket, CollaborationErrorMessage(message=str(exc)))
                continue

            await _broadcast_event(session_id, event)
    except WebSocketDisconnect:
        return
    finally:
        collaboration_service.disconnect_peer(session_id, peer_id)
