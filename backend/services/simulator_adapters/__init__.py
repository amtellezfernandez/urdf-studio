from __future__ import annotations

from backend.models.simulator_runtime import (
    SIMULATOR_GENESIS_ID,
    SIMULATOR_BLENDER_ID,
    SIMULATOR_MJLAB_ID,
    SIMULATOR_MUJOCO_ID,
    SIMULATOR_PYBULLET_ID,
    SIMULATOR_RUNTIME_SPECS,
    SUPPORTED_SIMULATOR_IDS,
    SimulatorId,
    SimulatorRuntimeDescriptor,
    SimulatorRuntimeListResponse,
    SimulatorRuntimeStatus,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapter,
    SimulatorAdapterError,
    SimulatorCapabilityError,
)
from backend.services.simulator_adapters.blender import BLENDER_SIMULATOR_ADAPTER
from backend.services.simulator_adapters.genesis import (
    GENESIS_SIMULATOR_ADAPTER,
)
from backend.services.simulator_adapters.mjlab import MJLAB_SIMULATOR_ADAPTER
from backend.services.simulator_adapters.mujoco import MUJOCO_SIMULATOR_ADAPTER
from backend.services.simulator_adapters.optional_runtime import make_optional_simulator_adapter
from backend.services.simulator_adapters.pybullet import PYBULLET_SIMULATOR_ADAPTER


WORKSPACE_SIMULATOR_IDS: tuple[SimulatorId, ...] = (
    SIMULATOR_GENESIS_ID,
    SIMULATOR_MJLAB_ID,
    SIMULATOR_MUJOCO_ID,
    SIMULATOR_PYBULLET_ID,
    SIMULATOR_BLENDER_ID,
)
WORKSPACE_SIMULATOR_ID_SET = set(WORKSPACE_SIMULATOR_IDS)
_OPTIONAL_SIMULATOR_ADAPTERS: dict[SimulatorId, SimulatorAdapter] = {
    spec.simulator_id: make_optional_simulator_adapter(spec=spec)
    for spec in SIMULATOR_RUNTIME_SPECS
    if spec.simulator_id not in WORKSPACE_SIMULATOR_ID_SET
}
_SIMULATOR_ADAPTERS: dict[SimulatorId, SimulatorAdapter] = {
    GENESIS_SIMULATOR_ADAPTER.simulator_id: GENESIS_SIMULATOR_ADAPTER,
    MJLAB_SIMULATOR_ADAPTER.simulator_id: MJLAB_SIMULATOR_ADAPTER,
    MUJOCO_SIMULATOR_ADAPTER.simulator_id: MUJOCO_SIMULATOR_ADAPTER,
    PYBULLET_SIMULATOR_ADAPTER.simulator_id: PYBULLET_SIMULATOR_ADAPTER,
    BLENDER_SIMULATOR_ADAPTER.simulator_id: BLENDER_SIMULATOR_ADAPTER,
    **_OPTIONAL_SIMULATOR_ADAPTERS,
}


def get_simulator_adapter(simulator_id: SimulatorId) -> SimulatorAdapter:
    try:
        return _SIMULATOR_ADAPTERS[simulator_id]
    except KeyError as exc:
        raise SimulatorCapabilityError(f"Unsupported simulator: {simulator_id}") from exc


def list_simulator_runtime_descriptors() -> SimulatorRuntimeListResponse:
    descriptors: list[SimulatorRuntimeDescriptor] = []
    for spec in SIMULATOR_RUNTIME_SPECS:
        get_simulator_adapter(spec.simulator_id)
        descriptors.append(
            SimulatorRuntimeDescriptor(
                simulatorId=spec.simulator_id,
                label=spec.label,
                capabilities=spec.capabilities_model(),
                transferPolicy=spec.transfer.runtime_model(),
            )
        )
    return SimulatorRuntimeListResponse(
        simulators=descriptors,
    )


def prepare_simulator_workspace(
    simulator_id: SimulatorId,
    request: SimulatorWorkspacePrepareRequest,
) -> SimulatorWorkspacePrepareResponse:
    return get_simulator_adapter(simulator_id).prepare_workspace(request)


def get_simulator_runtime_status(simulator_id: SimulatorId) -> SimulatorRuntimeStatus:
    return get_simulator_adapter(simulator_id).runtime_status()


__all__ = [
    "SUPPORTED_SIMULATOR_IDS",
    "WORKSPACE_SIMULATOR_IDS",
    "SimulatorAdapter",
    "SimulatorAdapterError",
    "SimulatorCapabilityError",
    "get_simulator_adapter",
    "get_simulator_runtime_status",
    "list_simulator_runtime_descriptors",
    "prepare_simulator_workspace",
]
