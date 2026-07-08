from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from backend.models.scenario_service import (
    ScenarioAuthoringRequest,
    ScenarioListResponse,
    ScenarioPackListResponse,
    ScenarioPackPublishRequest,
    ScenarioPackSummary,
    ScenarioRunDetail,
    ScenarioRunListResponse,
    ScenarioRunRequest,
    ScenarioSummary,
    ScenarioRunSummary,
)
from backend.services.scenario_authoring import ScenarioAuthoringError, save_recorded_scenario
from backend.services.scenario_library import list_scenarios
from backend.services.scenario_packs import ScenarioPackError, scenario_pack_service
from backend.services.scenario_run_service import ScenarioRunError, scenario_run_service

router = APIRouter(prefix="/scenarios", tags=["scenarios"])


@router.get("", response_model=ScenarioListResponse)
async def list_scenario_library() -> ScenarioListResponse:
    return ScenarioListResponse(scenarios=list_scenarios())


@router.get("/runs", response_model=ScenarioRunListResponse)
async def list_scenario_runs() -> ScenarioRunListResponse:
    return ScenarioRunListResponse(runs=scenario_run_service.list_runs())


@router.get("/runs/{run_id}", response_model=ScenarioRunDetail)
async def get_scenario_run(run_id: str) -> ScenarioRunDetail:
    try:
        return scenario_run_service.get_run(run_id)
    except ScenarioRunError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/runs/{run_id}/report", response_class=HTMLResponse)
async def get_scenario_run_report(run_id: str) -> HTMLResponse:
    try:
        path = scenario_run_service.report_path(run_id)
    except ScenarioRunError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return HTMLResponse(content=path.read_text(encoding="utf-8"))


@router.get("/packs", response_model=ScenarioPackListResponse)
async def list_scenario_packs() -> ScenarioPackListResponse:
    return ScenarioPackListResponse(packs=scenario_pack_service.list_packs())


@router.post("/packs/{package_id}/{version}/pull", response_model=ScenarioPackSummary)
async def pull_scenario_pack(package_id: str, version: str) -> ScenarioPackSummary:
    try:
        return scenario_pack_service.pull(package_id, version)
    except ScenarioPackError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{scenario_id}/packs", response_model=ScenarioPackSummary, status_code=201)
async def publish_scenario_pack(
    scenario_id: str, request: ScenarioPackPublishRequest
) -> ScenarioPackSummary:
    try:
        return scenario_pack_service.publish(scenario_id, request.version)
    except ScenarioPackError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/authored", response_model=ScenarioSummary, status_code=201)
async def create_authored_scenario(request: ScenarioAuthoringRequest) -> ScenarioSummary:
    try:
        return save_recorded_scenario(request)
    except ScenarioAuthoringError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{scenario_id}/runs", response_model=ScenarioRunSummary, status_code=202)
async def create_scenario_run(scenario_id: str, request: ScenarioRunRequest) -> ScenarioRunSummary:
    try:
        return scenario_run_service.create_run(scenario_id, request.sims, request.episodes)
    except ScenarioRunError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
