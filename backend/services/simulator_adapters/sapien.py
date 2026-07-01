from __future__ import annotations

from backend.models.simulator_runtime import (
    SIMULATOR_SAPIEN_ID,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
    get_simulator_runtime_spec,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapter,
    SimulatorAdapterError,
)
from backend.services.simulator_adapters.direct_urdf import (
    start_direct_urdf_workspace,
    make_direct_urdf_simulator_adapter,
    prepare_direct_urdf_workspace,
)
from backend.services.simulator_adapters.workspace_package import (
    PreparedSimulatorWorkspace,
)
from backend.services.simulator_adapters.params import SAPIEN_WORKSPACE_PROCESS_PARAMS


SAPIEN_RUNTIME_SPEC = get_simulator_runtime_spec(SIMULATOR_SAPIEN_ID)


class SapienWorkspaceError(SimulatorAdapterError):
    pass


def _sapien_error(message: str) -> SapienWorkspaceError:
    return SapienWorkspaceError(message)


def prepare_sapien_workspace(request: SimulatorWorkspacePrepareRequest) -> PreparedSimulatorWorkspace:
    return prepare_direct_urdf_workspace(
        request,
        workspace_process=SAPIEN_WORKSPACE_PROCESS_PARAMS,
        error=_sapien_error,
    )


def start_sapien_workspace(
    request: SimulatorWorkspacePrepareRequest,
) -> SimulatorWorkspacePrepareResponse:
    return start_direct_urdf_workspace(
        request,
        runtime_spec=SAPIEN_RUNTIME_SPEC,
        workspace_process=SAPIEN_WORKSPACE_PROCESS_PARAMS,
        error=_sapien_error,
        prepare_workspace_package_fn=prepare_sapien_workspace,
    )


SAPIEN_SIMULATOR_ADAPTER: SimulatorAdapter = make_direct_urdf_simulator_adapter(
    runtime_spec=SAPIEN_RUNTIME_SPEC,
    workspace_process=SAPIEN_WORKSPACE_PROCESS_PARAMS,
    error=_sapien_error,
    prepare_workspace_package_fn=prepare_sapien_workspace,
)
