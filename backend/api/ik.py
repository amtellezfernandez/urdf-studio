from __future__ import annotations

from fastapi import APIRouter

from backend.models.ik_solvers import IkSolverInfo, IkSolversResponse
from backend.services.health import dependency_health


def _placo_available() -> bool:
    try:
        import placo  # type: ignore # noqa: F401
    except ImportError:
        return False
    return True

router = APIRouter(prefix="/ik", tags=["ik"])


@router.get("/solvers", response_model=IkSolversResponse)
def list_ik_solvers() -> IkSolversResponse:
    health = dependency_health()
    placo_ok = _placo_available()
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
    if placo_ok:
        solvers.append(
            IkSolverInfo(
                id="lerobot-placo",
                label="LeRobot (Placo)",
                description="Placo-based IK service.",
                mode="remote",
            )
        )

    default_chain: list[str] = []
    if health.pyroki:
        default_chain.append("pyroki-http")
    if placo_ok:
        default_chain.append("lerobot-placo")

    if not default_chain and solvers:
        default_chain = [solver.id for solver in solvers]

    return IkSolversResponse(solvers=solvers, default_chain=default_chain)
