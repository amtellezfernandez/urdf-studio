from __future__ import annotations

from backend.models.simulator_runtime import (
    SIMULATOR_ISAAC_GYM_ID,
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
from backend.services.simulator_adapters.params import ISAAC_GYM_WORKSPACE_PROCESS_PARAMS
from backend.services.simulator_adapters.workspace_package import PreparedSimulatorWorkspace


ISAAC_GYM_RUNTIME_SPEC = get_simulator_runtime_spec(SIMULATOR_ISAAC_GYM_ID)


class IsaacGymWorkspaceError(SimulatorAdapterError):
    pass


def _isaac_gym_error(message: str) -> IsaacGymWorkspaceError:
    return IsaacGymWorkspaceError(message)


def prepare_isaac_gym_workspace(request: SimulatorWorkspacePrepareRequest) -> PreparedSimulatorWorkspace:
    return prepare_direct_urdf_workspace(
        request,
        workspace_process=ISAAC_GYM_WORKSPACE_PROCESS_PARAMS,
        error=_isaac_gym_error,
    )


def start_isaac_gym_workspace(
    request: SimulatorWorkspacePrepareRequest,
) -> SimulatorWorkspacePrepareResponse:
    return start_direct_urdf_workspace(
        request,
        runtime_spec=ISAAC_GYM_RUNTIME_SPEC,
        workspace_process=ISAAC_GYM_WORKSPACE_PROCESS_PARAMS,
        error=_isaac_gym_error,
        prepare_workspace_package_fn=prepare_isaac_gym_workspace,
    )


ISAAC_GYM_SIMULATOR_ADAPTER: SimulatorAdapter = make_direct_urdf_simulator_adapter(
    runtime_spec=ISAAC_GYM_RUNTIME_SPEC,
    workspace_process=ISAAC_GYM_WORKSPACE_PROCESS_PARAMS,
    error=_isaac_gym_error,
    prepare_workspace_package_fn=prepare_isaac_gym_workspace,
)
