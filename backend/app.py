from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from backend.api.datasets import router as datasets_router
from backend.api.health import router as health_router
from backend.api.ik import router as ik_router
from backend.api.lerobot import router as lerobot_router
from backend.api.pyroki import router as pyroki_router
from backend.api.rerun import router as rerun_router
from backend.api.samples import router as samples_router
from backend.api.training import router as training_router
from backend.core.settings import settings


def create_app() -> FastAPI:
    app = FastAPI(title="URDF Studio Backend", version="0.1.0")
    logger = logging.getLogger("urdf.metrics")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    if settings.enable_metrics:
        @app.middleware("http")
        async def timing_middleware(request: Request, call_next):
            start = time.perf_counter()
            response = await call_next(request)
            duration_ms = (time.perf_counter() - start) * 1000
            path = request.url.path
            if path.startswith(("/lerobot/ik", "/pyroki/ik", "/pyroki/fk", "/datasets", "/rerun")):
                logger.info("metrics.http path=%s duration_ms=%.2f", path, duration_ms)
            response.headers["X-Process-Time-Ms"] = f"{duration_ms:.2f}"
            return response

    app.include_router(health_router)
    app.include_router(ik_router)
    app.include_router(lerobot_router)
    app.include_router(pyroki_router)
    app.include_router(rerun_router)
    app.include_router(samples_router)
    app.include_router(datasets_router)
    app.include_router(training_router)
    return app


app = create_app()
