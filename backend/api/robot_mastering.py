from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from backend.models.robot_mastering import (
    BakeExportExecuteRequest,
    BakeExportExecuteResponse,
    CanonicalSynthesisRequest,
    CanonicalSynthesisResponse,
    FramePreflightRequest,
    FramePreflightResponse,
    GeneratePhysicsPreflightRequest,
    GeneratePhysicsPreflightResponse,
    GeneratePhysicsJobRequest,
    GeneratePhysicsJobResultResponse,
    RobotMasteringJobCreatedResponse,
    RobotMasteringJobStatusResponse,
)
from backend.services.robot_mastering import (
    RobotMasteringError,
    robot_mastering_service,
)


router = APIRouter(prefix="/robot-mastering", tags=["robot-mastering"])


@router.post("/jobs", response_model=RobotMasteringJobCreatedResponse)
def create_robot_mastering_job(
    request: GeneratePhysicsJobRequest,
) -> RobotMasteringJobCreatedResponse:
    try:
        return robot_mastering_service.create_generate_physics_job(request)
    except RobotMasteringError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/generate-physics/preflight", response_model=GeneratePhysicsPreflightResponse)
def generate_physics_preflight(
    request: GeneratePhysicsPreflightRequest,
) -> GeneratePhysicsPreflightResponse:
    try:
        return robot_mastering_service.run_generate_physics_preflight(request)
    except RobotMasteringError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/frame-preflight", response_model=FramePreflightResponse)
def frame_preflight(
    request: FramePreflightRequest,
) -> FramePreflightResponse:
    try:
        return robot_mastering_service.run_frame_preflight(request)
    except RobotMasteringError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/bake-export/execute", response_model=BakeExportExecuteResponse)
def bake_export_execute(
    request: BakeExportExecuteRequest,
) -> BakeExportExecuteResponse:
    try:
        return robot_mastering_service.run_bake_export_execute(request)
    except RobotMasteringError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/canonical-synthesis", response_model=CanonicalSynthesisResponse)
def canonical_synthesis(
    request: CanonicalSynthesisRequest,
) -> CanonicalSynthesisResponse:
    try:
        return robot_mastering_service.run_canonical_synthesis(request)
    except RobotMasteringError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/jobs/{job_id}", response_model=RobotMasteringJobStatusResponse)
def get_robot_mastering_job_status(job_id: str) -> RobotMasteringJobStatusResponse:
    try:
        return robot_mastering_service.get_job_status(job_id)
    except RobotMasteringError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/jobs/{job_id}/result", response_model=GeneratePhysicsJobResultResponse)
def get_robot_mastering_job_result(job_id: str) -> GeneratePhysicsJobResultResponse:
    try:
        return robot_mastering_service.get_generate_physics_result(job_id)
    except RobotMasteringError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/jobs/{job_id}/artifacts/{artifact_name}")
def get_robot_mastering_artifact(job_id: str, artifact_name: str) -> Response:
    try:
        content, media_type = robot_mastering_service.get_job_artifact(job_id, artifact_name)
        return Response(content=content, media_type=media_type)
    except RobotMasteringError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
