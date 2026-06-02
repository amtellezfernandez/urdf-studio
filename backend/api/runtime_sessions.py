from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi import HTTPException

from backend.models.butterclaw import ButterClawChatRequest, ButterClawChatResponse
from backend.models.runtime_integrations import (
    ButterClawRuntimeObjectsResponse,
    ButterClawRuntimePoseResponse,
)
from backend.models.verifiable_robotics import (
    VerifiableRoboticsProofRequest,
    VerifiableRoboticsProofResponse,
)
from backend.models.runtime_sessions import (
    RuntimeCommandRequest,
    RuntimeProviderApprovalRequest,
    RuntimeProviderApprovalResponse,
    RuntimeProviderClaimRequest,
    RuntimeProviderClaimResponse,
    RuntimeProviderRecordingRequest,
    RuntimeProviderRobotDescriptionRequest,
    RuntimeProviderSessionRequest,
    RuntimeProviderSessionRequestResponse,
    RuntimeProviderSessionSnapshot,
    RuntimeSessionStatsResponse,
    RuntimeTelemetryChannelsResponse,
    RuntimeTelemetryChannelsUpsertRequest,
    RuntimeTelemetryFramesResponse,
    RuntimeTelemetryIngestRequest,
    RuntimeVideoRefsResponse,
    RuntimeVideoRefsUpsertRequest,
)
from backend.core.simulator_security import RUNTIME_SESSION_TOKEN_HEADER
from backend.services.butterclaw_runtime_objects import butterclaw_runtime_objects_service
from backend.services.butterclaw_runtime_pose import butterclaw_runtime_pose_service
from backend.services.butterclaw_bridge import (
    ButterClawBridgeError,
    butterclaw_bridge_service,
)
from backend.services.verifiable_robotics import (
    VerifiableRoboticsError,
    verifiable_robotics_service,
)
from backend.services.runtime_sessions import (
    RuntimeProviderSessionStateError,
    RuntimeSessionAccessError,
    RuntimeSessionCapacityError,
    RuntimeSessionValidationError,
    runtime_sessions_service,
)


router = APIRouter(prefix="/runtime/sessions", tags=["runtime-sessions"])
HTTP_NOT_FOUND = 404
HTTP_UNAUTHORIZED = 401
HTTP_UNPROCESSABLE_ENTITY = 422
HTTP_CONFLICT = 409
HTTP_TOO_MANY_REQUESTS = 429


def _translate_runtime_session_error(exc: Exception) -> HTTPException:
    if isinstance(exc, KeyError):
        return HTTPException(status_code=HTTP_NOT_FOUND, detail=str(exc))
    if isinstance(exc, RuntimeSessionAccessError):
        return HTTPException(status_code=HTTP_UNAUTHORIZED, detail=str(exc))
    if isinstance(exc, RuntimeSessionValidationError):
        return HTTPException(status_code=HTTP_UNPROCESSABLE_ENTITY, detail=str(exc))
    if isinstance(exc, RuntimeProviderSessionStateError):
        return HTTPException(status_code=HTTP_CONFLICT, detail=str(exc))
    if isinstance(exc, RuntimeSessionCapacityError):
        return HTTPException(status_code=HTTP_TOO_MANY_REQUESTS, detail=str(exc))
    raise exc


def _runtime_session_token(request: Request) -> str | None:
    raw = request.headers.get(RUNTIME_SESSION_TOKEN_HEADER)
    if not isinstance(raw, str):
        return None
    normalized = raw.strip()
    return normalized or None


@router.get("/integrations/butterclaw/objects", response_model=ButterClawRuntimeObjectsResponse)
def list_butterclaw_runtime_objects() -> ButterClawRuntimeObjectsResponse:
    return butterclaw_runtime_objects_service.list_objects()


@router.get("/integrations/butterclaw/pose", response_model=ButterClawRuntimePoseResponse)
def get_butterclaw_runtime_pose() -> ButterClawRuntimePoseResponse:
    return butterclaw_runtime_pose_service.get_pose()


@router.post("/integrations/butterclaw/chat", response_model=ButterClawChatResponse)
def send_butterclaw_chat_command(request: ButterClawChatRequest) -> ButterClawChatResponse:
    try:
        return butterclaw_bridge_service.run_chat_command(request)
    except ButterClawBridgeError as exc:
        detail = str(exc)
        lowered_detail = detail.lower()
        if "blocked" in lowered_detail or "attestation" in lowered_detail:
            status_code = 403
        elif "invalid usage" in lowered_detail or "unsupported" in lowered_detail or "invalid numeric value" in lowered_detail:
            status_code = 400
        else:
            status_code = 502
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.post(
    "/integrations/verifiable-robotics/prove",
    response_model=VerifiableRoboticsProofResponse,
)
def prove_verifiable_robotics_execution(
    request: VerifiableRoboticsProofRequest,
) -> VerifiableRoboticsProofResponse:
    try:
        return verifiable_robotics_service.prove(request)
    except VerifiableRoboticsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/{session_id}/telemetry/channels", response_model=RuntimeTelemetryChannelsResponse)
def upsert_runtime_telemetry_channels(
    request_context: Request,
    session_id: str,
    request: RuntimeTelemetryChannelsUpsertRequest,
) -> RuntimeTelemetryChannelsResponse:
    try:
        return runtime_sessions_service.upsert_channels(
            session_id,
            request,
            session_token=_runtime_session_token(request_context),
        )
    except Exception as exc:
        raise _translate_runtime_session_error(exc) from exc


@router.get("/{session_id}/telemetry/channels", response_model=RuntimeTelemetryChannelsResponse)
def list_runtime_telemetry_channels(session_id: str) -> RuntimeTelemetryChannelsResponse:
    try:
        return runtime_sessions_service.list_channels(session_id)
    except Exception as exc:
        raise _translate_runtime_session_error(exc) from exc


@router.post("/{session_id}/telemetry/ingest", response_model=RuntimeSessionStatsResponse)
def ingest_runtime_telemetry(
    request_context: Request,
    session_id: str,
    request: RuntimeTelemetryIngestRequest,
) -> RuntimeSessionStatsResponse:
    try:
        return runtime_sessions_service.ingest_telemetry(
            session_id,
            request,
            session_token=_runtime_session_token(request_context),
        )
    except Exception as exc:
        raise _translate_runtime_session_error(exc) from exc


@router.get("/{session_id}/telemetry/frames", response_model=RuntimeTelemetryFramesResponse)
def list_runtime_telemetry_frames(session_id: str) -> RuntimeTelemetryFramesResponse:
    try:
        return runtime_sessions_service.list_frames(session_id)
    except Exception as exc:
        raise _translate_runtime_session_error(exc) from exc


@router.post("/{session_id}/video_refs", response_model=RuntimeVideoRefsResponse)
def upsert_runtime_video_refs(
    request_context: Request,
    session_id: str,
    request: RuntimeVideoRefsUpsertRequest,
) -> RuntimeVideoRefsResponse:
    try:
        return runtime_sessions_service.upsert_video_refs(
            session_id,
            request,
            session_token=_runtime_session_token(request_context),
        )
    except Exception as exc:
        raise _translate_runtime_session_error(exc) from exc


@router.get("/{session_id}/video_refs", response_model=RuntimeVideoRefsResponse)
def list_runtime_video_refs(session_id: str) -> RuntimeVideoRefsResponse:
    try:
        return runtime_sessions_service.list_video_refs(session_id)
    except Exception as exc:
        raise _translate_runtime_session_error(exc) from exc


@router.post("/{session_id}/commands", response_model=RuntimeSessionStatsResponse)
def ingest_runtime_command(
    session_id: str,
    request: RuntimeCommandRequest,
) -> RuntimeSessionStatsResponse:
    try:
        return runtime_sessions_service.ingest_command(session_id, request)
    except Exception as exc:
        raise _translate_runtime_session_error(exc) from exc


@router.get("/{session_id}/stats", response_model=RuntimeSessionStatsResponse)
def get_runtime_session_stats(session_id: str) -> RuntimeSessionStatsResponse:
    try:
        return runtime_sessions_service.stats(session_id)
    except Exception as exc:
        raise _translate_runtime_session_error(exc) from exc


@router.post("/{session_id}/provider", response_model=RuntimeProviderSessionRequestResponse)
def request_runtime_provider_session(
    session_id: str,
    request: RuntimeProviderSessionRequest,
) -> RuntimeProviderSessionRequestResponse:
    try:
        return runtime_sessions_service.request_provider_session(session_id, request)
    except Exception as exc:
        raise _translate_runtime_session_error(exc) from exc


@router.get("/{session_id}/provider", response_model=RuntimeProviderSessionSnapshot)
def get_runtime_provider_session(session_id: str) -> RuntimeProviderSessionSnapshot:
    try:
        return runtime_sessions_service.get_provider_session(session_id)
    except Exception as exc:
        raise _translate_runtime_session_error(exc) from exc


@router.post("/{session_id}/provider/approve", response_model=RuntimeProviderApprovalResponse)
def approve_runtime_provider_session(
    session_id: str,
    request: RuntimeProviderApprovalRequest,
) -> RuntimeProviderApprovalResponse:
    try:
        return runtime_sessions_service.approve_provider_session(session_id, request)
    except Exception as exc:
        raise _translate_runtime_session_error(exc) from exc


@router.post("/{session_id}/provider/claim", response_model=RuntimeProviderClaimResponse)
def claim_runtime_provider_session_token(
    session_id: str,
    request: RuntimeProviderClaimRequest,
) -> RuntimeProviderClaimResponse:
    try:
        return runtime_sessions_service.claim_provider_session_token(session_id, request)
    except Exception as exc:
        raise _translate_runtime_session_error(exc) from exc


@router.post("/{session_id}/provider/disconnect", response_model=RuntimeProviderSessionSnapshot)
def disconnect_runtime_provider_session(session_id: str) -> RuntimeProviderSessionSnapshot:
    try:
        return runtime_sessions_service.disconnect_provider_session(session_id)
    except Exception as exc:
        raise _translate_runtime_session_error(exc) from exc


@router.post("/{session_id}/provider/robot", response_model=RuntimeProviderRobotDescriptionRequest)
def publish_runtime_provider_robot_description(
    request_context: Request,
    session_id: str,
    request: RuntimeProviderRobotDescriptionRequest,
) -> RuntimeProviderRobotDescriptionRequest:
    try:
        return runtime_sessions_service.publish_provider_robot_description(
            session_id,
            request,
            session_token=_runtime_session_token(request_context),
        )
    except Exception as exc:
        raise _translate_runtime_session_error(exc) from exc


@router.get("/{session_id}/provider/robot", response_model=RuntimeProviderRobotDescriptionRequest)
def get_runtime_provider_robot_description(session_id: str) -> RuntimeProviderRobotDescriptionRequest:
    try:
        return runtime_sessions_service.get_provider_robot_description(session_id)
    except Exception as exc:
        raise _translate_runtime_session_error(exc) from exc


@router.post("/{session_id}/provider/recording/start", response_model=RuntimeProviderSessionSnapshot)
def start_runtime_provider_recording(
    session_id: str,
    request: RuntimeProviderRecordingRequest,
) -> RuntimeProviderSessionSnapshot:
    try:
        return runtime_sessions_service.start_provider_recording(session_id, request)
    except Exception as exc:
        raise _translate_runtime_session_error(exc) from exc


@router.post("/{session_id}/provider/recording/stop", response_model=RuntimeProviderSessionSnapshot)
def stop_runtime_provider_recording(session_id: str) -> RuntimeProviderSessionSnapshot:
    try:
        return runtime_sessions_service.stop_provider_recording(session_id)
    except Exception as exc:
        raise _translate_runtime_session_error(exc) from exc
