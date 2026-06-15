from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Callable, Sequence

from backend.core.paths import BASE_DIR
from backend.models.simulator_runtime import (
    SimulatorRuntimeSpec,
    SimulatorWorkspacePrepareResponse,
)
from backend.services.simulator_adapters.workspace_package import (
    PreparedSimulatorWorkspace,
    wait_for_workspace_readiness,
)
from backend.services.simulator_adapters.params import SimulatorWorkspaceProcessParams


def build_simulator_workspace_env(cache_root: Path) -> dict[str, str]:
    cache_root.mkdir(parents=True, exist_ok=True)
    cache_dirs = {
        "XDG_CACHE_HOME": cache_root / "xdg",
        "MPLCONFIGDIR": cache_root / "matplotlib",
        "NUMBA_CACHE_DIR": cache_root / "numba",
        "TI_CACHE_HOME": cache_root / "taichi",
        "TAICHI_CACHE_HOME": cache_root / "taichi",
        "QUADRANTS_CACHE_DIR": cache_root / "quadrants",
        "QDCACHE_DIR": cache_root / "quadrants",
    }
    for path in cache_dirs.values():
        path.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env.update({name: str(path) for name, path in cache_dirs.items()})
    return env


def start_prepared_workspace_process(
    *,
    runtime_spec: SimulatorRuntimeSpec,
    prepared: PreparedSimulatorWorkspace,
    simulator_asset_path: Path,
    simulator_asset_flag: str,
    workspace_process: SimulatorWorkspaceProcessParams,
    error: Callable[[str], Exception],
    simulator_label: str | None = None,
    extra_simulator_args: Sequence[str] = (),
) -> SimulatorWorkspacePrepareResponse:
    log_path = prepared.workspace_dir / workspace_process.log_name
    command = [
        sys.executable,
        "-u",
        "-m",
        workspace_process.module_name,
        "--world-package",
        str(prepared.world_package_path),
        simulator_asset_flag,
        str(simulator_asset_path),
        *extra_simulator_args,
        "--frame-map",
        "identity",
    ]
    with log_path.open("ab", buffering=0) as log_file:
        process = subprocess.Popen(
            command,
            cwd=BASE_DIR,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            env=build_simulator_workspace_env(prepared.workspace_dir / "runtime-cache"),
        )
    wait_for_workspace_readiness(
        process,
        simulator_label=simulator_label or runtime_spec.label,
        log_path=log_path,
        ready_log_marker=workspace_process.ready_log_marker,
        log_tail_chars=workspace_process.log_tail_chars,
        poll_sec=workspace_process.startup_poll_sec,
        ready_timeout_sec=workspace_process.ready_timeout_sec,
        post_ready_grace_sec=workspace_process.post_ready_grace_sec,
        error=error,
    )
    return SimulatorWorkspacePrepareResponse(
        simulator_id=runtime_spec.simulator_id,
        started=True,
        pid=process.pid,
        command=command,
        log_path=str(log_path),
        world_package_path=str(prepared.world_package_path),
        robot_urdf_path=str(prepared.robot_urdf_path),
        simulator_asset_path=str(simulator_asset_path),
        simulator_asset_format=runtime_spec.transfer.workspace_asset_format(),
        bundled_mesh_count=prepared.bundle_result.copied_files,
        unresolved_mesh_refs=list(prepared.bundle_result.unresolved),
        world_object_count=prepared.world_object_count,
        camera_count=prepared.camera_count,
    )
