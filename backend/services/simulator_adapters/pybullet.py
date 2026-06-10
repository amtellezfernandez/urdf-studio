from __future__ import annotations

from backend.models.simulator_runtime import (
    SIMULATOR_PYBULLET_ID,
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
from backend.services.simulator_adapters.params import PYBULLET_LAUNCH_PARAMS


PYBULLET_RUNTIME_SPEC = get_simulator_runtime_spec(SIMULATOR_PYBULLET_ID)


class PyBulletWorldLaunchError(SimulatorAdapterError):
    pass


def _pybullet_error(message: str) -> PyBulletWorldLaunchError:
    return PyBulletWorldLaunchError(message)


def prepare_pybullet_launch(request: SimulatorWorldOpenRequest) -> PreparedSimulatorLaunch:
    return prepare_direct_urdf_launch(
        request,
        launch_params=PYBULLET_LAUNCH_PARAMS,
        error=_pybullet_error,
    )


def launch_pybullet_world(request: SimulatorWorldOpenRequest) -> SimulatorWorldOpenResponse:
    return launch_direct_urdf_world(
        request,
        runtime_spec=PYBULLET_RUNTIME_SPEC,
        launch_params=PYBULLET_LAUNCH_PARAMS,
        error=_pybullet_error,
        prepare_launch=prepare_pybullet_launch,
    )


PYBULLET_SIMULATOR_ADAPTER: SimulatorAdapter = make_direct_urdf_simulator_adapter(
    runtime_spec=PYBULLET_RUNTIME_SPEC,
    launch_params=PYBULLET_LAUNCH_PARAMS,
    error=_pybullet_error,
    prepare_launch=prepare_pybullet_launch,
)
