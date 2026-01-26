"""Artifacts API endpoints.

This module provides endpoints for managing training job artifacts,
including uploading, downloading, and listing artifacts.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from fastapi import APIRouter, File, HTTPException, Path, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from backend.services.artifact_storage import (
    ArtifactListItem,
    ArtifactMetadata,
    get_artifact_storage,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


# ============================================================================
# Response Models
# ============================================================================


class ArtifactMetadataResponse(BaseModel):
    """Response model for artifact metadata."""

    job_id: str = Field(description="Training job ID")
    artifact_path: str = Field(description="Path within job artifacts")
    size_bytes: int = Field(description="File size in bytes")
    content_type: str = Field(default="application/octet-stream", description="MIME type")
    created_at: str = Field(description="Creation timestamp")
    checksum: Optional[str] = Field(default=None, description="SHA256 checksum")
    tags: Dict[str, str] = Field(default_factory=dict, description="Metadata tags")


class ArtifactListItemResponse(BaseModel):
    """Response model for artifact list item."""

    path: str = Field(description="Artifact path")
    size_bytes: int = Field(description="File size in bytes")
    last_modified: str = Field(description="Last modification timestamp")
    content_type: str = Field(default="application/octet-stream", description="MIME type")


class ArtifactListResponse(BaseModel):
    """Response for listing artifacts."""

    job_id: str = Field(description="Training job ID")
    artifacts: List[ArtifactListItemResponse] = Field(default_factory=list)
    total: int = Field(default=0, description="Total number of artifacts")


class ArtifactUploadResponse(BaseModel):
    """Response after uploading an artifact."""

    success: bool = Field(description="Whether upload succeeded")
    metadata: Optional[ArtifactMetadataResponse] = Field(
        default=None, description="Artifact metadata"
    )
    error: Optional[str] = Field(default=None, description="Error message if failed")


class ArtifactDeleteResponse(BaseModel):
    """Response after deleting an artifact."""

    success: bool = Field(description="Whether deletion succeeded")
    deleted_count: int = Field(default=0, description="Number of artifacts deleted")


# ============================================================================
# Helper Functions
# ============================================================================


def _metadata_to_response(metadata: ArtifactMetadata) -> ArtifactMetadataResponse:
    """Convert ArtifactMetadata to response model."""
    return ArtifactMetadataResponse(
        job_id=metadata.job_id,
        artifact_path=metadata.artifact_path,
        size_bytes=metadata.size_bytes,
        content_type=metadata.content_type,
        created_at=metadata.created_at,
        checksum=metadata.checksum,
        tags=metadata.tags,
    )


def _item_to_response(item: ArtifactListItem) -> ArtifactListItemResponse:
    """Convert ArtifactListItem to response model."""
    return ArtifactListItemResponse(
        path=item.path,
        size_bytes=item.size_bytes,
        last_modified=item.last_modified,
        content_type=item.content_type,
    )


def _get_content_type(filename: str) -> str:
    """Infer content type from filename."""
    ext = filename.lower().split(".")[-1] if "." in filename else ""

    content_types = {
        "pt": "application/x-pytorch",
        "pth": "application/x-pytorch",
        "safetensors": "application/x-safetensors",
        "ckpt": "application/x-checkpoint",
        "json": "application/json",
        "yaml": "text/yaml",
        "yml": "text/yaml",
        "txt": "text/plain",
        "log": "text/plain",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "mp4": "video/mp4",
        "csv": "text/csv",
        "parquet": "application/x-parquet",
    }

    return content_types.get(ext, "application/octet-stream")


# ============================================================================
# Endpoints
# ============================================================================


@router.get("/{job_id}", response_model=ArtifactListResponse)
async def list_job_artifacts(
    job_id: str = Path(..., description="Training job ID"),
    prefix: Optional[str] = Query(default=None, description="Path prefix filter"),
) -> ArtifactListResponse:
    """List artifacts for a training job.

    Returns a list of all artifacts associated with the specified job.
    Use the 'prefix' parameter to filter by path prefix (e.g., 'checkpoints/').
    """
    try:
        storage = get_artifact_storage()
        items = await storage.list_artifacts(job_id, prefix=prefix)

        return ArtifactListResponse(
            job_id=job_id,
            artifacts=[_item_to_response(item) for item in items],
            total=len(items),
        )
    except Exception as e:
        logger.error(f"Failed to list artifacts for job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list artifacts: {e}")


@router.get("/{job_id}/{artifact_path:path}")
async def download_artifact(
    job_id: str = Path(..., description="Training job ID"),
    artifact_path: str = Path(..., description="Path to artifact within job"),
) -> Response:
    """Download a specific artifact.

    Downloads the artifact file and returns it with the appropriate content type.
    """
    try:
        storage = get_artifact_storage()

        # Get metadata for content type
        metadata = await storage.get_metadata(job_id, artifact_path)
        content_type = (
            metadata.content_type if metadata else _get_content_type(artifact_path)
        )

        # Download the data
        data = await storage.download(job_id, artifact_path)

        # Extract filename from path
        filename = artifact_path.split("/")[-1]

        return Response(
            content=data,
            media_type=content_type,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(len(data)),
            },
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Artifact not found: {job_id}/{artifact_path}",
        )
    except Exception as e:
        logger.error(f"Failed to download artifact {job_id}/{artifact_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to download artifact: {e}")


@router.get("/{job_id}/{artifact_path:path}/metadata", response_model=ArtifactMetadataResponse)
async def get_artifact_metadata(
    job_id: str = Path(..., description="Training job ID"),
    artifact_path: str = Path(..., description="Path to artifact within job"),
) -> ArtifactMetadataResponse:
    """Get metadata for a specific artifact.

    Returns metadata including size, content type, checksum, and tags.
    """
    try:
        storage = get_artifact_storage()
        metadata = await storage.get_metadata(job_id, artifact_path)

        if not metadata:
            raise HTTPException(
                status_code=404,
                detail=f"Artifact not found: {job_id}/{artifact_path}",
            )

        return _metadata_to_response(metadata)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get metadata for {job_id}/{artifact_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get metadata: {e}")


@router.post("/{job_id}/upload", response_model=ArtifactUploadResponse)
async def upload_artifact(
    job_id: str = Path(..., description="Training job ID"),
    file: UploadFile = File(..., description="File to upload"),
    path: Optional[str] = Query(default=None, description="Custom path for artifact"),
) -> ArtifactUploadResponse:
    """Upload an artifact for a training job.

    Uploads a file and stores it as an artifact associated with the job.
    The artifact path defaults to the uploaded filename but can be customized
    using the 'path' parameter.
    """
    try:
        storage = get_artifact_storage()

        # Determine artifact path
        artifact_path = path or file.filename or "unnamed"

        # Get content type
        content_type = file.content_type or _get_content_type(artifact_path)

        # Read file data
        data = await file.read()

        # Upload
        metadata = await storage.upload(
            job_id=job_id,
            artifact_path=artifact_path,
            data=data,
            content_type=content_type,
        )

        logger.info(f"Uploaded artifact: {job_id}/{artifact_path}")

        return ArtifactUploadResponse(
            success=True,
            metadata=_metadata_to_response(metadata),
        )
    except Exception as e:
        logger.error(f"Failed to upload artifact for job {job_id}: {e}")
        return ArtifactUploadResponse(
            success=False,
            error=str(e),
        )


@router.delete("/{job_id}/{artifact_path:path}", response_model=ArtifactDeleteResponse)
async def delete_artifact(
    job_id: str = Path(..., description="Training job ID"),
    artifact_path: str = Path(..., description="Path to artifact within job"),
) -> ArtifactDeleteResponse:
    """Delete a specific artifact.

    Permanently removes the artifact from storage.
    """
    try:
        storage = get_artifact_storage()
        deleted = await storage.delete(job_id, artifact_path)

        return ArtifactDeleteResponse(
            success=deleted,
            deleted_count=1 if deleted else 0,
        )
    except Exception as e:
        logger.error(f"Failed to delete artifact {job_id}/{artifact_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete artifact: {e}")


@router.delete("/{job_id}", response_model=ArtifactDeleteResponse)
async def delete_all_job_artifacts(
    job_id: str = Path(..., description="Training job ID"),
) -> ArtifactDeleteResponse:
    """Delete all artifacts for a training job.

    Permanently removes all artifacts associated with the job.
    This action cannot be undone.
    """
    try:
        storage = get_artifact_storage()
        count = await storage.delete_job_artifacts(job_id)

        return ArtifactDeleteResponse(
            success=True,
            deleted_count=count,
        )
    except Exception as e:
        logger.error(f"Failed to delete artifacts for job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete artifacts: {e}")
