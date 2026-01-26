"""Experiments API endpoints.

This module provides REST API endpoints for:
- Creating and managing experiments
- Listing experiments with filtering
- Getting experiment details with runs
- Resolving HuggingFace dataset revisions
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from backend.models.experiments import (
    ExperimentCreate,
    ExperimentCreateResponse,
    ExperimentDetail,
    ExperimentListResponse,
    ExperimentResponse,
    ExperimentUpdate,
    JobSummary,
)
from backend.services.experiments import get_experiments_service
from backend.services.hf_resolver import (
    get_dataset_metadata,
    resolve_dataset_revision,
    validate_dataset_exists,
)

router = APIRouter(prefix="/experiments", tags=["experiments"])


# ============================================================================
# Experiment CRUD Endpoints
# ============================================================================


@router.post("", response_model=ExperimentCreateResponse)
async def create_experiment(request: ExperimentCreate) -> ExperimentCreateResponse:
    """Create a new experiment.

    This endpoint:
    1. Validates the experiment configuration
    2. Resolves HuggingFace dataset revision to commit SHA (if applicable)
    3. Creates the experiment record

    HuggingFace datasets are automatically pinned to a specific commit SHA
    for reproducibility.
    """
    service = get_experiments_service()
    return await service.create_experiment(request)


@router.get("", response_model=ExperimentListResponse)
async def list_experiments(
    page: int = Query(default=1, ge=1, description="Page number"),
    page_size: int = Query(default=20, ge=1, le=100, description="Items per page"),
    search: Optional[str] = Query(default=None, description="Search in name/description"),
    tags: Optional[str] = Query(default=None, description="Comma-separated tags to filter by"),
) -> ExperimentListResponse:
    """List experiments with pagination.

    Supports filtering by:
    - Search query (matches name and description)
    - Tags (comma-separated list)

    Results are sorted by creation date (newest first).
    """
    service = get_experiments_service()

    tag_list = None
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]

    return await service.list_experiments(
        page=page,
        page_size=page_size,
        search=search,
        tags=tag_list,
    )


@router.get("/{experiment_id}", response_model=ExperimentDetail)
async def get_experiment(experiment_id: str) -> ExperimentDetail:
    """Get experiment details including training runs.

    Returns:
    - Experiment metadata
    - List of training runs (jobs) in this experiment
    - List of evaluation results
    """
    service = get_experiments_service()
    experiment = await service.get_experiment(experiment_id)

    if not experiment:
        raise HTTPException(
            status_code=404,
            detail=f"Experiment not found: {experiment_id}",
        )

    return experiment


@router.patch("/{experiment_id}", response_model=ExperimentResponse)
async def update_experiment(
    experiment_id: str,
    request: ExperimentUpdate,
) -> ExperimentResponse:
    """Update an experiment.

    Only the following fields can be updated:
    - name
    - description
    - notes
    - tags

    Dataset configuration cannot be changed after creation.
    """
    service = get_experiments_service()

    try:
        result = await service.update_experiment(experiment_id, request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"Experiment not found: {experiment_id}",
        )

    return result


@router.delete("/{experiment_id}")
async def delete_experiment(experiment_id: str) -> dict:
    """Delete an experiment.

    This will:
    - Unlink all jobs from the experiment (jobs are NOT deleted)
    - Delete the experiment record

    Returns success status.
    """
    service = get_experiments_service()
    deleted = await service.delete_experiment(experiment_id)

    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=f"Experiment not found: {experiment_id}",
        )

    return {
        "success": True,
        "message": f"Experiment {experiment_id} deleted",
    }


# ============================================================================
# Job-Experiment Linking
# ============================================================================


@router.post("/{experiment_id}/jobs/{job_id}")
async def link_job_to_experiment(
    experiment_id: str,
    job_id: str,
) -> dict:
    """Link a job to an experiment.

    This associates an existing training job with an experiment.
    Jobs can only belong to one experiment at a time.
    """
    service = get_experiments_service()

    # Verify experiment exists
    experiment = await service.get_experiment(experiment_id)
    if not experiment:
        raise HTTPException(
            status_code=404,
            detail=f"Experiment not found: {experiment_id}",
        )

    # Link the job
    linked = await service.link_job_to_experiment(job_id, experiment_id)

    if not linked:
        raise HTTPException(
            status_code=404,
            detail=f"Job not found: {job_id}",
        )

    return {
        "success": True,
        "message": f"Job {job_id} linked to experiment {experiment_id}",
    }


@router.get("/unassigned/jobs", response_model=List[JobSummary])
async def get_unassigned_jobs(
    limit: int = Query(default=50, ge=1, le=200, description="Maximum jobs to return"),
) -> List[JobSummary]:
    """Get jobs that are not assigned to any experiment.

    These are "legacy" jobs or jobs that were started without
    specifying an experiment.
    """
    service = get_experiments_service()
    return await service.get_unassigned_jobs(limit=limit)


# ============================================================================
# HuggingFace Dataset Resolution
# ============================================================================


@router.get("/hf/resolve")
async def resolve_hf_revision(
    repo_id: str = Query(description="HuggingFace dataset repository ID"),
    revision: Optional[str] = Query(default=None, description="Revision (branch/tag/sha)"),
) -> dict:
    """Resolve a HuggingFace dataset revision to a commit SHA.

    This is useful for:
    - Pinning datasets to specific versions
    - Ensuring reproducibility across training runs
    - Validating dataset references

    Returns the resolved commit SHA that can be used for training.
    """
    try:
        sha = await resolve_dataset_revision(repo_id, revision)
        return {
            "repo_id": repo_id,
            "requested_revision": revision or "main",
            "resolved_sha": sha,
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/hf/validate")
async def validate_hf_dataset(
    repo_id: str = Query(description="HuggingFace dataset repository ID"),
) -> dict:
    """Validate that a HuggingFace dataset exists.

    Returns whether the dataset is accessible.
    """
    exists = await validate_dataset_exists(repo_id)
    return {
        "repo_id": repo_id,
        "exists": exists,
    }


@router.get("/hf/metadata")
async def get_hf_metadata(
    repo_id: str = Query(description="HuggingFace dataset repository ID"),
    revision: Optional[str] = Query(default=None, description="Revision"),
) -> dict:
    """Get metadata for a HuggingFace dataset.

    Returns information including:
    - Commit SHA
    - Author
    - Creation/modification dates
    - Download count
    - Tags
    """
    metadata = await get_dataset_metadata(repo_id, revision)

    if metadata.get("error"):
        raise HTTPException(
            status_code=404,
            detail=metadata.get("error"),
        )

    return metadata
