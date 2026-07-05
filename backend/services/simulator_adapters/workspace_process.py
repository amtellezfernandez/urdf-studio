from __future__ import annotations

import shutil
import subprocess
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

from backend.core.paths import BASE_DIR
from backend.models.simulator_runtime import (
    SimulatorRuntimeSpec,
    SimulatorWorkspacePrepareResponse,
)
from backend.services.simulator_adapters import simulator_acceleration
from backend.services.simulator_adapters.simulator_acceleration import SimulatorEnvironment
from backend.services.simulator_adapters.workspace_package import (
    PreparedSimulatorWorkspace,
    wait_for_workspace_readiness,
)
from backend.services.simulator_adapters.workspace_diagnostics import (
    read_workspace_launch_warnings,
)
from backend.services.simulator_adapters.workspace_launches import (
    attach_workspace_launch_process,
    begin_workspace_launch,
    complete_workspace_launch,
    is_workspace_launch_cancelled,
    terminate_workspace_process,
)
from backend.services.simulator_adapters.params import (
    WORKSPACE_LAUNCH_FRAME_MAP,
    SimulatorWorkspaceProcessParams,
)


SIMULATOR_ACCELERATION_DISABLE_ENV = simulator_acceleration.SIMULATOR_ACCELERATION_DISABLE_ENV
SIMULATOR_GPU_DEVICE_ENV = simulator_acceleration.SIMULATOR_GPU_DEVICE_ENV


def build_simulator_workspace_env(
    cache_root: Path,
    simulator_id: str | None = None,
) -> SimulatorEnvironment:
    return simulator_acceleration.build_simulator_workspace_env(
        cache_root,
        simulator_id=simulator_id,
    )


def _cancelled_launch_error(label: str) -> str:
    return f"{label} workspace launch was cancelled."


def _cleanup_cancelled_launch(
    *,
    workspace_dir: Path,
    simulator_label: str,
    error: Callable[[str], Exception],
) -> None:
    shutil.rmtree(workspace_dir, ignore_errors=True)
    raise error(_cancelled_launch_error(simulator_label))


def _raise_if_launch_cancelled(
    *,
    prepared: PreparedSimulatorWorkspace,
    simulator_id: str,
    simulator_label: str,
    launch_id: str | None,
    error: Callable[[str], Exception],
) -> None:
    if launch_id is None:
        return
    if not begin_workspace_launch(launch_id, simulator_id):
        _cleanup_cancelled_launch(
            workspace_dir=prepared.workspace_dir,
            simulator_label=simulator_label,
            error=error,
        )
    if is_workspace_launch_cancelled(launch_id):
        _cleanup_cancelled_launch(
            workspace_dir=prepared.workspace_dir,
            simulator_label=simulator_label,
            error=error,
        )


def build_workspace_process_command(
    *,
    workspace_process: SimulatorWorkspaceProcessParams,
    world_package_path: Path,
    simulator_asset_flag: str,
    simulator_asset_path: Path,
    extra_simulator_args: Sequence[str] = (),
) -> list[str]:
    return [
        sys.executable,
        "-u",
        "-m",
        workspace_process.module_name,
        "--world-package",
        str(world_package_path),
        simulator_asset_flag,
        str(simulator_asset_path),
        *extra_simulator_args,
        "--frame-map",
        WORKSPACE_LAUNCH_FRAME_MAP,
    ]


def start_workspace_process_until_ready(
    *,
    command: Sequence[str],
    prepared: PreparedSimulatorWorkspace,
    workspace_process: SimulatorWorkspaceProcessParams,
    simulator_id: str,
    simulator_label: str,
    log_path: Path,
    error: Callable[[str], Exception],
    launch_id: str | None = None,
) -> subprocess.Popen:
    _raise_if_launch_cancelled(
        prepared=prepared,
        simulator_id=simulator_id,
        simulator_label=simulator_label,
        launch_id=launch_id,
        error=error,
    )

    process: subprocess.Popen | None = None
    try:
        with log_path.open("ab", buffering=0) as log_file:
            process = subprocess.Popen(
                list(command),
                cwd=BASE_DIR,
                stdin=subprocess.DEVNULL,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                close_fds=True,
                env=simulator_acceleration.build_simulator_workspace_env(
                    prepared.workspace_dir / "runtime-cache",
                    simulator_id=simulator_id,
                ),
            )
        if launch_id and not attach_workspace_launch_process(launch_id, process):
            raise error(_cancelled_launch_error(simulator_label))
        wait_for_workspace_readiness(
            process,
            simulator_label=simulator_label,
            log_path=log_path,
            ready_log_marker=workspace_process.ready_log_marker,
            log_tail_chars=workspace_process.log_tail_chars,
            poll_sec=workspace_process.startup_poll_sec,
            ready_timeout_sec=workspace_process.ready_timeout_sec,
            post_ready_grace_sec=workspace_process.post_ready_grace_sec,
            error=error,
            should_cancel=(
                (lambda: is_workspace_launch_cancelled(launch_id))
                if launch_id is not None
                else None
            ),
        )
        if launch_id:
            complete_workspace_launch(launch_id)
        return process
    except BaseException:
        if process is not None and process.poll() is None:
            terminate_workspace_process(process)
        raise


def build_workspace_prepare_response(
    *,
    runtime_spec: SimulatorRuntimeSpec,
    prepared: PreparedSimulatorWorkspace,
    process: subprocess.Popen,
    command: Sequence[str],
    log_path: Path,
    simulator_asset_path: Path,
) -> SimulatorWorkspacePrepareResponse:
    return SimulatorWorkspacePrepareResponse(
        simulator_id=runtime_spec.simulator_id,
        started=True,
        pid=process.pid,
        command=list(command),
        launch_mode="interactive_viewer",
        log_path=str(log_path),
        world_package_path=str(prepared.world_package_path),
        robot_urdf_path=str(prepared.robot_urdf_path),
        simulator_asset_path=str(simulator_asset_path),
        simulator_asset_format=runtime_spec.transfer.workspace_asset_format(),
        bundled_mesh_count=prepared.bundle_result.copied_files,
        unresolved_mesh_refs=list(prepared.bundle_result.unresolved),
        workspace_warnings=read_workspace_launch_warnings(
            runtime_spec.simulator_id,
            log_path,
        ),
        world_object_count=prepared.world_object_count,
        camera_count=prepared.camera_count,
    )


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
    launch_id: str | None = None,
) -> SimulatorWorkspacePrepareResponse:
    resolved_simulator_label = simulator_label or runtime_spec.label
    log_path = prepared.workspace_dir / workspace_process.log_name
    command = build_workspace_process_command(
        workspace_process=workspace_process,
        world_package_path=prepared.world_package_path,
        simulator_asset_flag=simulator_asset_flag,
        simulator_asset_path=simulator_asset_path,
        extra_simulator_args=extra_simulator_args,
    )
    process = start_workspace_process_until_ready(
        command=command,
        prepared=prepared,
        workspace_process=workspace_process,
        simulator_id=runtime_spec.simulator_id,
        simulator_label=resolved_simulator_label,
        log_path=log_path,
        error=error,
        launch_id=launch_id,
    )
    return build_workspace_prepare_response(
        runtime_spec=runtime_spec,
        prepared=prepared,
        process=process,
        command=command,
        log_path=log_path,
        simulator_asset_path=simulator_asset_path,
    )
