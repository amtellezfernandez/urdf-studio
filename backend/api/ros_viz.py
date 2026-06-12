from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketException
from starlette.websockets import WebSocketDisconnect, WebSocketState

from backend.core.request_audit import (
    get_request_id_for_http_request,
    log_websocket_security_event,
    resolve_websocket_request_id,
)
from backend.models.ros_viz import (
    RosVizClockControlRequest,
    RosVizClockState,
    RosVizModeUpdateRequest,
    RosVizSessionCreateRequest,
    RosVizSessionSnapshot,
    RosVizSessionStateResponse,
    RosVizStreamTicketResponse,
    RosVizSubscriptionRequest,
    RosVizSubscriptionResponse,
    RosVizTopicCatalogResponse,
)
from backend.ros_viz.params import (
    ROSVIZ_STREAM_SUBPROTOCOL,
    ROSVIZ_STREAM_TICKET_SUBPROTOCOL_PREFIX,
    STREAM_SEND_INTERVAL_SEC,
)
from backend.ros_viz.runtime import RosVizRuntime

http_router = APIRouter(prefix="/ros-viz", tags=["ros-viz"])
ws_router = APIRouter(tags=["ros-viz"])
runtime = RosVizRuntime()

HTTP_UNPROCESSABLE_ENTITY = 422


def _is_ws_connected(websocket: WebSocket) -> bool:
    return (
        websocket.client_state == WebSocketState.CONNECTED
        and websocket.application_state == WebSocketState.CONNECTED
    )


def _client_host(websocket: WebSocket) -> str:
    client = websocket.client
    return client.host if client is not None else ""


def _extract_stream_ticket(websocket: WebSocket) -> str:
    subprotocols = websocket.scope.get("subprotocols")
    if not isinstance(subprotocols, list):
        raise WebSocketException(code=4401, reason="ROS viz websocket subprotocols are required.")

    ticket_prefix = ROSVIZ_STREAM_TICKET_SUBPROTOCOL_PREFIX
    has_stream_subprotocol = False
    ticket: str | None = None
    for entry in subprotocols:
        if not isinstance(entry, str):
            continue
        if entry == ROSVIZ_STREAM_SUBPROTOCOL:
            has_stream_subprotocol = True
            continue
        if entry.startswith(ticket_prefix):
            candidate = entry[len(ticket_prefix):].strip()
            if candidate:
                ticket = candidate

    if not has_stream_subprotocol:
        raise WebSocketException(code=4401, reason="ROS viz websocket protocol is required.")
    if ticket is None:
        raise WebSocketException(code=4401, reason="ROS viz websocket stream ticket is required.")
    return ticket


@http_router.post("/sessions", response_model=RosVizSessionSnapshot)
async def create_ros_viz_session(req: RosVizSessionCreateRequest) -> RosVizSessionSnapshot:
    try:
        return runtime.create_session(req)
    except ValueError as exc:
        raise HTTPException(status_code=HTTP_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@http_router.get("/sessions", response_model=list[RosVizSessionSnapshot])
async def list_ros_viz_sessions() -> list[RosVizSessionSnapshot]:
    return runtime.list_sessions()


@http_router.get("/sessions/{session_id}", response_model=RosVizSessionSnapshot)
async def get_ros_viz_session(session_id: str) -> RosVizSessionSnapshot:
    try:
        return runtime.get_session(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@http_router.get("/sessions/{session_id}/state", response_model=RosVizSessionStateResponse)
async def get_ros_viz_session_state(session_id: str) -> RosVizSessionStateResponse:
    try:
        return runtime.get_session_state(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@http_router.post("/sessions/{session_id}/mode", response_model=RosVizSessionStateResponse)
async def update_ros_viz_session_mode(
    session_id: str,
    req: RosVizModeUpdateRequest,
) -> RosVizSessionStateResponse:
    try:
        return runtime.update_session_mode(session_id, req)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=HTTP_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@http_router.get("/sessions/{session_id}/clock", response_model=RosVizClockState)
async def get_ros_viz_clock_state(session_id: str) -> RosVizClockState:
    try:
        return runtime.get_clock_state(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@http_router.post("/sessions/{session_id}/clock", response_model=RosVizClockState)
async def update_ros_viz_clock_state(
    session_id: str,
    req: RosVizClockControlRequest,
) -> RosVizClockState:
    try:
        return runtime.update_clock_control(session_id, req)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=HTTP_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@http_router.get("/sessions/{session_id}/topics", response_model=RosVizTopicCatalogResponse)
async def get_ros_viz_topics(session_id: str) -> RosVizTopicCatalogResponse:
    try:
        return runtime.list_topics(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@http_router.post(
    "/sessions/{session_id}/subscriptions",
    response_model=RosVizSubscriptionResponse,
)
async def update_ros_viz_subscriptions(
    session_id: str,
    req: RosVizSubscriptionRequest,
) -> RosVizSubscriptionResponse:
    try:
        return runtime.update_subscriptions(session_id, req)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=HTTP_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@http_router.post(
    "/sessions/{session_id}/stream-ticket",
    response_model=RosVizStreamTicketResponse,
)
async def issue_ros_viz_stream_ticket(request: Request, session_id: str) -> RosVizStreamTicketResponse:
    try:
        return runtime.issue_stream_ticket(
            session_id,
            client_host=request.client.host if request.client is not None else "",
            request_id=get_request_id_for_http_request(request),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@ws_router.websocket("/ws/ros-viz/{session_id}")
async def stream_ros_viz(websocket: WebSocket, session_id: str) -> None:
    request_id = resolve_websocket_request_id(websocket)
    try:
        ticket = _extract_stream_ticket(websocket)
        runtime.consume_stream_ticket(
            session_id,
            ticket=ticket,
            client_host=_client_host(websocket),
        )
    except (PermissionError, WebSocketException) as exc:
        reason = str(exc)
        if isinstance(exc, WebSocketException):
            reason = exc.reason or "ROS viz websocket access denied."
        log_websocket_security_event(
            websocket,
            request_id=request_id,
            decision="denied",
            reason=reason,
        )
        raise WebSocketException(code=4401, reason=reason) from exc

    try:
        runtime.get_session(session_id)
    except KeyError:
        log_websocket_security_event(
            websocket,
            request_id=request_id,
            decision="denied",
            reason="ROS viz session not found.",
        )
        raise WebSocketException(code=4404, reason="ROS viz session not found")

    log_websocket_security_event(
        websocket,
        request_id=request_id,
        decision="accepted",
        reason="stream ticket accepted",
    )
    await websocket.accept(subprotocol=ROSVIZ_STREAM_SUBPROTOCOL)

    try:
        while _is_ws_connected(websocket):
            frames = runtime.build_stream_frames(session_id)
            for frame in frames:
                if not _is_ws_connected(websocket):
                    break
                await websocket.send_bytes(frame)
            await asyncio.sleep(STREAM_SEND_INTERVAL_SEC)
    except (WebSocketDisconnect, RuntimeError):
        return
