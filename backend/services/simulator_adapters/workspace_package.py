from __future__ import annotations

import base64
import binascii
import hashlib
import html
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from backend.models.simulator_runtime import (
    SimulatorMeshAssetUpload,
    SimulatorWorkspacePrepareRequest,
    validate_simulator_relative_path,
)
from backend.services.ilu_session import IluSessionError, get_ilu_session_local_urdf_source_context
from backend.services.ilu_urdf import (
    BundleMeshAssetsResult,
    IluUrdfBridgeError,
    bundle_mesh_assets_for_urdf_file,
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
    world_object_count: int = 0
    camera_count: int = 0

URDF_VISUAL_SYNTHETIC_COLOR_PALETTE = (
    "0.74 0.76 0.72 1.0",
    "0.42 0.46 0.50 1.0",
    "0.20 0.53 0.43 1.0",
    "0.93 0.70 0.22 1.0",
    "0.13 0.34 0.50 1.0",
)

URDF_VISUAL_SEMANTIC_SYNTHETIC_COLORS = (
    (("wheel", "tire", "tyre"), "0.04 0.045 0.05 1.0"),
    (("camera", "lens", "sensor"), "0.06 0.15 0.24 1.0"),
    (("battery", "lipo", "power"), "0.08 0.09 0.10 1.0"),
    (("motor", "servo", "actuator"), "0.45 0.48 0.52 1.0"),
    (("frame", "plate", "base", "mount", "bracket", "body", "chassis"), "0.66 0.69 0.64 1.0"),
)


def _timestamped_workspace_dir(workspace_root: Path) -> Path:
    path = workspace_root / f"workspace-{time.time_ns()}"
    path.mkdir(parents=True, exist_ok=False)
    return path


def _normalize_relative_path(value: str) -> str:
    return validate_simulator_relative_path(value, "asset path")


def _normalize_resolved_urdf_asset_path(value: str | None) -> str:
    normalized = _normalize_relative_path(value or "robot.urdf")
    lowered = normalized.lower()
    if lowered.endswith(".urdf.xacro"):
        return f"{normalized[:-len('.urdf.xacro')]}.urdf"
    if lowered.endswith(".xacro"):
        return f"{normalized[:-len('.xacro')]}.urdf"
    return normalized


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
                    "  <description>URDF Studio simulator workspace package hint</description>\n"
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


def _prepare_urdf_visual_material_colors(urdf_path: Path) -> int:
    tree = ET.parse(urdf_path)
    root = tree.getroot()
    material_colors = {
        material.get("name"): color.get("rgba", "").strip()
        for material in root.findall("material")
        if material.get("name")
        for color in [material.find("color")]
        if color is not None and color.get("rgba", "").strip()
    }
    changed_count = 0
    for link in root.findall("link"):
        link_name = link.get("name", "")
        for visual_index, visual in enumerate(link.findall("visual")):
            material = visual.find("material")
            if _urdf_material_has_color(material):
                continue
            if material is None:
                material = ET.SubElement(
                    visual,
                    "material",
                    {"name": _synthetic_urdf_material_name(link_name, visual_index)},
                )
            material_name = material.get("name", "").strip()
            named_rgba = material_colors.get(material_name)
            ET.SubElement(
                material,
                "color",
                {"rgba": named_rgba or _synthetic_urdf_visual_rgba(link_name, visual, visual_index)},
            )
            changed_count += 1

    if changed_count:
        ET.indent(root, space="  ")
        tree.write(urdf_path, encoding="unicode", xml_declaration=False)
    return changed_count


def _urdf_material_has_color(material: ET.Element | None) -> bool:
    if material is None:
        return False
    color = material.find("color")
    return color is not None and bool(color.get("rgba", "").strip())


def _synthetic_urdf_material_name(link_name: str, visual_index: int) -> str:
    safe_link_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", link_name.strip()).strip("_")
    return f"urdf_studio_{safe_link_name or 'visual'}_{visual_index}"


def _synthetic_urdf_visual_rgba(link_name: str, visual: ET.Element, visual_index: int) -> str:
    fingerprint = _urdf_visual_fingerprint(link_name, visual, visual_index)
    fingerprint_lower = fingerprint.lower()
    for terms, rgba in URDF_VISUAL_SEMANTIC_SYNTHETIC_COLORS:
        if any(term in fingerprint_lower for term in terms):
            return rgba
    digest = hashlib.sha256(fingerprint_lower.encode("utf-8")).digest()
    return URDF_VISUAL_SYNTHETIC_COLOR_PALETTE[digest[0] % len(URDF_VISUAL_SYNTHETIC_COLOR_PALETTE)]


def _transferable_world_object_count(request: SimulatorWorkspacePrepareRequest) -> int:
    layout = parse_static_world_layout_payload(
        world_scene_package_json_payload(request.world_package)
    )
    return count_transferable_world_objects(layout, include_hidden=False)


def _urdf_visual_fingerprint(link_name: str, visual: ET.Element, visual_index: int) -> str:
    parts = [link_name, visual.get("name", ""), str(visual_index)]
    mesh = visual.find("./geometry/mesh")
    if mesh is not None:
        parts.append(mesh.get("filename", ""))
    return " ".join(part for part in parts if part)


def prepare_simulator_workspace_package(
    request: SimulatorWorkspacePrepareRequest,
    *,
    workspace_root: Path,
    error: Callable[[str], Exception],
) -> PreparedSimulatorWorkspace:
    request = normalize_simulator_workspace_package_request(request)
    workspace_dir = _timestamped_workspace_dir(workspace_root)
    source_root = workspace_dir / "source"
    source_root.mkdir(parents=True, exist_ok=True)
    _write_uploaded_assets(source_root, request.mesh_assets, error=error)
    _write_package_root_hints(source_root, request.package_roots)

    world_package_path = workspace_dir / "world-package.json"
    world_package_path.write_text(
        f"{json.dumps(world_scene_package_json_payload(request.world_package), indent=2)}\n",
        encoding="utf-8",
    )

    requested_asset_path = request.urdf_asset_path or "robot.urdf"
    staged_urdf_relative_path = _normalize_resolved_urdf_asset_path(requested_asset_path)
    staged_urdf_path = source_root / staged_urdf_relative_path
    _write_asset_file(
        source_root,
        staged_urdf_relative_path,
        request.world_package.world_snapshot.urdf_xml.encode("utf-8"),
        error=error,
    )

    source_urdf_path = staged_urdf_path
    extra_search_roots: list[Path] = [source_root, staged_urdf_path.parent]
    requested_asset_parent = (source_root / _normalize_relative_path(requested_asset_path)).parent
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

    extra_search_roots.extend(_package_root_hint_paths(source_root, request.package_roots))

    bundled_urdf_path = workspace_dir / "robot" / "robot.urdf"
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
        _raise(error, bundle_result.error or "Simulator workspace could not bundle robot mesh assets.")
    if bundle_result.unresolved:
        unresolved = ", ".join(bundle_result.unresolved[:8])
        suffix = "" if len(bundle_result.unresolved) <= 8 else " ..."
        _raise(error, f"Simulator workspace could not resolve robot mesh assets: {unresolved}{suffix}")
    try:
        _prepare_urdf_visual_material_colors(bundled_urdf_path)
    except ET.ParseError as exc:
        _raise(error, f"Simulator workspace could not parse robot URDF materials: {exc}")

    return PreparedSimulatorWorkspace(
        workspace_dir=workspace_dir,
        world_package_path=world_package_path,
        robot_urdf_path=bundled_urdf_path,
        bundle_result=bundle_result,
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
