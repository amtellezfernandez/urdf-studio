from __future__ import annotations

from backend.models.simulator_runtime import (
    SIMULATOR_NEWTON_ID,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
    get_simulator_runtime_spec,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapter,
    SimulatorAdapterError,
)
from backend.services.simulator_adapters.direct_urdf import (
    make_direct_urdf_simulator_adapter,
    prepare_direct_urdf_workspace,
    start_direct_urdf_workspace,
)
from backend.services.simulator_adapters.params import NEWTON_WORKSPACE_PROCESS_PARAMS
from backend.services.simulator_adapters.workspace_package import (
    PreparedSimulatorWorkspace,
)


NEWTON_RUNTIME_SPEC = get_simulator_runtime_spec(SIMULATOR_NEWTON_ID)


class NewtonWorkspaceError(SimulatorAdapterError):
    pass


def _newton_error(message: str) -> NewtonWorkspaceError:
    return NewtonWorkspaceError(message)


def prepare_newton_workspace(request: SimulatorWorkspacePrepareRequest) -> PreparedSimulatorWorkspace:
    return prepare_direct_urdf_workspace(
        request,
        workspace_process=NEWTON_WORKSPACE_PROCESS_PARAMS,
        error=_newton_error,
    )


def start_newton_workspace(
    request: SimulatorWorkspacePrepareRequest,
) -> SimulatorWorkspacePrepareResponse:
    return start_direct_urdf_workspace(
        request,
        runtime_spec=NEWTON_RUNTIME_SPEC,
        workspace_process=NEWTON_WORKSPACE_PROCESS_PARAMS,
        error=_newton_error,
        prepare_workspace_package_fn=prepare_newton_workspace,
    )


NEWTON_SIMULATOR_ADAPTER: SimulatorAdapter = make_direct_urdf_simulator_adapter(
    runtime_spec=NEWTON_RUNTIME_SPEC,
    workspace_process=NEWTON_WORKSPACE_PROCESS_PARAMS,
    error=_newton_error,
    prepare_workspace_package_fn=prepare_newton_workspace,
)
