from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.core.simulator_security import require_simulator_operator_access
from backend.models.genesis_world import (
    GenesisWorldOpenRequest,
    GenesisWorldOpenResponse,
)
from backend.services.genesis_world_launcher import launch_default_genesis_world

router = APIRouter(prefix="/worlds/genesis", tags=["genesis-world"])


@router.post("/open", response_model=GenesisWorldOpenResponse)
def open_genesis_world(
    request: GenesisWorldOpenRequest,
    _access: None = Depends(require_simulator_operator_access),
) -> GenesisWorldOpenResponse:
    return launch_default_genesis_world(
        dynamic_container_mode=request.dynamic_container_mode,
    )
