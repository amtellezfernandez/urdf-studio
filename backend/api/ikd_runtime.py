from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.models.ikd_runtime import IkdRuntimeActionResponse, IkdRuntimeStatusResponse
from backend.services.ikd_runtime import ikd_runtime_manager

router = APIRouter(prefix="/ikd/runtime", tags=["ikd-runtime"])


@router.get("/status", response_model=IkdRuntimeStatusResponse)
def get_ikd_runtime_status() -> IkdRuntimeStatusResponse:
    return IkdRuntimeStatusResponse.model_validate(ikd_runtime_manager.status().to_dict())


@router.post("/start", response_model=IkdRuntimeActionResponse)
def start_ikd_runtime() -> IkdRuntimeActionResponse:
    try:
        status = ikd_runtime_manager.start()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    payload = status.to_dict()
    if not status.running and status.message:
        raise HTTPException(status_code=409, detail=status.message)
    return IkdRuntimeActionResponse.model_validate({"action": "start", **payload})


@router.post("/stop", response_model=IkdRuntimeActionResponse)
def stop_ikd_runtime() -> IkdRuntimeActionResponse:
    status = ikd_runtime_manager.stop()
    payload = status.to_dict()
    return IkdRuntimeActionResponse.model_validate({"action": "stop", **payload})

