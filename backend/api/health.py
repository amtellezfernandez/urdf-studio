from __future__ import annotations

import os
from fastapi import APIRouter

from backend.models.health import HealthResponse
from backend.services.health import dependency_health

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return dependency_health()


@router.get("/version")
def version() -> dict:
    build = (
        os.getenv("URDF_STUDIO_BUILD_SHA")
        or os.getenv("VERCEL_GIT_COMMIT_SHA")
        or os.getenv("GITHUB_SHA")
        or os.getenv("CF_PAGES_COMMIT_SHA")
        or os.getenv("SOURCE_VERSION")
        or "dev"
    )
    return {"service": "backend", "build": build}
