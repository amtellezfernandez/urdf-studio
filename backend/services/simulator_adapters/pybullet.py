from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

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


@dataclass(frozen=True)
class PyBulletWorkspaceCheckArtifacts:
    camera_screenshot_dir: Path
    report_path: Path


def _pybullet_error(message: str) -> PyBulletWorkspaceError:
    return PyBulletWorkspaceError(message)


def prepare_pybullet_workspace(request: SimulatorWorkspacePrepareRequest) -> PreparedSimulatorWorkspace:
    return prepare_direct_urdf_workspace(
        request,
        workspace_process=PYBULLET_WORKSPACE_PROCESS_PARAMS,
        error=_pybullet_error,
    )


def _build_pybullet_workspace_check_artifacts(
    prepared: PreparedSimulatorWorkspace,
) -> PyBulletWorkspaceCheckArtifacts:
    artifacts_dir = prepared.workspace_dir / "artifacts"
    return PyBulletWorkspaceCheckArtifacts(
        camera_screenshot_dir=artifacts_dir / "cameras",
        report_path=artifacts_dir / "report.json",
    )


def _has_hardware_opengl_runtime_dependency(
    dependencies: list[SimulatorRuntimeDependency],
) -> bool:
    return any(
        dependency.name == PYBULLET_HARDWARE_OPENGL_DIAGNOSTIC_NAME
        for dependency in dependencies
    )


def _degraded_opengl_runtime_dependencies(
    dependencies: list[SimulatorRuntimeDependency],
) -> list[SimulatorRuntimeDependency]:
    if _has_hardware_opengl_runtime_dependency(dependencies):
        return dependencies
    return [
        *dependencies,
        SimulatorRuntimeDependency(
            name=PYBULLET_HARDWARE_OPENGL_DIAGNOSTIC_NAME,
            available=False,
            required=False,
            scope="runtime",
        ),
    ]


def _apply_degraded_opengl_runtime_status(status: SimulatorRuntimeStatus) -> SimulatorRuntimeStatus:
    dependencies = list(status.dependencies)
    return status.model_copy(
        update={
            "status": "ready, display degraded: software OpenGL",
            "dependencies": _degraded_opengl_runtime_dependencies(dependencies),
        }
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

    def prepare_workspace_package(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> PreparedSimulatorWorkspace:
        return prepare_pybullet_workspace(request)

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
        return _apply_degraded_opengl_runtime_status(status)

    def build_check_command(
        self,
        request: SimulatorWorkspacePrepareRequest,
        expectations: WorkspaceExpectations,
    ) -> PreparedWorkspaceCommand:
        prepared = prepare_pybullet_workspace(request)
        artifacts = _build_pybullet_workspace_check_artifacts(prepared)
        return _prepare_direct_urdf_command(
            prepared,
            simulator_id=SIMULATOR_PYBULLET_ID,
            workspace_process=PYBULLET_WORKSPACE_PROCESS_PARAMS,
            object_marker=f"world_objects={expectations.object_count}",
            extra_expected_markers=(f"camera_screenshots={expectations.camera_count}",),
            extra_args=(
                "--camera-screenshot-dir",
                str(artifacts.camera_screenshot_dir),
            ),
            expected_image_dirs=((artifacts.camera_screenshot_dir, expectations.camera_count),),
            expectations=expectations,
            expected_report_path=artifacts.report_path,
            expected_report_artifact_dir_keys=("camera_screenshot_dir",),
        )
