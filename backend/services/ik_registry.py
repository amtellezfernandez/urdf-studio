from __future__ import annotations

from dataclasses import dataclass
from typing import List

from backend.models.ik_solvers import IkSolverInfo

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
    "placo": SolverDefinition(
        id="placo",
        label="Placo",
        description="Placo-based IK service.",
        mode="remote",
        capabilities=["Pose", "Limits"],
        requirements=["Backend", "Placo"],
    ),
    "amik": SolverDefinition(
        id="amik",
        label="AMIK (CCD)",
        description="Backend CCD solver (URDF-only).",
        mode="remote",
        capabilities=["Position", "Limits"],
        requirements=["Backend"],
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
    solvers: List[IkSolverInfo] = []
    if _placo_available() and "placo" in SOLVER_DEFINITIONS:
        solvers.append(_definition_to_info(SOLVER_DEFINITIONS["placo"]))
    if "amik" in SOLVER_DEFINITIONS:
        solvers.append(_definition_to_info(SOLVER_DEFINITIONS["amik"]))
    return solvers


def default_solver_chain() -> List[str]:
    solvers = list_available_solvers()
    if not solvers:
        return []
    return [solver.id for solver in solvers]
