from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from backend.models.simulator_runtime import (
    SimulatorId,
    SimulatorRuntimeCapabilities,
    SimulatorRuntimeSpec,
    SimulatorRuntimeStatus,
    SimulatorWorldOpenRequest,
    SimulatorWorldOpenResponse,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapter,
    build_simulator_runtime_status,
)
from backend.services.simulator_adapters.launch_package import (
    PreparedSimulatorLaunch,
    prepare_simulator_launch_package,
)
from backend.services.simulator_adapters.params import SimulatorLaunchParams
from backend.services.simulator_adapters.world_process import launch_prepared_world_process


def prepare_direct_urdf_launch(
    request: SimulatorWorldOpenRequest,
    *,
    launch_params: SimulatorLaunchParams,
    error: Callable[[str], Exception],
) -> PreparedSimulatorLaunch:
    return prepare_simulator_launch_package(
        request,
        launch_root=launch_params.launch_root,
        error=error,
    )


def launch_direct_urdf_world(
    request: SimulatorWorldOpenRequest,
    *,
    runtime_spec: SimulatorRuntimeSpec,
    launch_params: SimulatorLaunchParams,
    error: Callable[[str], Exception],
    prepare_launch: Callable[[SimulatorWorldOpenRequest], PreparedSimulatorLaunch],
) -> SimulatorWorldOpenResponse:
    prepared = prepare_launch(request)
    return launch_prepared_world_process(
        runtime_spec=runtime_spec,
        prepared=prepared,
        simulator_asset_path=prepared.robot_urdf_path,
        simulator_asset_flag="--robot-urdf",
        launch_params=launch_params,
        error=error,
    )


@dataclass(frozen=True)
class DirectUrdfSimulatorAdapter:
    runtime_spec: SimulatorRuntimeSpec
    launch_params: SimulatorLaunchParams
    error: Callable[[str], Exception]
    prepare_launch: Callable[[SimulatorWorldOpenRequest], PreparedSimulatorLaunch]

    @property
    def simulator_id(self) -> SimulatorId:
        return self.runtime_spec.simulator_id

    @property
    def label(self) -> str:
        return self.runtime_spec.label

    @property
    def capabilities(self) -> SimulatorRuntimeCapabilities:
        return self.runtime_spec.capabilities_model()

    def open_world(self, request: SimulatorWorldOpenRequest) -> SimulatorWorldOpenResponse:
        return launch_direct_urdf_world(
            request,
            runtime_spec=self.runtime_spec,
            launch_params=self.launch_params,
            error=self.error,
            prepare_launch=self.prepare_launch,
        )

    def runtime_status(self) -> SimulatorRuntimeStatus:
        return build_simulator_runtime_status(self.runtime_spec)


def make_direct_urdf_simulator_adapter(
    *,
    runtime_spec: SimulatorRuntimeSpec,
    launch_params: SimulatorLaunchParams,
    error: Callable[[str], Exception],
    prepare_launch: Callable[[SimulatorWorldOpenRequest], PreparedSimulatorLaunch],
) -> SimulatorAdapter:
    return DirectUrdfSimulatorAdapter(
        runtime_spec=runtime_spec,
        launch_params=launch_params,
        error=error,
        prepare_launch=prepare_launch,
    )
