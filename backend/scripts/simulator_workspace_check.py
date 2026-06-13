from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
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
from backend.services.simulator_adapters.blender_workspace import (
    BLENDER_EDIT_SESSION_FILENAME,
    BLENDER_EXPORT_SCRIPT_FILENAME,
    BLENDER_OPEN_SCRIPT_FILENAME,
    BLENDER_ROBOT_USD_FILENAME,
)
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
from backend.services.simulator_adapters.workspace_request_sources import (
    WORKSPACE_SIMULATORS,
    build_demo_workspace_request,
    build_workspace_request_from_files,
)
from backend.services.simulator_adapters.workspace_report_validation import (
    SimulatorWorkspaceReportExpectations,
    validate_simulator_workspace_report,
)

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
    expected_report_path: Path | None = None
    expected_simulator_id: SimulatorId | None = None
    expected_object_count: int | None = None
    expected_camera_count: int | None = None
    expected_report_artifact_file_keys: tuple[str, ...] = ()
    expected_report_artifact_dir_keys: tuple[str, ...] = ()


@dataclass(frozen=True)
class WorkspaceExpectations:
    object_count: int
    camera_count: int
    duration_sec: float


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
    parser.add_argument("--duration-sec", type=float, default=DEFAULT_DURATION_SEC)
    parser.add_argument("--timeout-sec", type=float, default=DEFAULT_TIMEOUT_SEC)
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
    has_custom_world_package = bool(args.world_package)
    has_custom_robot_urdf = bool(args.robot_urdf)
    if has_custom_world_package != has_custom_robot_urdf:
        raise SystemExit("--world-package and --robot-urdf must be provided together")
    if args.asset_root and not has_custom_world_package:
        raise SystemExit("--asset-root can only be used with --world-package and --robot-urdf")
    if not has_custom_world_package:
        return build_demo_workspace_request()
    return build_workspace_request_from_files(
        world_package_path=Path(args.world_package),
        robot_urdf_path=Path(args.robot_urdf),
        asset_roots=tuple(Path(root) for root in args.asset_root),
    )


def _module_command(
    workspace_process: SimulatorWorkspaceProcessParams,
    *,
    world_package_path: Path,
    robot_asset_flag: str,
    robot_asset_path: Path,
    duration_sec: float,
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
        "identity",
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
        expected_report_path=expected_report_path,
        expected_simulator_id=simulator_id,
        expected_object_count=expectations.object_count,
        expected_camera_count=expectations.camera_count,
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
        expected_report_artifact_file_keys=("mjcf_path",),
        expected_report_artifact_dir_keys=("camera_screenshot_dir",),
    )


def _prepare_blender_command(
    request: SimulatorWorkspacePrepareRequest,
    expectations: WorkspaceExpectations,
) -> PreparedWorkspaceCommand:
    prepared = prepare_blender_workspace_package(request)
    artifact_dir = prepared.workspace_dir / "artifacts"
    camera_screenshot_dir = artifact_dir / "cameras"
    report_path = artifact_dir / "report.json"
    blender_executable = resolve_blender_executable()
    extra_args: tuple[str, ...] = ()
    extra_expected_markers = ("edit_session=",)
    expected_image_dirs: tuple[tuple[Path, int], ...] = ()
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
            artifact_dir / BLENDER_EDIT_SESSION_FILENAME,
            artifact_dir / BLENDER_OPEN_SCRIPT_FILENAME,
            artifact_dir / BLENDER_EXPORT_SCRIPT_FILENAME,
            artifact_dir / BLENDER_ROBOT_USD_FILENAME,
        ),
        expected_report_path=report_path,
        expected_report_artifact_file_keys=(
            "edit_session_path",
            "open_script_path",
            "export_script_path",
            "robot_usd_path",
        ),
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
    image_error = _validate_image_artifacts(command)
    if image_error:
        return False, f"{image_error}\n{output.strip()}"
    file_error = _validate_file_artifacts(command)
    if file_error:
        return False, f"{file_error}\n{output.strip()}"
    report_error = _validate_report_artifact(command)
    if report_error:
        return False, f"{report_error}\n{output.strip()}"
    return True, output.strip()


def _validate_image_artifacts(command: PreparedWorkspaceCommand) -> str | None:
    image_paths = list(command.expected_image_paths)
    for directory, expected_count in command.expected_image_dirs:
        directory_images = sorted(directory.glob("*.png")) if directory.exists() else []
        if len(directory_images) != expected_count:
            return f"expected {expected_count} PNG artifact(s) in {directory}, found {len(directory_images)}"
        image_paths.extend(directory_images)
    if not image_paths:
        return None

    try:
        from PIL import Image
    except Exception as exc:
        return f"could not validate image artifacts: {exc}"

    for path in image_paths:
        if not path.exists():
            return f"missing image artifact: {path}"
        try:
            image = Image.open(path).convert("RGB")
        except Exception as exc:
            return f"invalid image artifact {path}: {exc}"
        extrema = image.getextrema()
        channel_span = max(high - low for low, high in extrema)
        if channel_span <= 5:
            return f"blank image artifact: {path}"
    return None


def _validate_file_artifacts(command: PreparedWorkspaceCommand) -> str | None:
    for path in command.expected_file_paths:
        if not path.is_file():
            return f"missing file artifact: {path}"
        if path.stat().st_size <= 0:
            return f"empty file artifact: {path}"
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
    return WorkspaceCheckResult(
        target.simulator_id,
        target.label,
        "passed" if ok else "failed",
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
    return sum(
        1
        for item in request.world_package.world_snapshot.objects
        if not (isinstance(item, dict) and item.get("is_hidden") is True)
    )


def _print_human_results(results: Sequence[WorkspaceCheckResult]) -> None:
    for result in results:
        if result.status == "passed":
            print(f"[simulator-workspaces-check] {result.label}: passed", flush=True)
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
    selected_ids = tuple(args.simulator or ())
    require_runtime = (
        (bool(selected_ids) and not args.artifact_only)
        or args.require_all
        or _is_truthy_env(os.getenv(REQUIRE_SIMULATOR_WORKSPACE_ENV))
    )
    request = _workspace_request_from_args(args)
    expectations = WorkspaceExpectations(
        object_count=_active_object_count(request),
        camera_count=len(request.world_package.world_snapshot.cameras),
        duration_sec=args.duration_sec,
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
