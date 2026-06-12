from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from backend.models.simulator_runtime import (
    SimulatorId,
    SimulatorRuntimeCapabilities,
    SimulatorRuntimeSpec,
    SimulatorRuntimeStatus,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapter,
    build_simulator_runtime_status,
)
from backend.services.simulator_adapters.workspace_package import (
    PreparedSimulatorWorkspace,
    prepare_simulator_workspace_package,
)
from backend.services.simulator_adapters.params import SimulatorWorkspaceProcessParams
from backend.services.simulator_adapters.workspace_process import start_prepared_workspace_process


def prepare_direct_urdf_workspace(
    request: SimulatorWorkspacePrepareRequest,
    *,
    workspace_process: SimulatorWorkspaceProcessParams,
    error: Callable[[str], Exception],
) -> PreparedSimulatorWorkspace:
    return prepare_simulator_workspace_package(
        request,
        workspace_root=workspace_process.workspace_root,
        error=error,
    )


def start_direct_urdf_workspace(
    request: SimulatorWorkspacePrepareRequest,
    *,
    runtime_spec: SimulatorRuntimeSpec,
    workspace_process: SimulatorWorkspaceProcessParams,
    error: Callable[[str], Exception],
    prepare_workspace_package_fn: Callable[[SimulatorWorkspacePrepareRequest], PreparedSimulatorWorkspace],
) -> SimulatorWorkspacePrepareResponse:
    prepared = prepare_workspace_package_fn(request)
    return start_prepared_workspace_process(
        runtime_spec=runtime_spec,
        prepared=prepared,
        simulator_asset_path=prepared.robot_urdf_path,
        simulator_asset_flag="--robot-urdf",
        workspace_process=workspace_process,
        error=error,
    )


@dataclass(frozen=True)
class DirectUrdfSimulatorAdapter:
    runtime_spec: SimulatorRuntimeSpec
    workspace_process: SimulatorWorkspaceProcessParams
    error: Callable[[str], Exception]
    prepare_workspace_package_fn: Callable[[SimulatorWorkspacePrepareRequest], PreparedSimulatorWorkspace]

    @property
    def simulator_id(self) -> SimulatorId:
        return self.runtime_spec.simulator_id

    @property
    def label(self) -> str:
        return self.runtime_spec.label

    @property
    def capabilities(self) -> SimulatorRuntimeCapabilities:
        return self.runtime_spec.capabilities_model()

    def prepare_workspace(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> SimulatorWorkspacePrepareResponse:
        return start_direct_urdf_workspace(
            request,
            runtime_spec=self.runtime_spec,
            workspace_process=self.workspace_process,
            error=self.error,
            prepare_workspace_package_fn=self.prepare_workspace_package_fn,
        )

    def runtime_status(self) -> SimulatorRuntimeStatus:
        return build_simulator_runtime_status(self.runtime_spec)


def make_direct_urdf_simulator_adapter(
    *,
    runtime_spec: SimulatorRuntimeSpec,
    workspace_process: SimulatorWorkspaceProcessParams,
    error: Callable[[str], Exception],
    prepare_workspace_package_fn: Callable[[SimulatorWorkspacePrepareRequest], PreparedSimulatorWorkspace],
) -> SimulatorAdapter:
    return DirectUrdfSimulatorAdapter(
        runtime_spec=runtime_spec,
        workspace_process=workspace_process,
        error=error,
        prepare_workspace_package_fn=prepare_workspace_package_fn,
    )
