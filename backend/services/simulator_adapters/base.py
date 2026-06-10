from __future__ import annotations

from importlib.util import find_spec
from typing import Protocol

from backend.models.simulator_runtime import (
    SimulatorDependencySpec,
    SimulatorId,
    SimulatorRuntimeCapabilities,
    SimulatorRuntimeDependency,
    SimulatorRuntimeSpec,
    SimulatorRuntimeStatus,
    SimulatorWorldOpenRequest,
    SimulatorWorldOpenResponse,
)


class SimulatorAdapterError(RuntimeError):
    status_code = 503


class SimulatorCapabilityError(SimulatorAdapterError):
    status_code = 501


class SimulatorAdapter(Protocol):
    simulator_id: SimulatorId
    label: str
    capabilities: SimulatorRuntimeCapabilities

    def open_world(self, request: SimulatorWorldOpenRequest) -> SimulatorWorldOpenResponse:
        ...

    def runtime_status(self) -> SimulatorRuntimeStatus:
        ...


def is_python_module_available(import_name: str) -> bool:
    try:
        return find_spec(import_name) is not None
    except ModuleNotFoundError:
        return False


def build_runtime_dependency_statuses(
    dependencies: tuple[SimulatorDependencySpec, ...],
) -> list[SimulatorRuntimeDependency]:
    return [
        SimulatorRuntimeDependency(
            name=dependency.name,
            available=is_python_module_available(dependency.import_name),
        )
        for dependency in dependencies
    ]


def format_runtime_dependency_status(
    *,
    ready_status: str,
    missing_status_prefix: str,
    dependencies: list[SimulatorRuntimeDependency],
) -> tuple[bool, str]:
    available = all(dependency.available for dependency in dependencies)
    if available:
        return True, ready_status
    missing = ", ".join(dependency.name for dependency in dependencies if not dependency.available)
    return False, f"{missing_status_prefix}: {missing}"


def build_simulator_runtime_status(
    spec: SimulatorRuntimeSpec,
    *,
    missing_status_prefix: str = "Missing dependency",
    ready_status: str = "ready",
) -> SimulatorRuntimeStatus:
    dependencies = build_runtime_dependency_statuses(spec.dependencies)
    available, status = format_runtime_dependency_status(
        ready_status=ready_status,
        missing_status_prefix=missing_status_prefix,
        dependencies=dependencies,
    )
    return SimulatorRuntimeStatus(
        runtimeName=spec.simulator_id,
        available=available,
        status=status,
        dependencies=dependencies,
    )
