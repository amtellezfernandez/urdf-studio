from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.core.simulator_security import require_simulator_operator_access
from backend.models.world_labs import (
    WorldLabsCapabilitiesResponse,
    WorldLabsGenerateRequest,
    WorldLabsGenerateResponse,
    WorldLabsListWorldsRequest,
    WorldLabsListWorldsResponse,
    WorldLabsOperationStatusResponse,
    WorldLabsWorldImportResponse,
)
from backend.services.world_labs import (
    WORLD_LABS_DOCS_URL,
    WORLD_LABS_MARBLE_URL,
    WorldLabsError,
    world_labs_service,
)

router = APIRouter(prefix="/worlds/world-labs", tags=["world-labs"])


@router.get("/capabilities", response_model=WorldLabsCapabilitiesResponse)
def get_world_labs_capabilities(
    _access: None = Depends(require_simulator_operator_access),
) -> WorldLabsCapabilitiesResponse:
    configured = world_labs_service.configured
    return WorldLabsCapabilitiesResponse(
        available=configured,
        configured=configured,
        marble_url=WORLD_LABS_MARBLE_URL,
        docs_url=WORLD_LABS_DOCS_URL,
        generate_endpoint=world_labs_service.generate_endpoint,
        missing_reason=None if configured else "WORLD_LABS_API_KEY is not configured on the backend.",
    )


@router.post("/generate", response_model=WorldLabsGenerateResponse)
def generate_world_labs_world(
    request: WorldLabsGenerateRequest,
    _access: None = Depends(require_simulator_operator_access),
) -> WorldLabsGenerateResponse:
    try:
        return world_labs_service.start_generation(request)
    except WorldLabsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/operations/{operation_id}", response_model=WorldLabsOperationStatusResponse)
def get_world_labs_operation(
    operation_id: str,
    _access: None = Depends(require_simulator_operator_access),
) -> WorldLabsOperationStatusResponse:
    try:
        return world_labs_service.get_operation(operation_id)
    except WorldLabsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/worlds:list", response_model=WorldLabsListWorldsResponse)
def list_world_labs_worlds(
    request: WorldLabsListWorldsRequest,
    _access: None = Depends(require_simulator_operator_access),
) -> WorldLabsListWorldsResponse:
    try:
        return world_labs_service.list_worlds(request)
    except WorldLabsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/worlds/{world_id}", response_model=WorldLabsWorldImportResponse)
def import_world_labs_world(
    world_id: str,
    _access: None = Depends(require_simulator_operator_access),
) -> WorldLabsWorldImportResponse:
    try:
        return world_labs_service.import_world(world_id)
    except WorldLabsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
