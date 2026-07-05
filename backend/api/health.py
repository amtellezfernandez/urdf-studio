from __future__ import annotations

import os
from typing import Final

from fastapi import APIRouter

from backend.models.health import HealthResponse
from backend.services.health import dependency_health

router = APIRouter()
BUILD_SHA_ENV_KEYS: Final[tuple[str, ...]] = (
    "URDF_STUDIO_BUILD_SHA",
    "VERCEL_GIT_COMMIT_SHA",
    "GITHUB_SHA",
    "CF_PAGES_COMMIT_SHA",
    "SOURCE_VERSION",
)
DEFAULT_BACKEND_BUILD = "dev"


def _resolve_backend_build() -> str:
    for env_key in BUILD_SHA_ENV_KEYS:
        build = os.getenv(env_key)
        if isinstance(build, str):
            normalized_build = build.strip()
            if normalized_build:
                return normalized_build
    return DEFAULT_BACKEND_BUILD


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return dependency_health()


@router.get("/version")
async def version() -> dict[str, str]:
    return {"service": "backend", "build": _resolve_backend_build()}
