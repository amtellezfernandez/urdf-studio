from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.datasets import router as datasets_router
from backend.api.health import router as health_router
from backend.api.pyroki import router as pyroki_router
from backend.api.rerun import router as rerun_router


def create_app() -> FastAPI:
    app = FastAPI(title="URDF Studio Backend", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)
    app.include_router(pyroki_router)
    app.include_router(rerun_router)
    app.include_router(datasets_router)
    return app


app = create_app()
