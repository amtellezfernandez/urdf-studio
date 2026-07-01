from __future__ import annotations

from backend.models.simulator_runtime import (
    SIMULATOR_RUNTIME_SPECS,
    SUPPORTED_SIMULATOR_IDS,
    SimulatorId,
    SimulatorRuntimeDescriptor,
    SimulatorRuntimeListResponse,
    SimulatorRuntimeStatus,
    WorkspaceChangeSetApplyRequest,
    WorkspaceChangeSetApplyResponse,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapter,
    SimulatorAdapterError,
    SimulatorCapabilityError,
)
from backend.services.simulator_adapters.blender import BLENDER_SIMULATOR_ADAPTER
from backend.services.simulator_adapters.coppeliasim import COPPELIASIM_SIMULATOR_ADAPTER
from backend.services.simulator_adapters.genesis import (
    GENESIS_SIMULATOR_ADAPTER,
)
from backend.services.simulator_adapters.isaac import (
    ISAAC_LAB_SIMULATOR_ADAPTER,
    ISAAC_SIM_SIMULATOR_ADAPTER,
)
from backend.services.simulator_adapters.mjx import MJX_SIMULATOR_ADAPTER
from backend.services.simulator_adapters.mujoco import MUJOCO_SIMULATOR_ADAPTER
from backend.services.simulator_adapters.optional_runtime import make_optional_simulator_adapter
from backend.services.simulator_adapters.pybullet import PYBULLET_SIMULATOR_ADAPTER
from backend.services.simulator_adapters.sapien import SAPIEN_SIMULATOR_ADAPTER
from backend.services.world_scene_package_digest import normalize_world_snapshot_artifact_digests


def _build_adapter_map(adapters: tuple[SimulatorAdapter, ...]) -> dict[SimulatorId, SimulatorAdapter]:
    adapter_map: dict[SimulatorId, SimulatorAdapter] = {}
    for adapter in adapters:
        if adapter.simulator_id in adapter_map:
            raise RuntimeError(f"Duplicate simulator adapter id: {adapter.simulator_id}")
        adapter_map[adapter.simulator_id] = adapter
    return adapter_map


_WORKSPACE_SIMULATOR_ADAPTERS = _build_adapter_map(
    (
        GENESIS_SIMULATOR_ADAPTER,
        MUJOCO_SIMULATOR_ADAPTER,
        MJX_SIMULATOR_ADAPTER,
        ISAAC_SIM_SIMULATOR_ADAPTER,
        ISAAC_LAB_SIMULATOR_ADAPTER,
        PYBULLET_SIMULATOR_ADAPTER,
        SAPIEN_SIMULATOR_ADAPTER,
        COPPELIASIM_SIMULATOR_ADAPTER,
        BLENDER_SIMULATOR_ADAPTER,
    )
)
WORKSPACE_SIMULATOR_IDS: tuple[SimulatorId, ...] = tuple(
    spec.simulator_id
    for spec in SIMULATOR_RUNTIME_SPECS
    if spec.workspace_target and spec.transfer.transfer_strategy != "planned"
)
WORKSPACE_SIMULATOR_ID_SET = set(WORKSPACE_SIMULATOR_IDS)

if set(_WORKSPACE_SIMULATOR_ADAPTERS) != WORKSPACE_SIMULATOR_ID_SET:
    missing = sorted(WORKSPACE_SIMULATOR_ID_SET - set(_WORKSPACE_SIMULATOR_ADAPTERS))
    extra = sorted(set(_WORKSPACE_SIMULATOR_ADAPTERS) - WORKSPACE_SIMULATOR_ID_SET)
    raise RuntimeError(
        "Workspace simulator adapter registry does not match runtime specs "
        f"(missing={missing}, extra={extra})."
    )

_OPTIONAL_SIMULATOR_ADAPTERS: dict[SimulatorId, SimulatorAdapter] = {
    spec.simulator_id: make_optional_simulator_adapter(spec=spec)
    for spec in SIMULATOR_RUNTIME_SPECS
    if spec.simulator_id not in WORKSPACE_SIMULATOR_ID_SET
}
_SIMULATOR_ADAPTERS: dict[SimulatorId, SimulatorAdapter] = {
    **_WORKSPACE_SIMULATOR_ADAPTERS,
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
                targetKind=spec.target_kind,
                capabilities=spec.capabilities_model(),
                transferPolicy=spec.transfer.runtime_model(),
            )
        )
    return SimulatorRuntimeListResponse(
        simulators=descriptors,
    )


def normalize_simulator_workspace_prepare_request(
    request: SimulatorWorkspacePrepareRequest,
) -> SimulatorWorkspacePrepareRequest:
    return request.model_copy(
        update={"world_package": normalize_world_snapshot_artifact_digests(request.world_package)},
        deep=True,
    )


def normalize_simulator_workspace_change_set_request(
    request: WorkspaceChangeSetApplyRequest,
) -> WorkspaceChangeSetApplyRequest:
    return request.model_copy(
        update={"world_package": normalize_world_snapshot_artifact_digests(request.world_package)},
        deep=True,
    )


def prepare_simulator_workspace(
    simulator_id: SimulatorId,
    request: SimulatorWorkspacePrepareRequest,
) -> SimulatorWorkspacePrepareResponse:
    normalized_request = normalize_simulator_workspace_prepare_request(request)
    return get_simulator_adapter(simulator_id).prepare_workspace(normalized_request)


def apply_simulator_workspace_change_set(
    simulator_id: SimulatorId,
    request: WorkspaceChangeSetApplyRequest,
) -> WorkspaceChangeSetApplyResponse:
    adapter = get_simulator_adapter(simulator_id)
    apply_change_set = getattr(adapter, "apply_workspace_change_set", None)
    if not callable(apply_change_set):
        raise SimulatorCapabilityError(
            f"{adapter.label} workspace change-set import is not supported."
        )
    return apply_change_set(normalize_simulator_workspace_change_set_request(request))


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
    "apply_simulator_workspace_change_set",
    "list_simulator_runtime_descriptors",
    "normalize_simulator_workspace_change_set_request",
    "normalize_simulator_workspace_prepare_request",
    "prepare_simulator_workspace",
]
