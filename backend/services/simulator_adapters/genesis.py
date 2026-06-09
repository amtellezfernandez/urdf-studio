from __future__ import annotations

import subprocess
import sys

from backend.models.simulator_runtime import (
    SIMULATOR_GENESIS_ID,
    SimulatorRuntimeStatus,
    SimulatorWorldOpenRequest,
    SimulatorWorldOpenResponse,
    get_simulator_runtime_spec,
)
from backend.core.paths import BASE_DIR
from backend.services.simulator_adapters.base import (
    SimulatorAdapter,
    SimulatorAdapterError,
    build_runtime_dependency_statuses,
    format_runtime_dependency_status,
)
from backend.services.simulator_adapters.launch_package import (
    PreparedSimulatorLaunch,
    prepare_simulator_launch_package,
    wait_for_launch_readiness,
)
from backend.services.simulator_adapters.params import GENESIS_LAUNCH_PARAMS


GENESIS_RUNTIME_SPEC = get_simulator_runtime_spec(SIMULATOR_GENESIS_ID)


class GenesisWorldLaunchError(SimulatorAdapterError):
    pass


def _genesis_error(message: str) -> GenesisWorldLaunchError:
    return GenesisWorldLaunchError(message)


def _prepare_genesis_launch(request: SimulatorWorldOpenRequest) -> PreparedSimulatorLaunch:
    return prepare_simulator_launch_package(
        request,
        launch_root=GENESIS_LAUNCH_PARAMS.launch_root,
        error=_genesis_error,
    )


def launch_genesis_world(request: SimulatorWorldOpenRequest) -> SimulatorWorldOpenResponse:
    prepared = _prepare_genesis_launch(request)
    log_path = prepared.launch_dir / GENESIS_LAUNCH_PARAMS.log_name
    command = [
        sys.executable,
        "-u",
        "-m",
        GENESIS_LAUNCH_PARAMS.module_name,
        "--world-package",
        str(prepared.world_package_path),
        "--robot-urdf",
        str(prepared.robot_urdf_path),
        "--frame-map",
        "auto",
    ]
    with log_path.open("ab", buffering=0) as log_file:
        process = subprocess.Popen(
            command,
            cwd=BASE_DIR,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    wait_for_launch_readiness(
        process,
        simulator_label=GENESIS_RUNTIME_SPEC.label,
        log_path=log_path,
        ready_log_marker=GENESIS_LAUNCH_PARAMS.ready_log_marker,
        log_tail_chars=GENESIS_LAUNCH_PARAMS.log_tail_chars,
        poll_sec=GENESIS_LAUNCH_PARAMS.startup_poll_sec,
        ready_timeout_sec=GENESIS_LAUNCH_PARAMS.ready_timeout_sec,
        post_ready_grace_sec=GENESIS_LAUNCH_PARAMS.post_ready_grace_sec,
        error=_genesis_error,
    )
    return SimulatorWorldOpenResponse(
        simulator_id=GENESIS_RUNTIME_SPEC.simulator_id,
        started=True,
        pid=process.pid,
        command=command,
        log_path=str(log_path),
        world_package_path=str(prepared.world_package_path),
        robot_urdf_path=str(prepared.robot_urdf_path),
        simulator_asset_path=str(prepared.robot_urdf_path),
        simulator_asset_format="urdf",
        bundled_mesh_count=prepared.bundle_result.copied_files,
        unresolved_mesh_refs=list(prepared.bundle_result.unresolved),
    )


class GenesisSimulatorAdapter:
    simulator_id = GENESIS_RUNTIME_SPEC.simulator_id
    label = GENESIS_RUNTIME_SPEC.label
    capabilities = GENESIS_RUNTIME_SPEC.capabilities_model()

    def open_world(self, request: SimulatorWorldOpenRequest) -> SimulatorWorldOpenResponse:
        return launch_genesis_world(request)

    def runtime_status(self) -> SimulatorRuntimeStatus:
        dependencies = build_runtime_dependency_statuses(GENESIS_RUNTIME_SPEC.dependencies)
        available, status = format_runtime_dependency_status(
            ready_status="ready",
            missing_status_prefix="Missing dependency",
            dependencies=dependencies,
        )
        return SimulatorRuntimeStatus(
            runtimeName=self.simulator_id,
            available=available,
            status=status,
            dependencies=dependencies,
        )


GENESIS_SIMULATOR_ADAPTER: SimulatorAdapter = GenesisSimulatorAdapter()
