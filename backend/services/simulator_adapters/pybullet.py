from __future__ import annotations

from backend.models.simulator_runtime import (
    SIMULATOR_PYBULLET_ID,
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
from backend.services.simulator_adapters.params import PYBULLET_WORKSPACE_PROCESS_PARAMS


PYBULLET_RUNTIME_SPEC = get_simulator_runtime_spec(SIMULATOR_PYBULLET_ID)


class PyBulletWorkspaceError(SimulatorAdapterError):
    pass


def _pybullet_error(message: str) -> PyBulletWorkspaceError:
    return PyBulletWorkspaceError(message)


def prepare_pybullet_workspace(request: SimulatorWorkspacePrepareRequest) -> PreparedSimulatorWorkspace:
    return prepare_direct_urdf_workspace(
        request,
        workspace_process=PYBULLET_WORKSPACE_PROCESS_PARAMS,
        error=_pybullet_error,
    )


def start_pybullet_workspace(
    request: SimulatorWorkspacePrepareRequest,
) -> SimulatorWorkspacePrepareResponse:
    return start_direct_urdf_workspace(
        request,
        runtime_spec=PYBULLET_RUNTIME_SPEC,
        workspace_process=PYBULLET_WORKSPACE_PROCESS_PARAMS,
        error=_pybullet_error,
        prepare_workspace_package_fn=prepare_pybullet_workspace,
    )


PYBULLET_SIMULATOR_ADAPTER: SimulatorAdapter = make_direct_urdf_simulator_adapter(
    runtime_spec=PYBULLET_RUNTIME_SPEC,
    workspace_process=PYBULLET_WORKSPACE_PROCESS_PARAMS,
    error=_pybullet_error,
    prepare_workspace_package_fn=prepare_pybullet_workspace,
)
