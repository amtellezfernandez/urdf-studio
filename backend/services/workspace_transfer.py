from __future__ import annotations

from backend.models.simulator_runtime import (
    SIMULATOR_BLENDER_ID,
    SIMULATOR_RUNTIME_SPECS,
    SimulatorId,
    SimulatorWorkspacePrepareRequest,
    WorkspaceChangeSetApplyRequest as LegacyWorkspaceChangeSetApplyRequest,
    WorkspaceChangeSetApplyResponse as LegacyWorkspaceChangeSetApplyResponse,
)
from backend.models.workspace_transfer import (
    WorkspaceChangeSetApplyRequest,
    WorkspaceChangeSetApplyResponse,
    WorkspaceTransferCapabilities,
    WorkspaceTransferDependency,
    WorkspaceTransferPolicy,
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
from backend.services.simulator_adapters.blender_workspace import BLENDER_CHANGE_SET_SCHEMA


def _legacy_change_set_request(
    request: WorkspaceChangeSetApplyRequest,
) -> LegacyWorkspaceChangeSetApplyRequest:
    return LegacyWorkspaceChangeSetApplyRequest(
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
    return WorkspaceTransferTargetDescriptor(
        targetId=spec.simulator_id,
        label=spec.label,
        targetKind=spec.target_kind,
        capabilities=WorkspaceTransferCapabilities(
            workspaceTarget=spec.workspace_target,
            motionValidation=spec.motion_validation,
            layoutRoundTrip=spec.layout_round_trip,
        ),
        transferPolicy=WorkspaceTransferPolicy(
            robotAssetFormat=spec.transfer.robot_asset_format,
            sceneAssetFormat=spec.transfer.scene_asset_format,
            frameConvention=spec.transfer.frame_convention,
            transferStrategy=spec.transfer.transfer_strategy,
        ),
    )


def _open_response_from_legacy(response) -> WorkspaceOpenResponse:
    return WorkspaceOpenResponse(
        targetId=response.simulator_id,
        started=response.started,
        pid=response.pid,
        command=response.command,
        logPath=response.log_path,
        worldPackagePath=response.world_package_path,
        robotUrdfPath=response.robot_urdf_path,
        targetAssetPath=response.simulator_asset_path,
        targetAssetFormat=response.simulator_asset_format,
        bundledMeshCount=response.bundled_mesh_count,
        unresolvedMeshRefs=response.unresolved_mesh_refs,
    )


def _change_set_response_from_legacy(
    response: LegacyWorkspaceChangeSetApplyResponse,
) -> WorkspaceChangeSetApplyResponse:
    return WorkspaceChangeSetApplyResponse(
        targetId=response.simulator_id,
        world_package=response.world_package,
        appliedChangeCount=response.applied_change_count,
        reviewOnlyCount=response.review_only_count,
    )


def list_workspace_transfer_targets() -> WorkspaceTransferTargetListResponse:
    return WorkspaceTransferTargetListResponse(
        targets=[_target_descriptor_for_spec(spec) for spec in SIMULATOR_RUNTIME_SPECS],
    )


def get_workspace_transfer_target_status(
    target_id: WorkspaceTransferTargetId,
) -> WorkspaceTransferTargetStatus:
    status = get_simulator_runtime_status(target_id)
    return WorkspaceTransferTargetStatus(
        targetId=target_id,
        available=status.available,
        status=status.status,
        dependencies=[
            WorkspaceTransferDependency(name=dependency.name, available=dependency.available)
            for dependency in status.dependencies
        ],
    )


def open_workspace_transfer_target(
    target_id: WorkspaceTransferTargetId,
    request: WorkspaceOpenRequest,
) -> WorkspaceOpenResponse:
    return _open_response_from_legacy(
        prepare_simulator_workspace(target_id, _workspace_open_request(request))
    )


def resolve_workspace_change_set_target(
    request: WorkspaceChangeSetApplyRequest | LegacyWorkspaceChangeSetApplyRequest,
) -> SimulatorId:
    schema = request.change_set.get("schema")
    if schema == BLENDER_CHANGE_SET_SCHEMA:
        return SIMULATOR_BLENDER_ID
    raise SimulatorCapabilityError("Unsupported workspace change-set schema.")


def apply_workspace_transfer_change_set(
    request: WorkspaceChangeSetApplyRequest,
) -> WorkspaceChangeSetApplyResponse:
    return _change_set_response_from_legacy(
        apply_simulator_workspace_change_set(
            resolve_workspace_change_set_target(request),
            _legacy_change_set_request(request),
        )
    )


def apply_workspace_transfer_target_change_set(
    target_id: WorkspaceTransferTargetId,
    request: WorkspaceChangeSetApplyRequest,
) -> WorkspaceChangeSetApplyResponse:
    return _change_set_response_from_legacy(
        apply_simulator_workspace_change_set(target_id, _legacy_change_set_request(request))
    )


def apply_schema_routed_legacy_change_set(
    request: LegacyWorkspaceChangeSetApplyRequest,
) -> LegacyWorkspaceChangeSetApplyResponse:
    return apply_simulator_workspace_change_set(
        resolve_workspace_change_set_target(request),
        request,
    )
