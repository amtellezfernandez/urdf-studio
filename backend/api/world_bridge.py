from __future__ import annotations

from typing import Callable, TypeVar

from fastapi import APIRouter, Depends, HTTPException

from backend.core.settings import settings
from backend.core.simulator_security import require_simulator_operator_access_async
from backend.services.attestation import attestation_status_store
from backend.world_bridge.readiness import is_readiness_at_least
from backend.world_bridge.runtime import WorldBridgeRuntime
from backend.world_bridge.types import (
    WorldBridgeCommandAck,
    WorldBridgeJointCommandRequest,
    WorldBridgeReadinessDecision,
    WorldBridgeReadinessResponse,
    WorldBridgeScenarioTimeUpdateRequest,
    WorldBridgeSessionCreateRequest,
    WorldBridgeSessionSnapshot,
    WorldBridgeStatusResponse,
)
from backend.world_bridge.worldd_client import (
    WorlddClient,
    WorlddHttpError,
    WorlddUnavailableError,
)

router = APIRouter(prefix="/world-bridge", tags=["world-bridge"])
runtime = WorldBridgeRuntime()
worldd_client = WorlddClient(
    host=settings.worldd_host,
    port=settings.worldd_port,
    timeout_ms=settings.worldd_timeout_ms,
)

HTTP_BAD_REQUEST = 400
HTTP_CONFLICT = 409
HTTP_UNPROCESSABLE_ENTITY = 422
HTTP_SERVICE_UNAVAILABLE = 503
HTTP_PRECONDITION_FAILED = 412
RESULT = TypeVar("RESULT")


def _map_worldd_status_code(status_code: int) -> int:
    # Keep compatibility with previous Python runtime validation semantics.
    if status_code == HTTP_BAD_REQUEST:
        return HTTP_UNPROCESSABLE_ENTITY
    return status_code


def _dispatch_world_bridge_call(
    *,
    worldd_call: Callable[[], RESULT],
    runtime_call: Callable[[], RESULT],
    allow_runtime_fallback_on_unavailable: bool,
) -> RESULT:
    if not settings.world_bridge_use_worldd_proxy:
        return runtime_call()
    try:
        return worldd_call()
    except WorlddUnavailableError as exc:
        if allow_runtime_fallback_on_unavailable:
            return runtime_call()
        raise HTTPException(
            status_code=HTTP_SERVICE_UNAVAILABLE,
            detail=f"worldd unavailable: {exc}",
        ) from exc
    except WorlddHttpError as exc:
        raise HTTPException(
            status_code=_map_worldd_status_code(exc.status_code),
            detail=exc.detail,
        ) from exc


def _call_worldd_mutating(worldd_call: Callable[[], RESULT]) -> RESULT:
    try:
        return worldd_call()
    except WorlddUnavailableError as exc:
        raise HTTPException(
            status_code=HTTP_SERVICE_UNAVAILABLE,
            detail=f"worldd unavailable: {exc}",
        ) from exc
    except WorlddHttpError as exc:
        raise HTTPException(
            status_code=_map_worldd_status_code(exc.status_code),
            detail=exc.detail,
        ) from exc


def _runtime_create_session(req: WorldBridgeSessionCreateRequest) -> WorldBridgeSessionSnapshot:
    try:
        return runtime.create_session(req)
    except ValueError as exc:
        raise HTTPException(status_code=HTTP_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


def _runtime_get_session(session_id: str) -> WorldBridgeSessionSnapshot:
    try:
        return runtime.get_session(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _runtime_apply_joint_command(
    session_id: str, req: WorldBridgeJointCommandRequest
) -> WorldBridgeCommandAck:
    try:
        return runtime.apply_joint_command(session_id, req)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=HTTP_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


def _runtime_update_scenario_time(
    session_id: str, req: WorldBridgeScenarioTimeUpdateRequest
) -> WorldBridgeSessionSnapshot:
    try:
        return runtime.update_scenario_time(session_id, req)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _runtime_get_readiness() -> WorldBridgeReadinessResponse:
    return runtime.get_readiness()


def _require_attestation_control_allowed(robot_id: str) -> None:
    summary = attestation_status_store.summary(robot_id)
    if summary is None:
        raise HTTPException(
            status_code=HTTP_PRECONDITION_FAILED,
            detail={
                "robot_id": robot_id,
                "reason": "attestation_missing",
                "message": "No attestation status is available for this robot.",
            },
        )
    if summary.control_allowed:
        return
    raise HTTPException(
        status_code=HTTP_PRECONDITION_FAILED,
        detail={
            "robot_id": robot_id,
            "reason": summary.effective_trust_state.value,
            "message": summary.control_explanation,
        },
    )


@router.get("/status", response_model=WorldBridgeStatusResponse)
async def get_world_bridge_status(
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorldBridgeStatusResponse:
    return _dispatch_world_bridge_call(
        worldd_call=worldd_client.get_status,
        runtime_call=runtime.get_status,
        allow_runtime_fallback_on_unavailable=True,
    )


@router.get("/sessions", response_model=list[WorldBridgeSessionSnapshot])
async def list_world_bridge_sessions(
    _access: None = Depends(require_simulator_operator_access_async),
) -> list[WorldBridgeSessionSnapshot]:
    return _dispatch_world_bridge_call(
        worldd_call=worldd_client.list_sessions,
        runtime_call=runtime.list_sessions,
        allow_runtime_fallback_on_unavailable=False,
    )


@router.get("/readiness", response_model=WorldBridgeReadinessResponse)
async def get_world_bridge_readiness(
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorldBridgeReadinessResponse:
    # Readiness is control-plane telemetry owned by the Python API layer.
    return _runtime_get_readiness()


@router.get(
    "/readiness/assert/{minimum}",
    response_model=WorldBridgeReadinessResponse,
)
async def assert_world_bridge_readiness(
    minimum: WorldBridgeReadinessDecision,
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorldBridgeReadinessResponse:
    readiness = _runtime_get_readiness()
    if is_readiness_at_least(actual=readiness.decision, minimum=minimum):
        return readiness
    raise HTTPException(
        status_code=HTTP_CONFLICT,
        detail={
            "required_decision": minimum.value,
            "actual_decision": readiness.decision.value,
            "blockers": readiness.blockers,
        },
    )


@router.post("/sessions", response_model=WorldBridgeSessionSnapshot)
async def create_world_bridge_session(
    req: WorldBridgeSessionCreateRequest,
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorldBridgeSessionSnapshot:
    if not settings.world_bridge_use_worldd_proxy:
        return _runtime_create_session(req)
    snapshot = _call_worldd_mutating(lambda: worldd_client.create_session(req))
    runtime.record_external_session_create(req, session_id=snapshot.session_id)
    return snapshot


@router.get("/sessions/{session_id}", response_model=WorldBridgeSessionSnapshot)
async def get_world_bridge_session(
    session_id: str,
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorldBridgeSessionSnapshot:
    return _dispatch_world_bridge_call(
        worldd_call=lambda: worldd_client.get_session(session_id),
        runtime_call=lambda: _runtime_get_session(session_id),
        allow_runtime_fallback_on_unavailable=False,
    )


@router.post("/sessions/{session_id}/joint-command", response_model=WorldBridgeCommandAck)
async def apply_world_bridge_joint_command(
    session_id: str,
    req: WorldBridgeJointCommandRequest,
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorldBridgeCommandAck:
    robot_name = runtime.resolve_robot_name(session_id)
    if robot_name is None and not settings.world_bridge_use_worldd_proxy:
        robot_name = _runtime_get_session(session_id).robot_name
    if robot_name is not None:
        _require_attestation_control_allowed(robot_name)
    if not settings.world_bridge_use_worldd_proxy:
        return _runtime_apply_joint_command(session_id, req)
    ack = _call_worldd_mutating(lambda: worldd_client.apply_joint_command(session_id, req))
    runtime.record_external_joint_command(session_id=session_id, robot_name=None, req=req)
    return ack


@router.post("/sessions/{session_id}/scenario-time", response_model=WorldBridgeSessionSnapshot)
async def update_world_bridge_scenario_time(
    session_id: str,
    req: WorldBridgeScenarioTimeUpdateRequest,
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorldBridgeSessionSnapshot:
    robot_name = runtime.resolve_robot_name(session_id)
    if robot_name is None and not settings.world_bridge_use_worldd_proxy:
        robot_name = _runtime_get_session(session_id).robot_name
    if robot_name is not None:
        _require_attestation_control_allowed(robot_name)
    if not settings.world_bridge_use_worldd_proxy:
        return _runtime_update_scenario_time(session_id, req)
    snapshot = _call_worldd_mutating(
        lambda: worldd_client.update_scenario_time(session_id, req)
    )
    runtime.record_external_scenario_time_update(
        session_id=session_id,
        robot_name=None,
        req=req,
    )
    return snapshot
