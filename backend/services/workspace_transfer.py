from __future__ import annotations

from backend.models.simulator_runtime import (
    SIMULATOR_BLENDER_ID,
    SIMULATOR_RUNTIME_SPECS,
    SimulatorId,
    SimulatorWorkspacePrepareRequest,
    WorkspaceChangeSetApplyRequest as AdapterWorkspaceChangeSetApplyRequest,
)
from backend.models.workspace_transfer import (
    WorkspaceChangeSetApplyRequest,
    WorkspaceChangeSetApplyResponse,
    WorkspaceOpenRequest,
    WorkspaceOpenResponse,
    WorkspaceTransferTargetDescriptor,
    WorkspaceTransferTargetId,
    WorkspaceTransferTargetListResponse,
    WorkspaceTransferTargetStatus,
)
from backend.services.simulator_adapters import (
    SimulatorCapabilityError,
    apply_simulator_workspace_change_set,
    get_simulator_adapter,
    get_simulator_runtime_status,
    prepare_simulator_workspace,
)
from backend.services.simulator_adapters.blender_change_sets import BLENDER_CHANGE_SET_SCHEMA


def _adapter_change_set_request(
    request: WorkspaceChangeSetApplyRequest,
) -> AdapterWorkspaceChangeSetApplyRequest:
    return AdapterWorkspaceChangeSetApplyRequest(
        world_package=request.world_package,
        change_set=request.change_set,
    )


def _workspace_open_request(request: WorkspaceOpenRequest) -> SimulatorWorkspacePrepareRequest:
    return SimulatorWorkspacePrepareRequest(
        world_package=request.world_package,
        urdf_asset_path=request.urdf_asset_path,
        mesh_assets=request.mesh_assets,
        package_roots=request.package_roots,
        ilu_session_id=request.ilu_session_id,
    )


def _target_descriptor_for_spec(spec) -> WorkspaceTransferTargetDescriptor:
    get_simulator_adapter(spec.simulator_id)
    return WorkspaceTransferTargetDescriptor.from_runtime_spec(spec)


def list_workspace_transfer_targets() -> WorkspaceTransferTargetListResponse:
    return WorkspaceTransferTargetListResponse(
        targets=[_target_descriptor_for_spec(spec) for spec in SIMULATOR_RUNTIME_SPECS],
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
    return WorkspaceOpenResponse.from_adapter_response(
        prepare_simulator_workspace(target_id, _workspace_open_request(request))
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
    return WorkspaceChangeSetApplyResponse.from_adapter_response(
        apply_simulator_workspace_change_set(
            resolve_workspace_change_set_target(request),
            _adapter_change_set_request(request),
        )
    )


def apply_workspace_transfer_target_change_set(
    target_id: WorkspaceTransferTargetId,
    request: WorkspaceChangeSetApplyRequest,
) -> WorkspaceChangeSetApplyResponse:
    return WorkspaceChangeSetApplyResponse.from_adapter_response(
        apply_simulator_workspace_change_set(target_id, _adapter_change_set_request(request))
    )
