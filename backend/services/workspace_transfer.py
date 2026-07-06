from __future__ import annotations

from pydantic import ValidationError

from backend.models.simulator_runtime import (
    SIMULATOR_BLENDER_ID,
    SimulatorId,
    SimulatorRuntimeSpec,
    SimulatorWorkspacePrepareRequest,
    WorkspaceChangeSetApplyRequest as AdapterWorkspaceChangeSetApplyRequest,
    validate_simulator_workspace_launch_id,
)
from backend.models.workspace_transfer import (
    WorkspaceChangeSetApplyRequest,
    WorkspaceChangeSetApplyResponse,
    WorkspaceLaunchCancelResponse,
    WorkspaceOpenRequest,
    WorkspaceOpenResponse,
    WorkspaceTransferTargetDescriptor,
    WorkspaceTransferTargetId,
    WorkspaceTransferTargetListResponse,
    WorkspaceTransferTargetStatus,
)
from backend.services.simulator_adapters import (
    SimulatorAdapterError,
    SimulatorCapabilityError,
    apply_simulator_workspace_change_set,
    get_simulator_adapter,
    get_simulator_runtime_status,
    list_simulator_runtime_specs,
    normalize_simulator_workspace_prepare_request,
    prepare_simulator_workspace,
)
from backend.services.simulator_adapters.blender_change_sets import BLENDER_CHANGE_SET_SCHEMA
from backend.services.simulator_adapters.workspace_launches import cancel_workspace_launch


def _adapter_change_set_request(
    request: WorkspaceChangeSetApplyRequest,
) -> AdapterWorkspaceChangeSetApplyRequest:
    return request.to_internal_request()


def _build_workspace_prepare_request(
    request: WorkspaceOpenRequest,
) -> SimulatorWorkspacePrepareRequest:
    try:
        return request.to_internal_request()
    except ValidationError as exc:
        raise SimulatorAdapterError(str(exc), status_code=422) from exc


def _workspace_open_request(request: WorkspaceOpenRequest) -> SimulatorWorkspacePrepareRequest:
    return normalize_simulator_workspace_prepare_request(
        _build_workspace_prepare_request(request)
    )


def _target_descriptor_for_spec(spec: SimulatorRuntimeSpec) -> WorkspaceTransferTargetDescriptor:
    get_simulator_adapter(spec.simulator_id)
    return WorkspaceTransferTargetDescriptor.from_runtime_spec(spec)


def _workspace_open_response(
    target_id: WorkspaceTransferTargetId,
    request: WorkspaceOpenRequest,
) -> WorkspaceOpenResponse:
    return WorkspaceOpenResponse.from_adapter_response(
        prepare_simulator_workspace(target_id, _workspace_open_request(request))
    )


def _workspace_change_set_response(
    target_id: WorkspaceTransferTargetId,
    request: WorkspaceChangeSetApplyRequest,
) -> WorkspaceChangeSetApplyResponse:
    return WorkspaceChangeSetApplyResponse.from_adapter_response(
        apply_simulator_workspace_change_set(target_id, _adapter_change_set_request(request))
    )


def list_workspace_transfer_targets() -> WorkspaceTransferTargetListResponse:
    return WorkspaceTransferTargetListResponse(
        targets=[_target_descriptor_for_spec(spec) for spec in list_simulator_runtime_specs()],
    )


def get_workspace_transfer_target_status(
    target_id: WorkspaceTransferTargetId,
) -> WorkspaceTransferTargetStatus:
    status = get_simulator_runtime_status(target_id)
    return WorkspaceTransferTargetStatus.from_runtime_status(target_id, status)


def open_workspace_transfer_target(
    target_id: WorkspaceTransferTargetId,
    request: WorkspaceOpenRequest,
) -> WorkspaceOpenResponse:
    return _workspace_open_response(target_id, request)


def cancel_workspace_transfer_target_launch(
    target_id: WorkspaceTransferTargetId,
    launch_id: str,
) -> WorkspaceLaunchCancelResponse:
    normalized_launch_id = validate_simulator_workspace_launch_id(launch_id)
    result = cancel_workspace_launch(
        normalized_launch_id,
        target_id=target_id,
    )
    return WorkspaceLaunchCancelResponse.from_cancel_result(
        target_id=target_id,
        launch_id=result.launch_id,
        cancelled=result.cancelled,
        process_stopped=result.process_stopped,
        pid=result.pid,
    )


def resolve_workspace_change_set_target(
    request: WorkspaceChangeSetApplyRequest | AdapterWorkspaceChangeSetApplyRequest,
) -> SimulatorId:
    schema = request.change_set.get("schema")
    if schema == BLENDER_CHANGE_SET_SCHEMA:
        return SIMULATOR_BLENDER_ID
    raise SimulatorCapabilityError("Unsupported workspace change-set schema.")


def apply_workspace_transfer_change_set(
    request: WorkspaceChangeSetApplyRequest,
) -> WorkspaceChangeSetApplyResponse:
    return _workspace_change_set_response(
        resolve_workspace_change_set_target(request),
        request,
    )


def apply_workspace_transfer_target_change_set(
    target_id: WorkspaceTransferTargetId,
    request: WorkspaceChangeSetApplyRequest,
) -> WorkspaceChangeSetApplyResponse:
    return _workspace_change_set_response(target_id, request)
