from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.datasets import router as datasets_router
from backend.api.health import router as health_router
from backend.api.ik import router as ik_router
from backend.api.lerobot import router as lerobot_router
from backend.api.pyroki import router as pyroki_router
from backend.api.rerun import router as rerun_router
from backend.api.samples import router as samples_router
from backend.core.settings import settings


def create_app() -> FastAPI:
    app = FastAPI(title="URDF Studio Backend", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)
    app.include_router(ik_router)
    app.include_router(lerobot_router)
    app.include_router(pyroki_router)
    app.include_router(rerun_router)
    app.include_router(samples_router)
    app.include_router(datasets_router)
    return app


app = create_app()
