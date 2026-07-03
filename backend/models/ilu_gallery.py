from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


IluGalleryJobStatus = Literal["queued", "running", "completed", "failed"]
IluGalleryJobPhase = Literal["inspect", "generate"]
IluGalleryGenerateMode = Literal["repo", "selected"]
IluGalleryGenerateAssetKind = Literal["image", "video"]
IluGalleryProgressStage = Literal["preparing", "rendering"]
PERCENT_COMPLETE = 100
FIRST_PROGRESS_STEP = 1


class IluGalleryBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class IluGallerySource(IluGalleryBaseModel):
    owner: str = Field(..., min_length=1)
    repo: str = Field(..., min_length=1)
    path: str | None = Field(default=None)
    branch: str | None = Field(default=None)
    urdf_path: str | None = Field(
        default=None,
        serialization_alias="urdfPath",
        validation_alias=AliasChoices("urdfPath", "urdf_path"),
    )


class IluGalleryRepoMetadata(IluGalleryBaseModel):
    org: str = Field(default="")
    summary: str = Field(default="")
    demo: str = Field(default="")
    tags: list[str] = Field(default_factory=list)
    license: str = Field(default="")
    author_website: str = Field(
        default="",
        serialization_alias="authorWebsite",
        validation_alias=AliasChoices("authorWebsite", "author_website"),
    )
    author_x: str = Field(
        default="",
        serialization_alias="authorX",
        validation_alias=AliasChoices("authorX", "author_x"),
    )
    author_linkedin: str = Field(
        default="",
        serialization_alias="authorLinkedin",
        validation_alias=AliasChoices("authorLinkedin", "author_linkedin"),
    )
    author_github: str = Field(
        default="",
        serialization_alias="authorGithub",
        validation_alias=AliasChoices("authorGithub", "author_github"),
    )
    contact: str = Field(default="")
    extra: str = Field(default="")
    stars: int | None = Field(default=None, ge=0)
    owner_login: str | None = Field(
        default=None,
        serialization_alias="ownerLogin",
        validation_alias=AliasChoices("ownerLogin", "owner_login"),
    )
    owner_avatar: str | None = Field(
        default=None,
        serialization_alias="ownerAvatar",
        validation_alias=AliasChoices("ownerAvatar", "owner_avatar"),
    )
    author_login: str | None = Field(
        default=None,
        serialization_alias="authorLogin",
        validation_alias=AliasChoices("authorLogin", "author_login"),
    )
    author_avatar: str | None = Field(
        default=None,
        serialization_alias="authorAvatar",
        validation_alias=AliasChoices("authorAvatar", "author_avatar"),
    )
    repo_updated_at: str | None = Field(
        default=None,
        serialization_alias="repoUpdatedAt",
        validation_alias=AliasChoices("repoUpdatedAt", "repo_updated_at"),
    )


class IluGalleryRobotTraits(IluGalleryBaseModel):
    primary_family: str = Field(
        ...,
        min_length=1,
        serialization_alias="primaryFamily",
        validation_alias=AliasChoices("primaryFamily", "primary_family"),
    )
    families: list[str] = Field(default_factory=list)
    link_count: int = Field(
        ...,
        ge=0,
        serialization_alias="linkCount",
        validation_alias=AliasChoices("linkCount", "link_count"),
    )
    joint_count: int = Field(
        ...,
        ge=0,
        serialization_alias="jointCount",
        validation_alias=AliasChoices("jointCount", "joint_count"),
    )
    controllable_joint_count: int = Field(
        ...,
        ge=0,
        serialization_alias="controllableJointCount",
        validation_alias=AliasChoices("controllableJointCount", "controllable_joint_count"),
    )
    dof_count: int = Field(
        ...,
        ge=0,
        serialization_alias="dofCount",
        validation_alias=AliasChoices("dofCount", "dof_count"),
    )
    arm_count: int = Field(
        ...,
        ge=0,
        serialization_alias="armCount",
        validation_alias=AliasChoices("armCount", "arm_count"),
    )
    leg_count: int = Field(
        ...,
        ge=0,
        serialization_alias="legCount",
        validation_alias=AliasChoices("legCount", "leg_count"),
    )
    wheel_count: int = Field(
        ...,
        ge=0,
        serialization_alias="wheelCount",
        validation_alias=AliasChoices("wheelCount", "wheel_count"),
    )


class IluGalleryPublishedRobot(IluGalleryBaseModel):
    name: str | None = Field(default=None)
    file: str | None = Field(default=None)
    file_base: str | None = Field(
        default=None,
        serialization_alias="fileBase",
        validation_alias=AliasChoices("fileBase", "file_base"),
    )


class IluGalleryPublishedRepo(IluGalleryBaseModel):
    repo: str = Field(default="")
    repo_key: str | None = Field(
        default=None,
        serialization_alias="repoKey",
        validation_alias=AliasChoices("repoKey", "repo_key"),
    )
    path: str | None = Field(default=None)
    name: str | None = Field(default=None)
    summary: str = Field(default="")
    org: str = Field(default="")
    demo: str = Field(default="")
    tags: list[str] = Field(default_factory=list)
    robots: list[IluGalleryPublishedRobot] = Field(default_factory=list)
    author_website: str = Field(
        default="",
        serialization_alias="authorWebsite",
        validation_alias=AliasChoices("authorWebsite", "author_website"),
    )
    author_x: str = Field(
        default="",
        serialization_alias="authorX",
        validation_alias=AliasChoices("authorX", "author_x"),
    )
    author_linkedin: str = Field(
        default="",
        serialization_alias="authorLinkedin",
        validation_alias=AliasChoices("authorLinkedin", "author_linkedin"),
    )
    author_github: str = Field(
        default="",
        serialization_alias="authorGithub",
        validation_alias=AliasChoices("authorGithub", "author_github"),
    )
    contact: str = Field(default="")
    extra: str = Field(default="")
    stars: int | None = Field(default=None, ge=0)
    owner_login: str | None = Field(
        default=None,
        serialization_alias="ownerLogin",
        validation_alias=AliasChoices("ownerLogin", "owner_login"),
    )
    owner_avatar: str | None = Field(
        default=None,
        serialization_alias="ownerAvatar",
        validation_alias=AliasChoices("ownerAvatar", "owner_avatar"),
    )
    author_login: str | None = Field(
        default=None,
        serialization_alias="authorLogin",
        validation_alias=AliasChoices("authorLogin", "author_login"),
    )
    author_avatar: str | None = Field(
        default=None,
        serialization_alias="authorAvatar",
        validation_alias=AliasChoices("authorAvatar", "author_avatar"),
    )
    repo_updated_at: str | None = Field(
        default=None,
        serialization_alias="repoUpdatedAt",
        validation_alias=AliasChoices("repoUpdatedAt", "repo_updated_at"),
    )
    updated_at: str | None = Field(
        default=None,
        serialization_alias="updatedAt",
        validation_alias=AliasChoices("updatedAt", "updated_at"),
    )
    license: str = Field(default="")


class IluGalleryEntry(IluGalleryBaseModel):
    id: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    summary: str | None = Field(default=None)
    attention_notes: list[str] = Field(
        default_factory=list,
        serialization_alias="attentionNotes",
        validation_alias=AliasChoices("attentionNotes", "attention_notes"),
    )
    owner: str = Field(..., min_length=1)
    repo: str = Field(..., min_length=1)
    path: str | None = Field(default=None)
    branch: str | None = Field(default=None)
    urdf_path: str | None = Field(
        default=None,
        serialization_alias="urdfPath",
        validation_alias=AliasChoices("urdfPath", "urdf_path"),
    )
    source_file: str | None = Field(
        default=None,
        serialization_alias="sourceFile",
        validation_alias=AliasChoices("sourceFile", "source_file"),
    )
    thumbnail_url: str | None = Field(
        default=None,
        serialization_alias="thumbnailUrl",
        validation_alias=AliasChoices("thumbnailUrl", "thumbnail_url"),
    )
    preview_url: str | None = Field(
        default=None,
        serialization_alias="previewUrl",
        validation_alias=AliasChoices("previewUrl", "preview_url"),
    )
    video_url: str | None = Field(
        default=None,
        serialization_alias="videoUrl",
        validation_alias=AliasChoices("videoUrl", "video_url"),
    )
    gallery_repo_key: str | None = Field(
        default=None,
        serialization_alias="galleryRepoKey",
        validation_alias=AliasChoices("galleryRepoKey", "gallery_repo_key"),
    )
    gallery_file_base: str | None = Field(
        default=None,
        serialization_alias="galleryFileBase",
        validation_alias=AliasChoices("galleryFileBase", "gallery_file_base"),
    )
    macro_tags: list[str] = Field(
        default_factory=list,
        serialization_alias="macroTags",
        validation_alias=AliasChoices("macroTags", "macro_tags"),
    )
    mesh_count: int | None = Field(
        default=None,
        ge=0,
        serialization_alias="meshCount",
        validation_alias=AliasChoices("meshCount", "mesh_count"),
    )
    link_count: int | None = Field(
        default=None,
        ge=0,
        serialization_alias="linkCount",
        validation_alias=AliasChoices("linkCount", "link_count"),
    )
    joint_count: int | None = Field(
        default=None,
        ge=0,
        serialization_alias="jointCount",
        validation_alias=AliasChoices("jointCount", "joint_count"),
    )
    arm_count: int | None = Field(
        default=None,
        ge=0,
        serialization_alias="armCount",
        validation_alias=AliasChoices("armCount", "arm_count"),
    )
    leg_count: int | None = Field(
        default=None,
        ge=0,
        serialization_alias="legCount",
        validation_alias=AliasChoices("legCount", "leg_count"),
    )
    wheel_count: int | None = Field(
        default=None,
        ge=0,
        serialization_alias="wheelCount",
        validation_alias=AliasChoices("wheelCount", "wheel_count"),
    )
    robot_traits: IluGalleryRobotTraits | None = Field(
        default=None,
        serialization_alias="robotTraits",
        validation_alias=AliasChoices("robotTraits", "robot_traits"),
    )
    tags: list[str] = Field(default_factory=list)


class IluGalleryRepoPreviewResponse(IluGalleryBaseModel):
    source: IluGallerySource
    published_repo: IluGalleryPublishedRepo | None = Field(
        default=None,
        serialization_alias="publishedRepo",
        validation_alias=AliasChoices("publishedRepo", "published_repo"),
    )
    items: list[IluGalleryEntry] = Field(default_factory=list)


class IluGalleryRepoPreviewCandidate(IluGalleryBaseModel):
    path: str = Field(..., min_length=1)
    name: str | None = Field(default=None)
    display_name: str | None = Field(
        default=None,
        serialization_alias="displayName",
        validation_alias=AliasChoices("displayName", "display_name"),
    )
    file_base: str | None = Field(
        default=None,
        serialization_alias="fileBase",
        validation_alias=AliasChoices("fileBase", "file_base"),
    )
    source_file: str | None = Field(
        default=None,
        serialization_alias="sourceFile",
        validation_alias=AliasChoices("sourceFile", "source_file"),
    )
    has_meshes_folder: bool | None = Field(
        default=None,
        serialization_alias="hasMeshesFolder",
        validation_alias=AliasChoices("hasMeshesFolder", "has_meshes_folder"),
    )
    meshes_folder_path: str | None = Field(
        default=None,
        serialization_alias="meshesFolderPath",
        validation_alias=AliasChoices("meshesFolderPath", "meshes_folder_path"),
    )
    is_xacro: bool | None = Field(
        default=None,
        serialization_alias="isXacro",
        validation_alias=AliasChoices("isXacro", "is_xacro"),
    )
    inspection_mode: str | None = Field(
        default=None,
        serialization_alias="inspectionMode",
        validation_alias=AliasChoices("inspectionMode", "inspection_mode"),
    )
    has_renderable_geometry: bool | None = Field(
        default=None,
        serialization_alias="hasRenderableGeometry",
        validation_alias=AliasChoices("hasRenderableGeometry", "has_renderable_geometry"),
    )
    unresolved_mesh_reference_count: int | None = Field(
        default=None,
        ge=0,
        serialization_alias="unresolvedMeshReferenceCount",
        validation_alias=AliasChoices("unresolvedMeshReferenceCount", "unresolved_mesh_reference_count"),
    )


class IluGalleryRepoPreviewRequest(IluGalleryBaseModel):
    source: IluGallerySource
    candidates: list[IluGalleryRepoPreviewCandidate] = Field(default_factory=list)


class IluGalleryJobCreateRequest(IluGalleryBaseModel):
    source: IluGallerySource


class IluGalleryJobGenerateRequest(IluGalleryBaseModel):
    mode: IluGalleryGenerateMode = Field(...)
    item_ids: list[str] = Field(
        default_factory=list,
        serialization_alias="itemIds",
        validation_alias=AliasChoices("itemIds", "item_ids"),
    )
    asset_kinds: list[IluGalleryGenerateAssetKind] = Field(
        default_factory=lambda: ["image", "video"],
        serialization_alias="assetKinds",
        validation_alias=AliasChoices("assetKinds", "asset_kinds"),
    )


class IluGalleryItemMetadataUpdate(IluGalleryBaseModel):
    id: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)


class IluGalleryJobMetadataUpdateRequest(IluGalleryBaseModel):
    repo_metadata: IluGalleryRepoMetadata = Field(
        ...,
        serialization_alias="repoMetadata",
        validation_alias=AliasChoices("repoMetadata", "repo_metadata"),
    )
    items: list[IluGalleryItemMetadataUpdate] = Field(default_factory=list)


class IluGalleryJobProgress(IluGalleryBaseModel):
    completed: int = Field(default=0, ge=0)
    total: int = Field(default=0, ge=0)
    percent: int = Field(default=0, ge=0, le=PERCENT_COMPLETE)
    current_stage: IluGalleryProgressStage | None = Field(
        default=None,
        serialization_alias="currentStage",
        validation_alias=AliasChoices("currentStage", "current_stage"),
    )
    current_step: int | None = Field(
        default=None,
        ge=FIRST_PROGRESS_STEP,
        serialization_alias="currentStep",
        validation_alias=AliasChoices("currentStep", "current_step"),
    )
    current_item_id: str | None = Field(
        default=None,
        serialization_alias="currentItemId",
        validation_alias=AliasChoices("currentItemId", "current_item_id"),
    )
    current_asset_kind: str | None = Field(
        default=None,
        serialization_alias="currentAssetKind",
        validation_alias=AliasChoices("currentAssetKind", "current_asset_kind"),
    )
    current_label: str | None = Field(
        default=None,
        serialization_alias="currentLabel",
        validation_alias=AliasChoices("currentLabel", "current_label"),
    )


class IluGalleryJobResponse(IluGalleryBaseModel):
    job_id: str = Field(..., min_length=1, serialization_alias="jobId")
    status: IluGalleryJobStatus
    phase: IluGalleryJobPhase = Field(default="inspect")
    source: IluGallerySource
    repo_metadata: IluGalleryRepoMetadata = Field(
        default_factory=IluGalleryRepoMetadata,
        serialization_alias="repoMetadata",
        validation_alias=AliasChoices("repoMetadata", "repo_metadata"),
    )
    published_repo: IluGalleryPublishedRepo | None = Field(
        default=None,
        serialization_alias="publishedRepo",
        validation_alias=AliasChoices("publishedRepo", "published_repo"),
    )
    items: list[IluGalleryEntry] = Field(default_factory=list)
    progress: IluGalleryJobProgress | None = Field(default=None)
    error: str | None = Field(default=None)
    created_at: datetime = Field(..., serialization_alias="createdAt")
    updated_at: datetime = Field(..., serialization_alias="updatedAt")


class IluGalleryPrDraftFile(IluGalleryBaseModel):
    path: str = Field(..., min_length=1)
    content: str = Field(..., min_length=1)
    encoding: Literal["utf-8", "base64"] = Field(default="utf-8")
    media_type: str | None = Field(
        default=None,
        serialization_alias="mediaType",
        validation_alias=AliasChoices("mediaType", "media_type"),
    )


class IluGalleryPrDraftResponse(IluGalleryBaseModel):
    title: str = Field(..., min_length=1)
    body: str = Field(..., min_length=1)
    branch_name: str = Field(
        ...,
        min_length=1,
        serialization_alias="branchName",
        validation_alias=AliasChoices("branchName", "branch_name"),
    )
    repo_slug: str = Field(
        ...,
        min_length=1,
        serialization_alias="repoSlug",
        validation_alias=AliasChoices("repoSlug", "repo_slug"),
    )
    files: list[IluGalleryPrDraftFile] = Field(default_factory=list)


class IluGalleryPublishResponse(IluGalleryBaseModel):
    title: str = Field(..., min_length=1)
    repo_slug: str = Field(
        ...,
        min_length=1,
        serialization_alias="repoSlug",
        validation_alias=AliasChoices("repoSlug", "repo_slug"),
    )
    branch_name: str = Field(
        ...,
        min_length=1,
        serialization_alias="branchName",
        validation_alias=AliasChoices("branchName", "branch_name"),
    )
    base_branch: str = Field(
        ...,
        min_length=1,
        serialization_alias="baseBranch",
        validation_alias=AliasChoices("baseBranch", "base_branch"),
    )
    pull_request_number: int = Field(
        ...,
        ge=1,
        serialization_alias="pullRequestNumber",
        validation_alias=AliasChoices("pullRequestNumber", "pull_request_number"),
    )
    pull_request_url: str = Field(
        ...,
        min_length=1,
        serialization_alias="pullRequestUrl",
        validation_alias=AliasChoices("pullRequestUrl", "pull_request_url"),
    )
    files_changed: int = Field(
        ...,
        ge=0,
        serialization_alias="filesChanged",
        validation_alias=AliasChoices("filesChanged", "files_changed"),
    )
    reused_existing_pull_request: bool = Field(
        ...,
        serialization_alias="reusedExistingPullRequest",
        validation_alias=AliasChoices("reusedExistingPullRequest", "reused_existing_pull_request"),
    )
