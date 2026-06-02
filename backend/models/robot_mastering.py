from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class RobotMasteringModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class RobotMasteringMeshFilePayload(RobotMasteringModel):
    path: str = Field(..., min_length=1)
    base64_content: str = Field(..., alias="base64Content", min_length=1)
    mime_type: str | None = Field(default=None, alias="mimeType")


class RobotMasteringBlobPayload(RobotMasteringModel):
    base64_content: str = Field(..., alias="base64Content", min_length=1)
    mime_type: str | None = Field(default=None, alias="mimeType")


class RobotMasteringBakedMeshSidecarPayload(RobotMasteringModel):
    filename: str = Field(..., min_length=1)
    blob: RobotMasteringBlobPayload


class RobotMasteringBakedMeshOverridePayload(RobotMasteringModel):
    source_reference: str = Field(..., alias="sourceReference", min_length=1)
    resolved_path: str = Field(..., alias="resolvedPath", min_length=1)
    output_filename: str = Field(..., alias="outputFilename", min_length=1)
    blob: RobotMasteringBlobPayload
    sidecars: list[RobotMasteringBakedMeshSidecarPayload] = Field(default_factory=list)


class RobotMasteringUnsupportedBakeEntryPayload(RobotMasteringModel):
    mesh_reference: str = Field(..., alias="meshReference", min_length=1)
    reason: str = Field(..., min_length=1)


class GeneratePhysicsJobRequest(RobotMasteringModel):
    job_type: Literal["generate-physics"] = Field(alias="jobType")
    source_urdf: str = Field(..., alias="sourceUrdf", min_length=1)
    urdf_base_path: str | None = Field(default=None, alias="urdfBasePath")
    package_roots: dict[str, list[str]] = Field(default_factory=dict, alias="packageRoots")
    mesh_files: list[RobotMasteringMeshFilePayload] = Field(default_factory=list, alias="meshFiles")
    density_preset_id: str = Field(..., alias="densityPresetId", min_length=1)
    repair_mode: Literal["repair-missing-invalid", "replace-all"] = Field(alias="repairMode")
    link_names: list[str] = Field(default_factory=list, alias="linkNames")
    mesh_solve_mode: Literal["surface-then-voxel", "voxel-only"] | None = Field(
        default=None,
        alias="meshSolveMode",
    )
    regularize_near_miss_tensors: bool = Field(
        default=False,
        alias="regularizeNearMissTensors",
    )
    canonicalize_repeated_meshes: bool = Field(
        default=False,
        alias="canonicalizeRepeatedMeshes",
    )


class GeneratePhysicsPreflightRequest(RobotMasteringModel):
    source_urdf: str = Field(..., alias="sourceUrdf", min_length=1)
    urdf_base_path: str | None = Field(default=None, alias="urdfBasePath")
    package_roots: dict[str, list[str]] = Field(default_factory=dict, alias="packageRoots")
    mesh_files: list[RobotMasteringMeshFilePayload] = Field(default_factory=list, alias="meshFiles")


class FramePreflightRequest(RobotMasteringModel):
    source_urdf: str = Field(..., alias="sourceUrdf", min_length=1)


class RobotMasteringBakePlanEntryRequest(RobotMasteringModel):
    mesh_reference: str = Field(..., alias="meshReference", min_length=1)
    bake_matrix_elements: list[float] = Field(..., alias="bakeMatrixElements", min_length=16, max_length=16)
    link_names: list[str] = Field(default_factory=list, alias="linkNames")
    source_entry_count: int = Field(..., alias="sourceEntryCount", ge=1)


class RobotMasteringBakePlanConflictRequest(RobotMasteringModel):
    mesh_reference: str = Field(..., alias="meshReference", min_length=1)
    link_names: list[str] = Field(default_factory=list, alias="linkNames")


class BakeExportExecuteRequest(RobotMasteringModel):
    plan_entries: list[RobotMasteringBakePlanEntryRequest] = Field(default_factory=list, alias="planEntries")
    plan_conflicts: list[RobotMasteringBakePlanConflictRequest] = Field(default_factory=list, alias="planConflicts")
    mesh_files: list[RobotMasteringMeshFilePayload] = Field(default_factory=list, alias="meshFiles")
    urdf_base_path: str | None = Field(default=None, alias="urdfBasePath")
    package_roots: dict[str, list[str]] = Field(default_factory=dict, alias="packageRoots")


class RobotMasteringJobCreatedResponse(RobotMasteringModel):
    job_id: str = Field(alias="jobId")
    job_type: Literal["generate-physics"] = Field(alias="jobType")
    status: Literal["queued", "running", "succeeded", "failed"]


class RobotMasteringJobStatusResponse(RobotMasteringModel):
    job_id: str = Field(alias="jobId")
    job_type: Literal["generate-physics"] = Field(alias="jobType")
    status: Literal["queued", "running", "succeeded", "failed"]
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    error: str | None = None


class GeneratePhysicsJobResultResponse(RobotMasteringModel):
    job_id: str = Field(alias="jobId")
    job_type: Literal["generate-physics"] = Field(alias="jobType")
    draft_urdf_content: str = Field(alias="draftUrdfContent")
    audit_summary: dict[str, Any] | None = Field(alias="auditSummary")
    synthesis_result: dict[str, Any] = Field(alias="synthesisResult")
    plausibility_summary: dict[str, Any] | None = Field(alias="plausibilitySummary")


class GeneratePhysicsPreflightResponse(RobotMasteringModel):
    audit_summary: dict[str, Any] | None = Field(alias="auditSummary")
    plausibility_summary: dict[str, Any] | None = Field(alias="plausibilitySummary")


class FramePreflightResponse(RobotMasteringModel):
    orientation_card: dict[str, Any] | None = Field(alias="orientationCard")
    frame_lint: dict[str, Any] | None = Field(alias="frameLint")


class BakeExportExecuteResponse(RobotMasteringModel):
    overrides: list[RobotMasteringBakedMeshOverridePayload] = Field(default_factory=list)
    unsupported: list[RobotMasteringUnsupportedBakeEntryPayload] = Field(default_factory=list)


class CanonicalSynthesisCapturedLinkPoseRequest(RobotMasteringModel):
    link_name: str = Field(..., alias="linkName", min_length=1)
    matrix_world_elements: list[float] = Field(
        ...,
        alias="matrixWorldElements",
        min_length=16,
        max_length=16,
    )


class CanonicalSynthesisSupportPlaneRequest(RobotMasteringModel):
    success: bool
    confidence: float
    evidence: str = ""
    inferred_up_axis: str | None = Field(default=None, alias="inferredUpAxis")
    inferred_up_sign: int | None = Field(default=None, alias="inferredUpSign")
    target_up_axis: str | None = Field(default=None, alias="targetUpAxis")
    target_up_sign: int | None = Field(default=None, alias="targetUpSign")
    fallback_reason: str | None = Field(default=None, alias="fallbackReason")


class CanonicalSynthesisRequest(RobotMasteringModel):
    source_urdf: str = Field(..., alias="sourceUrdf", min_length=1)
    synthesis_source_urdf: str = Field(..., alias="synthesisSourceUrdf", min_length=1)
    robot_name: str | None = Field(default=None, alias="robotName")
    link_world_poses: list[CanonicalSynthesisCapturedLinkPoseRequest] = Field(
        default_factory=list,
        alias="capturedLinkWorldPoses",
    )
    support_plane: CanonicalSynthesisSupportPlaneRequest = Field(alias="supportPlane")


class CanonicalSynthesisResponse(RobotMasteringModel):
    preview: dict[str, Any] = Field(default_factory=dict)
    draft_content: str = Field(..., alias="draftContent")
