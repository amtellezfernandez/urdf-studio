from __future__ import annotations

import json
import mimetypes
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TypeAlias, cast
from urllib.parse import quote, urlparse

from pydantic import ValidationError

from backend.models.json_payload import JsonObject
from backend.models.ilu_session import (
    IluSessionAssetManifestFile,
    IluSessionAssetManifestResponse,
    IluSessionLoadedSource,
    IluSessionSaveResponse,
    IluSessionSnapshotResponse,
)
from backend.services.ilu_repo_source import GitHubPublicProxyError, list_repo_contents


ILU_SESSION_ROOT = Path.home() / ".i-love-urdf" / "sessions"
ILU_SESSION_METADATA = "session.json"
ILU_SESSION_SCHEMA = "ilu-shared-session"
ILU_SESSION_SCHEMA_VERSION = 1
SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
WORKING_ASSET_KIND = "working"
SOURCE_ASSET_KIND = "source"
WORKING_URDF_MEDIA_TYPE = "application/xml"
LOCAL_SESSION_RESOURCE_EXTENSIONS = {
    ".bin",
    ".dae",
    ".glb",
    ".gltf",
    ".jpeg",
    ".jpg",
    ".ktx2",
    ".mtl",
    ".obj",
    ".png",
    ".stl",
    ".webp",
}
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
    ".webp": "image/webp",
}

IluSessionMetadataPayload: TypeAlias = JsonObject


@dataclass(frozen=True)
class IluSessionError(RuntimeError):
    status_code: int
    detail: str


@dataclass(frozen=True)
class IluSessionAssetFile:
    file_path: Path
    media_type: str


@dataclass(frozen=True)
class IluSessionLocalAssetContext:
    root_dir: Path
    working_asset_path: str


@dataclass(frozen=True)
class IluSessionLocalUrdfSourceContext:
    source_urdf_path: Path
    source_root_dir: Path
    working_urdf_path: Path
    extra_search_roots: tuple[Path, ...]


@dataclass(frozen=True)
class IluSessionGitHubSourceContext:
    owner: str
    repo: str
    revision: str | None
    repository_urdf_path: str


def _validate_session_id(session_id: str) -> str:
    normalized = session_id.strip()
    if not normalized or not SESSION_ID_PATTERN.match(normalized):
        raise IluSessionError(status_code=400, detail="Invalid ilu session id.")
    return normalized


def _get_session_dir(session_id: str) -> Path:
    normalized = _validate_session_id(session_id)
    return ILU_SESSION_ROOT / normalized


def _get_session_metadata_path(session_id: str) -> Path:
    return _get_session_dir(session_id) / ILU_SESSION_METADATA


def _read_session_payload(session_id: str) -> IluSessionMetadataPayload:
    metadata_path = _get_session_metadata_path(session_id)
    if not metadata_path.exists():
        raise IluSessionError(status_code=404, detail=f"ilu session not found: {session_id}")
    try:
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise IluSessionError(status_code=500, detail="Failed to read ilu session metadata.") from exc
    if not isinstance(payload, dict):
        raise IluSessionError(status_code=500, detail="ilu session metadata is incomplete.")
    return cast(IluSessionMetadataPayload, payload)


def _metadata_string(
    payload: IluSessionMetadataPayload,
    field_name: str,
    default_value: str = "",
) -> str:
    value = payload.get(field_name)
    return value if isinstance(value, str) else default_value


def _required_metadata_string(
    payload: IluSessionMetadataPayload,
    field_name: str,
) -> str:
    value = _metadata_string(payload, field_name)
    if not value:
        raise IluSessionError(status_code=500, detail="ilu session metadata is incomplete.")
    return value


def _is_supported_schema_version(payload: IluSessionMetadataPayload) -> bool:
    version = payload.get("schemaVersion")
    return (
        isinstance(version, int)
        and not isinstance(version, bool)
        and version == ILU_SESSION_SCHEMA_VERSION
    )


def _coerce_loaded_source(raw: object) -> IluSessionLoadedSource | None:
    try:
        return IluSessionLoadedSource.model_validate(raw)
    except ValidationError:
        return None


def _normalize_working_asset_path(value: str | None, default_asset_path: str) -> str:
    candidate = (value or default_asset_path or "").replace("\\", "/").strip()
    candidate = re.sub(r"/+", "/", candidate).lstrip("/")
    if not candidate:
        candidate = default_asset_path or "robot.urdf"
    candidate = re.sub(r"\.(urdf\.xacro|xacro)$", ".urdf", candidate, flags=re.IGNORECASE)
    return candidate


def _normalize_session_asset_path(raw_path: str) -> str:
    candidate = raw_path.replace("\\", "/").strip()
    candidate = re.sub(r"/+", "/", candidate).lstrip("/")
    if not candidate:
        raise IluSessionError(status_code=400, detail="Invalid ilu session asset path.")
    parts = []
    for part in candidate.split("/"):
        if not part or part == ".":
            continue
        if part == "..":
            raise IluSessionError(status_code=400, detail="Invalid ilu session asset path.")
        parts.append(part)
    if not parts:
        raise IluSessionError(status_code=400, detail="Invalid ilu session asset path.")
    return "/".join(parts)


def _is_local_session_asset_file(file_path: Path) -> bool:
    if file_path.name.lower() == "package.xml":
        return True
    return file_path.suffix.lower() in LOCAL_SESSION_RESOURCE_EXTENSIONS


def _guess_media_type(file_path: Path) -> str:
    extension = file_path.suffix.lower()
    media_type = MEDIA_TYPE_BY_EXTENSION.get(extension)
    if media_type:
        return media_type
    guessed = mimetypes.guess_type(file_path.name)[0]
    return guessed or "application/octet-stream"


def _resolve_local_asset_context(
    loaded_source: IluSessionLoadedSource | None,
    working_urdf_path: Path,
) -> IluSessionLocalAssetContext | None:
    if loaded_source is None or loaded_source.source == "github":
        return None

    if loaded_source.source == "local-repo":
        if not loaded_source.local_path:
            raise IluSessionError(status_code=404, detail="ilu session local repository is unavailable.")
        root_dir = Path(loaded_source.local_path).expanduser()
        working_asset_path = _normalize_working_asset_path(
            loaded_source.repository_urdf_path,
            working_urdf_path.name,
        )
    else:
        raw_local_path = loaded_source.local_path or loaded_source.urdf_path
        if not raw_local_path:
            raise IluSessionError(status_code=404, detail="ilu session local source is unavailable.")
        local_path = Path(raw_local_path).expanduser()
        root_dir = local_path if local_path.is_dir() else local_path.parent
        working_asset_path = _normalize_working_asset_path(local_path.name, working_urdf_path.name)

    if not root_dir.exists() or not root_dir.is_dir():
        raise IluSessionError(
            status_code=404,
            detail=f"ilu session local asset root is missing: {root_dir}",
        )

    return IluSessionLocalAssetContext(
        root_dir=root_dir.resolve(),
        working_asset_path=working_asset_path,
    )


def _read_asset_source_context(
    session_id: str,
) -> tuple[str, Path, IluSessionLocalAssetContext]:
    payload = _read_session_payload(session_id)
    working_urdf_path = _required_metadata_string(payload, "workingUrdfPath")
    working_file = Path(working_urdf_path).expanduser()
    local_context = _resolve_local_asset_context(
        _coerce_loaded_source(payload.get("loadedSource")),
        working_file,
    )
    if local_context is None:
        raise IluSessionError(status_code=404, detail="ilu session has no local asset source.")
    return _validate_session_id(session_id), working_file, local_context


def _resolve_github_source_context(
    loaded_source: IluSessionLoadedSource | None,
) -> IluSessionGitHubSourceContext | None:
    if loaded_source is None or loaded_source.source != "github":
        return None

    github_ref = (loaded_source.github_ref or "").strip()
    repository_urdf_path = (loaded_source.repository_urdf_path or "").strip()
    if not github_ref or not repository_urdf_path:
        raise IluSessionError(status_code=404, detail="ilu session GitHub source is unavailable.")

    parsed = urlparse(github_ref)
    segments = [segment for segment in parsed.path.split("/") if segment]
    if len(segments) < 2:
        raise IluSessionError(status_code=500, detail="ilu session GitHub source is invalid.")

    owner = segments[0]
    repo = segments[1]
    if repo.endswith(".git"):
        repo = repo[:-4]
    if not owner or not repo:
        raise IluSessionError(status_code=500, detail="ilu session GitHub source is invalid.")

    revision = (loaded_source.github_revision or "").strip() or None
    return IluSessionGitHubSourceContext(
        owner=owner,
        repo=repo,
        revision=revision,
        repository_urdf_path=repository_urdf_path,
    )


def _iter_local_session_assets(
    root_dir: Path,
) -> list[tuple[str, Path]]:
    assets: list[tuple[str, Path]] = []
    for file_path in sorted(root_dir.rglob("*")):
        if not file_path.is_file() or not _is_local_session_asset_file(file_path):
            continue
        relative_path = file_path.relative_to(root_dir).as_posix()
        assets.append((relative_path, file_path))
    return assets


def _read_working_urdf(working_urdf_path: Path) -> str:
    if not working_urdf_path.exists():
        raise IluSessionError(
            status_code=404,
            detail=f"ilu working URDF is missing: {working_urdf_path}",
        )
    try:
        return working_urdf_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise IluSessionError(status_code=500, detail="Failed to read ilu working URDF.") from exc


def get_ilu_session_snapshot(session_id: str) -> IluSessionSnapshotResponse:
    payload = _read_session_payload(session_id)

    if (
        _metadata_string(payload, "schema") != ILU_SESSION_SCHEMA
        or not _is_supported_schema_version(payload)
    ):
        raise IluSessionError(status_code=500, detail="ilu session metadata is incomplete.")
    working_urdf_path = _required_metadata_string(payload, "workingUrdfPath")
    last_urdf_path = _required_metadata_string(payload, "lastUrdfPath")

    loaded_source = _coerce_loaded_source(payload.get("loadedSource"))
    urdf_xml = _read_working_urdf(Path(working_urdf_path))

    return IluSessionSnapshotResponse(
        session_schema=ILU_SESSION_SCHEMA,
        schema_version=ILU_SESSION_SCHEMA_VERSION,
        session_id=_metadata_string(payload, "sessionId", session_id),
        created_at=_metadata_string(payload, "createdAt"),
        updated_at=_metadata_string(payload, "updatedAt"),
        working_urdf_path=working_urdf_path,
        last_urdf_path=last_urdf_path,
        urdf_xml=urdf_xml,
        loaded_source=loaded_source,
    )


def get_ilu_session_asset_manifest(session_id: str) -> IluSessionAssetManifestResponse:
    payload = _read_session_payload(session_id)
    normalized_session_id = _validate_session_id(session_id)
    working_urdf_path = _required_metadata_string(payload, "workingUrdfPath")

    working_file = Path(working_urdf_path).expanduser()
    loaded_source = _coerce_loaded_source(payload.get("loadedSource"))
    github_context = _resolve_github_source_context(loaded_source)
    if github_context is not None:
        working_asset_path = _normalize_working_asset_path(
            github_context.repository_urdf_path,
            working_file.name,
        )
        files = [
            IluSessionAssetManifestFile(
                path=working_asset_path,
                url=(
                    f"/ilu-session/{normalized_session_id}/asset"
                    f"?kind={WORKING_ASSET_KIND}&path={quote(working_asset_path, safe='')}"
                ),
                mime=WORKING_URDF_MEDIA_TYPE,
            )
        ]
        seen_paths = {working_asset_path.casefold()}
        try:
            repo_files = list_repo_contents(
                owner=github_context.owner,
                repo=github_context.repo,
                path="",
                branch=github_context.revision,
            )
        except GitHubPublicProxyError as exc:
            raise IluSessionError(status_code=exc.status_code, detail=exc.detail) from exc
        for entry in repo_files:
            if entry.get("type") != "file":
                continue
            raw_path = entry.get("path")
            download_url = entry.get("download_url")
            if not isinstance(raw_path, str) or not raw_path:
                continue
            normalized_path = _normalize_session_asset_path(raw_path)
            if normalized_path.casefold() in seen_paths:
                continue
            if not isinstance(download_url, str) or not download_url:
                continue
            seen_paths.add(normalized_path.casefold())
            files.append(
                IluSessionAssetManifestFile(
                    path=normalized_path,
                    url=download_url,
                    mime=_guess_media_type(Path(normalized_path)),
                )
            )
        return IluSessionAssetManifestResponse(
            label=f"Attached ilu session {normalized_session_id}",
            files=files,
        )

    normalized_session_id, _, local_context = _read_asset_source_context(session_id)

    files = [
        IluSessionAssetManifestFile(
            path=local_context.working_asset_path,
            url=(
                f"/ilu-session/{normalized_session_id}/asset"
                f"?kind={WORKING_ASSET_KIND}&path={quote(local_context.working_asset_path, safe='')}"
            ),
            mime=WORKING_URDF_MEDIA_TYPE,
        )
    ]

    seen_paths = {local_context.working_asset_path.casefold()}
    for relative_path, file_path in _iter_local_session_assets(local_context.root_dir):
        normalized_relative_path = _normalize_session_asset_path(relative_path)
        if normalized_relative_path.casefold() in seen_paths:
            continue
        seen_paths.add(normalized_relative_path.casefold())
        files.append(
            IluSessionAssetManifestFile(
                path=normalized_relative_path,
                url=(
                    f"/ilu-session/{normalized_session_id}/asset"
                    f"?kind={SOURCE_ASSET_KIND}&path={quote(normalized_relative_path, safe='')}"
                ),
                mime=_guess_media_type(file_path),
            )
        )

    return IluSessionAssetManifestResponse(
        label=f"Attached ilu session {normalized_session_id}",
        files=files,
    )


def resolve_ilu_session_asset_file(session_id: str, asset_path: str, kind: str) -> IluSessionAssetFile:
    _, working_file, local_context = _read_asset_source_context(session_id)

    normalized_kind = kind.strip().lower()
    normalized_asset_path = _normalize_session_asset_path(asset_path)
    if normalized_kind == WORKING_ASSET_KIND:
        expected_path = local_context.working_asset_path.casefold()
        if normalized_asset_path.casefold() != expected_path:
            raise IluSessionError(status_code=404, detail="ilu session asset not found.")
        return IluSessionAssetFile(file_path=working_file, media_type=WORKING_URDF_MEDIA_TYPE)

    if normalized_kind != SOURCE_ASSET_KIND:
        raise IluSessionError(status_code=400, detail="Invalid ilu session asset kind.")

    candidate = (local_context.root_dir / normalized_asset_path).resolve()
    try:
        candidate.relative_to(local_context.root_dir)
    except ValueError as exc:
        raise IluSessionError(status_code=404, detail="ilu session asset not found.") from exc

    if not candidate.exists() or not candidate.is_file() or not _is_local_session_asset_file(candidate):
        raise IluSessionError(status_code=404, detail="ilu session asset not found.")

    return IluSessionAssetFile(file_path=candidate, media_type=_guess_media_type(candidate))


def get_ilu_session_local_urdf_source_context(
    session_id: str,
) -> IluSessionLocalUrdfSourceContext:
    _, working_file, local_context = _read_asset_source_context(session_id)
    source_urdf_path = (local_context.root_dir / local_context.working_asset_path).resolve()
    if not source_urdf_path.exists() or not source_urdf_path.is_file():
        source_urdf_path = working_file.resolve()
    extra_search_roots = tuple(
        dict.fromkeys(
            path.resolve()
            for path in (
                local_context.root_dir,
                source_urdf_path.parent,
                working_file.expanduser().parent,
            )
            if path.exists() and path.is_dir()
        )
    )
    return IluSessionLocalUrdfSourceContext(
        source_urdf_path=source_urdf_path,
        source_root_dir=local_context.root_dir,
        working_urdf_path=working_file.resolve(),
        extra_search_roots=extra_search_roots,
    )


def save_ilu_session_urdf(session_id: str, urdf_xml: str) -> IluSessionSaveResponse:
    normalized_session_id = _validate_session_id(session_id)
    metadata_path = _get_session_metadata_path(normalized_session_id)
    payload = _read_session_payload(normalized_session_id)

    working_urdf_path = _required_metadata_string(payload, "workingUrdfPath")

    working_file = Path(working_urdf_path)
    try:
        working_file.parent.mkdir(parents=True, exist_ok=True)
        working_file.write_text(urdf_xml, encoding="utf-8")
    except OSError as exc:
        raise IluSessionError(status_code=500, detail="Failed to write ilu working URDF.") from exc

    updated_at = datetime.now(timezone.utc).isoformat()
    payload["updatedAt"] = updated_at
    payload["lastUrdfPath"] = working_urdf_path
    loaded_source_payload = payload.get("loadedSource")
    if isinstance(loaded_source_payload, dict):
        loaded_source_payload["urdfPath"] = working_urdf_path

    try:
        metadata_path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")
    except OSError as exc:
        raise IluSessionError(status_code=500, detail="Failed to update ilu session metadata.") from exc

    return IluSessionSaveResponse(
        session_id=normalized_session_id,
        updated_at=updated_at,
        working_urdf_path=working_urdf_path,
    )
