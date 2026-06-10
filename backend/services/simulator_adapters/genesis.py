from __future__ import annotations

from backend.models.simulator_runtime import (
    SIMULATOR_GENESIS_ID,
    SimulatorWorldOpenRequest,
    SimulatorWorldOpenResponse,
    get_simulator_runtime_spec,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapter,
    SimulatorAdapterError,
)
from backend.services.simulator_adapters.direct_urdf import (
    launch_direct_urdf_world,
    make_direct_urdf_simulator_adapter,
    prepare_direct_urdf_launch,
)
from backend.services.simulator_adapters.launch_package import (
    PreparedSimulatorLaunch,
)
from backend.services.simulator_adapters.params import GENESIS_LAUNCH_PARAMS


GENESIS_RUNTIME_SPEC = get_simulator_runtime_spec(SIMULATOR_GENESIS_ID)


class GenesisWorldLaunchError(SimulatorAdapterError):
    pass


def _genesis_error(message: str) -> GenesisWorldLaunchError:
    return GenesisWorldLaunchError(message)


def prepare_genesis_launch(request: SimulatorWorldOpenRequest) -> PreparedSimulatorLaunch:
    return prepare_direct_urdf_launch(
        request,
        launch_params=GENESIS_LAUNCH_PARAMS,
        error=_genesis_error,
    )


def launch_genesis_world(request: SimulatorWorldOpenRequest) -> SimulatorWorldOpenResponse:
    return launch_direct_urdf_world(
        request,
        runtime_spec=GENESIS_RUNTIME_SPEC,
        launch_params=GENESIS_LAUNCH_PARAMS,
        error=_genesis_error,
        prepare_launch=prepare_genesis_launch,
    )


GENESIS_SIMULATOR_ADAPTER: SimulatorAdapter = make_direct_urdf_simulator_adapter(
    runtime_spec=GENESIS_RUNTIME_SPEC,
    launch_params=GENESIS_LAUNCH_PARAMS,
    error=_genesis_error,
    prepare_launch=prepare_genesis_launch,
)
