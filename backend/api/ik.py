from __future__ import annotations

from fastapi import APIRouter

from backend.models.ik_solvers import IkSolverInfo, IkSolversResponse
from backend.services.health import dependency_health

router = APIRouter(prefix="/ik", tags=["ik"])


@router.get("/solvers", response_model=IkSolversResponse)
def list_ik_solvers() -> IkSolversResponse:
    health = dependency_health()
    solvers: list[IkSolverInfo] = []
    if health.pyroki:
        solvers.append(
            IkSolverInfo(
                id="pyroki-http",
                label="PyRoki (HTTP)",
                description="Backend IK service.",
                mode="remote",
            )
        )
    return IkSolversResponse(solvers=solvers, default_chain=[solver.id for solver in solvers])
