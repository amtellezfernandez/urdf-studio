"""Pydantic models for experiments API.

These models define the request/response schema for the experiments endpoints,
supporting grouping of training runs and HuggingFace dataset revision pinning.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from backend.models.training import DatasetConfig, DatasetSource


# ============================================================================
# Request Models
# ============================================================================


class ExperimentCreate(BaseModel):
    """Request to create a new experiment."""

    name: str = Field(
        description="Unique experiment name",
        min_length=1,
        max_length=255,
    )
    description: Optional[str] = Field(
        default=None,
        description="Experiment description",
    )
    notes: Optional[str] = Field(
        default=None,
        description="Additional notes (markdown supported)",
    )
    tags: Optional[List[str]] = Field(
        default=None,
        description="Tags for categorization",
    )
    dataset: DatasetConfig = Field(
        description="Dataset configuration",
    )
    robot_name: Optional[str] = Field(
        default=None,
        description="Robot name for lineage tracking",
    )
    urdf_hash: Optional[str] = Field(
        default=None,
        description="URDF content hash for lineage tracking",
    )
    environment_config: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Environment configuration (for future use)",
    )


class ExperimentUpdate(BaseModel):
    """Request to update an experiment."""

    name: Optional[str] = Field(
        default=None,
        description="New experiment name",
        min_length=1,
        max_length=255,
    )
    description: Optional[str] = Field(
        default=None,
        description="New description",
    )
    notes: Optional[str] = Field(
        default=None,
        description="Updated notes",
    )
    tags: Optional[List[str]] = Field(
        default=None,
        description="Updated tags",
    )


# ============================================================================
# Response Models
# ============================================================================


class JobSummary(BaseModel):
    """Summary of a training job for experiment listing."""

    job_id: str = Field(description="Job identifier")
    status: str = Field(description="Job status")
    run_name: Optional[str] = Field(default=None, description="Run name")
    model_architecture: Optional[str] = Field(default=None, description="Model architecture")
    started_at: Optional[str] = Field(default=None, description="Start timestamp")
    finished_at: Optional[str] = Field(default=None, description="End timestamp")
    compute_backend: str = Field(default="local", description="Compute backend")


class EvaluationSummary(BaseModel):
    """Summary of an evaluation run."""

    eval_id: str = Field(description="Evaluation identifier")
    job_id: str = Field(description="Related job ID")
    checkpoint: str = Field(description="Checkpoint used")
    num_episodes: int = Field(description="Number of episodes")
    success_rate: Optional[float] = Field(default=None, description="Success rate")
    created_at: str = Field(description="Evaluation timestamp")


class ExperimentResponse(BaseModel):
    """Response for experiment listing."""

    id: str = Field(description="Experiment ID")
    name: str = Field(description="Experiment name")
    description: Optional[str] = Field(default=None, description="Description")
    notes: Optional[str] = Field(default=None, description="Notes")
    tags: Optional[List[str]] = Field(default=None, description="Tags")
    dataset_source: str = Field(description="Dataset source type")
    dataset_repo_id: Optional[str] = Field(default=None, description="HuggingFace repo ID")
    dataset_local_path: Optional[str] = Field(default=None, description="Local dataset path")
    dataset_version: Optional[str] = Field(default=None, description="Dataset version/revision")
    dataset_resolved_revision: Optional[str] = Field(
        default=None,
        description="Resolved HF commit SHA",
    )
    robot_name: Optional[str] = Field(default=None, description="Robot name")
    run_count: int = Field(default=0, description="Number of training runs")
    created_at: str = Field(description="Creation timestamp")
    updated_at: str = Field(description="Last update timestamp")


class ExperimentDetail(ExperimentResponse):
    """Detailed experiment response with runs and evaluations."""

    runs: List[JobSummary] = Field(
        default_factory=list,
        description="Training runs in this experiment",
    )
    evaluations: List[EvaluationSummary] = Field(
        default_factory=list,
        description="Evaluation runs for this experiment",
    )
    environment_config: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Environment configuration",
    )
    urdf_hash: Optional[str] = Field(default=None, description="URDF hash")


class ExperimentListResponse(BaseModel):
    """Paginated list of experiments."""

    experiments: List[ExperimentResponse] = Field(
        default_factory=list,
        description="List of experiments",
    )
    total: int = Field(default=0, description="Total count")
    page: int = Field(default=1, description="Current page")
    page_size: int = Field(default=20, description="Page size")


class ExperimentCreateResponse(BaseModel):
    """Response after creating an experiment."""

    success: bool = Field(description="Whether creation succeeded")
    experiment: Optional[ExperimentResponse] = Field(
        default=None,
        description="Created experiment",
    )
    message: str = Field(description="Status message")
    resolved_revision: Optional[str] = Field(
        default=None,
        description="Resolved HF dataset revision (commit SHA)",
    )
