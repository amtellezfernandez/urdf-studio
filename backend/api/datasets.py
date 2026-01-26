from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.models.datasets import DatasetMixRequest, DatasetMixResponse
from backend.services.dataset_browser import (
    DatasetInfo,
    DatasetSearchResult,
    get_dataset_browser_service,
)
from backend.services.datasets import mix_datasets

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/datasets", tags=["datasets"])


# ============================================================================
# Response Models for Browse Endpoints
# ============================================================================


class DatasetInfoResponse(BaseModel):
    """Response model for dataset info."""

    repo_id: str = Field(description="HuggingFace repository ID")
    description: Optional[str] = Field(default=None, description="Dataset description")
    downloads: int = Field(default=0, description="Download count")
    likes: int = Field(default=0, description="Like count")
    tags: List[str] = Field(default_factory=list, description="Dataset tags")
    last_modified: Optional[str] = Field(default=None, description="Last modification date")
    num_episodes: Optional[int] = Field(default=None, description="Number of episodes")
    num_frames: Optional[int] = Field(default=None, description="Total number of frames")
    robot_type: Optional[str] = Field(default=None, description="Robot type")
    fps: Optional[int] = Field(default=None, description="Frames per second")


class DatasetListResponse(BaseModel):
    """Response for listing datasets."""

    datasets: List[DatasetInfoResponse] = Field(default_factory=list)
    total: int = Field(default=0, description="Total number of datasets")


class DatasetSearchResponse(BaseModel):
    """Response for searching datasets."""

    datasets: List[DatasetInfoResponse] = Field(default_factory=list)
    total: int = Field(default=0, description="Total number of results")
    query: str = Field(description="Search query used")


# ============================================================================
# Helper Functions
# ============================================================================


def _to_response(info: DatasetInfo) -> DatasetInfoResponse:
    """Convert DatasetInfo to response model."""
    return DatasetInfoResponse(
        repo_id=info.repo_id,
        description=info.description,
        downloads=info.downloads,
        likes=info.likes,
        tags=info.tags,
        last_modified=info.last_modified,
        num_episodes=info.num_episodes,
        num_frames=info.num_frames,
        robot_type=info.robot_type,
        fps=info.fps,
    )


# ============================================================================
# Browse Endpoints
# ============================================================================


@router.get("/browse", response_model=DatasetListResponse)
async def browse_datasets() -> DatasetListResponse:
    """List popular LeRobot datasets.

    Returns a curated list of popular datasets from the LeRobot collection,
    including PushT, ALOHA, LIBERO, and xArm datasets.
    """
    try:
        service = get_dataset_browser_service()
        datasets = await service.list_popular_datasets()

        return DatasetListResponse(
            datasets=[_to_response(d) for d in datasets],
            total=len(datasets),
        )
    except Exception as e:
        logger.error(f"Failed to browse datasets: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to browse datasets: {e}")


@router.get("/search", response_model=DatasetSearchResponse)
async def search_datasets(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(default=20, ge=1, le=100, description="Maximum results"),
    author: Optional[str] = Query(default=None, description="Filter by author (e.g., 'lerobot')"),
) -> DatasetSearchResponse:
    """Search for datasets on HuggingFace.

    Search the HuggingFace Hub for datasets matching the query.
    Use the 'author' parameter to filter by organization (e.g., 'lerobot').
    """
    try:
        service = get_dataset_browser_service()
        result = await service.search_datasets(query=q, limit=limit, author=author)

        return DatasetSearchResponse(
            datasets=[_to_response(d) for d in result.datasets],
            total=result.total,
            query=result.query,
        )
    except Exception as e:
        logger.error(f"Failed to search datasets: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to search datasets: {e}")


@router.get("/{repo_id:path}/info", response_model=DatasetInfoResponse)
async def get_dataset_info(repo_id: str) -> DatasetInfoResponse:
    """Get detailed info for a specific dataset.

    Retrieves metadata about a dataset including LeRobot-specific
    information like episode count, frame count, and robot type.

    Args:
        repo_id: HuggingFace dataset ID (e.g., 'lerobot/pusht')
    """
    try:
        service = get_dataset_browser_service()
        info = await service.get_dataset_info(repo_id)

        if not info:
            raise HTTPException(status_code=404, detail=f"Dataset not found: {repo_id}")

        return _to_response(info)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get dataset info: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get dataset info: {e}")


# ============================================================================
# Existing Endpoints
# ============================================================================


@router.post("/mix", response_model=DatasetMixResponse)
def datasets_mix(req: DatasetMixRequest) -> DatasetMixResponse:
    """Mix multiple robot learning datasets."""
    return mix_datasets(req)
