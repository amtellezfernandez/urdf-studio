from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.core.simulator_security import require_simulator_operator_access_async
from backend.models.simulator_runtime import (
    SimulatorId,
    SimulatorRuntimeStatus,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
    WorkspaceChangeSetApplyRequest,
    WorkspaceChangeSetApplyResponse,
    WorkspaceTransferTargetListResponse,
)
from backend.services.simulator_adapters import (
    SimulatorAdapterError,
    apply_simulator_workspace_change_set,
    apply_workspace_change_set,
    get_simulator_runtime_status,
    list_workspace_transfer_targets,
    prepare_simulator_workspace,
)


router = APIRouter(prefix="/workspace-transfer", tags=["workspace-transfer"])


@router.get("/targets", response_model=WorkspaceTransferTargetListResponse)
async def list_workspace_transfer_targets_route(
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorkspaceTransferTargetListResponse:
    return list_workspace_transfer_targets()


@router.get("/targets/{simulator_id}/runtime", response_model=SimulatorRuntimeStatus)
async def get_workspace_transfer_target_runtime_route(
    simulator_id: SimulatorId,
    _access: None = Depends(require_simulator_operator_access_async),
) -> SimulatorRuntimeStatus:
    return get_simulator_runtime_status(simulator_id)


@router.post(
    "/targets/{simulator_id}/open",
    response_model=SimulatorWorkspacePrepareResponse,
)
async def open_workspace_transfer_target_route(
    simulator_id: SimulatorId,
    request: SimulatorWorkspacePrepareRequest,
    _access: None = Depends(require_simulator_operator_access_async),
) -> SimulatorWorkspacePrepareResponse:
    try:
        return prepare_simulator_workspace(simulator_id, request)
    except SimulatorAdapterError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post(
    "/change-set/apply",
    response_model=WorkspaceChangeSetApplyResponse,
)
async def apply_workspace_change_set_route(
    request: WorkspaceChangeSetApplyRequest,
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorkspaceChangeSetApplyResponse:
    try:
        return apply_workspace_change_set(request)
    except SimulatorAdapterError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post(
    "/targets/{simulator_id}/change-set/apply",
    response_model=WorkspaceChangeSetApplyResponse,
)
async def apply_workspace_transfer_target_change_set_route(
    simulator_id: SimulatorId,
    request: WorkspaceChangeSetApplyRequest,
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorkspaceChangeSetApplyResponse:
    try:
        return apply_simulator_workspace_change_set(simulator_id, request)
    except SimulatorAdapterError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
