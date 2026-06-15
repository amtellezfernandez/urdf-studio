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

from backend.api.attestation import router as attestation_router
from backend.api.cam_to_sim import router as cam_to_sim_router
from backend.api.collaboration import http_router as collaboration_http_router
from backend.api.collaboration import ws_router as collaboration_ws_router
from backend.api.datasets import router as datasets_router
from backend.api.health import router as health_router
from backend.api.ilu_assembly import router as ilu_assembly_router
from backend.api.ik import router as ik_router
from backend.api.ikd_runtime import router as ikd_runtime_router
from backend.api.ilu_urdf import router as ilu_urdf_router
from backend.api.ilu_session import router as ilu_session_router
from backend.api.lerobot import router as lerobot_router
from backend.api.robot_mastering import router as robot_mastering_router
from backend.api.ros_viz import http_router as ros_viz_http_router
from backend.api.ros_viz import ws_router as ros_viz_ws_router
from backend.api.robot_gateway import router as robot_gateway_router
from backend.api.teleop_mjlab import router as teleop_mjlab_router
from backend.api.teleop_replay import router as teleop_replay_router
from backend.api.runtime_sessions import router as runtime_sessions_router
from backend.api.samples import router as samples_router
from backend.api.simulator_runtime import router as simulator_runtime_router
from backend.api.simulation_prep import router as simulation_prep_router
from backend.api.world_bridge import router as world_bridge_router
from backend.api.world_registry import router as world_registry_router
from backend.api.world_rollouts import router as world_rollouts_router
from backend.api.workspace_transfer import router as workspace_transfer_router
from backend.core.request_audit import (
    REQUEST_ID_HEADER,
    get_request_id_for_http_request,
    log_http_security_event,
    should_audit_http_request,
)
from backend.core.simulator_security import enforce_backend_http_access_policy
from backend.core.settings import settings
from backend.services.zra_orchestrator import zra_orchestrator_service


METRICS_PATH_PREFIXES = (
    "/lerobot/ik",
    "/datasets",
    "/world-bridge",
    "/workspace-transfer",
    "/simulators",
    "/worlds/rollouts",
    "/ros-viz",
    "/ws/ros-viz",
    "/cam-to-sim",
    "/teleop/mjlab",
    "/teleop/replay",
    "/collaboration",
    "/ws/collaboration",
)
LOOPBACK_CORS_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|\[::1\]):\d+$"
API_ROUTERS = (
    health_router,
    ilu_urdf_router,
    ilu_session_router,
    ilu_assembly_router,
    attestation_router,
    ik_router,
    ikd_runtime_router,
    lerobot_router,
    robot_mastering_router,
    runtime_sessions_router,
    samples_router,
    datasets_router,
    world_bridge_router,
    workspace_transfer_router,
    simulator_runtime_router,
    world_registry_router,
    world_rollouts_router,
    ros_viz_http_router,
    ros_viz_ws_router,
    robot_gateway_router,
    teleop_mjlab_router,
    teleop_replay_router,
    cam_to_sim_router,
    collaboration_http_router,
    collaboration_ws_router,
    simulation_prep_router,
)


@asynccontextmanager
async def app_lifespan(_app: FastAPI):
    zra_orchestrator_service.start()
    try:
        yield
    finally:
        from backend.robot_gateway.openarm_leader_state import (
            openarm_leader_state_service,
        )

        openarm_leader_state_service.release_all()
        zra_orchestrator_service.stop()


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
