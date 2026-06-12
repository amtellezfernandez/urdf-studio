from __future__ import annotations

from backend.models.simulator_runtime import (
    SIMULATOR_MJLAB_ID,
    SimulatorRuntimeDependency,
    SimulatorRuntimeStatus,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
    get_simulator_runtime_spec,
)
from backend.services.simulator_adapters.base import SimulatorAdapter
from backend.services.simulator_adapters.mujoco import start_mujoco_workspace
from backend.services.teleop_mjlab import resolve_teleop_mjlab_runtime_status


MJLAB_RUNTIME_SPEC = get_simulator_runtime_spec(SIMULATOR_MJLAB_ID)


class MjlabSimulatorAdapter:
    simulator_id = MJLAB_RUNTIME_SPEC.simulator_id
    label = MJLAB_RUNTIME_SPEC.label
    capabilities = MJLAB_RUNTIME_SPEC.capabilities_model()

    def prepare_workspace(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> SimulatorWorkspacePrepareResponse:
        return start_mujoco_workspace(
            request,
            simulator_id=self.simulator_id,
            simulator_label=self.label,
        )

    def runtime_status(self) -> SimulatorRuntimeStatus:
        status = resolve_teleop_mjlab_runtime_status()
        return SimulatorRuntimeStatus(
            runtimeName=self.simulator_id,
            available=status.available,
            status=status.status,
            dependencies=[
                SimulatorRuntimeDependency(name=dependency.name, available=dependency.available)
                for dependency in status.dependencies
            ],
        )


MJLAB_SIMULATOR_ADAPTER: SimulatorAdapter = MjlabSimulatorAdapter()
