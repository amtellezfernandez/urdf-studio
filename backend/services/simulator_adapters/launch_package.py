from __future__ import annotations

import base64
import binascii
import html
import json
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from backend.models.simulator_runtime import (
    SimulatorMeshAssetUpload,
    SimulatorWorldOpenRequest,
)
from backend.services.ilu_session import IluSessionError, get_ilu_session_local_urdf_source_context
from backend.services.ilu_urdf import BundleMeshAssetsResult, IluUrdfBridgeError, bundle_mesh_assets_for_urdf_file


@dataclass(frozen=True)
class PreparedSimulatorLaunch:
    launch_dir: Path
    world_package_path: Path
    robot_urdf_path: Path
    bundle_result: BundleMeshAssetsResult


def _timestamped_launch_dir(launch_root: Path) -> Path:
    path = launch_root / f"launch-{time.time_ns()}"
    path.mkdir(parents=True, exist_ok=False)
    return path


def _normalize_relative_path(value: str) -> str:
    return value.replace("\\", "/").strip().lstrip("/")


def _raise(error: Callable[[str], Exception], message: str) -> None:
    raise error(message)


def _write_asset_file(
    root: Path,
    relative_path: str,
    content: bytes,
    *,
    error: Callable[[str], Exception],
) -> Path:
    output_path = (root / _normalize_relative_path(relative_path)).resolve()
    try:
        output_path.relative_to(root.resolve())
    except ValueError:
        _raise(error, f"Invalid asset path: {relative_path}")
    if output_path.exists():
        existing = output_path.read_bytes()
        if existing != content:
            _raise(error, f"Conflicting uploaded asset path: {relative_path}")
        return output_path
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(content)
    return output_path


def _decode_asset(
    asset: SimulatorMeshAssetUpload,
    *,
    error: Callable[[str], Exception],
) -> bytes:
    try:
        return base64.b64decode(asset.content_base64, validate=True)
    except binascii.Error:
        _raise(error, f"Invalid base64 mesh asset: {asset.path}")


def _write_uploaded_assets(
    source_root: Path,
    assets: list[SimulatorMeshAssetUpload],
    *,
    error: Callable[[str], Exception],
) -> None:
    for asset in assets:
        content = _decode_asset(asset, error=error)
        written_paths = {asset.path, *asset.aliases}
        for relative_path in written_paths:
            _write_asset_file(source_root, relative_path, content, error=error)


def _write_package_root_hints(
    source_root: Path,
    package_roots: dict[str, list[str]],
) -> None:
    for package_name, roots in package_roots.items():
        normalized_package_name = package_name.strip()
        if not normalized_package_name:
            continue
        for root in roots:
            candidate = (source_root / _normalize_relative_path(root)).resolve()
            try:
                candidate.relative_to(source_root.resolve())
            except ValueError:
                continue
            candidate.mkdir(parents=True, exist_ok=True)
            package_xml = candidate / "package.xml"
            if package_xml.exists():
                continue
            package_xml.write_text(
                (
                    "<?xml version=\"1.0\"?>\n"
                    "<package format=\"3\">\n"
                    f"  <name>{html.escape(normalized_package_name)}</name>\n"
                    "  <version>0.0.0</version>\n"
                    "  <description>URDF Studio simulator launch package hint</description>\n"
                    "  <maintainer email=\"noreply@localhost\">URDF Studio</maintainer>\n"
                    "  <license>UNSPECIFIED</license>\n"
                    "</package>\n"
                ),
                encoding="utf-8",
            )


def _package_root_hint_paths(source_root: Path, package_roots: dict[str, list[str]]) -> list[Path]:
    paths: list[Path] = []
    for roots in package_roots.values():
        for root in roots:
            candidate = (source_root / _normalize_relative_path(root)).resolve()
            try:
                candidate.relative_to(source_root.resolve())
            except ValueError:
                continue
            paths.append(candidate)
    return paths


def prepare_simulator_launch_package(
    request: SimulatorWorldOpenRequest,
    *,
    launch_root: Path,
    error: Callable[[str], Exception],
) -> PreparedSimulatorLaunch:
    launch_dir = _timestamped_launch_dir(launch_root)
    source_root = launch_dir / "source"
    source_root.mkdir(parents=True, exist_ok=True)
    _write_uploaded_assets(source_root, request.mesh_assets, error=error)
    _write_package_root_hints(source_root, request.package_roots)

    world_package_path = launch_dir / "world-package.json"
    world_package_path.write_text(
        f"{json.dumps(request.world_package.model_dump(mode='json'), indent=2)}\n",
        encoding="utf-8",
    )

    staged_urdf_path = source_root / (request.urdf_asset_path or "robot.urdf")
    _write_asset_file(
        source_root,
        request.urdf_asset_path or "robot.urdf",
        request.world_package.world_snapshot.urdf_xml.encode("utf-8"),
        error=error,
    )

    source_urdf_path = staged_urdf_path
    extra_search_roots: list[Path] = [source_root, staged_urdf_path.parent]
    if request.ilu_session_id:
        try:
            session_context = get_ilu_session_local_urdf_source_context(request.ilu_session_id)
        except IluSessionError:
            session_context = None
        if session_context is not None:
            source_urdf_path = session_context.source_urdf_path
            extra_search_roots.extend(session_context.extra_search_roots)

    extra_search_roots.extend(_package_root_hint_paths(source_root, request.package_roots))

    bundled_urdf_path = launch_dir / "robot" / "robot.urdf"
    try:
        bundle_result = bundle_mesh_assets_for_urdf_file(
            urdf_path=str(source_urdf_path),
            urdf_xml=request.world_package.world_snapshot.urdf_xml,
            out_path=str(bundled_urdf_path),
            extra_search_roots=[
                str(path)
                for path in dict.fromkeys(path.resolve() for path in extra_search_roots)
                if path.exists()
            ],
        )
    except IluUrdfBridgeError as exc:
        _raise(error, exc.detail)

    if not bundle_result.success:
        _raise(error, bundle_result.error or "Simulator launch could not bundle robot mesh assets.")
    if bundle_result.unresolved:
        unresolved = ", ".join(bundle_result.unresolved[:8])
        suffix = "" if len(bundle_result.unresolved) <= 8 else " ..."
        _raise(error, f"Simulator launch could not resolve robot mesh assets: {unresolved}{suffix}")

    return PreparedSimulatorLaunch(
        launch_dir=launch_dir,
        world_package_path=world_package_path,
        robot_urdf_path=bundled_urdf_path,
        bundle_result=bundle_result,
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


def wait_for_launch_readiness(
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
) -> None:
    deadline = time.monotonic() + ready_timeout_sec
    while time.monotonic() < deadline:
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
    _raise(
        error,
        f"{simulator_label} launch did not become ready within {ready_timeout_sec:.0f}s. "
        f"Launch log: {log_path}",
    )


def _format_startup_failure(
    *,
    simulator_label: str,
    returncode: int,
    log_path: Path,
    log_tail_chars: int,
) -> str:
    detail = (
        f"{simulator_label} launch exited immediately with code {returncode}. "
        f"Launch log: {log_path}"
    )
    log_tail = read_log_tail(log_path, tail_chars=log_tail_chars)
    if log_tail:
        detail = f"{detail}\n\n{log_tail}"
    return detail
