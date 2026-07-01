from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from backend.models.simulator_runtime import (
    SIMULATOR_ISAAC_LAB_ID,
    SIMULATOR_ISAAC_SIM_ID,
    SimulatorId,
    SimulatorRuntimeDependency,
    SimulatorRuntimeSpec,
    SimulatorRuntimeStatus,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
    get_simulator_runtime_spec,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapter,
    SimulatorAdapterError,
    build_runtime_dependency_statuses,
    format_runtime_dependency_status,
)
from backend.services.simulator_adapters.isaac_runtime import (
    ISAAC_EULA_ENV,
    isaac_eula_accepted,
)
from backend.services.simulator_adapters.params import (
    ISAAC_LAB_WORKSPACE_PROCESS_PARAMS,
    ISAAC_SIM_WORKSPACE_PROCESS_PARAMS,
    SimulatorWorkspaceProcessParams,
)
from backend.services.simulator_adapters.workspace_package import (
    PreparedSimulatorWorkspace,
    prepare_simulator_workspace_package,
)
from backend.services.simulator_adapters.workspace_process import start_prepared_workspace_process


ISAAC_SIM_RUNTIME_SPEC = get_simulator_runtime_spec(SIMULATOR_ISAAC_SIM_ID)
ISAAC_LAB_RUNTIME_SPEC = get_simulator_runtime_spec(SIMULATOR_ISAAC_LAB_ID)


class IsaacWorkspaceError(SimulatorAdapterError):
    pass


@dataclass(frozen=True)
class PreparedIsaacWorkspace:
    shared_workspace: PreparedSimulatorWorkspace
    stage_usd_path: Path


def _isaac_error(message: str) -> IsaacWorkspaceError:
    return IsaacWorkspaceError(message)


def _workspace_process(simulator_id: SimulatorId) -> SimulatorWorkspaceProcessParams:
    if simulator_id == SIMULATOR_ISAAC_LAB_ID:
        return ISAAC_LAB_WORKSPACE_PROCESS_PARAMS
    return ISAAC_SIM_WORKSPACE_PROCESS_PARAMS


def _runtime_spec(simulator_id: SimulatorId) -> SimulatorRuntimeSpec:
    if simulator_id == SIMULATOR_ISAAC_LAB_ID:
        return ISAAC_LAB_RUNTIME_SPEC
    return ISAAC_SIM_RUNTIME_SPEC


def prepare_isaac_workspace(
    request: SimulatorWorkspacePrepareRequest,
    *,
    simulator_id: SimulatorId,
) -> PreparedIsaacWorkspace:
    workspace_process = _workspace_process(simulator_id)
    prepared = prepare_simulator_workspace_package(
        request,
        workspace_root=workspace_process.workspace_root,
        error=_isaac_error,
    )
    stage_usd_path = prepared.workspace_dir / "isaac" / "workspace.usda"
    stage_usd_path.parent.mkdir(parents=True, exist_ok=True)
    stage_usd_path.write_text(
        '#usda 1.0\n(\n    defaultPrim = "World"\n    upAxis = "Z"\n)\n\ndef Xform "World"\n{\n}\n',
        encoding="utf-8",
    )
    return PreparedIsaacWorkspace(
        shared_workspace=prepared,
        stage_usd_path=stage_usd_path,
    )


def start_isaac_workspace(
    request: SimulatorWorkspacePrepareRequest,
    *,
    simulator_id: SimulatorId,
) -> SimulatorWorkspacePrepareResponse:
    runtime_spec = _runtime_spec(simulator_id)
    workspace_process = _workspace_process(simulator_id)
    prepared = prepare_isaac_workspace(request, simulator_id=simulator_id)
    shared = prepared.shared_workspace
    return start_prepared_workspace_process(
        runtime_spec=runtime_spec,
        prepared=shared,
        simulator_asset_path=prepared.stage_usd_path,
        simulator_asset_flag="--stage-usd",
        workspace_process=workspace_process,
        error=_isaac_error,
        simulator_label=runtime_spec.label,
        extra_simulator_args=(
            "--robot-urdf",
            str(shared.robot_urdf_path),
            "--simulator-id",
            simulator_id,
        ),
    )


def _isaac_runtime_status(spec: SimulatorRuntimeSpec) -> SimulatorRuntimeStatus:
    dependencies = build_runtime_dependency_statuses(spec.dependencies)
    dependencies.append(
        SimulatorRuntimeDependency(
            name=f"{ISAAC_EULA_ENV}=YES",
            available=isaac_eula_accepted(),
        )
    )
    available, status = format_runtime_dependency_status(
        ready_status="ready",
        missing_status_prefix=(
            "Missing dependency; install the Isaac runtime and set "
            f"{ISAAC_EULA_ENV}=YES only after accepting NVIDIA's Omniverse EULA"
        ),
        dependencies=dependencies,
    )
    return SimulatorRuntimeStatus(
        runtimeName=spec.simulator_id,
        available=available,
        status=status,
        dependencies=dependencies,
    )


class IsaacSimulatorAdapter:
    def __init__(self, runtime_spec: SimulatorRuntimeSpec) -> None:
        self.runtime_spec = runtime_spec
        self.simulator_id = runtime_spec.simulator_id
        self.label = runtime_spec.label
        self.capabilities = runtime_spec.capabilities_model()

    def prepare_workspace(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> SimulatorWorkspacePrepareResponse:
        return start_isaac_workspace(request, simulator_id=self.simulator_id)

    def runtime_status(self) -> SimulatorRuntimeStatus:
        return _isaac_runtime_status(self.runtime_spec)


ISAAC_SIM_SIMULATOR_ADAPTER: SimulatorAdapter = IsaacSimulatorAdapter(ISAAC_SIM_RUNTIME_SPEC)
ISAAC_LAB_SIMULATOR_ADAPTER: SimulatorAdapter = IsaacSimulatorAdapter(ISAAC_LAB_RUNTIME_SPEC)
