from __future__ import annotations

from importlib.util import find_spec
import subprocess
from typing import Callable, Protocol

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


def _resolve_module_availability_probe(
    python_executable: str | None,
) -> Callable[[str], bool]:
    if python_executable:
        return lambda import_name: is_python_module_available_in_python(
            python_executable,
            import_name,
        )
    return is_python_module_available


def build_runtime_dependency_statuses(
    dependencies: tuple[SimulatorDependencySpec, ...],
    *,
    python_executable: str | None = None,
) -> list[SimulatorRuntimeDependency]:
    is_module_available = _resolve_module_availability_probe(python_executable)
    return [
        SimulatorRuntimeDependency(
            name=dependency.name,
            available=is_module_available(dependency.import_name),
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
    missing_required_dependencies = [
        dependency.name
        for dependency in dependencies
        if dependency.required and not dependency.available
    ]
    if not missing_required_dependencies:
        return True, ready_status
    return False, f"{missing_status_prefix}: {', '.join(missing_required_dependencies)}"
