from __future__ import annotations

# Import concrete plugin modules in SIMULATOR_ID_VALUES order to trigger registration.
import backend.services.simulator_adapters.genesis  # noqa: F401
import backend.services.simulator_adapters.mjlab  # noqa: F401
import backend.services.simulator_adapters.mujoco  # noqa: F401
import backend.services.simulator_adapters.mjx  # noqa: F401
import backend.services.simulator_adapters.pybullet  # noqa: F401
import backend.services.simulator_adapters.blender  # noqa: F401
import backend.services.simulator_adapters.planned_simulators  # noqa: F401

from backend.models.simulator_runtime import (
    SIMULATOR_ID_VALUES,
    SimulatorId,
    SimulatorRuntimeListResponse,
    SimulatorRuntimeSpec,
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
from backend.services.simulator_adapters.plugin import get_all_plugins, get_plugin
from backend.services.world_scene_package_digest import normalize_world_snapshot_artifact_digests

_plugins_by_id = {p.simulator_id: p for p in get_all_plugins()}
SUPPORTED_SIMULATOR_IDS: tuple[SimulatorId, ...] = tuple(
    sid for sid in SIMULATOR_ID_VALUES if sid in _plugins_by_id
)
WORKSPACE_SIMULATOR_IDS: tuple[SimulatorId, ...] = tuple(
    sid for sid in SIMULATOR_ID_VALUES
    if (p := _plugins_by_id.get(sid)) is not None
    and p.workspace_target
    and p.transfer_strategy != "planned"
)
WORKSPACE_SIMULATOR_ID_SET = set(WORKSPACE_SIMULATOR_IDS)


def get_simulator_adapter(simulator_id: SimulatorId) -> SimulatorAdapter:
    return get_plugin(simulator_id)


def list_simulator_runtime_descriptors() -> SimulatorRuntimeListResponse:
    descriptors = [
        _plugins_by_id[sid].runtime_spec_descriptor()
        for sid in SIMULATOR_ID_VALUES
        if sid in _plugins_by_id
    ]
    return SimulatorRuntimeListResponse(simulators=descriptors)


def list_simulator_runtime_specs() -> tuple[SimulatorRuntimeSpec, ...]:
    return tuple(
        _plugins_by_id[sid].as_runtime_spec()
        for sid in SIMULATOR_ID_VALUES
        if sid in _plugins_by_id
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
    return get_plugin(simulator_id).prepare_workspace(normalized_request)


def apply_simulator_workspace_change_set(
    simulator_id: SimulatorId,
    request: WorkspaceChangeSetApplyRequest,
) -> WorkspaceChangeSetApplyResponse:
    plugin = get_plugin(simulator_id)
    apply_change_set = getattr(plugin, "apply_workspace_change_set", None)
    if not callable(apply_change_set):
        raise SimulatorCapabilityError(
            f"{plugin.label} workspace change-set import is not supported."
        )
    return apply_change_set(normalize_simulator_workspace_change_set_request(request))


def get_simulator_runtime_status(simulator_id: SimulatorId) -> SimulatorRuntimeStatus:
    return get_plugin(simulator_id).runtime_status()


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
    "list_simulator_runtime_specs",
    "normalize_simulator_workspace_change_set_request",
    "normalize_simulator_workspace_prepare_request",
    "prepare_simulator_workspace",
]
