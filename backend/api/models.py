"""Models API router.

Provides endpoints for model export operations.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from backend.services.model_export import get_export_service

router = APIRouter(prefix="/models", tags=["models"])


class HFExportRequest(BaseModel):
    """Request body for HuggingFace export."""

    run_id: str
    checkpoint_name: str = "final_model"
    repo_id: str
    commit_message: Optional[str] = None


class HFExportResponse(BaseModel):
    """Response body for HuggingFace export."""

    success: bool
    repo_url: Optional[str] = None
    commit_hash: Optional[str] = None
    error: Optional[str] = None


@router.post("/export/hf", response_model=HFExportResponse)
async def export_to_huggingface(request: HFExportRequest) -> HFExportResponse:
    """Export a trained checkpoint to HuggingFace Hub.

    Creates a model bundle with:
    - Model weights (safetensors/pytorch)
    - config.json
    - training_config.json
    - dataset_ref.json
    - urdf_hash.txt (if available)
    - README.md (model card)

    Args:
        request: Export request with run_id, checkpoint, and repo details

    Returns:
        HFExportResponse with success status, repo URL and commit hash
    """
    service = get_export_service()

    result = await service.export_to_hf(
        run_id=request.run_id,
        checkpoint_name=request.checkpoint_name,
        repo_id=request.repo_id,
        commit_message=request.commit_message,
    )

    if not result.success:
        # Return error in response body, not HTTP error
        return HFExportResponse(
            success=False,
            error=result.error,
        )

    return HFExportResponse(
        success=True,
        repo_url=result.repo_url,
        commit_hash=result.commit_hash,
    )
