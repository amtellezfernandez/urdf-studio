from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from backend.models.simulator_runtime import (
    SIMULATOR_CANONICAL_FRAME_CONVENTION,
    SimulatorAssetFormat,
    SimulatorId,
    SimulatorMeshAssetUpload,
    SimulatorTargetKind,
    SimulatorTransferStrategy,
    SimulatorWorkspaceAssetFormat,
    SimulatorWorkspacePrepareRequest,
)
from backend.models.world_scene_package import WorldScenePackageManifest


WorkspaceTransferTargetId = SimulatorId
WorkspaceTransferAssetFormat = SimulatorAssetFormat
WorkspaceTransferWorkspaceAssetFormat = SimulatorWorkspaceAssetFormat
WorkspaceTransferStrategy = SimulatorTransferStrategy
WorkspaceTransferTargetKind = SimulatorTargetKind
WorkspaceTransferMeshAssetUpload = SimulatorMeshAssetUpload


class WorkspaceTransferCamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class WorkspaceTransferDependency(WorkspaceTransferCamelModel):
    name: str
    available: bool


class WorkspaceTransferCapabilities(WorkspaceTransferCamelModel):
    workspace_target: bool = Field(default=False, alias="workspaceTarget")
    motion_validation: bool = Field(default=False, alias="motionValidation")
    layout_round_trip: bool = Field(default=False, alias="layoutRoundTrip")


class WorkspaceTransferPolicy(WorkspaceTransferCamelModel):
    robot_asset_format: WorkspaceTransferAssetFormat = Field(..., alias="robotAssetFormat")
    scene_asset_format: WorkspaceTransferAssetFormat = Field(..., alias="sceneAssetFormat")
    frame_convention: str = Field(
        default=SIMULATOR_CANONICAL_FRAME_CONVENTION,
        alias="frameConvention",
    )
    transfer_strategy: WorkspaceTransferStrategy = Field(..., alias="transferStrategy")


class WorkspaceTransferTargetDescriptor(WorkspaceTransferCamelModel):
    target_id: WorkspaceTransferTargetId = Field(..., alias="targetId")
    label: str
    target_kind: WorkspaceTransferTargetKind = Field(..., alias="targetKind")
    capabilities: WorkspaceTransferCapabilities
    transfer_policy: WorkspaceTransferPolicy = Field(..., alias="transferPolicy")


class WorkspaceTransferTargetListResponse(WorkspaceTransferCamelModel):
    targets: list[WorkspaceTransferTargetDescriptor] = Field(default_factory=list)


class WorkspaceTransferTargetStatus(WorkspaceTransferCamelModel):
    target_id: WorkspaceTransferTargetId = Field(..., alias="targetId")
    available: bool
    status: str
    dependencies: list[WorkspaceTransferDependency] = Field(default_factory=list)


class WorkspaceOpenRequest(SimulatorWorkspacePrepareRequest):
    pass


class WorkspaceOpenResponse(WorkspaceTransferCamelModel):
    target_id: WorkspaceTransferTargetId = Field(..., alias="targetId")
    started: bool
    pid: int
    command: list[str]
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


class WorkspaceChangeSetApplyRequest(BaseModel):
    world_package: WorldScenePackageManifest
    change_set: dict[str, Any]


class WorkspaceChangeSetApplyResponse(WorkspaceTransferCamelModel):
    target_id: WorkspaceTransferTargetId = Field(..., alias="targetId")
    world_package: WorldScenePackageManifest
    applied_change_count: int = Field(..., alias="appliedChangeCount")
    review_only_count: int = Field(..., alias="reviewOnlyCount")
