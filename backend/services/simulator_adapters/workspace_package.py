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
from backend.services.ilu_session import IluSessionError, get_ilu_session_local_urdf_source_context
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
    normalize_and_require_world_snapshot_artifact_digests,
    world_scene_package_json_payload,
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


def _timestamped_workspace_dir(workspace_root: Path) -> Path:
    path = workspace_root / f"workspace-{time.time_ns()}"
    path.mkdir(parents=True, exist_ok=False)
    return path


def _raise(error: Callable[[str], Exception], message: str) -> None:
    raise error(message)


def normalize_simulator_workspace_package_request(
    request: SimulatorWorkspacePrepareRequest,
) -> SimulatorWorkspacePrepareRequest:
    normalized_world_package = normalize_and_require_world_snapshot_artifact_digests(
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
        world_scene_package_json_payload(request.world_package)
    )
    return count_transferable_world_objects(layout, include_hidden=False)


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

    world_package_path = workspace_dir / "world-package.json"
    world_package_path.write_text(
        f"{json.dumps(world_scene_package_json_payload(request.world_package), indent=2)}\n",
        encoding="utf-8",
    )

    requested_asset_path = request.urdf_asset_path or "robot.urdf"
    staged_urdf_relative_path = normalize_resolved_urdf_asset_path(requested_asset_path)
    staged_urdf_path = source_root / staged_urdf_relative_path
    robot_urdf_xml = normalize_root_relative_urdf_mesh_filenames(
        request.world_package.world_snapshot.urdf_xml
    )
    write_workspace_asset_file(
        source_root,
        staged_urdf_relative_path,
        robot_urdf_xml.encode("utf-8"),
        error=error,
    )

    source_urdf_path = staged_urdf_path
    extra_search_roots: list[Path] = [source_root, staged_urdf_path.parent]
    requested_asset_parent = (source_root / normalize_workspace_asset_path(requested_asset_path)).parent
    if requested_asset_parent != staged_urdf_path.parent:
        extra_search_roots.append(requested_asset_parent)
    if request.ilu_session_id:
        try:
            session_context = get_ilu_session_local_urdf_source_context(request.ilu_session_id)
        except IluSessionError:
            session_context = None
        if session_context is not None:
            source_urdf_path = session_context.source_urdf_path
            extra_search_roots.extend(session_context.extra_search_roots)

    extra_search_roots.extend(package_root_hint_paths(source_root, request.package_roots))

    bundled_urdf_path = workspace_dir / "robot" / "robot.urdf"
    workspace_asset_roots = compute_workspace_asset_roots(
        workspace_dir=workspace_dir,
        robot_urdf_path=bundled_urdf_path,
        uploaded_asset_sources=tuple(extra_search_roots),
    )
    write_workspace_asset_roots(workspace_dir, workspace_asset_roots)
    try:
        bundle_result = bundle_mesh_assets_for_urdf_file(
            urdf_path=str(source_urdf_path),
            urdf_xml=robot_urdf_xml,
            out_path=str(bundled_urdf_path),
            extra_search_roots=[str(path) for path in workspace_asset_roots],
        )
    except IluUrdfBridgeError as exc:
        _raise(error, exc.detail)

    if not bundle_result.success:
        _raise(error, bundle_result.error or "Simulator workspace could not bundle robot mesh assets.")
    if bundle_result.unresolved:
        unresolved = ", ".join(bundle_result.unresolved[:8])
        suffix = "" if len(bundle_result.unresolved) <= 8 else " ..."
        _raise(error, f"Simulator workspace could not resolve robot mesh assets: {unresolved}{suffix}")
    try:
        materialize_urdf_visual_material_colors(bundled_urdf_path)
    except ET.ParseError as exc:
        _raise(error, f"Simulator workspace could not parse robot URDF materials: {exc}")
    prepared_robot_urdf_xml = bundled_urdf_path.read_text(encoding="utf-8")

    return PreparedSimulatorWorkspace(
        workspace_dir=workspace_dir,
        world_package_path=world_package_path,
        robot_urdf_path=bundled_urdf_path,
        bundle_result=bundle_result,
        robot_urdf_xml=prepared_robot_urdf_xml,
        world_object_count=_transferable_world_object_count(request),
        camera_count=len(request.world_package.world_snapshot.cameras),
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
        if should_cancel is not None and should_cancel():
            _raise(error, f"{simulator_label} workspace launch was cancelled.")
        returncode = process.poll()
        if returncode is not None:
            _raise(
                error,
                _format_startup_failure(
                    simulator_label=simulator_label,
                    returncode=returncode,
                    log_path=log_path,
                    log_tail_chars=log_tail_chars,
                ),
            )
        if ready_log_marker in read_log_tail(log_path, tail_chars=log_tail_chars):
            time.sleep(post_ready_grace_sec)
            if should_cancel is not None and should_cancel():
                _raise(error, f"{simulator_label} workspace launch was cancelled.")
            returncode = process.poll()
            if returncode is not None:
                _raise(
                    error,
                    _format_startup_failure(
                        simulator_label=simulator_label,
                        returncode=returncode,
                        log_path=log_path,
                        log_tail_chars=log_tail_chars,
                    ),
                )
            return
        time.sleep(poll_sec)
    if should_cancel is not None and should_cancel():
        _raise(error, f"{simulator_label} workspace launch was cancelled.")
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
