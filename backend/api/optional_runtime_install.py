from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.core.simulator_security import require_simulator_operator_access_async
from backend.services.optional_runtime_install import optional_runtime_install_service


router = APIRouter(prefix="/optional-runtime-installs", tags=["optional-runtime-installs"])


@router.post("/{runtime_id}")
async def start_optional_runtime_install(
    runtime_id: str,
    _access: None = Depends(require_simulator_operator_access_async),
) -> dict[str, object]:
    try:
        return optional_runtime_install_service.start(runtime_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/{job_id}/status")
async def get_optional_runtime_install_status(
    job_id: str,
    _access: None = Depends(require_simulator_operator_access_async),
) -> dict[str, object]:
    try:
        return optional_runtime_install_service.status(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Optional runtime install was not found.") from exc
