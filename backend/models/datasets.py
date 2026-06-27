from __future__ import annotations

from typing import Annotated, Literal, Optional

from pydantic import BaseModel, Field

from backend.models.dataset_alignment import DatasetRepresentationValidationResponse
from backend.services.dataset_alignment_params import (
    DEFAULT_SEMANTIC_REPRESENTATION_ID,
    NAMING_STATUS_NAMED,
    NAMING_STATUS_UNNAMED,
)


NonEmptyDatasetValue = Annotated[str, Field(min_length=1)]
DatasetMixJobStatus = Literal["rejected", "queued", "running", "succeeded", "failed"]
DatasetMixExecutionMode = Literal["native-local-lerobot", "subprocess-compat"]
DatasetMixPartitionStrategy = Literal["episode-window"]


class DatasetMixRequest(BaseModel):
    repo_ids: list[NonEmptyDatasetValue] = Field(
        default_factory=list,
        description="Hugging Face repo IDs",
    )
    local_paths: list[NonEmptyDatasetValue] = Field(
        default_factory=list,
        description="Local dataset paths under backend allowlisted roots",
    )
    alignment: "DatasetMixAlignmentRequest"


class DatasetTreatmentIssue(BaseModel):
    code: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1)
    dataset_id: str | None = None
    source_id: str | None = None


class DatasetTreatmentSourceManifest(BaseModel):
    source_id: str = Field(..., min_length=1)
    dataset_id: str = Field(..., min_length=1)
    source_kind: Literal["repo", "local", "virtual"]
    source_value: str = Field(..., min_length=1)
    canonical_source: str = Field(..., min_length=1)
    content_fingerprint: str | None = None
    content_fingerprint_kind: Literal["episode-series-v1"] | None = None
    embodiment_id: str | None = None
    representation_id: str = Field(..., min_length=1)
    naming_status: Literal[NAMING_STATUS_NAMED, NAMING_STATUS_UNNAMED]
    profile_id: str = Field(..., min_length=1)
    profile_version: str = Field(..., min_length=1)
    canonical_fingerprint: str | None = None
    normalization_actions: list[str] = Field(default_factory=list)
    duplicate_group_id: str | None = None
    duplicate_group_size: int = Field(default=1, ge=1)
    duplicate_match_kind: Literal["exact", "normalized"] | None = None


class DatasetTreatmentStats(BaseModel):
    total_sources: int = Field(default=0, ge=0)
    repo_source_count: int = Field(default=0, ge=0)
    local_source_count: int = Field(default=0, ge=0)
    unique_canonical_sources: int = Field(default=0, ge=0)
    duplicate_group_count: int = Field(default=0, ge=0)
    exact_duplicate_group_count: int = Field(default=0, ge=0)
    normalized_duplicate_group_count: int = Field(default=0, ge=0)
    alignment_error_count: int = Field(default=0, ge=0)
    alignment_warning_count: int = Field(default=0, ge=0)
    unnamed_source_count: int = Field(default=0, ge=0)
    representation_ids: list[str] = Field(default_factory=list)
    embodiment_ids: list[str] = Field(default_factory=list)


class DatasetTreatmentManifest(BaseModel):
    manifest_version: str = Field(..., min_length=1)
    required_representation_id: str = Field(..., min_length=1)
    sources: list[DatasetTreatmentSourceManifest] = Field(default_factory=list)
    normalization_actions: list[str] = Field(default_factory=list)
    warnings: list[DatasetTreatmentIssue] = Field(default_factory=list)
    errors: list[DatasetTreatmentIssue] = Field(default_factory=list)
    stats: DatasetTreatmentStats


class DatasetTreatmentAnalysisResponse(BaseModel):
    success: bool
    warnings: list[str] = Field(default_factory=list)
    error: Optional[str] = None
    alignment: Optional[DatasetRepresentationValidationResponse] = None
    treatment_manifest: DatasetTreatmentManifest


class DatasetLocalExportResponse(BaseModel):
    dataset_path: str = Field(..., alias="datasetPath")
    dataset_name: str = Field(..., alias="datasetName")
    file_count: int = Field(..., ge=0, alias="fileCount")


class DatasetMixArtifactRef(BaseModel):
    store_kind: Literal["local"]
    object_path: str = Field(..., min_length=1)
    uri: str | None = None


class DatasetMixSourceRef(BaseModel):
    source_id: str = Field(..., min_length=1)
    dataset_id: str = Field(..., min_length=1)
    source_kind: Literal["repo", "local", "virtual"]
    source_value: str = Field(..., min_length=1)
    canonical_source: str = Field(..., min_length=1)


class DatasetMixExecutionPlan(BaseModel):
    execution_mode: DatasetMixExecutionMode
    reason: str = Field(..., min_length=1)


class DatasetMixPartitionPlan(BaseModel):
    strategy: DatasetMixPartitionStrategy
    target_episodes_per_partition: int = Field(..., ge=1)
    target_frames_per_partition: int = Field(..., ge=1)


class DatasetMixPartitionTask(BaseModel):
    task_index: int = Field(..., ge=0)
    task_name: str = Field(..., min_length=1)


class DatasetMixPartitionRef(BaseModel):
    partition_id: str = Field(..., min_length=1)
    source_ids: list[str] = Field(default_factory=list)
    task_indices: list[int] = Field(default_factory=list)
    episode_from_index: int = Field(..., ge=0)
    episode_to_index: int = Field(..., ge=0)
    frame_from_index: int = Field(..., ge=0)
    frame_to_index: int = Field(..., ge=0)
    episode_count: int = Field(..., ge=0)
    frame_count: int = Field(..., ge=0)
    episodes_artifact_path: str = Field(..., min_length=1)
    data_artifact_path: str = Field(..., min_length=1)


class DatasetMixPartitionManifest(BaseModel):
    manifest_version: str = Field(..., min_length=1)
    partition_plan: DatasetMixPartitionPlan
    tasks: list[DatasetMixPartitionTask] = Field(default_factory=list)
    representation_id: str = Field(..., min_length=1)
    naming_status: str = Field(..., min_length=1)
    robot_type: str = Field(..., min_length=1)
    embodiment_id: str | None = None
    fps: float
    features: dict[str, object] = Field(default_factory=dict)
    partitions: list[DatasetMixPartitionRef] = Field(default_factory=list)


class DatasetMixJobManifest(BaseModel):
    manifest_version: str = Field(..., min_length=1)
    job_type: Literal["mix"] = "mix"
    required_representation_id: str = Field(..., min_length=1)
    sources: list[DatasetMixSourceRef] = Field(default_factory=list)
    execution_plan: DatasetMixExecutionPlan
    partition_plan: DatasetMixPartitionPlan | None = None
    alignment: DatasetRepresentationValidationResponse | None = None
    treatment_manifest: DatasetTreatmentManifest
    output_artifact: DatasetMixArtifactRef


class DatasetMixResponse(BaseModel):
    job_id: str = Field(..., min_length=1)
    job_type: Literal["mix"] = "mix"
    status: DatasetMixJobStatus
    created_at: str = Field(..., min_length=1)
    updated_at: str = Field(..., min_length=1)
    started_at: str | None = None
    completed_at: str | None = None
    success: bool
    message: Optional[str] = None
    output_path: Optional[str] = None
    output_artifact: DatasetMixArtifactRef | None = None
    manifest_artifact: DatasetMixArtifactRef | None = None
    execution_plan: DatasetMixExecutionPlan | None = None
    partition_plan: DatasetMixPartitionPlan | None = None
    error: Optional[str] = None
    warnings: list[str] = Field(default_factory=list)
    alignment: Optional[DatasetRepresentationValidationResponse] = None
    treatment_manifest: DatasetTreatmentManifest | None = None
    source_refs: list[DatasetMixSourceRef] = Field(default_factory=list)


class DatasetMixAlignmentRequest(BaseModel):
    datasets: list["DatasetMixAlignmentDataset"] = Field(default_factory=list)
    required_representation_id: str = Field(
        default=DEFAULT_SEMANTIC_REPRESENTATION_ID,
        min_length=1,
    )


class DatasetContentSignatureFrame(BaseModel):
    timestamp: float
    joints: dict[NonEmptyDatasetValue, float] = Field(default_factory=dict)


class DatasetContentSignatureEpisode(BaseModel):
    episode_index: int = Field(default=0)
    frames: list[DatasetContentSignatureFrame] = Field(default_factory=list)


class DatasetContentSignature(BaseModel):
    kind: Literal["episode-series-v1"]
    episodes: list[DatasetContentSignatureEpisode] = Field(default_factory=list)


class DatasetMixAlignmentDataset(BaseModel):
    dataset_id: str = Field(..., min_length=1)
    embodiment_id: Optional[str] = None
    representation_id: str = Field(..., min_length=1)
    naming_status: Literal[NAMING_STATUS_NAMED, NAMING_STATUS_UNNAMED] = (
        NAMING_STATUS_NAMED
    )
    content_fingerprint: str | None = None
    content_fingerprint_kind: Literal["episode-series-v1"] | None = None
    content_signature: DatasetContentSignature | None = None
