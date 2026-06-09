from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.core.simulator_security import require_simulator_operator_access
from backend.models.simulator_runtime import (
    SimulatorId,
    SimulatorRuntimeListResponse,
    SimulatorRuntimeStatus,
    SimulatorWorldOpenRequest,
    SimulatorWorldOpenResponse,
)
from backend.services.simulator_adapters import (
    SimulatorAdapterError,
    get_simulator_runtime_status,
    launch_simulator_world,
    list_simulator_runtime_descriptors,
)


router = APIRouter(prefix="/simulators", tags=["simulator-runtime"])


@router.get("", response_model=SimulatorRuntimeListResponse)
def list_simulator_runtimes(
    _access: None = Depends(require_simulator_operator_access),
) -> SimulatorRuntimeListResponse:
    return list_simulator_runtime_descriptors()


@router.get("/{simulator_id}/runtime", response_model=SimulatorRuntimeStatus)
def get_runtime_status(
    simulator_id: SimulatorId,
    _access: None = Depends(require_simulator_operator_access),
) -> SimulatorRuntimeStatus:
    return get_simulator_runtime_status(simulator_id)


@router.post("/{simulator_id}/world/open", response_model=SimulatorWorldOpenResponse)
def open_simulator_world(
    simulator_id: SimulatorId,
    request: SimulatorWorldOpenRequest,
    _access: None = Depends(require_simulator_operator_access),
) -> SimulatorWorldOpenResponse:
    try:
        return launch_simulator_world(simulator_id, request)
    except SimulatorAdapterError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
