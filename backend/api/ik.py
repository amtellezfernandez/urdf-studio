from __future__ import annotations

from fastapi import APIRouter

from backend.models.kinematics import IKResponse, IkSolveRequest
from backend.models.ik_config import IkConfigResponse
from backend.models.ik_solvers import IkSolversResponse
from backend.services.ik_config import get_ik_config
from backend.services.ik_registry import (
    IK_SOLVER_REGISTRY_VERSION,
    default_solver_chain,
    list_available_solvers,
)
from backend.services.ik_orchestrator import solve_ik as orchestrated_ik

router = APIRouter(prefix="/ik", tags=["ik"])


@router.get("/solvers", response_model=IkSolversResponse)
async def list_ik_solvers() -> IkSolversResponse:
    solvers = list_available_solvers()
    default_chain = default_solver_chain()
    return IkSolversResponse(
        version=IK_SOLVER_REGISTRY_VERSION,
        solvers=solvers,
        default_chain=default_chain,
    )


@router.get("/config", response_model=IkConfigResponse)
async def get_ik_runtime_config() -> IkConfigResponse:
    return get_ik_config()


@router.post("/solve", response_model=IKResponse)
async def solve_ik(req: IkSolveRequest) -> IKResponse:
    return orchestrated_ik(req)
