from __future__ import annotations

from backend.models.simulator_runtime import (
    SIMULATOR_MJX_ID,
    SimulatorRuntimeStatus,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
    get_simulator_runtime_spec,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapter,
    SimulatorAdapterError,
    build_simulator_runtime_status,
)
from backend.services.simulator_adapters.mujoco import (
    PreparedMujocoWorkspace,
    prepare_mujoco_workspace,
)
from backend.services.simulator_adapters.params import MJX_WORKSPACE_PROCESS_PARAMS
from backend.services.simulator_adapters.workspace_process import start_prepared_workspace_process


MJX_RUNTIME_SPEC = get_simulator_runtime_spec(SIMULATOR_MJX_ID)


class MjxWorkspaceError(SimulatorAdapterError):
    pass


def _mjx_error(message: str) -> MjxWorkspaceError:
    return MjxWorkspaceError(message)


def prepare_mjx_workspace(request: SimulatorWorkspacePrepareRequest) -> PreparedMujocoWorkspace:
    try:
        return prepare_mujoco_workspace(
            request,
            simulator_id=SIMULATOR_MJX_ID,
        )
    except SimulatorAdapterError as exc:
        raise MjxWorkspaceError(f"MuJoCo MJX workspace preparation failed: {exc}") from exc


def start_mjx_workspace(
    request: SimulatorWorkspacePrepareRequest,
) -> SimulatorWorkspacePrepareResponse:
    prepared = prepare_mjx_workspace(request)
    shared = prepared.shared_workspace
    return start_prepared_workspace_process(
        runtime_spec=MJX_RUNTIME_SPEC,
        prepared=shared,
        simulator_asset_path=prepared.mjcf_path,
        simulator_asset_flag="--robot-mjcf",
        workspace_process=MJX_WORKSPACE_PROCESS_PARAMS,
        error=_mjx_error,
        simulator_label=MJX_RUNTIME_SPEC.label,
        extra_simulator_args=("--robot-urdf", str(shared.robot_urdf_path)),
    )


class MjxSimulatorAdapter:
    simulator_id = MJX_RUNTIME_SPEC.simulator_id
    label = MJX_RUNTIME_SPEC.label
    capabilities = MJX_RUNTIME_SPEC.capabilities_model()

    def prepare_workspace(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> SimulatorWorkspacePrepareResponse:
        return start_mjx_workspace(request)

    def runtime_status(self) -> SimulatorRuntimeStatus:
        return build_simulator_runtime_status(MJX_RUNTIME_SPEC)


MJX_SIMULATOR_ADAPTER: SimulatorAdapter = MjxSimulatorAdapter()
