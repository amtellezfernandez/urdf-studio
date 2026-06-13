from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass

from backend.core.paths import BASE_DIR
from backend.models.simulator_runtime import (
    SIMULATOR_BLENDER_ID,
    SimulatorId,
    SimulatorRuntimeCapabilities,
    SimulatorRuntimeDependency,
    SimulatorRuntimeStatus,
    WorkspaceChangeSetApplyRequest,
    WorkspaceChangeSetApplyResponse,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
    get_simulator_runtime_spec,
)
from backend.services.simulator_adapters.base import SimulatorAdapter, SimulatorAdapterError
from backend.services.simulator_adapters.blender_runtime import (
    BLENDER_PATH_ENV,
    resolve_blender_executable,
)
from backend.services.simulator_adapters.blender_change_sets import (
    apply_blender_layout_change_set_with_summary,
)
from backend.services.simulator_adapters.blender_workspace import BLENDER_EDIT_SESSION_FILENAME
from backend.services.simulator_adapters.params import BLENDER_WORKSPACE_PROCESS_PARAMS
from backend.services.simulator_adapters.workspace_package import (
    PreparedSimulatorWorkspace,
    prepare_simulator_workspace_package,
    validate_simulator_workspace_package_request,
    wait_for_workspace_readiness,
)
from backend.services.simulator_adapters.workspace_process import build_simulator_workspace_env

BLENDER_RUNTIME_SPEC = get_simulator_runtime_spec(SIMULATOR_BLENDER_ID)


class BlenderWorkspaceError(SimulatorAdapterError):
    pass


def _blender_error(message: str) -> BlenderWorkspaceError:
    return BlenderWorkspaceError(message)


def prepare_blender_workspace_package(
    request: SimulatorWorkspacePrepareRequest,
) -> PreparedSimulatorWorkspace:
    return prepare_simulator_workspace_package(
        request,
        workspace_root=BLENDER_WORKSPACE_PROCESS_PARAMS.workspace_root,
        error=_blender_error,
    )


def start_blender_workspace(
    request: SimulatorWorkspacePrepareRequest,
) -> SimulatorWorkspacePrepareResponse:
    validate_simulator_workspace_package_request(request)
    blender_executable = resolve_blender_executable()
    if blender_executable is None:
        raise BlenderWorkspaceError(
            f"Blender executable was not found. Install Blender or set {BLENDER_PATH_ENV}."
        )
    prepared = prepare_blender_workspace_package(request)
    log_path = prepared.workspace_dir / BLENDER_WORKSPACE_PROCESS_PARAMS.log_name
    report_path = prepared.workspace_dir / "artifacts" / "report.json"
    command = [
        sys.executable,
        "-u",
        "-m",
        BLENDER_WORKSPACE_PROCESS_PARAMS.module_name,
        "--world-package",
        str(prepared.world_package_path),
        "--robot-urdf",
        str(prepared.robot_urdf_path),
        "--frame-map",
        "identity",
        "--report",
        str(report_path),
        "--blender",
        blender_executable,
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
        simulator_label=BLENDER_RUNTIME_SPEC.label,
        log_path=log_path,
        ready_log_marker=BLENDER_WORKSPACE_PROCESS_PARAMS.ready_log_marker,
        log_tail_chars=BLENDER_WORKSPACE_PROCESS_PARAMS.log_tail_chars,
        poll_sec=BLENDER_WORKSPACE_PROCESS_PARAMS.startup_poll_sec,
        ready_timeout_sec=BLENDER_WORKSPACE_PROCESS_PARAMS.ready_timeout_sec,
        post_ready_grace_sec=BLENDER_WORKSPACE_PROCESS_PARAMS.post_ready_grace_sec,
        error=_blender_error,
    )
    return SimulatorWorkspacePrepareResponse(
        simulator_id=BLENDER_RUNTIME_SPEC.simulator_id,
        started=True,
        pid=process.pid,
        command=command,
        log_path=str(log_path),
        world_package_path=str(prepared.world_package_path),
        robot_urdf_path=str(prepared.robot_urdf_path),
        simulator_asset_path=str(
            prepared.workspace_dir / "artifacts" / BLENDER_EDIT_SESSION_FILENAME
        ),
        simulator_asset_format=BLENDER_RUNTIME_SPEC.transfer.workspace_asset_format(),
        bundled_mesh_count=prepared.bundle_result.copied_files,
        unresolved_mesh_refs=list(prepared.bundle_result.unresolved),
    )


@dataclass(frozen=True)
class BlenderSimulatorAdapter:
    @property
    def simulator_id(self) -> SimulatorId:
        return BLENDER_RUNTIME_SPEC.simulator_id

    @property
    def label(self) -> str:
        return BLENDER_RUNTIME_SPEC.label

    @property
    def capabilities(self) -> SimulatorRuntimeCapabilities:
        return BLENDER_RUNTIME_SPEC.capabilities_model()

    def prepare_workspace(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> SimulatorWorkspacePrepareResponse:
        return start_blender_workspace(request)

    def apply_workspace_change_set(
        self,
        request: WorkspaceChangeSetApplyRequest,
    ) -> WorkspaceChangeSetApplyResponse:
        result = apply_blender_layout_change_set_with_summary(
            request.world_package,
            request.change_set,
        )
        return WorkspaceChangeSetApplyResponse(
            simulator_id=BLENDER_RUNTIME_SPEC.simulator_id,
            world_package=result.world_package,
            applied_change_count=result.applied_change_count,
            review_only_count=result.review_only_count,
        )

    def runtime_status(self) -> SimulatorRuntimeStatus:
        executable = resolve_blender_executable()
        available = executable is not None
        return SimulatorRuntimeStatus(
            runtimeName=BLENDER_RUNTIME_SPEC.simulator_id,
            available=available,
            status=f"ready: {executable}"
            if available
            else f"Missing optional dependency: blender. Set {BLENDER_PATH_ENV} if Blender is installed outside the standard paths.",
            dependencies=[
                SimulatorRuntimeDependency(name="blender", available=available),
            ],
        )


BLENDER_SIMULATOR_ADAPTER: SimulatorAdapter = BlenderSimulatorAdapter()
