from __future__ import annotations

import json
import mimetypes
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from backend.models.ilu_assembly import (
    IluAssemblyManifestFile,
    IluAssemblyManifestResponse,
    IluAssemblySource,
)
from backend.models.json_payload import JsonObject


ILU_ASSEMBLY_ROOT = Path.home() / ".i-love-urdf" / "assembly-sessions"
ILU_ASSEMBLY_METADATA = "assembly-session.json"
ILU_ASSEMBLY_SCHEMA = "ilu-assembly-session"
ILU_ASSEMBLY_SCHEMA_VERSION = 1
ASSEMBLY_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
MEDIA_TYPE_BY_EXTENSION = {
    ".bin": "application/octet-stream",
    ".dae": "model/vnd.collada+xml",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".ktx2": "image/ktx2",
    ".mtl": "text/plain",
    ".obj": "text/plain",
    ".png": "image/png",
    ".stl": "model/stl",
    ".urdf": "application/xml",
    ".webp": "image/webp",
    ".xacro": "application/xml",
    ".xml": "application/xml",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
}


@dataclass(frozen=True)
class IluAssemblyError(RuntimeError):
    status_code: int
    detail: str


@dataclass(frozen=True)
class IluAssemblyAssetFile:
    file_path: Path
    media_type: str


def _validate_assembly_id(assembly_id: str) -> str:
    normalized = assembly_id.strip()
    if not normalized or not ASSEMBLY_ID_PATTERN.match(normalized):
        raise IluAssemblyError(status_code=400, detail="Invalid ilu assembly id.")
    return normalized


def _get_assembly_dir(assembly_id: str) -> Path:
    return ILU_ASSEMBLY_ROOT / _validate_assembly_id(assembly_id)


def _get_assembly_metadata_path(assembly_id: str) -> Path:
    return _get_assembly_dir(assembly_id) / ILU_ASSEMBLY_METADATA


def _normalize_asset_path(raw_path: str) -> str:
    candidate = raw_path.replace("\\", "/").strip()
    candidate = re.sub(r"/+", "/", candidate).lstrip("/")
    if not candidate:
        raise IluAssemblyError(status_code=400, detail="Invalid ilu assembly asset path.")
    parts = []
    for part in candidate.split("/"):
        if not part or part == ".":
            continue
        if part == "..":
            raise IluAssemblyError(status_code=400, detail="Invalid ilu assembly asset path.")
        parts.append(part)
    if not parts:
        raise IluAssemblyError(status_code=400, detail="Invalid ilu assembly asset path.")
    return "/".join(parts)


def _guess_media_type(file_path: Path) -> str:
    extension = file_path.suffix.lower()
    media_type = MEDIA_TYPE_BY_EXTENSION.get(extension)
    if media_type:
        return media_type
    guessed = mimetypes.guess_type(file_path.name)[0]
    return guessed or "application/octet-stream"


def _read_json_object(path: Path) -> JsonObject:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Expected JSON object")
    return payload


def _read_assembly_payload(assembly_id: str) -> JsonObject:
    metadata_path = _get_assembly_metadata_path(assembly_id)
    if not metadata_path.exists():
        raise IluAssemblyError(status_code=404, detail=f"ilu assembly not found: {assembly_id}")
    try:
        payload = _read_json_object(metadata_path)
    except (json.JSONDecodeError, OSError, UnicodeDecodeError, ValueError) as exc:
        raise IluAssemblyError(status_code=500, detail="Failed to read ilu assembly metadata.") from exc

    if (
        payload.get("schema") != ILU_ASSEMBLY_SCHEMA
        or payload.get("schemaVersion") != ILU_ASSEMBLY_SCHEMA_VERSION
    ):
        raise IluAssemblyError(status_code=500, detail="ilu assembly metadata is incomplete.")
    return payload


def _normalized_selected_paths(payload: JsonObject) -> list[str]:
    selected_paths = payload.get("selectedPaths")
    if not isinstance(selected_paths, list) or not selected_paths:
        raise IluAssemblyError(status_code=500, detail="ilu assembly selected paths are missing.")

    normalized = [
        item.strip()
        for item in selected_paths
        if isinstance(item, str) and item.strip()
    ]
    if not normalized:
        raise IluAssemblyError(status_code=500, detail="ilu assembly selected paths are missing.")
    return normalized


def get_ilu_assembly_manifest(assembly_id: str) -> IluAssemblyManifestResponse:
    payload = _read_assembly_payload(assembly_id)
    normalized_assembly_id = _validate_assembly_id(assembly_id)
    workspace_root_raw = payload.get("workspaceRoot")
    if not isinstance(workspace_root_raw, str) or not workspace_root_raw.strip():
        raise IluAssemblyError(status_code=500, detail="ilu assembly metadata is incomplete.")

    workspace_root = Path(workspace_root_raw).expanduser().resolve()
    if not workspace_root.exists() or not workspace_root.is_dir():
        raise IluAssemblyError(status_code=404, detail="ilu assembly workspace is missing.")

    files: list[IluAssemblyManifestFile] = []
    for file_path in sorted(workspace_root.rglob("*")):
        if not file_path.is_file():
            continue
        relative_path = file_path.relative_to(workspace_root).as_posix()
        files.append(
            IluAssemblyManifestFile(
                path=relative_path,
                url=(
                    f"/ilu-assembly/{normalized_assembly_id}/asset"
                    f"?path={quote(relative_path, safe='')}"
                ),
                mime=_guess_media_type(file_path),
            )
        )

    if not files:
        raise IluAssemblyError(status_code=404, detail="ilu assembly workspace is empty.")

    source_by_path_raw = payload.get("sourceByPath")
    source_by_path: dict[str, IluAssemblySource] = {}
    if isinstance(source_by_path_raw, dict):
        for key, value in source_by_path_raw.items():
            if not isinstance(key, str):
                continue
            if not isinstance(value, dict):
                continue
            source_by_path[key] = IluAssemblySource.model_validate(value)

    selected_paths = _normalized_selected_paths(payload)
    names_by_path = payload.get("namesByPath")
    if not isinstance(names_by_path, dict):
        names_by_path = {}

    return IluAssemblyManifestResponse(
        label=str(payload.get("label") or f"Attached ilu assembly {normalized_assembly_id}"),
        files=files,
        selected_paths=selected_paths,
        names_by_path={
            str(key): str(value)
            for key, value in names_by_path.items()
            if isinstance(key, str) and isinstance(value, str)
        },
        source_by_path=source_by_path,
    )


def resolve_ilu_assembly_asset_file(assembly_id: str, asset_path: str) -> IluAssemblyAssetFile:
    payload = _read_assembly_payload(assembly_id)
    workspace_root_raw = payload.get("workspaceRoot")
    if not isinstance(workspace_root_raw, str) or not workspace_root_raw.strip():
        raise IluAssemblyError(status_code=500, detail="ilu assembly metadata is incomplete.")

    workspace_root = Path(workspace_root_raw).expanduser().resolve()
    if not workspace_root.exists() or not workspace_root.is_dir():
        raise IluAssemblyError(status_code=404, detail="ilu assembly workspace is missing.")

    normalized_asset_path = _normalize_asset_path(asset_path)
    candidate = (workspace_root / normalized_asset_path).resolve()
    try:
        candidate.relative_to(workspace_root)
    except ValueError as exc:
        raise IluAssemblyError(status_code=404, detail="ilu assembly asset not found.") from exc

    if not candidate.exists() or not candidate.is_file():
        raise IluAssemblyError(status_code=404, detail="ilu assembly asset not found.")

    return IluAssemblyAssetFile(file_path=candidate, media_type=_guess_media_type(candidate))
