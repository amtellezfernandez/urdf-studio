from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from backend.models.simulator_runtime import (
    SIMULATOR_CANONICAL_FRAME_CONVENTION,
    SimulatorAssetFormat,
    SimulatorDependencyScope,
    SimulatorId,
    SimulatorMeshAssetUpload,
    SimulatorRuntimeCapabilities,
    SimulatorRuntimeDependency,
    SimulatorRuntimeSpec,
    SimulatorRuntimeStatus,
    SimulatorRuntimeTransferPolicy,
    SimulatorTargetKind,
    SimulatorTransferStrategy,
    SimulatorWorkspaceAssetFormat,
    SimulatorWorkspaceLaunchMode,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse as AdapterWorkspaceOpenResponse,
    WorkspaceChangeSetApplyResponse as AdapterWorkspaceChangeSetApplyResponse,
    validate_simulator_workspace_launch_id,
)
from backend.models.world_scene_package import WorldScenePackageManifest


WorkspaceTransferTargetId = SimulatorId
WorkspaceTransferAssetFormat = SimulatorAssetFormat
WorkspaceTransferWorkspaceAssetFormat = SimulatorWorkspaceAssetFormat
WorkspaceTransferStrategy = SimulatorTransferStrategy
WorkspaceTransferTargetKind = SimulatorTargetKind
WorkspaceTransferMeshAssetUpload = SimulatorMeshAssetUpload
WorkspaceTransferLaunchMode = SimulatorWorkspaceLaunchMode


class WorkspaceTransferCamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class WorkspaceTransferDependency(WorkspaceTransferCamelModel):
    name: str
    available: bool
    required: bool = True
    scope: SimulatorDependencyScope = "workspace"

    @classmethod
    def from_runtime_dependency(
        cls,
        dependency: SimulatorRuntimeDependency,
    ) -> "WorkspaceTransferDependency":
        return cls(
            name=dependency.name,
            available=dependency.available,
            required=dependency.required,
            scope=dependency.scope,
        )


class WorkspaceTransferCapabilities(WorkspaceTransferCamelModel):
    workspace_target: bool = Field(default=False, alias="workspaceTarget")
    motion_validation: bool = Field(default=False, alias="motionValidation")
    layout_round_trip: bool = Field(default=False, alias="layoutRoundTrip")

    @classmethod
    def from_runtime_capabilities(
        cls,
        capabilities: SimulatorRuntimeCapabilities,
    ) -> "WorkspaceTransferCapabilities":
        return cls.model_validate(capabilities.model_dump(by_alias=True))


class WorkspaceTransferPolicy(WorkspaceTransferCamelModel):
    robot_asset_format: WorkspaceTransferAssetFormat = Field(..., alias="robotAssetFormat")
    scene_asset_format: WorkspaceTransferAssetFormat = Field(..., alias="sceneAssetFormat")
    frame_convention: str = Field(
        default=SIMULATOR_CANONICAL_FRAME_CONVENTION,
        alias="frameConvention",
    )
    transfer_strategy: WorkspaceTransferStrategy = Field(..., alias="transferStrategy")

    @classmethod
    def from_runtime_policy(
        cls,
        policy: SimulatorRuntimeTransferPolicy,
    ) -> "WorkspaceTransferPolicy":
        return cls.model_validate(policy.model_dump(by_alias=True))


class WorkspaceTransferTargetDescriptor(WorkspaceTransferCamelModel):
    target_id: WorkspaceTransferTargetId = Field(..., alias="targetId")
    label: str
    target_kind: WorkspaceTransferTargetKind = Field(..., alias="targetKind")
    capabilities: WorkspaceTransferCapabilities
    transfer_policy: WorkspaceTransferPolicy = Field(..., alias="transferPolicy")

    @classmethod
    def from_runtime_spec(
        cls,
        spec: SimulatorRuntimeSpec,
    ) -> "WorkspaceTransferTargetDescriptor":
        return cls(
            targetId=spec.simulator_id,
            label=spec.label,
            targetKind=spec.target_kind,
            capabilities=WorkspaceTransferCapabilities.from_runtime_capabilities(
                spec.capabilities_model()
            ),
            transferPolicy=WorkspaceTransferPolicy.from_runtime_policy(
                spec.transfer.runtime_model()
            ),
        )


class WorkspaceTransferTargetListResponse(WorkspaceTransferCamelModel):
    targets: list[WorkspaceTransferTargetDescriptor] = Field(default_factory=list)


class WorkspaceTransferTargetStatus(WorkspaceTransferCamelModel):
    target_id: WorkspaceTransferTargetId = Field(..., alias="targetId")
    available: bool
    status: str
    dependencies: list[WorkspaceTransferDependency] = Field(default_factory=list)

    @classmethod
    def from_runtime_status(
        cls,
        target_id: WorkspaceTransferTargetId,
        status: SimulatorRuntimeStatus,
    ) -> "WorkspaceTransferTargetStatus":
        return cls(
            targetId=target_id,
            available=status.available,
            status=status.status,
            dependencies=[
                WorkspaceTransferDependency.from_runtime_dependency(dependency)
                for dependency in status.dependencies
            ],
        )


class WorkspaceOpenRequest(SimulatorWorkspacePrepareRequest):
    pass


class WorkspaceLaunchCancelResponse(WorkspaceTransferCamelModel):
    target_id: WorkspaceTransferTargetId = Field(..., alias="targetId")
    launch_id: str = Field(..., alias="launchId")
    cancelled: bool
    process_stopped: bool = Field(default=False, alias="processStopped")
    pid: int | None = None

    @classmethod
    def from_cancel_result(
        cls,
        *,
        target_id: WorkspaceTransferTargetId,
        launch_id: str,
        cancelled: bool,
        process_stopped: bool,
        pid: int | None,
    ) -> "WorkspaceLaunchCancelResponse":
        return cls(
            targetId=target_id,
            launchId=validate_simulator_workspace_launch_id(launch_id),
            cancelled=cancelled,
            processStopped=process_stopped,
            pid=pid,
        )


class WorkspaceOpenResponse(WorkspaceTransferCamelModel):
    target_id: WorkspaceTransferTargetId = Field(..., alias="targetId")
    started: bool
    pid: int
    command: list[str]
    launch_mode: WorkspaceTransferLaunchMode = Field(
        default="interactive_viewer",
        alias="launchMode",
    )
    log_path: str | None = Field(default=None, alias="logPath")
    world_package_path: str = Field(..., alias="worldPackagePath")
    robot_urdf_path: str = Field(..., alias="robotUrdfPath")
    target_asset_path: str | None = Field(default=None, alias="targetAssetPath")
    target_asset_format: WorkspaceTransferWorkspaceAssetFormat | None = Field(
        default=None,
        alias="targetAssetFormat",
    )
    bundled_mesh_count: int = Field(default=0, alias="bundledMeshCount")
    unresolved_mesh_refs: list[str] = Field(default_factory=list, alias="unresolvedMeshRefs")
    workspace_warnings: list[str] = Field(default_factory=list, alias="workspaceWarnings")
    world_object_count: int = Field(default=0, ge=0, alias="worldObjectCount")
    camera_count: int = Field(default=0, ge=0, alias="cameraCount")

    @classmethod
    def from_adapter_response(
        cls,
        response: AdapterWorkspaceOpenResponse,
    ) -> "WorkspaceOpenResponse":
        return cls(
            targetId=response.simulator_id,
            started=response.started,
            pid=response.pid,
            command=response.command,
            launchMode=response.launch_mode,
            logPath=response.log_path,
            worldPackagePath=response.world_package_path,
            robotUrdfPath=response.robot_urdf_path,
            targetAssetPath=response.simulator_asset_path,
            targetAssetFormat=response.simulator_asset_format,
            bundledMeshCount=response.bundled_mesh_count,
            unresolvedMeshRefs=response.unresolved_mesh_refs,
            workspaceWarnings=response.workspace_warnings,
            worldObjectCount=response.world_object_count,
            cameraCount=response.camera_count,
        )


class WorkspaceChangeSetApplyRequest(BaseModel):
    world_package: WorldScenePackageManifest
    change_set: dict[str, Any]


class WorkspaceChangeSetApplyResponse(WorkspaceTransferCamelModel):
    target_id: WorkspaceTransferTargetId = Field(..., alias="targetId")
    world_package: WorldScenePackageManifest
    applied_change_count: int = Field(..., alias="appliedChangeCount")
    review_only_count: int = Field(..., alias="reviewOnlyCount")

    @classmethod
    def from_adapter_response(
        cls,
        response: AdapterWorkspaceChangeSetApplyResponse,
    ) -> "WorkspaceChangeSetApplyResponse":
        return cls(
            targetId=response.simulator_id,
            world_package=response.world_package,
            appliedChangeCount=response.applied_change_count,
            reviewOnlyCount=response.review_only_count,
        )
