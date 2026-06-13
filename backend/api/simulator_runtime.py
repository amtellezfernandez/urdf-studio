from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.core.simulator_security import require_simulator_operator_access_async
from backend.models.simulator_runtime import (
    BlenderLayoutChangeSetApplyRequest,
    BlenderLayoutChangeSetApplyResponse,
    SimulatorId,
    SimulatorRuntimeListResponse,
    SimulatorRuntimeStatus,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
)
from backend.services.simulator_adapters.blender_workspace import (
    apply_blender_layout_change_set_with_summary,
)
from backend.services.simulator_adapters import (
    SimulatorAdapterError,
    get_simulator_runtime_status,
    list_simulator_runtime_descriptors,
    prepare_simulator_workspace,
)


router = APIRouter(prefix="/simulators", tags=["simulator-runtime"])


@router.get("", response_model=SimulatorRuntimeListResponse)
async def list_simulator_runtimes(
    _access: None = Depends(require_simulator_operator_access_async),
) -> SimulatorRuntimeListResponse:
    return list_simulator_runtime_descriptors()


@router.get("/{simulator_id}/runtime", response_model=SimulatorRuntimeStatus)
async def get_runtime_status(
    simulator_id: SimulatorId,
    _access: None = Depends(require_simulator_operator_access_async),
) -> SimulatorRuntimeStatus:
    return get_simulator_runtime_status(simulator_id)


@router.post("/{simulator_id}/workspace/prepare", response_model=SimulatorWorkspacePrepareResponse)
async def prepare_simulator_workspace_route(
    simulator_id: SimulatorId,
    request: SimulatorWorkspacePrepareRequest,
    _access: None = Depends(require_simulator_operator_access_async),
) -> SimulatorWorkspacePrepareResponse:
    try:
        return prepare_simulator_workspace(simulator_id, request)
    except SimulatorAdapterError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post(
    "/blender/layout-change-set/apply",
    response_model=BlenderLayoutChangeSetApplyResponse,
)
async def apply_blender_layout_change_set_route(
    request: BlenderLayoutChangeSetApplyRequest,
    _access: None = Depends(require_simulator_operator_access_async),
) -> BlenderLayoutChangeSetApplyResponse:
    try:
        result = apply_blender_layout_change_set_with_summary(
            request.world_package,
            request.change_set,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return BlenderLayoutChangeSetApplyResponse(
        world_package=result.world_package,
        applied_change_count=result.applied_change_count,
        review_only_count=result.review_only_count,
    )
