from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.core.simulator_security import require_simulator_operator_access_async
from backend.models.workspace_transfer import (
    WorkspaceChangeSetApplyRequest,
    WorkspaceChangeSetApplyResponse,
    WorkspaceOpenRequest,
    WorkspaceOpenResponse,
    WorkspaceTransferTargetId,
    WorkspaceTransferTargetListResponse,
    WorkspaceTransferTargetStatus,
)
from backend.services.simulator_adapters import (
    SimulatorAdapterError,
)
from backend.services.workspace_transfer import (
    apply_workspace_transfer_change_set,
    apply_workspace_transfer_target_change_set,
    get_workspace_transfer_target_status,
    list_workspace_transfer_targets,
    open_workspace_transfer_target,
)


router = APIRouter(prefix="/workspace-transfer", tags=["workspace-transfer"])


@router.get("/targets", response_model=WorkspaceTransferTargetListResponse)
async def list_workspace_transfer_targets_route(
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorkspaceTransferTargetListResponse:
    return list_workspace_transfer_targets()


@router.get("/targets/{target_id}/runtime", response_model=WorkspaceTransferTargetStatus)
async def get_workspace_transfer_target_runtime_route(
    target_id: WorkspaceTransferTargetId,
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorkspaceTransferTargetStatus:
    return get_workspace_transfer_target_status(target_id)


@router.post(
    "/targets/{target_id}/open",
    response_model=WorkspaceOpenResponse,
)
async def open_workspace_transfer_target_route(
    target_id: WorkspaceTransferTargetId,
    request: WorkspaceOpenRequest,
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorkspaceOpenResponse:
    try:
        return open_workspace_transfer_target(target_id, request)
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
        return apply_workspace_transfer_change_set(request)
    except SimulatorAdapterError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post(
    "/targets/{target_id}/change-set/apply",
    response_model=WorkspaceChangeSetApplyResponse,
)
async def apply_workspace_transfer_target_change_set_route(
    target_id: WorkspaceTransferTargetId,
    request: WorkspaceChangeSetApplyRequest,
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorkspaceChangeSetApplyResponse:
    try:
        return apply_workspace_transfer_target_change_set(target_id, request)
    except SimulatorAdapterError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
