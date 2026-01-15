from __future__ import annotations

from dataclasses import dataclass
from typing import List

from backend.models.ik_solvers import IkSolverInfo
from backend.services.health import dependency_health

IK_SOLVER_REGISTRY_VERSION = "1"


@dataclass(frozen=True)
class SolverDefinition:
    id: str
    label: str
    description: str
    mode: str
    capabilities: List[str]
    requirements: List[str]


SOLVER_DEFINITIONS: dict[str, SolverDefinition] = {
    "pyroki-http": SolverDefinition(
        id="pyroki-http",
        label="PyRoki (HTTP)",
        description="Backend IK service.",
        mode="remote",
        capabilities=["Orientation", "Limits"],
        requirements=["Backend"],
    ),
    "lerobot-placo": SolverDefinition(
        id="lerobot-placo",
        label="LeRobot (Placo)",
        description="Placo-based IK service.",
        mode="remote",
        capabilities=["Pose", "Limits"],
        requirements=["Backend", "Placo"],
    ),
}


def _placo_available() -> bool:
    try:
        import placo  # type: ignore # noqa: F401
    except ImportError:
        return False
    return True


def _definition_to_info(defn: SolverDefinition) -> IkSolverInfo:
    return IkSolverInfo(
        id=defn.id,
        label=defn.label,
        description=defn.description,
        mode=defn.mode,
        capabilities=list(defn.capabilities),
        requirements=list(defn.requirements),
    )


def list_available_solvers() -> List[IkSolverInfo]:
    health = dependency_health()
    solvers: List[IkSolverInfo] = []
    if health.pyroki and "pyroki-http" in SOLVER_DEFINITIONS:
        solvers.append(_definition_to_info(SOLVER_DEFINITIONS["pyroki-http"]))
    if _placo_available() and "lerobot-placo" in SOLVER_DEFINITIONS:
        solvers.append(_definition_to_info(SOLVER_DEFINITIONS["lerobot-placo"]))
    return solvers


def default_solver_chain() -> List[str]:
    solvers = list_available_solvers()
    if not solvers:
        return []
    ids = [solver.id for solver in solvers]
    if "pyroki-http" in ids:
        ids.remove("pyroki-http")
        ids.insert(0, "pyroki-http")
    return ids
