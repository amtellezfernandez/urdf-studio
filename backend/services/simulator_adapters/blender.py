from __future__ import annotations

import sys

from backend.models.simulator_runtime import (
    SIMULATOR_BLENDER_ID,
    SimulatorDependencySpec,
    SimulatorRuntimeDependency,
    SimulatorRuntimeStatus,
    WorkspaceChangeSetApplyRequest,
    WorkspaceChangeSetApplyResponse,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
)
from backend.services.simulator_adapters.base import SimulatorAdapterError
from backend.services.simulator_adapters.blender_runtime import (
    BLENDER_PATH_ENV,
    resolve_blender_executable,
)
from backend.services.simulator_adapters.blender_change_sets import (
    apply_blender_layout_change_set_with_summary,
)
from backend.services.simulator_adapters.blender_workspace import BLENDER_EDIT_SESSION_FILENAME
from backend.services.simulator_adapters.params import (
    BLENDER_SCENE_PARAMS,
    BLENDER_WORKSPACE_PROCESS_PARAMS,
    WORKSPACE_LAUNCH_FRAME_MAP,
)
from backend.services.simulator_adapters.plugin import SimulatorPlugin
from backend.services.simulator_adapters.workspace_package import (
    PreparedSimulatorWorkspace,
    prepare_simulator_workspace_package,
)
from backend.services.simulator_adapters.workspace_process import (
    build_workspace_prepare_response,
    start_workspace_process_until_ready,
)


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


def _blender_workspace_command(
    *,
    prepared: PreparedSimulatorWorkspace,
    blender_executable: str,
    report_path,
) -> list[str]:
    return [
        sys.executable,
        "-u",
        "-m",
        BLENDER_WORKSPACE_PROCESS_PARAMS.module_name,
        "--world-package",
        str(prepared.world_package_path),
        "--robot-urdf",
        str(prepared.robot_urdf_path),
        "--frame-map",
        WORKSPACE_LAUNCH_FRAME_MAP,
        "--report",
        str(report_path),
        "--blender",
        blender_executable,
    ]


def start_blender_workspace(
    request: SimulatorWorkspacePrepareRequest,
) -> SimulatorWorkspacePrepareResponse:
    from backend.services.simulator_adapters.plugin import get_plugin
    plugin = get_plugin(SIMULATOR_BLENDER_ID)
    blender_executable = resolve_blender_executable()
    if blender_executable is None:
        raise BlenderWorkspaceError(
            f"Blender executable was not found. Install Blender or set {BLENDER_PATH_ENV}."
        )
    prepared = prepare_blender_workspace_package(request)
    log_path = prepared.workspace_dir / BLENDER_WORKSPACE_PROCESS_PARAMS.log_name
    report_path = prepared.workspace_dir / "artifacts" / "report.json"
    command = _blender_workspace_command(
        prepared=prepared,
        blender_executable=blender_executable,
        report_path=report_path,
    )
    process = start_workspace_process_until_ready(
        command=command,
        prepared=prepared,
        workspace_process=BLENDER_WORKSPACE_PROCESS_PARAMS,
        simulator_id=SIMULATOR_BLENDER_ID,
        simulator_label=plugin.label,
        log_path=log_path,
        error=_blender_error,
        launch_id=request.launch_id,
    )
    runtime_spec = plugin.as_runtime_spec()
    return build_workspace_prepare_response(
        runtime_spec=runtime_spec,
        prepared=prepared,
        process=process,
        command=command,
        log_path=log_path,
        simulator_asset_path=prepared.workspace_dir / "artifacts" / BLENDER_EDIT_SESSION_FILENAME,
    )


class BlenderPlugin(SimulatorPlugin):
    simulator_id = SIMULATOR_BLENDER_ID
    label = "Blender"
    robot_asset_format = "native"
    transfer_strategy = "direct"
    target_kind = "authoring_tool"
    workspace_target = True
    layout_round_trip = True
    dependencies = (SimulatorDependencySpec(name="blender", import_name="bpy"),)
    workspace_process = BLENDER_WORKSPACE_PROCESS_PARAMS
    scene_params = BLENDER_SCENE_PARAMS
    requires_runtime_for_check = False

    def prepare_workspace(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> SimulatorWorkspacePrepareResponse:
        return start_blender_workspace(request)

    def runtime_status(self) -> SimulatorRuntimeStatus:
        executable = resolve_blender_executable()
        available = executable is not None
        return SimulatorRuntimeStatus(
            runtimeName=self.simulator_id,
            available=available,
            status=f"ready: {executable}"
            if available
            else f"Missing optional dependency: blender. Set {BLENDER_PATH_ENV} if Blender is installed outside the standard paths.",
            dependencies=[
                SimulatorRuntimeDependency(name="blender", available=available),
            ],
        )

    def apply_workspace_change_set(
        self,
        request: WorkspaceChangeSetApplyRequest,
    ) -> WorkspaceChangeSetApplyResponse:
        result = apply_blender_layout_change_set_with_summary(
            request.world_package,
            request.change_set,
        )
        return WorkspaceChangeSetApplyResponse(
            simulator_id=self.simulator_id,
            world_package=result.world_package,
            applied_change_count=result.applied_change_count,
            review_only_count=result.review_only_count,
        )
