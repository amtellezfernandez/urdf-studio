from __future__ import annotations

import importlib
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
from backend.services.import_utils import module_not_found_matches_import_name

PYTHON_MODULE_PROBE_TIMEOUT_SEC = 5
PYTHON_MODULE_PROBE_PROGRAM = (
    "import importlib, sys; "
    "sys.exit(0 if importlib.import_module(sys.argv[1]) else 1)"
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
        importlib.import_module(import_name)
    except ModuleNotFoundError as exc:
        if not module_not_found_matches_import_name(exc.name, import_name):
            raise
        return False
    return True


def is_python_module_available_in_python(python_executable: str, import_name: str) -> bool:
    try:
        process = subprocess.run(
            _python_module_probe_command(
                python_executable=python_executable,
                import_name=import_name,
            ),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=PYTHON_MODULE_PROBE_TIMEOUT_SEC,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return process.returncode == 0


def _python_module_probe_command(*, python_executable: str, import_name: str) -> list[str]:
    return [
        python_executable,
        "-c",
        PYTHON_MODULE_PROBE_PROGRAM,
        import_name,
    ]


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
    module_availability_probe = _resolve_module_availability_probe(python_executable)
    return [
        _runtime_dependency_status(
            dependency=dependency,
            module_availability_probe=module_availability_probe,
        )
        for dependency in dependencies
    ]


def format_runtime_dependency_status(
    *,
    ready_status: str,
    missing_status_prefix: str,
    dependencies: list[SimulatorRuntimeDependency],
) -> tuple[bool, str]:
    missing_required_dependencies = _missing_required_dependency_names(dependencies)
    if not missing_required_dependencies:
        return True, ready_status
    return False, f"{missing_status_prefix}: {', '.join(missing_required_dependencies)}"


def _missing_required_dependency_names(
    dependencies: list[SimulatorRuntimeDependency],
) -> list[str]:
    return [
        dependency.name
        for dependency in dependencies
        if dependency.required and not dependency.available
    ]


def _runtime_dependency_status(
    *,
    dependency: SimulatorDependencySpec,
    module_availability_probe: Callable[[str], bool],
) -> SimulatorRuntimeDependency:
    return SimulatorRuntimeDependency(
        name=dependency.name,
        available=module_availability_probe(dependency.import_name),
        required=dependency.required,
        scope=dependency.scope,
    )
