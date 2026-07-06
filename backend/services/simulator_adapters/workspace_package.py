from __future__ import annotations

import json
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from backend.models.simulator_runtime import (
    SimulatorWorkspacePrepareRequest,
)
from backend.services.ilu_session import (
    IluSessionError,
    IluSessionLocalUrdfSourceContext,
    get_ilu_session_local_urdf_source_context,
)
from backend.services.ilu_urdf import (
    BundleMeshAssetsResult,
    IluUrdfBridgeError,
    bundle_mesh_assets_for_urdf_file,
)
from backend.services.simulator_adapters.workspace_paths import (
    compute_workspace_asset_roots,
    write_workspace_asset_roots,
)
from backend.services.simulator_adapters.urdf_workspace_paths import (
    normalize_resolved_urdf_asset_path,
    normalize_root_relative_urdf_mesh_filenames,
)
from backend.services.simulator_adapters.urdf_material_policy import (
    materialize_urdf_visual_material_colors,
)
from backend.services.simulator_adapters.workspace_asset_staging import (
    normalize_workspace_asset_path,
    package_root_hint_paths,
    write_package_root_hints,
    write_uploaded_workspace_assets,
    write_workspace_asset_file,
)
from backend.services.world_scene_package_digest import (
    normalize_and_require_world_scene_registry_envelope_artifact_digests,
)
from backend.services.world_layout_static_transfer import (
    count_transferable_world_objects,
    parse_static_world_layout_payload,
)


@dataclass(frozen=True)
class PreparedSimulatorWorkspace:
    workspace_dir: Path
    world_package_path: Path
    robot_urdf_path: Path
    bundle_result: BundleMeshAssetsResult
    robot_urdf_xml: str = ""
    world_object_count: int = 0
    camera_count: int = 0


@dataclass(frozen=True)
class StagedWorkspaceRobotSource:
    requested_asset_path: str
    staged_urdf_relative_path: str
    staged_urdf_path: Path
    robot_urdf_xml: str


@dataclass(frozen=True)
class WorkspaceRobotBundleInputs:
    source_urdf_path: Path
    bundled_urdf_path: Path
    workspace_asset_roots: tuple[Path, ...]


def _timestamped_workspace_dir(workspace_root: Path) -> Path:
    path = workspace_root / f"workspace-{time.time_ns()}"
    path.mkdir(parents=True, exist_ok=False)
    return path


def _raise(error: Callable[[str], Exception], message: str) -> None:
    raise error(message)


def normalize_simulator_workspace_package_request(
    request: SimulatorWorkspacePrepareRequest,
) -> SimulatorWorkspacePrepareRequest:
    normalized_world_package = normalize_and_require_world_scene_registry_envelope_artifact_digests(
        request.world_package,
        context="Simulator workspace world package invalid",
    )
    normalized_request = request
    if normalized_world_package is not request.world_package:
        normalized_request = request.model_copy(
            update={"world_package": normalized_world_package},
            deep=True,
        )
    return normalized_request


def _transferable_world_object_count(request: SimulatorWorkspacePrepareRequest) -> int:
    layout = parse_static_world_layout_payload(
        request.world_package.model_dump(mode="json", exclude_none=True)
    )
    return count_transferable_world_objects(layout, include_hidden=False)


def _write_workspace_world_package(
    request: SimulatorWorkspacePrepareRequest,
    *,
    workspace_dir: Path,
) -> Path:
    world_package_path = workspace_dir / "world-package.json"
    world_package_path.write_text(
        f"{request.world_package.model_dump_json(indent=2, exclude_none=True)}\n",
        encoding="utf-8",
    )
    return world_package_path


def _stage_workspace_robot_source(
    request: SimulatorWorkspacePrepareRequest,
    *,
    source_root: Path,
    error: Callable[[str], Exception],
) -> StagedWorkspaceRobotSource:
    requested_asset_path = request.urdf_asset_path or "robot.urdf"
    staged_urdf_relative_path = normalize_resolved_urdf_asset_path(requested_asset_path)
    staged_urdf_path = source_root / staged_urdf_relative_path
    robot_urdf_xml = normalize_root_relative_urdf_mesh_filenames(
        request.world_package.world.urdf_xml or ""
    )
    write_workspace_asset_file(
        source_root,
        staged_urdf_relative_path,
        robot_urdf_xml.encode("utf-8"),
        error=error,
    )
    return StagedWorkspaceRobotSource(
        requested_asset_path=requested_asset_path,
        staged_urdf_relative_path=staged_urdf_relative_path,
        staged_urdf_path=staged_urdf_path,
        robot_urdf_xml=robot_urdf_xml,
    )


def _local_ilu_session_source_context(
    session_id: str,
    *,
    error: Callable[[str], Exception],
) -> IluSessionLocalUrdfSourceContext | None:
    try:
        return get_ilu_session_local_urdf_source_context(session_id)
    except IluSessionError as exc:
        if exc.status_code == 404 and exc.detail == "ilu session has no local asset source.":
            return None
        _raise(error, exc.detail)


def _resolve_workspace_robot_bundle_inputs(
    request: SimulatorWorkspacePrepareRequest,
    *,
    workspace_dir: Path,
    source_root: Path,
    staged_robot_source: StagedWorkspaceRobotSource,
    error: Callable[[str], Exception],
) -> WorkspaceRobotBundleInputs:
    source_urdf_path = staged_robot_source.staged_urdf_path
    uploaded_asset_sources: list[Path] = [source_root, staged_robot_source.staged_urdf_path.parent]
    requested_asset_parent = (
        source_root / normalize_workspace_asset_path(staged_robot_source.requested_asset_path)
    ).parent
    if requested_asset_parent != staged_robot_source.staged_urdf_path.parent:
        uploaded_asset_sources.append(requested_asset_parent)
    if request.ilu_session_id:
        session_context = _local_ilu_session_source_context(
            request.ilu_session_id,
            error=error,
        )
        if session_context is not None:
            source_urdf_path = session_context.source_urdf_path
            uploaded_asset_sources.extend(session_context.extra_search_roots)

    uploaded_asset_sources.extend(package_root_hint_paths(source_root, request.package_roots))

    bundled_urdf_path = workspace_dir / "robot" / "robot.urdf"
    workspace_asset_roots = compute_workspace_asset_roots(
        workspace_dir=workspace_dir,
        robot_urdf_path=bundled_urdf_path,
        uploaded_asset_sources=tuple(uploaded_asset_sources),
    )
    return WorkspaceRobotBundleInputs(
        source_urdf_path=source_urdf_path,
        bundled_urdf_path=bundled_urdf_path,
        workspace_asset_roots=workspace_asset_roots,
    )


def _bundle_workspace_robot_assets(
    bundle_inputs: WorkspaceRobotBundleInputs,
    *,
    robot_urdf_xml: str,
    error: Callable[[str], Exception],
) -> BundleMeshAssetsResult:
    try:
        return bundle_mesh_assets_for_urdf_file(
            urdf_path=str(bundle_inputs.source_urdf_path),
            urdf_xml=robot_urdf_xml,
            out_path=str(bundle_inputs.bundled_urdf_path),
            extra_search_roots=[str(path) for path in bundle_inputs.workspace_asset_roots],
        )
    except IluUrdfBridgeError as exc:
        _raise(error, exc.detail)


def _raise_on_workspace_bundle_failure(
    bundle_result: BundleMeshAssetsResult,
    *,
    error: Callable[[str], Exception],
) -> None:
    if not bundle_result.success:
        _raise(
            error,
            bundle_result.error or "Simulator workspace could not bundle robot mesh assets.",
        )
    if bundle_result.unresolved:
        unresolved = ", ".join(bundle_result.unresolved[:8])
        suffix = "" if len(bundle_result.unresolved) <= 8 else " ..."
        _raise(
            error,
            f"Simulator workspace could not resolve robot mesh assets: {unresolved}{suffix}",
        )


def _materialize_workspace_robot_urdf(
    bundled_urdf_path: Path,
    *,
    error: Callable[[str], Exception],
) -> str:
    try:
        materialize_urdf_visual_material_colors(bundled_urdf_path)
    except ET.ParseError as exc:
        _raise(error, f"Simulator workspace could not parse robot URDF materials: {exc}")
    try:
        return bundled_urdf_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        _raise(error, f"Simulator workspace could not read robot URDF materials: {exc}")


def prepare_simulator_workspace_package(
    request: SimulatorWorkspacePrepareRequest,
    *,
    workspace_root: Path,
    error: Callable[[str], Exception],
) -> PreparedSimulatorWorkspace:
    request = normalize_simulator_workspace_package_request(request)
    workspace_dir = _timestamped_workspace_dir(workspace_root)
    source_root = workspace_dir / "source"
    try:
        source_root.mkdir(parents=True, exist_ok=True)
        return _prepare_simulator_workspace_package_inner(
            request,
            workspace_dir=workspace_dir,
            source_root=source_root,
            error=error,
        )
    except BaseException:
        # Cleanup boundary: remove the partially prepared workspace even on cancellation or interpreter shutdown.
        shutil.rmtree(workspace_dir, ignore_errors=True)
        raise


def _prepare_simulator_workspace_package_inner(
    request: SimulatorWorkspacePrepareRequest,
    *,
    workspace_dir: Path,
    source_root: Path,
    error: Callable[[str], Exception],
) -> PreparedSimulatorWorkspace:
    write_uploaded_workspace_assets(source_root, request.mesh_assets, error=error)
    write_package_root_hints(source_root, request.package_roots)
    world_package_path = _write_workspace_world_package(request, workspace_dir=workspace_dir)
    staged_robot_source = _stage_workspace_robot_source(
        request,
        source_root=source_root,
        error=error,
    )
    bundle_inputs = _resolve_workspace_robot_bundle_inputs(
        request,
        workspace_dir=workspace_dir,
        source_root=source_root,
        staged_robot_source=staged_robot_source,
        error=error,
    )
    bundle_inputs.bundled_urdf_path.parent.mkdir(parents=True, exist_ok=True)
    write_workspace_asset_roots(workspace_dir, bundle_inputs.workspace_asset_roots)
    bundle_result = _bundle_workspace_robot_assets(
        bundle_inputs,
        robot_urdf_xml=staged_robot_source.robot_urdf_xml,
        error=error,
    )
    _raise_on_workspace_bundle_failure(
        bundle_result,
        error=error,
    )
    prepared_robot_urdf_xml = _materialize_workspace_robot_urdf(
        bundle_inputs.bundled_urdf_path,
        error=error,
    )

    return PreparedSimulatorWorkspace(
        workspace_dir=workspace_dir,
        world_package_path=world_package_path,
        robot_urdf_path=bundle_inputs.bundled_urdf_path,
        bundle_result=bundle_result,
        robot_urdf_xml=prepared_robot_urdf_xml,
        world_object_count=_transferable_world_object_count(request),
        camera_count=len(request.world_package.world.cameras or []),
    )


def read_log_tail(log_path: Path, *, tail_chars: int) -> str:
    try:
        with log_path.open("rb") as handle:
            handle.seek(0, 2)
            size = handle.tell()
            handle.seek(max(0, size - tail_chars))
            return handle.read().decode("utf-8", errors="replace").strip()
    except OSError:
        return ""


def _raise_workspace_launch_cancelled(
    *,
    simulator_label: str,
    error: Callable[[str], Exception],
) -> None:
    _raise(error, f"{simulator_label} workspace launch was cancelled.")


def _raise_if_workspace_launch_cancelled(
    *,
    simulator_label: str,
    error: Callable[[str], Exception],
    should_cancel: Callable[[], bool] | None,
) -> None:
    if should_cancel is not None and should_cancel():
        _raise_workspace_launch_cancelled(
            simulator_label=simulator_label,
            error=error,
        )


def _raise_on_workspace_process_exit(
    process: subprocess.Popen,
    *,
    simulator_label: str,
    log_path: Path,
    log_tail_chars: int,
    error: Callable[[str], Exception],
) -> None:
    returncode = process.poll()
    if returncode is None:
        return
    _raise(
        error,
        _format_startup_failure(
            simulator_label=simulator_label,
            returncode=returncode,
            log_path=log_path,
            log_tail_chars=log_tail_chars,
        ),
    )


def _raise_if_workspace_process_not_ready(
    process: subprocess.Popen,
    *,
    simulator_label: str,
    log_path: Path,
    log_tail_chars: int,
    error: Callable[[str], Exception],
    should_cancel: Callable[[], bool] | None,
) -> None:
    _raise_if_workspace_launch_cancelled(
        simulator_label=simulator_label,
        error=error,
        should_cancel=should_cancel,
    )
    _raise_on_workspace_process_exit(
        process,
        simulator_label=simulator_label,
        log_path=log_path,
        log_tail_chars=log_tail_chars,
        error=error,
    )


def _workspace_ready_log_marker_seen(
    *,
    log_path: Path,
    ready_log_marker: str,
    log_tail_chars: int,
) -> bool:
    return ready_log_marker in read_log_tail(log_path, tail_chars=log_tail_chars)


def _raise_if_workspace_process_still_not_ready(
    process: subprocess.Popen,
    *,
    simulator_label: str,
    log_path: Path,
    ready_log_marker: str,
    log_tail_chars: int,
    error: Callable[[str], Exception],
    should_cancel: Callable[[], bool] | None,
) -> bool:
    _raise_if_workspace_process_not_ready(
        process,
        simulator_label=simulator_label,
        log_path=log_path,
        log_tail_chars=log_tail_chars,
        error=error,
        should_cancel=should_cancel,
    )
    return _workspace_ready_log_marker_seen(
        log_path=log_path,
        ready_log_marker=ready_log_marker,
        log_tail_chars=log_tail_chars,
    )


def wait_for_workspace_readiness(
    process: subprocess.Popen,
    *,
    simulator_label: str,
    log_path: Path,
    ready_log_marker: str,
    log_tail_chars: int,
    poll_sec: float,
    ready_timeout_sec: float,
    post_ready_grace_sec: float,
    error: Callable[[str], Exception],
    should_cancel: Callable[[], bool] | None = None,
) -> None:
    deadline = time.monotonic() + ready_timeout_sec
    while time.monotonic() < deadline:
        if _raise_if_workspace_process_still_not_ready(
            process,
            simulator_label=simulator_label,
            log_path=log_path,
            ready_log_marker=ready_log_marker,
            log_tail_chars=log_tail_chars,
            error=error,
            should_cancel=should_cancel,
        ):
            time.sleep(post_ready_grace_sec)
            if _raise_if_workspace_process_still_not_ready(
                process,
                simulator_label=simulator_label,
                log_path=log_path,
                ready_log_marker=ready_log_marker,
                log_tail_chars=log_tail_chars,
                error=error,
                should_cancel=should_cancel,
            ):
                return
        time.sleep(poll_sec)
    _raise_if_workspace_launch_cancelled(
        simulator_label=simulator_label,
        error=error,
        should_cancel=should_cancel,
    )
    _raise(
        error,
        f"{simulator_label} workspace did not become ready within {ready_timeout_sec:.0f}s. "
        f"Workspace log: {log_path}",
    )


def _format_startup_failure(
    *,
    simulator_label: str,
    returncode: int,
    log_path: Path,
    log_tail_chars: int,
) -> str:
    detail = (
        f"{simulator_label} workspace process exited immediately with code {returncode}. "
        f"Workspace log: {log_path}"
    )
    log_tail = read_log_tail(log_path, tail_chars=log_tail_chars)
    if log_tail:
        detail = f"{detail}\n\n{log_tail}"
    return detail
