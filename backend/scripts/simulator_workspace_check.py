from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping, Sequence

from backend.core.paths import BASE_DIR
from backend.models.simulator_runtime import (
    SIMULATOR_BLENDER_ID,
    SIMULATOR_GENESIS_ID,
    SIMULATOR_MJLAB_ID,
    SIMULATOR_MUJOCO_ID,
    SIMULATOR_PYBULLET_ID,
    SimulatorId,
    SimulatorRuntimeStatus,
    SimulatorWorkspacePrepareRequest,
)
from backend.services.simulator_adapters import get_simulator_runtime_status
from backend.services.simulator_adapters.blender import prepare_blender_workspace_package
from backend.services.simulator_adapters.blender_runtime import resolve_blender_executable
from backend.services.simulator_adapters.blender_saved_session import (
    validate_blender_blend_artifact,
)
from backend.services.simulator_adapters.blender_workspace import (
    BLENDER_EDIT_SESSION_FILENAME,
    BLENDER_EXPORT_SCRIPT_FILENAME,
    BLENDER_OPEN_SCRIPT_FILENAME,
    BLENDER_ROBOT_USD_FILENAME,
)
from backend.services.simulator_adapters.blender_edit_session import (
    validate_blender_edit_session_artifact,
)
from backend.services.simulator_adapters.camera_transfer import build_sim_camera_specs
from backend.services.simulator_adapters.genesis import prepare_genesis_workspace
from backend.services.simulator_adapters.mujoco import PreparedMujocoWorkspace, prepare_mujoco_workspace
from backend.services.simulator_adapters.params import (
    BLENDER_WORKSPACE_PROCESS_PARAMS,
    GENESIS_WORKSPACE_PROCESS_PARAMS,
    MUJOCO_WORKSPACE_PROCESS_PARAMS,
    PYBULLET_WORKSPACE_PROCESS_PARAMS,
    SimulatorWorkspaceProcessParams,
)
from backend.services.simulator_adapters.pybullet import prepare_pybullet_workspace
from backend.services.simulator_adapters.workspace_package import PreparedSimulatorWorkspace
from backend.services.simulator_adapters.workspace_parity import (
    WORKSPACE_PARITY_ID,
    WorkspaceParityInput,
    check_simulator_workspace_parity,
)
from backend.services.simulator_adapters.workspace_process import build_simulator_workspace_env
from backend.services.simulator_adapters.workspace_image_artifacts import (
    WorkspaceImageArtifactExpectations,
    validate_workspace_image_artifacts,
)
from backend.services.simulator_adapters.workspace_request_sources import (
    WORKSPACE_FIXTURES,
    WORKSPACE_SIMULATORS,
    build_demo_workspace_request,
    build_mesh_asset_workspace_request,
    build_studio_y_up_axis_workspace_request,
    build_workspace_request_from_files,
)
from backend.services.simulator_adapters.workspace_report_validation import (
    ExpectedCameraReport,
    ExpectedObjectReport,
    SimulatorWorkspaceReportExpectations,
    validate_simulator_workspace_report,
)
from backend.services.world_layout_static_transfer import (
    build_sim_primitives,
    count_transferable_world_objects,
    parse_static_world_layout_payload,
    resolve_world_layout_frame_map,
)
from backend.services.world_layout_transfer_types import (
    ConcreteWorldLayoutFrameMap,
    WorldLayoutFrameMap,
)
from backend.services.world_scene_package_digest import world_scene_package_json_payload
from backend.scripts.simulator_workspace_cli import WORKSPACE_FRAME_MAP_CHOICES

REQUIRE_SIMULATOR_WORKSPACE_ENV = "URDF_STUDIO_REQUIRE_SIMULATOR_WORKSPACE"
DEFAULT_DURATION_SEC = 0.02
DEFAULT_TIMEOUT_SEC = 180.0


@dataclass(frozen=True)
class PreparedWorkspaceCommand:
    command: list[str]
    ready_marker: str
    expected_object_marker: str
    expected_camera_log_marker: str
    extra_expected_markers: tuple[str, ...] = ()
    expected_image_paths: tuple[Path, ...] = ()
    expected_image_dirs: tuple[tuple[Path, int], ...] = ()
    expected_file_paths: tuple[Path, ...] = ()
    expected_file_validators: tuple[tuple[Path, Callable[[Path], str | None]], ...] = ()
    expected_report_path: Path | None = None
    expected_simulator_id: SimulatorId | None = None
    expected_object_count: int | None = None
    expected_camera_count: int | None = None
    expected_requested_frame_map: WorldLayoutFrameMap | None = None
    expected_frame_map: ConcreteWorldLayoutFrameMap | None = None
    expected_object_positions_xyz: Mapping[str, tuple[float, float, float]] | None = None
    expected_object_sizes_xyz: Mapping[str, tuple[float, float, float]] | None = None
    expected_object_asset_refs: Mapping[str, str | None] | None = None
    expected_object_contracts: Mapping[str, ExpectedObjectReport] | None = None
    expected_joint_positions: Mapping[str, float] | None = None
    expected_camera_ids: tuple[str, ...] | None = None
    expected_camera_contracts: Mapping[str, ExpectedCameraReport] | None = None
    expected_report_artifact_file_keys: tuple[str, ...] = ()
    expected_report_artifact_dir_keys: tuple[str, ...] = ()


@dataclass(frozen=True)
class WorkspaceExpectations:
    object_count: int
    camera_count: int
    duration_sec: float
    frame_map: WorldLayoutFrameMap = "auto"
    resolved_frame_map: ConcreteWorldLayoutFrameMap | None = None
    object_positions_xyz: Mapping[str, tuple[float, float, float]] | None = None
    object_sizes_xyz: Mapping[str, tuple[float, float, float]] | None = None
    object_asset_refs: Mapping[str, str | None] | None = None
    object_contracts: Mapping[str, ExpectedObjectReport] | None = None
    joint_positions: Mapping[str, float] | None = None
    camera_ids: tuple[str, ...] | None = None
    camera_contracts: Mapping[str, ExpectedCameraReport] | None = None


@dataclass(frozen=True)
class WorkspaceTarget:
    simulator_id: SimulatorId
    label: str
    prepare: Callable[[SimulatorWorkspacePrepareRequest, WorkspaceExpectations], PreparedWorkspaceCommand]
    requires_runtime: bool = True
    include_in_parity: bool = True


@dataclass(frozen=True)
class WorkspaceCheckResult:
    simulator_id: str
    label: str
    status: str
    detail: str = ""
    report_path: str | None = None


def _workspace_frame_map(expectations: WorkspaceExpectations) -> WorldLayoutFrameMap:
    return getattr(expectations, "frame_map", "auto")


def _workspace_resolved_frame_map(
    expectations: WorkspaceExpectations,
) -> ConcreteWorldLayoutFrameMap | None:
    return getattr(expectations, "resolved_frame_map", None)


def _workspace_object_positions(
    expectations: WorkspaceExpectations,
) -> Mapping[str, tuple[float, float, float]] | None:
    return getattr(expectations, "object_positions_xyz", None)


def _workspace_object_sizes(
    expectations: WorkspaceExpectations,
) -> Mapping[str, tuple[float, float, float]] | None:
    return getattr(expectations, "object_sizes_xyz", None)


def _workspace_object_asset_refs(
    expectations: WorkspaceExpectations,
) -> Mapping[str, str | None] | None:
    return getattr(expectations, "object_asset_refs", None)


def _workspace_object_contracts(
    expectations: WorkspaceExpectations,
) -> Mapping[str, ExpectedObjectReport] | None:
    return getattr(expectations, "object_contracts", None)


def _workspace_joint_positions(
    expectations: WorkspaceExpectations,
) -> Mapping[str, float] | None:
    return getattr(expectations, "joint_positions", None)


def _workspace_camera_ids(expectations: WorkspaceExpectations) -> tuple[str, ...] | None:
    return getattr(expectations, "camera_ids", None)


def _workspace_camera_contracts(
    expectations: WorkspaceExpectations,
) -> Mapping[str, ExpectedCameraReport] | None:
    return getattr(expectations, "camera_contracts", None)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Headlessly prepare a URDF Studio workspace in installed transfer targets."
    )
    parser.add_argument(
        "--simulator",
        action="append",
        choices=WORKSPACE_SIMULATORS,
        help="Simulator to check. May be passed more than once. Defaults to every openable simulator.",
    )
    parser.add_argument(
        "simulator_targets",
        nargs="*",
        choices=WORKSPACE_SIMULATORS,
        metavar="simulator",
        help="Simulator to check. Compact alias for --simulator.",
    )
    parser.add_argument(
        "--require-all",
        action="store_true",
        help=(
            "Fail when a transfer target runtime is missing. "
            f"Also enabled by {REQUIRE_SIMULATOR_WORKSPACE_ENV}=1."
        ),
    )
    parser.add_argument(
        "--artifact-only",
        action="store_true",
        help=(
            "Validate workspace transfer artifacts without requiring optional opener "
            "applications such as Blender. This cannot be combined with --require-all."
        ),
    )
    parser.add_argument(
        "--fixture",
        choices=WORKSPACE_FIXTURES,
        default="demo",
        help="Built-in workspace fixture to validate when --world-package is not provided.",
    )
    parser.add_argument("--duration-sec", type=float, default=DEFAULT_DURATION_SEC)
    parser.add_argument("--timeout-sec", type=float, default=DEFAULT_TIMEOUT_SEC)
    parser.add_argument(
        "--frame-map",
        choices=WORKSPACE_FRAME_MAP_CHOICES,
        default="auto",
        help="World frame-map policy used for simulator workspace launches.",
    )
    parser.add_argument(
        "--world-package",
        default="",
        help="Path to a WSP manifest to validate instead of the built-in demo fixture.",
    )
    parser.add_argument(
        "--robot-urdf",
        "--robot-source",
        dest="robot_urdf",
        default="",
        help="Path to the local robot URDF or Xacro source used to resolve mesh assets for --world-package.",
    )
    parser.add_argument(
        "--asset-root",
        action="append",
        default=[],
        help=(
            "Asset root copied into the simulator workspace for --world-package. "
            "May be passed more than once. Defaults to the robot URDF directory."
        ),
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable results.")
    return parser.parse_args()


def _is_truthy_env(value: str | None) -> bool:
    return value is not None and value.strip().lower() in {"1", "true", "yes", "on"}


def _workspace_request_from_args(args: argparse.Namespace) -> SimulatorWorkspacePrepareRequest:
    fixture = getattr(args, "fixture", "demo")
    has_custom_world_package = bool(args.world_package)
    has_custom_robot_urdf = bool(args.robot_urdf)
    if has_custom_world_package != has_custom_robot_urdf:
        raise SystemExit("--world-package and --robot-urdf must be provided together")
    if args.asset_root and not has_custom_world_package:
        raise SystemExit("--asset-root can only be used with --world-package and --robot-urdf")
    if has_custom_world_package and fixture != "demo":
        raise SystemExit("--fixture cannot be combined with --world-package")
    if not has_custom_world_package:
        if fixture == "studio-y-up-axis":
            return build_studio_y_up_axis_workspace_request()
        if fixture == "mesh-asset":
            return build_mesh_asset_workspace_request()
        return build_demo_workspace_request()
    return build_workspace_request_from_files(
        world_package_path=Path(args.world_package),
        robot_urdf_path=Path(args.robot_urdf),
        asset_roots=tuple(Path(root) for root in args.asset_root),
    )


def _selected_simulator_ids_from_args(args: argparse.Namespace) -> tuple[SimulatorId, ...]:
    selected_ids: list[SimulatorId] = []
    for simulator_id in (*(args.simulator or ()), *args.simulator_targets):
        if simulator_id not in selected_ids:
            selected_ids.append(simulator_id)
    return tuple(selected_ids)


def _module_command(
    workspace_process: SimulatorWorkspaceProcessParams,
    *,
    world_package_path: Path,
    robot_asset_flag: str,
    robot_asset_path: Path,
    duration_sec: float,
    frame_map: WorldLayoutFrameMap = "auto",
    extra_args: Sequence[str] = (),
    report_path: Path | None = None,
) -> list[str]:
    report_args = ("--report", str(report_path)) if report_path is not None else ()
    return [
        sys.executable,
        "-u",
        "-m",
        workspace_process.module_name,
        "--world-package",
        str(world_package_path),
        robot_asset_flag,
        str(robot_asset_path),
        *extra_args,
        *report_args,
        "--frame-map",
        frame_map,
        "--no-viewer",
        "--duration-sec",
        str(duration_sec),
    ]


def _prepare_direct_urdf_command(
    prepared: PreparedSimulatorWorkspace,
    *,
    simulator_id: SimulatorId,
    workspace_process: SimulatorWorkspaceProcessParams,
    object_marker: str,
    camera_log_marker: str | None = None,
    extra_expected_markers: tuple[str, ...] = (),
    extra_args: Sequence[str] = (),
    expected_image_paths: tuple[Path, ...] = (),
    expected_image_dirs: tuple[tuple[Path, int], ...] = (),
    expected_file_paths: tuple[Path, ...] = (),
    expected_file_validators: tuple[tuple[Path, Callable[[Path], str | None]], ...] = (),
    expected_report_path: Path | None = None,
    expected_report_artifact_file_keys: tuple[str, ...] = (),
    expected_report_artifact_dir_keys: tuple[str, ...] = (),
    expectations: WorkspaceExpectations,
) -> PreparedWorkspaceCommand:
    return PreparedWorkspaceCommand(
        command=_module_command(
            workspace_process,
            world_package_path=prepared.world_package_path,
            robot_asset_flag="--robot-urdf",
            robot_asset_path=prepared.robot_urdf_path,
            duration_sec=expectations.duration_sec,
            frame_map=_workspace_frame_map(expectations),
            extra_args=extra_args,
            report_path=expected_report_path,
        ),
        ready_marker=workspace_process.ready_log_marker,
        expected_object_marker=object_marker,
        expected_camera_log_marker=camera_log_marker or f"cameras={expectations.camera_count}",
        extra_expected_markers=extra_expected_markers,
        expected_image_paths=expected_image_paths,
        expected_image_dirs=expected_image_dirs,
        expected_file_paths=expected_file_paths,
        expected_file_validators=expected_file_validators,
        expected_report_path=expected_report_path,
        expected_simulator_id=simulator_id,
        expected_object_count=expectations.object_count,
        expected_camera_count=expectations.camera_count,
        expected_requested_frame_map=_workspace_frame_map(expectations),
        expected_frame_map=_workspace_resolved_frame_map(expectations),
        expected_object_positions_xyz=_workspace_object_positions(expectations),
        expected_object_sizes_xyz=_workspace_object_sizes(expectations),
        expected_object_asset_refs=_workspace_object_asset_refs(expectations),
        expected_object_contracts=_workspace_object_contracts(expectations),
        expected_joint_positions=_workspace_joint_positions(expectations),
        expected_camera_ids=_workspace_camera_ids(expectations),
        expected_camera_contracts=_workspace_camera_contracts(expectations),
        expected_report_artifact_file_keys=expected_report_artifact_file_keys,
        expected_report_artifact_dir_keys=expected_report_artifact_dir_keys,
    )


def _prepare_genesis_command(
    request: SimulatorWorkspacePrepareRequest,
    expectations: WorkspaceExpectations,
) -> PreparedWorkspaceCommand:
    prepared = prepare_genesis_workspace(request)
    screenshot_dir = prepared.workspace_dir / "artifacts"
    camera_screenshot_dir = screenshot_dir / "cameras"
    sensor_screenshot_dir = screenshot_dir / "sensors"
    report_path = screenshot_dir / "report.json"
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
            str(screenshot_dir / "viewer.png"),
            "--camera-screenshot-dir",
            str(camera_screenshot_dir),
            "--sensor-screenshot-dir",
            str(sensor_screenshot_dir),
        ),
        expectations=expectations,
        expected_image_paths=(screenshot_dir / "viewer.png",),
        expected_image_dirs=(
            (camera_screenshot_dir, expectations.camera_count),
            (sensor_screenshot_dir, expectations.camera_count),
        ),
        expected_report_path=report_path,
        expected_report_artifact_file_keys=("viewer_screenshot",),
        expected_report_artifact_dir_keys=("camera_screenshot_dir", "sensor_screenshot_dir"),
    )


def _prepare_pybullet_command(
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


def _prepare_mujoco_command(
    request: SimulatorWorkspacePrepareRequest,
    expectations: WorkspaceExpectations,
    *,
    simulator_id: SimulatorId,
) -> PreparedWorkspaceCommand:
    prepared: PreparedMujocoWorkspace = prepare_mujoco_workspace(
        request,
        simulator_id=simulator_id,
    )
    artifact_dir = prepared.shared_workspace.workspace_dir / "artifacts"
    camera_screenshot_dir = artifact_dir / "cameras"
    report_path = artifact_dir / "report.json"
    return PreparedWorkspaceCommand(
        command=_module_command(
            MUJOCO_WORKSPACE_PROCESS_PARAMS,
            world_package_path=prepared.shared_workspace.world_package_path,
            robot_asset_flag="--robot-mjcf",
            robot_asset_path=prepared.mjcf_path,
            duration_sec=expectations.duration_sec,
            frame_map=_workspace_frame_map(expectations),
            extra_args=(
                "--robot-urdf",
                str(prepared.shared_workspace.robot_urdf_path),
                "--simulator-id",
                simulator_id,
                "--camera-screenshot-dir",
                str(camera_screenshot_dir),
            ),
            report_path=report_path,
        ),
        ready_marker=MUJOCO_WORKSPACE_PROCESS_PARAMS.ready_log_marker,
        expected_object_marker=f"world_objects={expectations.object_count}",
        expected_camera_log_marker=f"cameras={expectations.camera_count}",
        extra_expected_markers=(f"camera_screenshots={expectations.camera_count}",),
        expected_image_dirs=((camera_screenshot_dir, expectations.camera_count),),
        expected_report_path=report_path,
        expected_simulator_id=simulator_id,
        expected_object_count=expectations.object_count,
        expected_camera_count=expectations.camera_count,
        expected_requested_frame_map=_workspace_frame_map(expectations),
        expected_frame_map=_workspace_resolved_frame_map(expectations),
        expected_object_positions_xyz=_workspace_object_positions(expectations),
        expected_object_sizes_xyz=_workspace_object_sizes(expectations),
        expected_object_asset_refs=_workspace_object_asset_refs(expectations),
        expected_object_contracts=_workspace_object_contracts(expectations),
        expected_joint_positions=_workspace_joint_positions(expectations),
        expected_report_artifact_file_keys=("mjcf_path",),
        expected_report_artifact_dir_keys=("camera_screenshot_dir",),
    )


def _prepare_blender_command(
    request: SimulatorWorkspacePrepareRequest,
    expectations: WorkspaceExpectations,
) -> PreparedWorkspaceCommand:
    prepared = prepare_blender_workspace_package(request)
    artifact_dir = prepared.workspace_dir / "artifacts"
    blend_path = prepared.workspace_dir / "blender" / "urdf-studio-layout.blend"
    camera_screenshot_dir = artifact_dir / "cameras"
    report_path = artifact_dir / "report.json"
    blender_executable = resolve_blender_executable()
    extra_args: tuple[str, ...] = ()
    extra_expected_markers = ("edit_session=",)
    expected_image_dirs: tuple[tuple[Path, int], ...] = ()
    expected_file_validators: tuple[tuple[Path, Callable[[Path], str | None]], ...] = (
        (
            artifact_dir / BLENDER_EDIT_SESSION_FILENAME,
            lambda path: validate_blender_edit_session_artifact(
                path,
                expected_object_count=expectations.object_count,
                expected_camera_count=expectations.camera_count,
            ),
        ),
    )
    expected_report_artifact_file_keys = (
        "edit_session_path",
        "open_script_path",
        "export_script_path",
        "robot_usd_path",
    )
    expected_report_artifact_dir_keys: tuple[str, ...] = ()
    if blender_executable is not None:
        extra_args = (
            "--blender",
            blender_executable,
            "--camera-screenshot-dir",
            str(camera_screenshot_dir),
        )
        extra_expected_markers = (
            *extra_expected_markers,
            f"camera_screenshots={expectations.camera_count}",
        )
        expected_image_dirs = ((camera_screenshot_dir, expectations.camera_count),)
        expected_file_validators = (
            *expected_file_validators,
            (
                blend_path,
                lambda path: validate_blender_blend_artifact(
                    path,
                    blender_executable=blender_executable,
                    expected_object_count=expectations.object_count,
                    expected_camera_count=expectations.camera_count,
                ),
            ),
        )
        expected_report_artifact_file_keys = (
            *expected_report_artifact_file_keys,
            "blend_path",
        )
        expected_report_artifact_dir_keys = ("camera_screenshot_dir",)
    return _prepare_direct_urdf_command(
        prepared,
        simulator_id=SIMULATOR_BLENDER_ID,
        workspace_process=BLENDER_WORKSPACE_PROCESS_PARAMS,
        object_marker=f"world_objects={expectations.object_count}",
        extra_args=extra_args,
        extra_expected_markers=extra_expected_markers,
        expectations=expectations,
        expected_image_dirs=expected_image_dirs,
        expected_file_paths=(
            artifact_dir / BLENDER_OPEN_SCRIPT_FILENAME,
            artifact_dir / BLENDER_EXPORT_SCRIPT_FILENAME,
            artifact_dir / BLENDER_ROBOT_USD_FILENAME,
        ),
        expected_file_validators=expected_file_validators,
        expected_report_path=report_path,
        expected_report_artifact_file_keys=expected_report_artifact_file_keys,
        expected_report_artifact_dir_keys=expected_report_artifact_dir_keys,
    )


WORKSPACE_TARGETS: dict[SimulatorId, WorkspaceTarget] = {
    SIMULATOR_GENESIS_ID: WorkspaceTarget(
        simulator_id=SIMULATOR_GENESIS_ID,
        label="Genesis",
        prepare=_prepare_genesis_command,
    ),
    SIMULATOR_MJLAB_ID: WorkspaceTarget(
        simulator_id=SIMULATOR_MJLAB_ID,
        label="MJLab",
        prepare=lambda request, expectations: _prepare_mujoco_command(
            request,
            expectations,
            simulator_id=SIMULATOR_MJLAB_ID,
        ),
    ),
    SIMULATOR_MUJOCO_ID: WorkspaceTarget(
        simulator_id=SIMULATOR_MUJOCO_ID,
        label="MuJoCo",
        prepare=lambda request, expectations: _prepare_mujoco_command(
            request,
            expectations,
            simulator_id=SIMULATOR_MUJOCO_ID,
        ),
    ),
    SIMULATOR_PYBULLET_ID: WorkspaceTarget(
        simulator_id=SIMULATOR_PYBULLET_ID,
        label="PyBullet",
        prepare=_prepare_pybullet_command,
    ),
    SIMULATOR_BLENDER_ID: WorkspaceTarget(
        simulator_id=SIMULATOR_BLENDER_ID,
        label="Blender",
        prepare=_prepare_blender_command,
        requires_runtime=False,
        include_in_parity=True,
    ),
}


def _format_missing_runtime(status: SimulatorRuntimeStatus) -> str:
    missing = [
        dependency.name
        for dependency in status.dependencies
        if not dependency.available
    ]
    if missing:
        return f"missing runtime dependency: {', '.join(missing)}"
    return status.status


def _run_workspace_command(
    command: PreparedWorkspaceCommand,
    *,
    timeout_sec: float,
) -> tuple[bool, str]:
    process = subprocess.run(
        command.command,
        cwd=BASE_DIR,
        capture_output=True,
        text=True,
        timeout=timeout_sec,
        check=False,
        env=build_simulator_workspace_env(
            BASE_DIR / ".cache" / "simulator-workspaces" / "runtime-cache"
        ),
    )
    output = "\n".join(part for part in (process.stdout, process.stderr) if part)
    if process.returncode != 0:
        return False, output.strip() or f"process exited with code {process.returncode}"
    required_markers = (
        command.ready_marker,
        command.expected_object_marker,
        command.expected_camera_log_marker,
        *command.extra_expected_markers,
    )
    missing_markers = [marker for marker in required_markers if marker not in output]
    if missing_markers:
        return False, f"missing workspace marker(s): {', '.join(missing_markers)}\n{output.strip()}"
    image_error = validate_workspace_image_artifacts(
        WorkspaceImageArtifactExpectations(
            image_paths=command.expected_image_paths,
            image_dirs=command.expected_image_dirs,
            camera_ids=command.expected_camera_ids,
            camera_contracts=command.expected_camera_contracts,
        )
    )
    if image_error:
        return False, f"{image_error}\n{output.strip()}"
    file_error = _validate_file_artifacts(command)
    if file_error:
        return False, f"{file_error}\n{output.strip()}"
    report_error = _validate_report_artifact(command)
    if report_error:
        return False, f"{report_error}\n{output.strip()}"
    return True, output.strip()


def _validate_file_artifacts(command: PreparedWorkspaceCommand) -> str | None:
    for path in (
        *command.expected_file_paths,
        *(path for path, _validator in command.expected_file_validators),
    ):
        if not path.is_file():
            return f"missing file artifact: {path}"
        if path.stat().st_size <= 0:
            return f"empty file artifact: {path}"
    for _path, validator in command.expected_file_validators:
        validation_error = validator(_path)
        if validation_error:
            return validation_error
    return None


def _validate_report_artifact(command: PreparedWorkspaceCommand) -> str | None:
    report_path = command.expected_report_path
    if report_path is None:
        return None
    return validate_simulator_workspace_report(
        report_path,
        SimulatorWorkspaceReportExpectations(
            simulator_id=command.expected_simulator_id,
            object_count=command.expected_object_count,
            camera_count=command.expected_camera_count,
            requested_frame_map=command.expected_requested_frame_map,
            frame_map=command.expected_frame_map,
            object_positions_xyz=command.expected_object_positions_xyz,
            object_sizes_xyz=command.expected_object_sizes_xyz,
            object_asset_refs=command.expected_object_asset_refs,
            object_contracts=command.expected_object_contracts,
            joint_positions=command.expected_joint_positions,
            camera_ids=command.expected_camera_ids,
            camera_contracts=command.expected_camera_contracts,
            required_artifact_file_keys=command.expected_report_artifact_file_keys,
            required_artifact_dir_keys=command.expected_report_artifact_dir_keys,
        ),
    )


def _check_target(
    target: WorkspaceTarget,
    *,
    request: SimulatorWorkspacePrepareRequest,
    expectations: WorkspaceExpectations,
    timeout_sec: float,
    require_runtime: bool,
) -> WorkspaceCheckResult:
    status = get_simulator_runtime_status(target.simulator_id)
    runtime_notice: str | None = None
    if not status.available:
        detail = _format_missing_runtime(status)
        if require_runtime:
            return WorkspaceCheckResult(target.simulator_id, target.label, "failed", detail)
        if not target.requires_runtime:
            runtime_notice = f"{detail}; validating transfer artifacts without opening runtime"
        else:
            return WorkspaceCheckResult(target.simulator_id, target.label, "skipped", detail)

    try:
        command = target.prepare(request, expectations)
        ok, detail = _run_workspace_command(command, timeout_sec=timeout_sec)
        if runtime_notice:
            detail = f"{runtime_notice}\n{detail}" if detail else runtime_notice
    except Exception as exc:
        return WorkspaceCheckResult(
            target.simulator_id,
            target.label,
            "failed",
            f"{type(exc).__name__}: {exc}",
        )
    result_status = "failed"
    if ok:
        result_status = "artifact-only" if runtime_notice else "passed"
    return WorkspaceCheckResult(
        target.simulator_id,
        target.label,
        result_status,
        detail,
        report_path=str(command.expected_report_path) if ok and command.expected_report_path else None,
    )


def _selected_targets(simulator_ids: Sequence[SimulatorId] | None) -> tuple[WorkspaceTarget, ...]:
    selected_ids = tuple(simulator_ids or WORKSPACE_SIMULATORS)
    return tuple(WORKSPACE_TARGETS[simulator_id] for simulator_id in selected_ids)


def _check_cross_simulator_parity(
    results: Sequence[WorkspaceCheckResult],
) -> WorkspaceCheckResult | None:
    if any(result.status == "failed" for result in results):
        return None
    parity = check_simulator_workspace_parity(
        [
            WorkspaceParityInput(result.label, Path(result.report_path))
            for result in results
            if result.status == "passed"
            and result.report_path is not None
            and WORKSPACE_TARGETS[result.simulator_id].include_in_parity
            and _report_has_camera_artifacts(Path(result.report_path))
        ]
    )
    if parity is None:
        return None
    return WorkspaceCheckResult(
        WORKSPACE_PARITY_ID,
        "Workspace parity",
        "passed" if parity.passed else "failed",
        parity.detail,
    )


def _report_has_camera_artifacts(report_path: Path) -> bool:
    try:
        payload = json.loads(report_path.read_text(encoding="utf-8"))
    except Exception:
        return False
    artifacts = payload.get("artifacts") if isinstance(payload, Mapping) else None
    if not isinstance(artifacts, Mapping):
        return False
    directory = artifacts.get("camera_screenshot_dir")
    return isinstance(directory, str) and bool(directory.strip())


def _active_object_count(request: SimulatorWorkspacePrepareRequest) -> int:
    layout = _workspace_layout(request)
    return count_transferable_world_objects(layout, include_hidden=False)


def _workspace_layout(request: SimulatorWorkspacePrepareRequest):
    return parse_static_world_layout_payload(world_scene_package_json_payload(request.world_package))


def _resolved_frame_map_for_request(
    request: SimulatorWorkspacePrepareRequest,
    frame_map: WorldLayoutFrameMap,
) -> ConcreteWorldLayoutFrameMap:
    return resolve_world_layout_frame_map(_workspace_layout(request), frame_map)


def _expected_object_contract_for_request(
    request: SimulatorWorkspacePrepareRequest,
    frame_map: WorldLayoutFrameMap,
) -> tuple[
    dict[str, tuple[float, float, float]],
    dict[str, tuple[float, float, float]],
    dict[str, str | None],
    dict[str, ExpectedObjectReport],
]:
    primitives, _warnings = build_sim_primitives(
        _workspace_layout(request),
        frame_map=frame_map,
        include_hidden=False,
    )
    return (
        {primitive.source_id: primitive.position_xyz for primitive in primitives},
        {primitive.source_id: primitive.size_xyz for primitive in primitives},
        {primitive.source_id: primitive.asset_ref for primitive in primitives},
        {
            primitive.source_id: ExpectedObjectReport(
                source_id=primitive.source_id,
                source_name=primitive.source_name,
                sim_name=primitive.sim_name,
                source_type=primitive.source_type,
                sim_type=primitive.sim_type,
                position_xyz=primitive.position_xyz,
                quat_wxyz=primitive.quat_wxyz,
                size_xyz=primitive.size_xyz,
                rgba=primitive.rgba,
                collision=primitive.collision,
                fixed=primitive.fixed,
                mass_kg=primitive.mass_kg,
                friction=primitive.friction,
                restitution=primitive.restitution,
                semantic_role=primitive.semantic_role,
                asset_ref=primitive.asset_ref,
                asset_scale_xyz=primitive.asset_scale_xyz,
            )
            for primitive in primitives
        },
    )


def _expected_camera_ids_for_request(request: SimulatorWorkspacePrepareRequest) -> tuple[str, ...]:
    camera_ids: list[str] = []
    for index, camera in enumerate(request.world_package.world_snapshot.cameras):
        if isinstance(camera, Mapping):
            raw_id = camera.get("id")
            raw_name = camera.get("name")
            if isinstance(raw_id, str) and raw_id.strip():
                camera_ids.append(raw_id.strip())
                continue
            if isinstance(raw_name, str) and raw_name.strip():
                camera_ids.append(raw_name.strip())
                continue
        camera_ids.append(f"camera_{index + 1}")
    return tuple(camera_ids)


def _expected_camera_contracts_for_request(
    request: SimulatorWorkspacePrepareRequest,
) -> dict[str, ExpectedCameraReport]:
    if not request.world_package.world_snapshot.cameras:
        return {}
    with tempfile.TemporaryDirectory(prefix="urdf-studio-camera-contract-") as directory:
        robot_urdf_path = Path(directory) / "robot.urdf"
        robot_urdf_path.write_text(
            request.world_package.world_snapshot.urdf_xml,
            encoding="utf-8",
        )
        camera_specs, _warnings = build_sim_camera_specs(
            request.world_package,
            robot_urdf_path=robot_urdf_path,
        )
    return {
        camera.camera_id: ExpectedCameraReport(
            camera_id=camera.camera_id,
            sim_name=camera.sim_name,
            parent_joint=camera.parent_joint,
            parent_link=camera.parent_link,
            position_xyz=camera.position_xyz,
            quat_wxyz=camera.quat_wxyz,
            width=camera.width,
            height=camera.height,
            fov_deg=camera.fov_deg,
            intrinsics_matrix=camera.intrinsics.matrix if camera.intrinsics is not None else (),
        )
        for camera in camera_specs
    }


def _print_human_results(results: Sequence[WorkspaceCheckResult]) -> None:
    for result in results:
        if result.status == "passed":
            print(f"[simulator-workspaces-check] {result.label}: passed", flush=True)
        elif result.status == "artifact-only":
            detail = f" ({result.detail.splitlines()[0]})" if result.detail else ""
            print(f"[simulator-workspaces-check] {result.label}: artifact-only{detail}", flush=True)
        elif result.status == "skipped":
            print(f"[simulator-workspaces-check] {result.label}: skipped ({result.detail})", flush=True)
        else:
            print(f"[simulator-workspaces-check] {result.label}: failed", flush=True)
            if result.detail:
                print(result.detail, flush=True)


def main() -> int:
    args = _parse_args()
    if args.artifact_only and args.require_all:
        raise SystemExit("--artifact-only cannot be combined with --require-all")
    selected_ids = _selected_simulator_ids_from_args(args)
    require_runtime = (
        (bool(selected_ids) and not args.artifact_only)
        or args.require_all
        or _is_truthy_env(os.getenv(REQUIRE_SIMULATOR_WORKSPACE_ENV))
    )
    request = _workspace_request_from_args(args)
    (
        object_positions_xyz,
        object_sizes_xyz,
        object_asset_refs,
        object_contracts,
    ) = _expected_object_contract_for_request(request, args.frame_map)
    expectations = WorkspaceExpectations(
        object_count=_active_object_count(request),
        camera_count=len(request.world_package.world_snapshot.cameras),
        duration_sec=args.duration_sec,
        frame_map=args.frame_map,
        resolved_frame_map=_resolved_frame_map_for_request(request, args.frame_map),
        object_positions_xyz=object_positions_xyz,
        object_sizes_xyz=object_sizes_xyz,
        object_asset_refs=object_asset_refs,
        object_contracts=object_contracts,
        joint_positions={
            str(name): float(position)
            for name, position in request.world_package.world_snapshot.joint_positions.items()
        },
        camera_ids=_expected_camera_ids_for_request(request),
        camera_contracts=_expected_camera_contracts_for_request(request),
    )
    results = [
        _check_target(
            target,
            request=request,
            expectations=expectations,
            timeout_sec=args.timeout_sec,
            require_runtime=require_runtime,
        )
        for target in _selected_targets(selected_ids or None)
    ]
    parity_result = _check_cross_simulator_parity(results)
    if parity_result is not None:
        results.append(parity_result)

    if args.json:
        print(
            json.dumps(
                [
                    {
                        "simulator_id": result.simulator_id,
                        "label": result.label,
                        "status": result.status,
                        "detail": result.detail,
                        "report_path": result.report_path,
                    }
                    for result in results
                ],
                indent=2,
            )
        )
    else:
        _print_human_results(results)
    return 0 if all(result.status != "failed" for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
