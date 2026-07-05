from __future__ import annotations

import base64
import binascii
import html
from pathlib import Path
from typing import Callable, Iterable

from backend.models.simulator_runtime import (
    SimulatorMeshAssetUpload,
    validate_simulator_relative_path,
)


def normalize_workspace_asset_path(value: str) -> str:
    return validate_simulator_relative_path(value, "asset path")


def resolve_workspace_asset_path(
    root: Path,
    relative_path: str,
    *,
    error: Callable[[str], Exception] = ValueError,
) -> Path:
    root_path = root.resolve()
    output_path = (root_path / normalize_workspace_asset_path(relative_path)).resolve()
    try:
        output_path.relative_to(root_path)
    except ValueError:
        raise error(f"Invalid asset path: {relative_path}") from None
    return output_path


def write_workspace_asset_file(
    root: Path,
    relative_path: str,
    content: bytes,
    *,
    error: Callable[[str], Exception],
) -> Path:
    output_path = resolve_workspace_asset_path(root, relative_path, error=error)
    if output_path.exists():
        if not output_path.is_file():
            raise error(f"Conflicting uploaded asset path: {relative_path}")
        existing = output_path.read_bytes()
        if existing != content:
            raise error(f"Conflicting uploaded asset path: {relative_path}")
        return output_path
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
    except FileExistsError:
        raise error(f"Conflicting uploaded asset path: {relative_path}") from None
    output_path.write_bytes(content)
    return output_path


def write_uploaded_workspace_assets(
    source_root: Path,
    assets: list[SimulatorMeshAssetUpload],
    *,
    error: Callable[[str], Exception],
) -> None:
    for asset in assets:
        content = decode_workspace_asset_upload(asset, error=error)
        for relative_path in unique_workspace_asset_paths((asset.path, *asset.aliases)):
            write_workspace_asset_file(source_root, relative_path, content, error=error)


def decode_workspace_asset_upload(
    asset: SimulatorMeshAssetUpload,
    *,
    error: Callable[[str], Exception],
) -> bytes:
    try:
        return base64.b64decode(asset.content_base64, validate=True)
    except binascii.Error:
        raise error(f"Invalid base64 mesh asset: {asset.path}")


def write_package_root_hints(
    source_root: Path,
    package_roots: dict[str, list[str]],
) -> None:
    for package_name, roots in package_roots.items():
        normalized_package_name = package_name.strip()
        if not normalized_package_name:
            continue
        for candidate in _package_root_hint_directories(source_root, roots):
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


def package_root_hint_paths(source_root: Path, package_roots: dict[str, list[str]]) -> list[Path]:
    paths: list[Path] = []
    seen: set[Path] = set()
    for roots in package_roots.values():
        for candidate in _package_root_hint_directories(source_root, roots):
            if candidate in seen:
                continue
            seen.add(candidate)
            paths.append(candidate)
    return paths


def _package_root_hint_directories(source_root: Path, roots: Iterable[str]) -> tuple[Path, ...]:
    return tuple(
        resolve_workspace_asset_path(source_root, root)
        for root in unique_workspace_asset_paths(roots)
    )


def unique_workspace_asset_paths(paths: Iterable[str]) -> tuple[str, ...]:
    unique: list[str] = []
    seen: set[str] = set()
    for path in paths:
        normalized = normalize_workspace_asset_path(path)
        if normalized in seen:
            continue
        seen.add(normalized)
        unique.append(normalized)
    return tuple(unique)
