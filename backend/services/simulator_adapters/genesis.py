from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from backend.models.simulator_runtime import (
    SIMULATOR_GENESIS_ID,
    SimulatorDependencySpec,
    SimulatorWorkspacePrepareRequest,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapterError,
)
from backend.services.simulator_adapters.direct_urdf import prepare_direct_urdf_workspace
from backend.services.simulator_adapters.params import (
    GENESIS_SCENE_PARAMS,
    GENESIS_WORKSPACE_PROCESS_PARAMS,
)
from backend.services.simulator_adapters.plugin import DirectUrdfSimulatorPlugin
from backend.services.simulator_adapters.workspace_check_spec import (
    PreparedWorkspaceCommand,
    _prepare_direct_urdf_command,
)
from backend.services.simulator_adapters.workspace_expectations import WorkspaceExpectations
from backend.services.simulator_adapters.workspace_package import PreparedSimulatorWorkspace


class GenesisWorkspaceError(SimulatorAdapterError):
    pass


@dataclass(frozen=True)
class GenesisWorkspaceCheckArtifacts:
    viewer_screenshot_path: Path
    camera_screenshot_dir: Path
    sensor_screenshot_dir: Path
    report_path: Path


def _genesis_error(message: str) -> GenesisWorkspaceError:
    return GenesisWorkspaceError(message)


def prepare_genesis_workspace(request: SimulatorWorkspacePrepareRequest) -> PreparedSimulatorWorkspace:
    return prepare_direct_urdf_workspace(
        request,
        workspace_process=GENESIS_WORKSPACE_PROCESS_PARAMS,
        error=_genesis_error,
    )


def _build_genesis_workspace_check_artifacts(
    prepared: PreparedSimulatorWorkspace,
) -> GenesisWorkspaceCheckArtifacts:
    artifacts_dir = prepared.workspace_dir / "artifacts"
    return GenesisWorkspaceCheckArtifacts(
        viewer_screenshot_path=artifacts_dir / "viewer.png",
        camera_screenshot_dir=artifacts_dir / "cameras",
        sensor_screenshot_dir=artifacts_dir / "sensors",
        report_path=artifacts_dir / "report.json",
    )


class GenesisPlugin(DirectUrdfSimulatorPlugin):
    simulator_id = SIMULATOR_GENESIS_ID
    label = "Genesis"
    robot_asset_format = "urdf"
    transfer_strategy = "direct"
    workspace_target = True
    dependencies = (SimulatorDependencySpec(name="genesis", import_name="genesis"),)
    workspace_process = GENESIS_WORKSPACE_PROCESS_PARAMS
    workspace_error_class = GenesisWorkspaceError
    scene_params = GENESIS_SCENE_PARAMS

    def build_check_command(
        self,
        request: SimulatorWorkspacePrepareRequest,
        expectations: WorkspaceExpectations,
    ) -> PreparedWorkspaceCommand:
        prepared = prepare_genesis_workspace(request)
        artifacts = _build_genesis_workspace_check_artifacts(prepared)
        return _prepare_direct_urdf_command(
            prepared,
            simulator_id=SIMULATOR_GENESIS_ID,
            workspace_process=GENESIS_WORKSPACE_PROCESS_PARAMS,
            object_marker=f"primitives={expectations.object_count}",
            camera_log_marker=f"attached_cameras={expectations.camera_count}",
            extra_expected_markers=(
                f"camera_screenshots={expectations.camera_count}",
                f"observation_cameras={expectations.camera_count}",
                f"sensor_reads={expectations.camera_count}",
                f"sensor_screenshots={expectations.camera_count}",
                "merge_fixed_links=True",
            ),
            extra_args=(
                "--screenshot",
                str(artifacts.viewer_screenshot_path),
                "--camera-screenshot-dir",
                str(artifacts.camera_screenshot_dir),
                "--sensor-screenshot-dir",
                str(artifacts.sensor_screenshot_dir),
            ),
            expectations=expectations,
            expected_image_paths=(artifacts.viewer_screenshot_path,),
            expected_image_dirs=(
                (artifacts.camera_screenshot_dir, expectations.camera_count),
                (artifacts.sensor_screenshot_dir, expectations.camera_count),
            ),
            expected_report_path=artifacts.report_path,
            expected_report_artifact_file_keys=("viewer_screenshot",),
            expected_report_artifact_dir_keys=("camera_screenshot_dir", "sensor_screenshot_dir"),
        )
