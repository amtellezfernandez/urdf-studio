"""Evaluation API endpoints.

This module provides REST API endpoints for:
- Starting evaluations
- Listing and retrieving evaluations
- Getting episode data
- Deleting evaluations
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from backend.models.evaluations import (
    EpisodeResult,
    EvaluationCreate,
    EvaluationDetail,
    EvaluationListResponse,
    EvaluationResponse,
)
from backend.services import evaluations as evaluations_service

router = APIRouter(prefix="/evaluations", tags=["evaluations"])


# ============================================================================
# Evaluation Endpoints
# ============================================================================


@router.post("/runs/{run_id}/evaluate", response_model=EvaluationResponse)
async def start_evaluation(
    run_id: str,
    request: EvaluationCreate,
    experiment_id: Optional[str] = Query(default=None, description="Associated experiment ID"),
) -> EvaluationResponse:
    """Start a new evaluation for a training run.

    This endpoint:
    1. Creates an evaluation record in the database
    2. Starts the evaluation in the background
    3. Returns immediately with the evaluation ID

    The evaluation runs asynchronously. Use GET /evaluations/{id} to monitor progress.
    """
    return await evaluations_service.start_evaluation(
        run_id=run_id,
        request=request,
        experiment_id=experiment_id,
    )


@router.get("", response_model=EvaluationListResponse)
async def list_evaluations(
    run_id: Optional[str] = Query(default=None, description="Filter by run ID"),
    experiment_id: Optional[str] = Query(default=None, description="Filter by experiment ID"),
    status: Optional[str] = Query(default=None, description="Filter by status"),
    limit: int = Query(default=50, ge=1, le=100, description="Maximum results"),
    offset: int = Query(default=0, ge=0, description="Results offset"),
) -> EvaluationListResponse:
    """List evaluations with optional filters.

    Returns a list of evaluation summaries, sorted by creation time (newest first).
    """
    return await evaluations_service.list_evaluations(
        run_id=run_id,
        experiment_id=experiment_id,
        status=status,
        limit=limit,
        offset=offset,
    )


@router.get("/{eval_id}", response_model=EvaluationResponse)
async def get_evaluation(eval_id: str) -> EvaluationResponse:
    """Get evaluation by ID.

    Returns:
    - Status and configuration
    - Metrics (if completed)
    - Artifact paths
    """
    result = await evaluations_service.get_evaluation(eval_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Evaluation {eval_id} not found")
    return result


@router.get("/{eval_id}/detail", response_model=EvaluationDetail)
async def get_evaluation_detail(eval_id: str) -> EvaluationDetail:
    """Get detailed evaluation including episode data.

    Returns:
    - Full evaluation info
    - Episode data (loaded from artifact)
    - Environment configuration
    """
    result = await evaluations_service.get_evaluation_detail(eval_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Evaluation {eval_id} not found")
    return result


@router.get("/{eval_id}/episodes", response_model=List[EpisodeResult])
async def get_evaluation_episodes(eval_id: str) -> List[EpisodeResult]:
    """Get episodes for an evaluation.

    Returns the full episode data including:
    - Actions
    - Observations (if available)
    - Rewards (if available)
    - Timestamps
    """
    episodes = await evaluations_service.get_evaluation_episodes(eval_id)
    if episodes is None:
        raise HTTPException(status_code=404, detail=f"Evaluation {eval_id} not found or no episodes available")
    return episodes


@router.get("/{eval_id}/video/{video_index}")
async def get_evaluation_video(eval_id: str, video_index: int = 0) -> FileResponse:
    """Get video file for an evaluation.

    Args:
        eval_id: Evaluation ID
        video_index: Index of video to retrieve (default 0)

    Returns:
        Video file (MP4)
    """
    from pathlib import Path

    result = await evaluations_service.get_evaluation(eval_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Evaluation {eval_id} not found")

    if not result.video_artifact_paths:
        raise HTTPException(status_code=404, detail="No video available for this evaluation")

    if video_index >= len(result.video_artifact_paths):
        raise HTTPException(
            status_code=404,
            detail=f"Video index {video_index} not found. Available: 0-{len(result.video_artifact_paths) - 1}",
        )

    video_path = Path(result.video_artifact_paths[video_index])
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    return FileResponse(
        video_path,
        media_type="video/mp4",
        filename=f"evaluation_{eval_id}_{video_index}.mp4",
    )


@router.delete("/{eval_id}")
async def delete_evaluation(eval_id: str) -> dict:
    """Delete an evaluation.

    This will:
    1. Delete the evaluation record
    2. Delete associated artifacts (episodes JSON, videos)
    """
    deleted = await evaluations_service.delete_evaluation(eval_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Evaluation {eval_id} not found")
    return {"success": True, "message": f"Evaluation {eval_id} deleted"}


# ============================================================================
# Run-scoped Endpoints (alternative paths)
# ============================================================================


@router.get("/runs/{run_id}/evaluations", response_model=EvaluationListResponse)
async def list_run_evaluations(
    run_id: str,
    status: Optional[str] = Query(default=None, description="Filter by status"),
    limit: int = Query(default=50, ge=1, le=100, description="Maximum results"),
) -> EvaluationListResponse:
    """List evaluations for a specific training run."""
    return await evaluations_service.list_evaluations(
        run_id=run_id,
        status=status,
        limit=limit,
    )
