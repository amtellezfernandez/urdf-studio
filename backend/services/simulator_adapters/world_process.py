from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Callable, Sequence

from backend.core.paths import BASE_DIR
from backend.models.simulator_runtime import (
    SimulatorRuntimeSpec,
    SimulatorWorldOpenResponse,
)
from backend.services.simulator_adapters.launch_package import (
    PreparedSimulatorLaunch,
    wait_for_launch_readiness,
)
from backend.services.simulator_adapters.params import SimulatorLaunchParams


def launch_prepared_world_process(
    *,
    runtime_spec: SimulatorRuntimeSpec,
    prepared: PreparedSimulatorLaunch,
    simulator_asset_path: Path,
    simulator_asset_flag: str,
    launch_params: SimulatorLaunchParams,
    error: Callable[[str], Exception],
    simulator_label: str | None = None,
    extra_simulator_args: Sequence[str] = (),
) -> SimulatorWorldOpenResponse:
    log_path = prepared.launch_dir / launch_params.log_name
    command = [
        sys.executable,
        "-u",
        "-m",
        launch_params.module_name,
        "--world-package",
        str(prepared.world_package_path),
        simulator_asset_flag,
        str(simulator_asset_path),
        *extra_simulator_args,
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
        simulator_label=simulator_label or runtime_spec.label,
        log_path=log_path,
        ready_log_marker=launch_params.ready_log_marker,
        log_tail_chars=launch_params.log_tail_chars,
        poll_sec=launch_params.startup_poll_sec,
        ready_timeout_sec=launch_params.ready_timeout_sec,
        post_ready_grace_sec=launch_params.post_ready_grace_sec,
        error=error,
    )
    return SimulatorWorldOpenResponse(
        simulator_id=runtime_spec.simulator_id,
        started=True,
        pid=process.pid,
        command=command,
        log_path=str(log_path),
        world_package_path=str(prepared.world_package_path),
        robot_urdf_path=str(prepared.robot_urdf_path),
        simulator_asset_path=str(simulator_asset_path),
        simulator_asset_format=runtime_spec.transfer.launch_asset_format(),
        bundled_mesh_count=prepared.bundle_result.copied_files,
        unresolved_mesh_refs=list(prepared.bundle_result.unresolved),
    )
