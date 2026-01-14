from __future__ import annotations

from fastapi import APIRouter

from backend.models.health import HealthResponse
from backend.services.health import dependency_health

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return dependency_health()
