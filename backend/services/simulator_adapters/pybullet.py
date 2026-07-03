from __future__ import annotations

from backend.models.simulator_runtime import (
    SIMULATOR_PYBULLET_ID,
    SimulatorDependencySpec,
    SimulatorRuntimeDependency,
    SimulatorRuntimeStatus,
    SimulatorWorkspacePrepareRequest,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapterError,
)
from backend.services.simulator_adapters.direct_urdf import prepare_direct_urdf_workspace
from backend.services.simulator_adapters.params import (
    PYBULLET_SCENE_PARAMS,
    PYBULLET_WORKSPACE_PROCESS_PARAMS,
)
from backend.services.simulator_adapters.plugin import DirectUrdfSimulatorPlugin
from backend.services.simulator_adapters.workspace_check_spec import (
    PreparedWorkspaceCommand,
    _prepare_direct_urdf_command,
)
from backend.services.simulator_adapters.workspace_diagnostics import (
    PYBULLET_HARDWARE_OPENGL_DIAGNOSTIC_NAME,
    pybullet_runtime_opengl_warnings,
)
from backend.services.simulator_adapters.workspace_expectations import WorkspaceExpectations
from backend.services.simulator_adapters.workspace_package import PreparedSimulatorWorkspace


class PyBulletWorkspaceError(SimulatorAdapterError):
    pass


def _pybullet_error(message: str) -> PyBulletWorkspaceError:
    return PyBulletWorkspaceError(message)


def prepare_pybullet_workspace(request: SimulatorWorkspacePrepareRequest) -> PreparedSimulatorWorkspace:
    return prepare_direct_urdf_workspace(
        request,
        workspace_process=PYBULLET_WORKSPACE_PROCESS_PARAMS,
        error=_pybullet_error,
    )


class PyBulletPlugin(DirectUrdfSimulatorPlugin):
    simulator_id = SIMULATOR_PYBULLET_ID
    label = "PyBullet"
    robot_asset_format = "urdf"
    transfer_strategy = "direct"
    workspace_target = True
    dependencies = (SimulatorDependencySpec(name="pybullet", import_name="pybullet"),)
    workspace_process = PYBULLET_WORKSPACE_PROCESS_PARAMS
    workspace_error_class = PyBulletWorkspaceError
    scene_params = PYBULLET_SCENE_PARAMS

    def runtime_status(self) -> SimulatorRuntimeStatus:
        status = super().runtime_status()
        if not status.available:
            return status
        warnings = pybullet_runtime_opengl_warnings(
            workspace_root=PYBULLET_WORKSPACE_PROCESS_PARAMS.workspace_root,
            log_name=PYBULLET_WORKSPACE_PROCESS_PARAMS.log_name,
        )
        if not warnings:
            return status
        dependencies = list(status.dependencies)
        if not any(
            dependency.name == PYBULLET_HARDWARE_OPENGL_DIAGNOSTIC_NAME
            for dependency in dependencies
        ):
            dependencies.append(
                SimulatorRuntimeDependency(
                    name=PYBULLET_HARDWARE_OPENGL_DIAGNOSTIC_NAME,
                    available=False,
                    required=False,
                    scope="runtime",
                )
            )
        return status.model_copy(
            update={
                "status": "ready, display degraded: software OpenGL",
                "dependencies": dependencies,
            }
        )

    def build_check_command(
        self,
        request: SimulatorWorkspacePrepareRequest,
        expectations: WorkspaceExpectations,
    ) -> PreparedWorkspaceCommand:
        prepared = prepare_pybullet_workspace(request)
        screenshot_dir = prepared.workspace_dir / "artifacts"
        camera_screenshot_dir = screenshot_dir / "cameras"
        report_path = screenshot_dir / "report.json"
        return _prepare_direct_urdf_command(
            prepared,
            simulator_id=SIMULATOR_PYBULLET_ID,
            workspace_process=PYBULLET_WORKSPACE_PROCESS_PARAMS,
            object_marker=f"world_objects={expectations.object_count}",
            extra_expected_markers=(f"camera_screenshots={expectations.camera_count}",),
            extra_args=(
                "--camera-screenshot-dir",
                str(camera_screenshot_dir),
            ),
            expected_image_dirs=((camera_screenshot_dir, expectations.camera_count),),
            expectations=expectations,
            expected_report_path=report_path,
            expected_report_artifact_dir_keys=("camera_screenshot_dir",),
        )
