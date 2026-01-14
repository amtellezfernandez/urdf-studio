from __future__ import annotations

from fastapi import APIRouter

from backend.models.visualization import RerunVisualizeRequest, RerunVisualizeResponse
from backend.services.visualization import run_rerun_visualization

router = APIRouter(prefix="/rerun", tags=["rerun"])


@router.post("/visualize", response_model=RerunVisualizeResponse)
def rerun_visualize(req: RerunVisualizeRequest) -> RerunVisualizeResponse:
    """Visualize robot episode using Rerun viewer."""
    return run_rerun_visualization(req)
