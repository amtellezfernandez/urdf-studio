from __future__ import annotations

import argparse
import base64
import json
import math
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from backend.core.paths import BASE_DIR
from backend.models.simulator_runtime import (
    SIMULATOR_BLENDER_ID,
    SIMULATOR_GENESIS_ID,
    SIMULATOR_MJLAB_ID,
    SIMULATOR_MUJOCO_ID,
    SIMULATOR_PYBULLET_ID,
    SimulatorId,
    SimulatorMeshAssetUpload,
    SimulatorRuntimeStatus,
    SimulatorWorkspacePrepareRequest,
)
from backend.models.world_scene_package import (
    WorldInterfaceSpec,
    WorldRuntimeTarget,
    WorldScenePackageManifest,
    WorldSnapshot,
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


WORKSPACE_SIMULATORS: tuple[SimulatorId, ...] = (
    SIMULATOR_GENESIS_ID,
    SIMULATOR_MJLAB_ID,
    SIMULATOR_MUJOCO_ID,
    SIMULATOR_PYBULLET_ID,
    SIMULATOR_BLENDER_ID,
)
DEMO_ROOT = BASE_DIR / "web" / "public" / "demo"
SO101_MANIFEST_PATH = DEMO_ROOT / "so101" / "manifest.json"
SO101_CAMERA_CONFIG_PATH = DEMO_ROOT / "so101" / "camera-config.json"
STATIC_WORLD_LAYOUT_PATH = (
    BASE_DIR / "web" / "public" / "world-layouts" / "static-transfer-smoke.world-layout.json"
)
REQUIRE_SIMULATOR_WORKSPACE_ENV = "URDF_STUDIO_REQUIRE_SIMULATOR_WORKSPACE"
DEFAULT_DURATION_SEC = 0.02
DEFAULT_TIMEOUT_SEC = 180.0
WORKSPACE_ASSET_IGNORED_DIR_NAMES = frozenset(
    {
        ".cache",
        ".git",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        "__pycache__",
        "node_modules",
    }
)


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
        default="",
        help="Path to the local robot URDF used to resolve mesh assets for --world-package.",
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


def _load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return payload


def _load_demo_mesh_assets() -> list[SimulatorMeshAssetUpload]:
    manifest = _load_json(SO101_MANIFEST_PATH)
    files = manifest.get("files")
    if not isinstance(files, list):
        raise ValueError(f"Invalid SO101 manifest: {SO101_MANIFEST_PATH}")

    uploads: list[SimulatorMeshAssetUpload] = []
    for entry in files:
        if not isinstance(entry, dict):
            continue
        relative_path = entry.get("path")
        if not isinstance(relative_path, str) or relative_path == "robot.urdf":
            continue
        url = entry.get("url")
        source_path = (
            (SO101_MANIFEST_PATH.parent / url).resolve()
            if isinstance(url, str) and url
            else (DEMO_ROOT / relative_path).resolve()
        )
        uploads.append(
            SimulatorMeshAssetUpload(
                path=relative_path,
                aliases=[],
                content_base64=base64.b64encode(source_path.read_bytes()).decode("ascii"),
                mime=entry.get("mime") if isinstance(entry.get("mime"), str) else None,
            )
        )
    return uploads


def _load_demo_cameras() -> list[dict]:
    payload = _load_json(SO101_CAMERA_CONFIG_PATH)
    cameras = payload.get("cameras")
    if not isinstance(cameras, list):
        raise ValueError(f"Invalid SO101 camera config: {SO101_CAMERA_CONFIG_PATH}")
    return [camera for camera in cameras if isinstance(camera, dict)]


def _load_demo_objects() -> list[dict]:
    payload = _load_json(STATIC_WORLD_LAYOUT_PATH)
    world_layout = payload.get("world_layout")
    if not isinstance(world_layout, dict):
        raise ValueError(f"Invalid static world layout: {STATIC_WORLD_LAYOUT_PATH}")
    objects = world_layout.get("objects")
    if not isinstance(objects, list):
        raise ValueError(f"Invalid object list in static world layout: {STATIC_WORLD_LAYOUT_PATH}")
    return [item for item in objects if isinstance(item, dict)]


def build_demo_workspace_request() -> SimulatorWorkspacePrepareRequest:
    urdf_xml = (DEMO_ROOT / "robot.urdf").read_text(encoding="utf-8")
    cameras = _load_demo_cameras()
    objects = _load_demo_objects()
    world_package = WorldScenePackageManifest(
        package_id="so101-simulator-workspaces-check",
        version="1.0.0",
        title="SO101 Simulator Workspace Check",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        runtime_targets=[
            WorldRuntimeTarget(name=simulator_id, mode="python")
            for simulator_id in WORKSPACE_SIMULATORS
        ],
        interface=WorldInterfaceSpec(
            observation_modalities=["state", "rgb"],
            action_semantics="joint_position",
            timestep_ms=10,
            frame_convention="ros-rep-103",
        ),
        world_snapshot=WorldSnapshot(
            urdf_xml=urdf_xml,
            joint_positions={},
            cameras=cameras,
            objects=objects,
            scenario_time_ms=0,
            scenario_duration_ms=0,
        ),
        provenance={
            "robot": str((DEMO_ROOT / "robot.urdf").relative_to(BASE_DIR)),
            "cameras": str(SO101_CAMERA_CONFIG_PATH.relative_to(BASE_DIR)),
            "world_layout": str(STATIC_WORLD_LAYOUT_PATH.relative_to(BASE_DIR)),
        },
    )
    return SimulatorWorkspacePrepareRequest(
        world_package=world_package,
        urdf_asset_path="robot.urdf",
        mesh_assets=_load_demo_mesh_assets(),
    )


def build_workspace_request_from_files(
    *,
    world_package_path: Path,
    robot_urdf_path: Path,
    asset_roots: Sequence[Path] = (),
) -> SimulatorWorkspacePrepareRequest:
    world_package = WorldScenePackageManifest.model_validate(_load_json(world_package_path))
    resolved_robot_urdf_path = robot_urdf_path.expanduser().resolve()
    if not resolved_robot_urdf_path.is_file():
        raise ValueError(f"Robot URDF does not exist: {robot_urdf_path}")
    resolved_asset_roots = tuple(
        dict.fromkeys(
            root.expanduser().resolve()
            for root in (asset_roots or (resolved_robot_urdf_path.parent,))
        )
    )
    for root in resolved_asset_roots:
        if not root.is_dir():
            raise ValueError(f"Asset root does not exist or is not a directory: {root}")
    return SimulatorWorkspacePrepareRequest(
        world_package=world_package,
        urdf_asset_path=_relative_to_asset_roots(
            resolved_robot_urdf_path,
            resolved_asset_roots,
            fallback=resolved_robot_urdf_path.name,
        ),
        mesh_assets=_load_workspace_asset_uploads(
            resolved_asset_roots,
            skip_paths=(resolved_robot_urdf_path,),
        ),
    )


def _relative_to_asset_roots(path: Path, roots: Sequence[Path], *, fallback: str) -> str:
    resolved_path = path.resolve()
    for root in roots:
        try:
            return resolved_path.relative_to(root.resolve()).as_posix()
        except ValueError:
            continue
    return fallback


def _load_workspace_asset_uploads(
    asset_roots: Sequence[Path],
    *,
    skip_paths: Sequence[Path] = (),
) -> list[SimulatorMeshAssetUpload]:
    skipped = {path.resolve() for path in skip_paths}
    content_by_path: dict[str, bytes] = {}
    for root in asset_roots:
        resolved_root = root.resolve()
        for source_path in sorted(path for path in resolved_root.rglob("*") if path.is_file()):
            resolved_source_path = source_path.resolve()
            if resolved_source_path in skipped:
                continue
            relative_path = resolved_source_path.relative_to(resolved_root).as_posix()
            if _is_ignored_workspace_asset_path(relative_path):
                continue
            content = resolved_source_path.read_bytes()
            existing = content_by_path.get(relative_path)
            if existing is not None and existing != content:
                raise ValueError(f"Conflicting asset path across asset roots: {relative_path}")
            content_by_path[relative_path] = content
    return [
        SimulatorMeshAssetUpload(
            path=relative_path,
            aliases=[],
            content_base64=base64.b64encode(content).decode("ascii"),
        )
        for relative_path, content in sorted(content_by_path.items())
    ]


def _is_ignored_workspace_asset_path(relative_path: str) -> bool:
    return any(part in WORKSPACE_ASSET_IGNORED_DIR_NAMES for part in Path(relative_path).parts)


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
    if not report_path.exists():
        return f"missing simulator validation report: {report_path}"
    try:
        payload = json.loads(report_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return f"invalid simulator validation report {report_path}: {exc}"
    if not isinstance(payload, dict):
        return f"invalid simulator validation report {report_path}: expected JSON object"

    required_fields = (
        "simulator",
        "package_id",
        "frame_map",
        "primitive_count",
        "camera_count",
        "objects",
        "cameras",
        "artifacts",
    )
    missing_fields = [field for field in required_fields if field not in payload]
    if missing_fields:
        return f"simulator validation report missing field(s): {', '.join(missing_fields)}"

    simulator = payload.get("simulator")
    if not isinstance(simulator, Mapping):
        return "simulator validation report field 'simulator' must be an object"
    if command.expected_simulator_id is not None and simulator.get("id") != command.expected_simulator_id:
        return (
            "simulator validation report has wrong simulator id: "
            f"{simulator.get('id')!r}, expected {command.expected_simulator_id!r}"
        )

    count_error = _validate_report_count(
        payload,
        field_name="primitive_count",
        list_field_name="objects",
        expected_count=command.expected_object_count,
    )
    if count_error:
        return count_error
    count_error = _validate_report_count(
        payload,
        field_name="camera_count",
        list_field_name="cameras",
        expected_count=command.expected_camera_count,
    )
    if count_error:
        return count_error
    item_error = _validate_report_item_fields(
        payload,
        list_field_name="objects",
        required_fields=(
            "source_id",
            "sim_name",
            "sim_type",
            "position_xyz",
            "quat_wxyz",
            "size_xyz",
            "rgba",
        ),
    )
    if item_error:
        return item_error
    return _validate_report_item_fields(
        payload,
        list_field_name="cameras",
        required_fields=(
            "camera_id",
            "sim_name",
            "parent_link",
            "position_xyz",
            "quat_wxyz",
            "width",
            "height",
            "fov_deg",
            "intrinsics",
        ),
    )


def _validate_report_count(
    payload: Mapping[str, Any],
    *,
    field_name: str,
    list_field_name: str,
    expected_count: int | None,
) -> str | None:
    count = payload.get(field_name)
    if expected_count is not None and count != expected_count:
        return (
            f"simulator validation report has {field_name}={count!r}, "
            f"expected {expected_count}"
        )
    items = payload.get(list_field_name)
    if not isinstance(items, list):
        return f"simulator validation report field '{list_field_name}' must be a list"
    if isinstance(count, int) and len(items) != count:
        return (
            f"simulator validation report field '{list_field_name}' has {len(items)} item(s), "
            f"expected {count}"
        )
    return None


def _validate_report_item_fields(
    payload: Mapping[str, Any],
    *,
    list_field_name: str,
    required_fields: tuple[str, ...],
) -> str | None:
    items = payload.get(list_field_name)
    if not isinstance(items, list):
        return f"simulator validation report field '{list_field_name}' must be a list"
    for index, item in enumerate(items):
        if not isinstance(item, Mapping):
            return (
                f"simulator validation report field '{list_field_name}[{index}]' "
                "must be an object"
            )
        missing_fields = [field for field in required_fields if field not in item]
        if missing_fields:
            return (
                f"simulator validation report field '{list_field_name}[{index}]' "
                f"missing field(s): {', '.join(missing_fields)}"
            )
        value_error = _validate_report_item_values(
            item,
            path=f"{list_field_name}[{index}]",
            list_field_name=list_field_name,
        )
        if value_error:
            return value_error
    return None


def _validate_report_item_values(
    item: Mapping[str, Any],
    *,
    path: str,
    list_field_name: str,
) -> str | None:
    if list_field_name == "objects":
        for field_name in ("source_id", "sim_name", "sim_type"):
            error = _validate_report_string(item.get(field_name), f"{path}.{field_name}")
            if error:
                return error
        for field_name in ("position_xyz", "size_xyz"):
            error = _validate_report_vector3(
                item.get(field_name),
                f"{path}.{field_name}",
                positive=field_name == "size_xyz",
            )
            if error:
                return error
        error = _validate_report_quat_wxyz(item.get("quat_wxyz"), f"{path}.quat_wxyz")
        if error:
            return error
        return _validate_report_rgba(item.get("rgba"), f"{path}.rgba")

    if list_field_name == "cameras":
        for field_name in ("camera_id", "sim_name", "parent_link"):
            error = _validate_report_string(item.get(field_name), f"{path}.{field_name}")
            if error:
                return error
        error = _validate_report_vector3(item.get("position_xyz"), f"{path}.position_xyz")
        if error:
            return error
        error = _validate_report_quat_wxyz(item.get("quat_wxyz"), f"{path}.quat_wxyz")
        if error:
            return error
        for field_name in ("width", "height"):
            error = _validate_report_positive_int(item.get(field_name), f"{path}.{field_name}")
            if error:
                return error
        error = _validate_report_camera_fov(item.get("fov_deg"), f"{path}.fov_deg")
        if error:
            return error
        return _validate_report_camera_intrinsics(
            item.get("intrinsics"),
            f"{path}.intrinsics",
        )
    return None


def _validate_report_string(value: Any, path: str) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return f"simulator validation report field '{path}' must be a non-empty string"
    return None


def _validate_report_vector3(
    value: Any,
    path: str,
    *,
    positive: bool = False,
) -> str | None:
    numbers = _report_number_tuple(value, path, expected_length=3)
    if isinstance(numbers, str):
        return numbers
    if positive and any(number <= 0.0 for number in numbers):
        return f"simulator validation report field '{path}' must contain positive numbers"
    return None


def _validate_report_quat_wxyz(value: Any, path: str) -> str | None:
    numbers = _report_number_tuple(value, path, expected_length=4)
    if isinstance(numbers, str):
        return numbers
    norm = math.sqrt(sum(number * number for number in numbers))
    if norm <= 0.0:
        return f"simulator validation report field '{path}' must be a non-zero quaternion"
    return None


def _validate_report_rgba(value: Any, path: str) -> str | None:
    numbers = _report_number_tuple(value, path, expected_length=4)
    if isinstance(numbers, str):
        return numbers
    if any(number < 0.0 or number > 1.0 for number in numbers):
        return f"simulator validation report field '{path}' must contain numbers between 0 and 1"
    return None


def _validate_report_positive_int(value: Any, path: str) -> str | None:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        return f"simulator validation report field '{path}' must be a positive integer"
    return None


def _validate_report_positive_number(value: Any, path: str) -> str | None:
    if not _is_finite_report_number(value) or float(value) <= 0.0:
        return f"simulator validation report field '{path}' must be a positive finite number"
    return None


def _validate_report_camera_fov(value: Any, path: str) -> str | None:
    if not _is_finite_report_number(value):
        return f"simulator validation report field '{path}' must be a finite number"
    parsed = float(value)
    if parsed <= 0.0 or parsed >= 180.0:
        return f"simulator validation report field '{path}' must be between 0 and 180 degrees"
    return None


def _validate_report_camera_intrinsics(value: Any, path: str) -> str | None:
    if not isinstance(value, Mapping):
        return f"simulator validation report field '{path}' must be an object"
    matrix = value.get("matrix")
    rows = _report_matrix3(matrix, f"{path}.matrix")
    if isinstance(rows, str):
        return rows
    if rows[0][0] <= 0.0 or rows[1][1] <= 0.0:
        return f"simulator validation report field '{path}.matrix' must have positive focal lengths"
    bottom_row = rows[2]
    if not (
        math.isclose(bottom_row[0], 0.0, abs_tol=1e-9)
        and math.isclose(bottom_row[1], 0.0, abs_tol=1e-9)
        and math.isclose(bottom_row[2], 1.0, abs_tol=1e-9)
    ):
        return (
            f"simulator validation report field '{path}.matrix' must have "
            "homogeneous bottom row [0, 0, 1]"
        )
    return None


def _report_matrix3(value: Any, path: str) -> tuple[tuple[float, float, float], ...] | str:
    if not isinstance(value, list) or len(value) != 3:
        return f"simulator validation report field '{path}' must be a 3x3 number matrix"
    rows: list[tuple[float, float, float]] = []
    for row_index, row in enumerate(value):
        numbers = _report_number_tuple(
            row,
            f"{path}[{row_index}]",
            expected_length=3,
        )
        if isinstance(numbers, str):
            return f"simulator validation report field '{path}' must be a 3x3 number matrix"
        rows.append((numbers[0], numbers[1], numbers[2]))
    return tuple(rows)


def _report_number_tuple(
    value: Any,
    path: str,
    *,
    expected_length: int,
) -> tuple[float, ...] | str:
    if (
        not isinstance(value, list)
        or len(value) != expected_length
        or not all(_is_finite_report_number(component) for component in value)
    ):
        return (
            f"simulator validation report field '{path}' must be a "
            f"{expected_length}-number list"
        )
    return tuple(float(component) for component in value)


def _is_finite_report_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


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
