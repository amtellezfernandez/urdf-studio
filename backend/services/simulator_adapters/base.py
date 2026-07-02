from __future__ import annotations

from importlib.util import find_spec
import subprocess
from typing import Protocol

from backend.models.simulator_runtime import (
    SimulatorDependencySpec,
    SimulatorId,
    SimulatorRuntimeCapabilities,
    SimulatorRuntimeDependency,
    SimulatorRuntimeStatus,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
)


class SimulatorAdapterError(RuntimeError):
    status_code = 503


class SimulatorCapabilityError(SimulatorAdapterError):
    status_code = 501


class SimulatorAdapter(Protocol):
    simulator_id: SimulatorId
    label: str
    capabilities: SimulatorRuntimeCapabilities

    def prepare_workspace(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> SimulatorWorkspacePrepareResponse:
        ...

    def runtime_status(self) -> SimulatorRuntimeStatus:
        ...


def is_python_module_available(import_name: str) -> bool:
    try:
        return find_spec(import_name) is not None
    except ModuleNotFoundError:
        return False


def is_python_module_available_in_python(python_executable: str, import_name: str) -> bool:
    try:
        process = subprocess.run(
            [
                python_executable,
                "-c",
                (
                    "import importlib.util, sys; "
                    "sys.exit(0 if importlib.util.find_spec(sys.argv[1]) else 1)"
                ),
                import_name,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return process.returncode == 0


def build_runtime_dependency_statuses(
    dependencies: tuple[SimulatorDependencySpec, ...],
    *,
    python_executable: str | None = None,
) -> list[SimulatorRuntimeDependency]:
    return [
        SimulatorRuntimeDependency(
            name=dependency.name,
            available=(
                is_python_module_available_in_python(python_executable, dependency.import_name)
                if python_executable
                else is_python_module_available(dependency.import_name)
            ),
            required=dependency.required,
            scope=dependency.scope,
        )
        for dependency in dependencies
    ]


def format_runtime_dependency_status(
    *,
    ready_status: str,
    missing_status_prefix: str,
    dependencies: list[SimulatorRuntimeDependency],
) -> tuple[bool, str]:
    required_dependencies = [dependency for dependency in dependencies if dependency.required]
    available = all(dependency.available for dependency in required_dependencies)
    if available:
        return True, ready_status
    missing = ", ".join(
        dependency.name
        for dependency in required_dependencies
        if not dependency.available
    )
    return False, f"{missing_status_prefix}: {missing}"
