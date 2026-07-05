from __future__ import annotations

import importlib
from collections.abc import Iterator
from typing import TypeVar

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
from backend.services.simulator_adapters.plugin import (
    SimulatorPlugin,
    get_all_plugins,
    get_plugin,
)
from backend.services.world_scene_package_digest import normalize_world_snapshot_artifact_digests

WorkspacePackageRequest = TypeVar(
    "WorkspacePackageRequest",
    SimulatorWorkspacePrepareRequest,
    WorkspaceChangeSetApplyRequest,
)

_BUILTIN_PLUGIN_MODULES = (
    "backend.services.simulator_adapters.genesis",
    "backend.services.simulator_adapters.mjlab",
    "backend.services.simulator_adapters.mujoco",
    "backend.services.simulator_adapters.mjx",
    "backend.services.simulator_adapters.pybullet",
    "backend.services.simulator_adapters.blender",
    "backend.services.simulator_adapters.planned_simulators",
)


def ensure_builtin_simulator_plugins_registered() -> None:
    for module_name in _BUILTIN_PLUGIN_MODULES:
        importlib.import_module(module_name)


ensure_builtin_simulator_plugins_registered()

_plugins_by_id: dict[SimulatorId, SimulatorPlugin] = {
    p.simulator_id: p for p in get_all_plugins()
}


def _iter_supported_plugins() -> Iterator[SimulatorPlugin]:
    for simulator_id in SIMULATOR_ID_VALUES:
        plugin = _plugins_by_id.get(simulator_id)
        if plugin is not None:
            yield plugin


def _normalize_world_package_request(
    request: WorkspacePackageRequest,
) -> WorkspacePackageRequest:
    return request.model_copy(
        update={"world_package": normalize_world_snapshot_artifact_digests(request.world_package)},
        deep=True,
    )


SUPPORTED_SIMULATOR_IDS: tuple[SimulatorId, ...] = tuple(
    plugin.simulator_id for plugin in _iter_supported_plugins()
)
WORKSPACE_SIMULATOR_IDS: tuple[SimulatorId, ...] = tuple(
    plugin.simulator_id
    for plugin in _iter_supported_plugins()
    if plugin.workspace_target and plugin.transfer_strategy != "planned"
)
WORKSPACE_SIMULATOR_ID_SET: set[SimulatorId] = set(WORKSPACE_SIMULATOR_IDS)


def get_simulator_adapter(simulator_id: SimulatorId) -> SimulatorAdapter:
    return get_plugin(simulator_id)


def list_simulator_runtime_descriptors() -> SimulatorRuntimeListResponse:
    descriptors = [plugin.runtime_spec_descriptor() for plugin in _iter_supported_plugins()]
    return SimulatorRuntimeListResponse(simulators=descriptors)


def list_simulator_runtime_specs() -> tuple[SimulatorRuntimeSpec, ...]:
    return tuple(plugin.as_runtime_spec() for plugin in _iter_supported_plugins())


def normalize_simulator_workspace_prepare_request(
    request: SimulatorWorkspacePrepareRequest,
) -> SimulatorWorkspacePrepareRequest:
    return _normalize_world_package_request(request)


def normalize_simulator_workspace_change_set_request(
    request: WorkspaceChangeSetApplyRequest,
) -> WorkspaceChangeSetApplyRequest:
    return _normalize_world_package_request(request)


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
    "ensure_builtin_simulator_plugins_registered",
    "get_simulator_adapter",
    "get_simulator_runtime_status",
    "apply_simulator_workspace_change_set",
    "list_simulator_runtime_descriptors",
    "list_simulator_runtime_specs",
    "normalize_simulator_workspace_change_set_request",
    "normalize_simulator_workspace_prepare_request",
    "prepare_simulator_workspace",
]
