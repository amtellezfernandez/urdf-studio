from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from copy import copy

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIWebSocketRoute, APIRoute, request_response
from fastapi.responses import JSONResponse
from starlette.routing import BaseRoute

from backend.api.health import router as health_router
from backend.api.ilu_urdf import router as ilu_urdf_router
from backend.api.samples import router as samples_router
from backend.api.simulator_runtime import router as simulator_runtime_router
from backend.api.simulation_prep import router as simulation_prep_router
from backend.api.workspace_transfer import router as workspace_transfer_router
from backend.core.request_audit import (
    REQUEST_ID_HEADER,
    get_request_id_for_http_request,
    log_http_security_event,
    should_audit_http_request,
)
from backend.core.simulator_security import enforce_backend_http_access_policy
from backend.core.settings import settings


METRICS_PATH_PREFIXES = (
    "/workspace-transfer",
    "/simulators",
    "/simulation-prep",
    "/ilu",
)
LOOPBACK_CORS_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|\[::1\]):\d+$"
API_ROUTERS = (
    health_router,
    ilu_urdf_router,
    samples_router,
    workspace_transfer_router,
    simulator_runtime_router,
    simulation_prep_router,
)


@asynccontextmanager
async def app_lifespan(_app: FastAPI):
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="URDF Studio Backend", version="0.1.0", lifespan=app_lifespan)
    logger = logging.getLogger("urdf.metrics")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=LOOPBACK_CORS_ORIGIN_REGEX,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def simulator_security_middleware(request: Request, call_next):
        request_id = get_request_id_for_http_request(request)
        try:
            enforce_backend_http_access_policy(request)
        except HTTPException as exc:
            response = JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
            response.headers[REQUEST_ID_HEADER] = request_id
            if should_audit_http_request(request):
                log_http_security_event(request, status_code=exc.status_code, decision="denied")
            return response

        try:
            response = await call_next(request)
        except Exception:
            if should_audit_http_request(request):
                log_http_security_event(request, status_code=500, decision="error")
            raise

        response.headers[REQUEST_ID_HEADER] = request_id
        if should_audit_http_request(request):
            log_http_security_event(request, status_code=response.status_code, decision="allowed")
        return response

    if settings.enable_metrics:

        @app.middleware("http")
        async def timing_middleware(request: Request, call_next):
            start = time.perf_counter()
            response = await call_next(request)
            duration_ms = (time.perf_counter() - start) * 1000
            path = request.url.path
            if path.startswith(METRICS_PATH_PREFIXES):
                logger.info("metrics.http path=%s duration_ms=%.2f", path, duration_ms)
            response.headers["X-Process-Time-Ms"] = f"{duration_ms:.2f}"
            return response

    register_api_routers(app)

    @app.exception_handler(NotImplementedError)
    async def not_implemented_handler(request: Request, exc: NotImplementedError):
        return JSONResponse(
            status_code=501,
            content={"detail": str(exc) or "This feature is not yet available."},
        )

    return app


def clone_route_for_app(route: BaseRoute, app: FastAPI) -> BaseRoute:
    if isinstance(route, APIWebSocketRoute):
        return APIWebSocketRoute(
            route.path,
            route.endpoint,
            name=route.name,
            dependencies=route.dependencies,
            dependency_overrides_provider=app,
        )

    route_copy = copy(route)
    if hasattr(route_copy, "dependency_overrides_provider"):
        route_copy.dependency_overrides_provider = app
    if isinstance(route_copy, APIRoute):
        route_copy.app = request_response(route_copy.get_route_handler())
    return route_copy


def register_api_routers(app: FastAPI) -> None:
    for router in API_ROUTERS:
        app.router.routes.extend(clone_route_for_app(route, app) for route in router.routes)


app = create_app()
