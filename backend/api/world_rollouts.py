from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.core.simulator_security import require_simulator_operator_access_async
from backend.models.world_rollouts import (
    WorldRolloutImportRequest,
    WorldRolloutImportResponse,
    WorldRolloutJobCreateRequest,
    WorldRolloutJobResponse,
)
from backend.services.world_rollouts import WorldRolloutError, world_rollout_service


router = APIRouter(prefix="/worlds/rollouts", tags=["world-rollouts"])

HTTP_NOT_FOUND = 404
HTTP_UNPROCESSABLE_ENTITY = 422


@router.post("/jobs", response_model=WorldRolloutJobResponse)
async def create_world_rollout_job(
    request: WorldRolloutJobCreateRequest,
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorldRolloutJobResponse:
    try:
        return world_rollout_service.create_job(request)
    except WorldRolloutError as exc:
        raise HTTPException(status_code=HTTP_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=HTTP_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.get("/jobs/{job_id}", response_model=WorldRolloutJobResponse)
async def get_world_rollout_job(
    job_id: str,
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorldRolloutJobResponse:
    try:
        return world_rollout_service.get_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=HTTP_NOT_FOUND, detail=str(exc)) from exc


@router.post("/import", response_model=WorldRolloutImportResponse)
async def import_world_rollout_results(
    request: WorldRolloutImportRequest,
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorldRolloutImportResponse:
    try:
        return world_rollout_service.import_results(request)
    except WorldRolloutError as exc:
        raise HTTPException(status_code=HTTP_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=HTTP_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
