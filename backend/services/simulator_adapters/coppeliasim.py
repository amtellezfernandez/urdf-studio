from __future__ import annotations

from backend.models.simulator_runtime import (
    SIMULATOR_COPPELIASIM_ID,
    SimulatorRuntimeDependency,
    SimulatorRuntimeStatus,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
    get_simulator_runtime_spec,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapter,
    SimulatorAdapterError,
    build_runtime_dependency_statuses,
    format_runtime_dependency_status,
)
from backend.services.simulator_adapters.coppeliasim_runtime import (
    COPPELIASIM_EXECUTABLE_ENV,
    COPPELIASIM_REMOTE_ENV,
    COPPELIASIM_ROOT_ENV,
    coppeliasim_remote_configured,
    resolve_coppeliasim_executable,
)
from backend.services.simulator_adapters.direct_urdf import (
    start_direct_urdf_workspace,
    prepare_direct_urdf_workspace,
)
from backend.services.simulator_adapters.params import COPPELIASIM_WORKSPACE_PROCESS_PARAMS
from backend.services.simulator_adapters.workspace_package import PreparedSimulatorWorkspace


COPPELIASIM_RUNTIME_SPEC = get_simulator_runtime_spec(SIMULATOR_COPPELIASIM_ID)


class CoppeliaSimWorkspaceError(SimulatorAdapterError):
    pass


def _coppeliasim_error(message: str) -> CoppeliaSimWorkspaceError:
    return CoppeliaSimWorkspaceError(message)


def prepare_coppeliasim_workspace(request: SimulatorWorkspacePrepareRequest) -> PreparedSimulatorWorkspace:
    return prepare_direct_urdf_workspace(
        request,
        workspace_process=COPPELIASIM_WORKSPACE_PROCESS_PARAMS,
        error=_coppeliasim_error,
    )


def start_coppeliasim_workspace(
    request: SimulatorWorkspacePrepareRequest,
) -> SimulatorWorkspacePrepareResponse:
    return start_direct_urdf_workspace(
        request,
        runtime_spec=COPPELIASIM_RUNTIME_SPEC,
        workspace_process=COPPELIASIM_WORKSPACE_PROCESS_PARAMS,
        error=_coppeliasim_error,
        prepare_workspace_package_fn=prepare_coppeliasim_workspace,
    )


class CoppeliaSimSimulatorAdapter:
    simulator_id = COPPELIASIM_RUNTIME_SPEC.simulator_id
    label = COPPELIASIM_RUNTIME_SPEC.label
    capabilities = COPPELIASIM_RUNTIME_SPEC.capabilities_model()

    def prepare_workspace(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> SimulatorWorkspacePrepareResponse:
        return start_coppeliasim_workspace(request)

    def runtime_status(self) -> SimulatorRuntimeStatus:
        dependencies = build_runtime_dependency_statuses(COPPELIASIM_RUNTIME_SPEC.dependencies)
        executable = resolve_coppeliasim_executable()
        remote_configured = coppeliasim_remote_configured()
        dependencies.append(
            SimulatorRuntimeDependency(
                name="CoppeliaSim executable or remote",
                available=executable is not None or remote_configured,
            )
        )
        available, status = format_runtime_dependency_status(
            ready_status=(
                f"ready ({executable})"
                if executable is not None
                else "ready (remote CoppeliaSim configured)"
            ),
            missing_status_prefix=(
                "Missing dependency; install CoppeliaSim and set "
                f"{COPPELIASIM_EXECUTABLE_ENV} or {COPPELIASIM_ROOT_ENV}, or set "
                f"{COPPELIASIM_REMOTE_ENV}=1 for an already-running remote API"
            ),
            dependencies=dependencies,
        )
        return SimulatorRuntimeStatus(
            runtimeName=COPPELIASIM_RUNTIME_SPEC.simulator_id,
            available=available,
            status=status,
            dependencies=dependencies,
        )


COPPELIASIM_SIMULATOR_ADAPTER: SimulatorAdapter = CoppeliaSimSimulatorAdapter()
