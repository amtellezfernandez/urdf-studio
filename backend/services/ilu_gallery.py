from __future__ import annotations

import base64
import json
import mimetypes
import os
import socket
import subprocess
import threading
import time
import uuid
import zipfile
from collections.abc import Callable
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
import urllib.request
from urllib.request import urlopen

from pydantic import ValidationError

from backend.models.ilu_gallery import (
    IluGalleryEntry,
    IluGalleryJobCreateRequest,
    IluGalleryJobGenerateRequest,
    IluGalleryJobMetadataUpdateRequest,
    IluGalleryJobProgress,
    IluGalleryPublishResponse,
    IluGalleryPrDraftFile,
    IluGalleryJobResponse,
    IluGalleryPrDraftResponse,
    IluGalleryPublishedRepo,
    IluGalleryPublishedRobot,
    IluGalleryRepoPreviewResponse,
    IluGalleryRepoMetadata,
    IluGalleryRobotTraits,
    IluGallerySource,
)
from backend.models.xacro import GitHubXacroExpandRequest
from backend.services.github_auth import resolve_server_github_token
from backend.services.ilu_gallery_params import (
    GALLERY_INSPECT_CACHE_RETENTION_LIMIT,
    GALLERY_INSPECT_CACHE_TTL_SECONDS,
    GALLERY_JOB_RETENTION_LIMIT,
    GALLERY_JOB_ROOT,
    GALLERY_MANIFEST_CACHE_TTL_SECONDS,
    GALLERY_MANIFEST_TIMEOUT_SECONDS,
    GALLERY_RENDER_ASSET_BATCH_SIZE,
    GALLERY_RENDER_BATCH_SIZE,
    GALLERY_GENERATE_MAX_CONCURRENCY,
    GALLERY_RESOLVE_ROBOT_TRAITS_DURING_INSPECTION,
    ILU_GALLERY_GENERATE_TIMEOUT_SECONDS,
    ILU_GALLERY_TIMEOUT_SECONDS,
)
from backend.services.ilu_repo_source import (
    GitHubPublicProxyError,
    _load_public_archive_snapshot,
    fetch_file_bytes,
    list_repo_candidates,
)
from backend.services.ilu_urdf import (
    IluUrdfBridgeError,
    analyze_robot_morphology,
    expand_github_xacro,
)


NODE_BIN = os.getenv("URDF_NODE_BIN", "node").strip() or "node"
REPO_ROOT = Path(__file__).resolve().parents[2]
ILU_UPSTREAM_DIST_CLI_PATH = REPO_ROOT.parent / "i-love-urdf" / "dist" / "cli.js"
ILU_INSTALLED_DIST_CLI_PATH = REPO_ROOT / "node_modules" / "i-love-urdf" / "dist" / "cli.js"
ILU_DIST_SOURCE_ENV = "URDF_ILU_DIST_SOURCE"
ILU_DIST_SOURCE_INSTALLED = "installed"
ILU_DIST_SOURCE_SIBLING = "sibling"
ILU_REQUIRED_DIST_RELATIVE_PATHS = (
    "commands/sourceGalleryCommands.js",
    "gallery/galleryPublish.js",
    "gallery/repoMediaRender.js",
    "repository/githubRepositoryInspection.js",
    "repository/repositoryPackageNames.js",
    "repository/repositoryPathScope.js",
)
PLAYWRIGHT_BROWSERS_PATH = REPO_ROOT / ".cache" / "ms-playwright"
ILU_GALLERY_INSPECT_COMMAND = "inspect-repo"
ILU_GALLERY_RENDER_COMMAND = "gallery-render"
ILU_GALLERY_BUILD_PUBLISH_COMMAND = "gallery-build-publish"
ILU_GALLERY_PREVIEW_QUERY_FLAG = "1"
ILU_GALLERY_RENDER_APP_URL = os.getenv("URDF_GALLERY_RENDER_APP_URL", "http://127.0.0.1:4173")
NPM_BIN = os.getenv("URDF_NPM_BIN", "npm").strip() or "npm"
ILU_GALLERY_RENDER_BUILD_TIMEOUT_SECONDS = 300
ILU_GALLERY_RENDER_APP_READY_TIMEOUT_SECONDS = 60
ILU_GALLERY_RENDER_APP_PROBE_TIMEOUT_SECONDS = 2
ILU_GALLERY_RENDER_APP_POLL_INTERVAL_SECONDS = 0.25
ILU_GALLERY_RENDER_APP_SHUTDOWN_TIMEOUT_SECONDS = 5
HTTP_USER_AGENT = os.getenv("URDF_STUDIO_HTTP_USER_AGENT", "urdf-studio/1.0")
GALLERY_DOCS_BASE_URL = "https://cdn.jsdelivr.net/gh/urdf-studio/urdf-robot-gallery@main/docs"
GALLERY_RAW_BASE_URL = "https://raw.githubusercontent.com/urdf-studio/urdf-robot-gallery/main/docs"
GALLERY_ROBOTS_MANIFEST_URL = f"{GALLERY_RAW_BASE_URL}/robots.json"
GALLERY_PREVIEWS_MANIFEST_URL = f"{GALLERY_RAW_BASE_URL}/previews.json"
GALLERY_ROBOTS_DOCS_PATH = "docs/robots.json"
GALLERY_PREVIEWS_DOCS_PATH = "docs/previews.json"
GALLERY_REPO_SHARDS_BASE_URL = f"{GALLERY_RAW_BASE_URL}/repos"
GALLERY_PREVIEW_SHARDS_BASE_URL = f"{GALLERY_RAW_BASE_URL}/previews-by-repo"
GALLERY_REPO_SHARDS_DOCS_DIR = "docs/repos"
GALLERY_PREVIEW_SHARDS_DOCS_DIR = "docs/previews-by-repo"
GALLERY_ASSET_KIND_THUMBNAIL = "thumbnail"
GALLERY_ASSET_KIND_VIDEO = "video"
GALLERY_GENERATE_ASSET_KIND_IMAGE = "image"
GALLERY_GENERATE_ASSET_KIND_VIDEO = "video"
GALLERY_PROGRESS_STARTED_PERCENT = 1
GALLERY_PROGRESS_COMPLETE_PERCENT = 100
GALLERY_PROGRESS_FIRST_STEP = 1
GALLERY_PROGRESS_STAGE_PREPARING = "preparing"
GALLERY_PROGRESS_STAGE_RENDERING = "rendering"
GITHUB_API_BASE_URL = "https://api.github.com"
GITHUB_API_VERSION = "2022-11-28"
GITHUB_GIT_FILE_MODE = "100644"
GITHUB_GIT_BLOB_TYPE = "blob"
GALLERY_INSPECT_CACHE_SCHEMA_VERSION = 2
GALLERY_RENDER_MISSING_TARGET_ERROR = "Unable to find the requested URDF target in the GitHub repository."


@dataclass(frozen=True)
class _GalleryCatalog:
    repo_entries: dict[str, list[dict]]
    preview_entries: dict[str, dict]


@dataclass
class _GalleryCatalogCacheEntry:
    expires_at: float
    catalog: _GalleryCatalog


_gallery_catalog_cache_by_scope: dict[str, _GalleryCatalogCacheEntry] = {}
_gallery_catalog_miss_cache_by_scope: dict[str, float] = {}


def _catalog_snapshot_from_catalog(catalog: _GalleryCatalog) -> dict[str, list[dict]]:
    return {
        "repoEntries": [dict(entry) for repo_entries in catalog.repo_entries.values() for entry in repo_entries],
        "previewEntries": [dict(entry) for entry in catalog.preview_entries.values()],
    }


def _catalog_from_snapshot(snapshot: object) -> _GalleryCatalog:
    snapshot_root = snapshot if isinstance(snapshot, dict) else {}
    repo_entries: dict[str, list[dict]] = {}
    for entry in snapshot_root.get("repoEntries", []):
        if not isinstance(entry, dict):
            continue
        repo_key = _normalize_repo_or_path(str(entry.get("repoKey") or ""))
        if not repo_key:
            continue
        repo_entries.setdefault(repo_key, []).append(entry)
    preview_entries = {
        f"{_normalize_repo_or_path(str(entry.get('repoKey') or ''))}::{str(entry.get('fileBase') or '').strip()}": entry
        for entry in snapshot_root.get("previewEntries", [])
        if isinstance(entry, dict)
        and str(entry.get("repoKey") or "").strip()
        and str(entry.get("fileBase") or "").strip()
    }
    return _GalleryCatalog(repo_entries=repo_entries, preview_entries=preview_entries)


def _resolve_ilu_cli_path() -> Path:
    preferred_source = os.getenv(ILU_DIST_SOURCE_ENV, "").strip().lower()
    candidate_paths = (
        (ILU_INSTALLED_DIST_CLI_PATH, ILU_UPSTREAM_DIST_CLI_PATH)
        if preferred_source == ILU_DIST_SOURCE_INSTALLED
        else (ILU_UPSTREAM_DIST_CLI_PATH, ILU_INSTALLED_DIST_CLI_PATH)
    )
    missing_roots: list[str] = []
    incomplete_roots: list[str] = []
    for cli_path in candidate_paths:
        if not cli_path.exists():
            missing_roots.append(str(cli_path))
            continue
        dist_root = cli_path.parent
        missing_files = [relative_path for relative_path in ILU_REQUIRED_DIST_RELATIVE_PATHS if not (dist_root / relative_path).exists()]
        if missing_files:
            incomplete_roots.append(f"{dist_root} missing {', '.join(missing_files)}")
            continue
        return cli_path
    detail_parts = [
        "Unable to resolve a complete i-love-urdf dist CLI.",
        *([f"Missing CLI paths: {', '.join(missing_roots)}"] if missing_roots else []),
        *([f"Incomplete dist roots: {'; '.join(incomplete_roots)}"] if incomplete_roots else []),
    ]
    raise RuntimeError(" ".join(detail_parts))


def _build_github_repo_url(source: IluGallerySource) -> str:
    return f"https://github.com/{source.owner}/{source.repo}"


def _build_gallery_live_source_missing_target_message(source: IluGallerySource) -> str:
    repo_label = _build_github_repo_url(source)
    path_label = _normalize_repo_path(source.path)
    scoped_label = f"{repo_label}/{path_label}" if path_label else repo_label
    return (
        f"The live GitHub source {scoped_label} does not expose a loadable URDF/Xacro target for gallery rendering. "
        "This source may only contain MuJoCo MJCF/XML assets or other non-URDF files."
    )


def _normalize_repo_key(owner: str, repo: str) -> str:
    return f"{owner.strip().lower()}/{repo.strip().lower()}"


def _normalize_repo_or_path(value: str) -> str:
    return value.replace("\\", "/").strip().strip("/").lower()


def _strip_robot_source_extension(value: str) -> str:
    normalized = value.strip()
    if normalized.lower().endswith(".urdf.xacro"):
        return normalized[: -len(".urdf.xacro")]
    if normalized.lower().endswith(".xacro"):
        return normalized[: -len(".xacro")]
    if normalized.lower().endswith(".urdf"):
        return normalized[: -len(".urdf")]
    return normalized


def _build_gallery_asset_endpoint(job_id: str, item_id: str, kind: str) -> str:
    query = urlencode({"item_id": item_id, "kind": kind})
    return f"/ilu/gallery/jobs/{job_id}/asset?{query}"


def _manifest_path(output_root: Path) -> Path:
    return output_root / "manifest.json"


def _write_manifest(output_root: Path, manifest: dict) -> None:
    _manifest_path(output_root).write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def _require_manifest_items(manifest: dict, error_message: str) -> list[dict]:
    raw_items = manifest.get("items")
    if not isinstance(raw_items, list):
        raise RuntimeError(error_message)
    return [item for item in raw_items if isinstance(item, dict)]


def _build_gallery_media_status(
    *,
    inspect_status: str,
    thumbnail_url: str | None,
    preview_url: str | None,
    video_url: str | None,
    repo_cataloged: bool,
) -> str:
    media_parts: list[str] = []
    if thumbnail_url:
        media_parts.append("image ready")
    elif repo_cataloged:
        media_parts.append("image missing")

    if video_url:
        media_parts.append("video ready")
    elif preview_url:
        media_parts.append("animated preview ready")
    elif repo_cataloged:
        media_parts.append("video missing")

    if not media_parts and not repo_cataloged:
        media_parts.append("repo not in gallery catalog")

    combined = [part for part in [", ".join(media_parts), inspect_status] if part]
    return " | ".join(combined) or "candidate discovered"


def _build_gallery_item_status(raw_item: dict) -> str:
    status_parts: list[str] = []
    inspection_mode = str(raw_item.get("inspectionMode") or "").strip()
    unresolved_mesh_refs = raw_item.get("unresolvedMeshReferenceCount")
    has_renderable_geometry = raw_item.get("hasRenderableGeometry")

    if inspection_mode == "xacro-source":
        status_parts.append("xacro source")
    elif inspection_mode == "urdf":
        status_parts.append("urdf")

    if has_renderable_geometry is True:
        status_parts.append("renderable")
    elif has_renderable_geometry is False:
        status_parts.append("non-renderable")

    if isinstance(unresolved_mesh_refs, int) and unresolved_mesh_refs > 0:
        suffix = "" if unresolved_mesh_refs == 1 else "s"
        status_parts.append(f"{unresolved_mesh_refs} unresolved mesh ref{suffix}")

    return ", ".join(status_parts) or "candidate discovered"


def _build_gallery_attention_notes(*, raw_item: dict, repo_cataloged: bool) -> list[str]:
    notes: list[str] = []
    unresolved_mesh_refs = raw_item.get("unresolvedMeshReferenceCount")
    has_renderable_geometry = raw_item.get("hasRenderableGeometry")

    if not repo_cataloged:
        notes.append("repo not in gallery catalog")
    if has_renderable_geometry is False:
        notes.append("non-renderable")
    if isinstance(unresolved_mesh_refs, int) and unresolved_mesh_refs > 0:
        suffix = "" if unresolved_mesh_refs == 1 else "s"
        notes.append(f"{unresolved_mesh_refs} unresolved mesh ref{suffix}")
    return notes


def _read_remote_json(url: str, *, headers: dict[str, str] | None = None, timeout_seconds: float = GALLERY_MANIFEST_TIMEOUT_SECONDS) -> object:
    request = urllib.request.Request(url, headers=headers or {"User-Agent": HTTP_USER_AGENT})
    with urlopen(request, timeout=timeout_seconds) as response:
        return json.loads(response.read().decode("utf-8"))


def _read_subprocess_output(process: subprocess.CompletedProcess[str]) -> str:
    return (process.stderr or process.stdout or "").strip()


def _build_gallery_render_api_base_url() -> str:
    host = os.getenv("URDF_API_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = os.getenv("URDF_API_PORT", "8000").strip() or "8000"
    if host in {"0.0.0.0", "::"}:
        host = "127.0.0.1"
    if ":" in host and not (host.startswith("[") and host.endswith("]")):
        host = f"[{host}]"
    return f"http://{host}:{port}"


def _reserve_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_gallery_render_app_ready(base_url: str, process: subprocess.Popen[str]) -> None:
    deadline = time.time() + ILU_GALLERY_RENDER_APP_READY_TIMEOUT_SECONDS
    request = urllib.request.Request(base_url, headers={"User-Agent": HTTP_USER_AGENT})
    last_error: Exception | None = None
    while time.time() < deadline:
        if process.poll() is not None:
            output = ""
            if process.stdout is not None:
                output = process.stdout.read().strip()
            detail = output or "gallery preview server exited before becoming ready"
            raise RuntimeError(detail)
        try:
            with urlopen(request, timeout=ILU_GALLERY_RENDER_APP_PROBE_TIMEOUT_SECONDS):
                return
        except HTTPError as error:
            last_error = error
        except (OSError, URLError, TimeoutError) as error:
            last_error = error
        time.sleep(ILU_GALLERY_RENDER_APP_POLL_INTERVAL_SECONDS)
    if last_error is not None:
        raise RuntimeError(f"Timed out waiting for gallery render app: {last_error}") from last_error
    raise RuntimeError("Timed out waiting for gallery render app.")


@contextmanager
def _resolve_gallery_render_app_url() -> str:
    explicit_url = os.getenv("URDF_GALLERY_RENDER_APP_URL", "").strip()
    if explicit_url:
        yield explicit_url
        return

    preview_env = os.environ.copy()
    preview_env.setdefault("VITE_API_BASE_URL", _build_gallery_render_api_base_url())

    build_process = subprocess.run(
        [NPM_BIN, "run", "build"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=ILU_GALLERY_RENDER_BUILD_TIMEOUT_SECONDS,
        check=False,
        env=preview_env,
    )
    if build_process.returncode != 0:
        detail = _read_subprocess_output(build_process) or "npm run build failed"
        raise RuntimeError(detail)

    preview_port = _reserve_loopback_port()
    preview_url = f"http://127.0.0.1:{preview_port}"
    preview_process = subprocess.Popen(
        [NPM_BIN, "run", "preview", "--", "--host", "127.0.0.1", "--port", str(preview_port)],
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=preview_env,
    )
    try:
        _wait_for_gallery_render_app_ready(preview_url, preview_process)
        yield preview_url
    finally:
        if preview_process.poll() is None:
            preview_process.terminate()
            try:
                preview_process.wait(timeout=ILU_GALLERY_RENDER_APP_SHUTDOWN_TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired:
                preview_process.kill()
                preview_process.wait(timeout=ILU_GALLERY_RENDER_APP_SHUTDOWN_TIMEOUT_SECONDS)


def _gallery_catalog_cache_key(repo_key: str | None = None) -> str:
    normalized_repo_key = _normalize_repo_or_path(repo_key or "")
    return normalized_repo_key or "__full__"


def _get_cached_gallery_catalog(repo_key: str | None = None) -> _GalleryCatalog | None:
    cache_key = _gallery_catalog_cache_key(repo_key)
    cached = _gallery_catalog_cache_by_scope.get(cache_key)
    now = time.time()
    if cached is None or now >= cached.expires_at:
        if cached is not None:
            _gallery_catalog_cache_by_scope.pop(cache_key, None)
        return None
    return cached.catalog


def _has_cached_gallery_catalog_miss(repo_key: str | None = None) -> bool:
    cache_key = _gallery_catalog_cache_key(repo_key)
    expires_at = _gallery_catalog_miss_cache_by_scope.get(cache_key)
    now = time.time()
    if expires_at is None:
        return False
    if now >= expires_at:
        _gallery_catalog_miss_cache_by_scope.pop(cache_key, None)
        return False
    return True


def _set_cached_gallery_catalog_miss(repo_key: str | None = None) -> None:
    cache_key = _gallery_catalog_cache_key(repo_key)
    _gallery_catalog_miss_cache_by_scope[cache_key] = time.time() + GALLERY_MANIFEST_CACHE_TTL_SECONDS
    _gallery_catalog_cache_by_scope.pop(cache_key, None)


def _set_cached_gallery_catalog(catalog: _GalleryCatalog, repo_key: str | None = None) -> _GalleryCatalog:
    cache_key = _gallery_catalog_cache_key(repo_key)
    _gallery_catalog_miss_cache_by_scope.pop(cache_key, None)
    _gallery_catalog_cache_by_scope[cache_key] = _GalleryCatalogCacheEntry(
        expires_at=time.time() + GALLERY_MANIFEST_CACHE_TTL_SECONDS,
        catalog=catalog,
    )
    return catalog


def _normalize_preview_entries(previews_payload: object) -> list[dict]:
    previews_list = previews_payload.get("previews") if isinstance(previews_payload, dict) else previews_payload
    if not isinstance(previews_list, list):
        return []
    return [entry for entry in previews_list if isinstance(entry, dict)]


def _catalog_from_payloads(robots_payload: object, previews_payload: object) -> _GalleryCatalog:
    robots_list = robots_payload if isinstance(robots_payload, list) else []
    preview_entries_list = _normalize_preview_entries(previews_payload)

    repo_entries: dict[str, list[dict]] = {}
    for entry in robots_list:
        if not isinstance(entry, dict):
            continue
        repo_key = _normalize_repo_or_path(str(entry.get("repoKey") or ""))
        if not repo_key:
            continue
        repo_entries.setdefault(repo_key, []).append(entry)
    preview_entries = {
        f"{_normalize_repo_or_path(str(entry.get('repoKey') or ''))}::{str(entry.get('fileBase') or '').strip()}": entry
        for entry in preview_entries_list
        if str(entry.get("repoKey") or "").strip()
        and str(entry.get("fileBase") or "").strip()
    }
    return _GalleryCatalog(repo_entries=repo_entries, preview_entries=preview_entries)


def _build_gallery_repo_shard_url(base_url: str, repo_key: str) -> str:
    normalized_repo_key = _normalize_repo_or_path(repo_key)
    if not normalized_repo_key:
        raise ValueError("repo_key is required for gallery shard urls")
    return f"{base_url}/{normalized_repo_key}.json"


def _build_gallery_repo_shard_docs_path(base_path: str, repo_key: str) -> str:
    normalized_repo_key = _normalize_repo_or_path(repo_key)
    if not normalized_repo_key:
        raise ValueError("repo_key is required for gallery shard paths")
    return f"{base_path}/{normalized_repo_key}.json"


def _load_gallery_catalog_repo_shard(source: IluGallerySource) -> _GalleryCatalog | None:
    repo_key = _normalize_repo_key(source.owner, source.repo)
    cached = _get_cached_gallery_catalog(repo_key)
    if cached is not None:
        return cached
    if _has_cached_gallery_catalog_miss(repo_key):
        return None

    robots_url = _build_gallery_repo_shard_url(GALLERY_REPO_SHARDS_BASE_URL, repo_key)
    previews_url = _build_gallery_repo_shard_url(GALLERY_PREVIEW_SHARDS_BASE_URL, repo_key)
    try:
        robots_payload = _read_remote_json(robots_url)
        previews_payload = _read_remote_json(previews_url)
    except HTTPError as error:
        if error.code == 404:
            _set_cached_gallery_catalog_miss(repo_key)
            return None
        raise
    catalog = _catalog_from_payloads(robots_payload, previews_payload)
    if not catalog.repo_entries and not catalog.preview_entries:
        _set_cached_gallery_catalog_miss(repo_key)
        return None
    return _set_cached_gallery_catalog(catalog, repo_key)


def _normalize_optional_text(value: object) -> str:
    return str(value or "").strip()


def _normalize_optional_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float):
        if value.is_integer() and value >= 0:
            return int(value)
        return None
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            parsed = int(stripped)
        except ValueError:
            return None
        return parsed if parsed >= 0 else None
    return None



def _load_gallery_catalog() -> _GalleryCatalog:
    cached = _get_cached_gallery_catalog()
    if cached is not None:
        return cached

    robots_payload = _read_remote_json(GALLERY_ROBOTS_MANIFEST_URL)
    previews_payload = _read_remote_json(GALLERY_PREVIEWS_MANIFEST_URL)
    return _set_cached_gallery_catalog(_catalog_from_payloads(robots_payload, previews_payload))


def _load_gallery_catalog_for_source(source: IluGallerySource) -> _GalleryCatalog:
    try:
        repo_catalog = _load_gallery_catalog_repo_shard(source)
    except (OSError, URLError, TimeoutError, json.JSONDecodeError):
        repo_catalog = None
    if repo_catalog is not None:
        return repo_catalog
    return _load_gallery_catalog()


def _build_gallery_media_url(relative_path: str | None) -> str | None:
    normalized = str(relative_path or "").strip().lstrip("/")
    if not normalized:
        return None
    return f"{GALLERY_DOCS_BASE_URL}/{normalized}"


def _normalize_text_list(values: object) -> list[str]:
    normalized: list[str] = []
    if not isinstance(values, list):
        return normalized
    for value in values:
        item = str(value).strip()
        if item and item not in normalized:
            normalized.append(item)
    return normalized


def _merge_text_lists(*lists: list[str]) -> list[str]:
    merged: list[str] = []
    for values in lists:
        for value in values:
            item = str(value).strip()
            if item and item not in merged:
                merged.append(item)
    return merged


def _normalize_repo_metadata_list(values: list[str] | None) -> list[str]:
    return _normalize_text_list(values)


def _coerce_gallery_repo_metadata(value: object) -> IluGalleryRepoMetadata:
    if isinstance(value, IluGalleryRepoMetadata):
        return value
    if isinstance(value, dict):
        try:
            return IluGalleryRepoMetadata.model_validate(value)
        except ValidationError:
            return IluGalleryRepoMetadata()
    return IluGalleryRepoMetadata()


def _coerce_gallery_robot_traits(value: object) -> IluGalleryRobotTraits | None:
    if isinstance(value, IluGalleryRobotTraits):
        return value
    if isinstance(value, dict):
        try:
            return IluGalleryRobotTraits.model_validate(value)
        except ValidationError:
            return None
    return None


def _build_gallery_robot_traits(urdf_xml: str) -> IluGalleryRobotTraits | None:
    normalized_urdf = urdf_xml.strip()
    if not normalized_urdf:
        return None
    try:
        morphology = analyze_robot_morphology(normalized_urdf)
    except IluUrdfBridgeError:
        return None

    return IluGalleryRobotTraits(
        primary_family=morphology.primary_family,
        families=list(morphology.families),
        link_count=morphology.link_count,
        joint_count=morphology.joint_count,
        controllable_joint_count=morphology.controllable_joint_count,
        dof_count=morphology.dof_count,
        arm_count=morphology.arm_count,
        leg_count=morphology.leg_count,
        wheel_count=morphology.wheel_count,
    )


def _load_gallery_repo_file_bytes_by_path(source: IluGallerySource) -> dict[str, bytes] | None:
    if not source.owner.strip() or not source.repo.strip():
        return None
    try:
        snapshot = _load_public_archive_snapshot(source.owner, source.repo, source.branch)
    except GitHubPublicProxyError:
        return None
    return dict(snapshot.file_bytes_by_path)


def _resolve_gallery_robot_traits(
    source: IluGallerySource,
    candidate_path: str,
    inspection_mode: str,
    repo_file_bytes_by_path: dict[str, bytes] | None = None,
) -> IluGalleryRobotTraits | None:
    if not source.owner.strip() or not source.repo.strip():
        return None
    if inspection_mode == "xacro-source":
        try:
            expanded_urdf, _stderr = expand_github_xacro(
                GitHubXacroExpandRequest(
                    owner=source.owner,
                    repo=source.repo,
                    target_path=candidate_path,
                    branch=source.branch,
                )
            )
        except IluUrdfBridgeError:
            return None
        return _build_gallery_robot_traits(expanded_urdf)
    if inspection_mode != "urdf":
        return None

    raw_bytes = repo_file_bytes_by_path.get(candidate_path) if repo_file_bytes_by_path else None
    if raw_bytes is None:
        try:
            raw_bytes, _mime_type = fetch_file_bytes(
                source.owner,
                source.repo,
                candidate_path,
                branch=source.branch,
            )
        except (GitHubPublicProxyError, OSError, UnicodeDecodeError):
            return None
    urdf_xml = raw_bytes.decode("utf-8", errors="ignore")
    return _build_gallery_robot_traits(urdf_xml)


def _score_repo_entry_path_match(source: IluGallerySource, repo_entry: dict, candidate_path: str | None = None) -> tuple[int, int]:
    normalized_source_path = _normalize_repo_path(source.path) or ""
    normalized_entry_path = _normalize_repo_path(str(repo_entry.get("path") or "")) or ""
    normalized_candidate_path = _normalize_repo_or_path(candidate_path or "")

    if normalized_source_path and normalized_entry_path == normalized_source_path:
        return (0, -len(normalized_entry_path))
    if normalized_source_path and normalized_candidate_path and normalized_candidate_path.startswith(f"{normalized_entry_path}/"):
        return (1, -len(normalized_entry_path))
    if not normalized_entry_path:
        return (2, 0)
    return (3, -len(normalized_entry_path))


def _select_repo_entry(source: IluGallerySource, catalog: _GalleryCatalog, candidate_path: str | None = None) -> dict | None:
    repo_key = _normalize_repo_key(source.owner, source.repo)
    repo_entries = catalog.repo_entries.get(repo_key) or []
    if not repo_entries:
        return None
    return min(repo_entries, key=lambda entry: _score_repo_entry_path_match(source, entry, candidate_path))


def _build_gallery_published_repo(
    source: IluGallerySource,
    catalog: _GalleryCatalog | None = None,
) -> IluGalleryPublishedRepo | None:
    resolved_catalog = catalog
    if resolved_catalog is None:
        try:
            resolved_catalog = _load_gallery_catalog_for_source(source)
        except (OSError, URLError, TimeoutError, json.JSONDecodeError):
            resolved_catalog = _GalleryCatalog(repo_entries={}, preview_entries={})
    repo_entry = _select_repo_entry(source, resolved_catalog)
    if not isinstance(repo_entry, dict):
        return None
    raw_robots = repo_entry.get("robots") if isinstance(repo_entry.get("robots"), list) else []
    return IluGalleryPublishedRepo(
        repo=_normalize_optional_text(repo_entry.get("repo")) or _build_github_repo_url(source),
        repoKey=_normalize_optional_text(repo_entry.get("repoKey")) or _normalize_repo_key(source.owner, source.repo),
        path=_normalize_repo_path(str(repo_entry.get("path") or "")),
        name=_normalize_optional_text(repo_entry.get("name")) or None,
        summary=_normalize_optional_text(repo_entry.get("summary")),
        org=_normalize_optional_text(repo_entry.get("org")),
        demo=_normalize_optional_text(repo_entry.get("demo")),
        tags=_normalize_text_list(repo_entry.get("tags")),
        robots=[
            IluGalleryPublishedRobot(
                name=_normalize_optional_text(robot.get("name")) or None,
                file=_normalize_optional_text(robot.get("file")) or None,
                fileBase=_normalize_optional_text(robot.get("fileBase")) or None,
            )
            for robot in raw_robots
            if isinstance(robot, dict)
        ],
        authorWebsite=_normalize_optional_text(repo_entry.get("authorWebsite")),
        authorX=_normalize_optional_text(repo_entry.get("authorX")),
        authorLinkedin=_normalize_optional_text(repo_entry.get("authorLinkedin")),
        authorGithub=_normalize_optional_text(repo_entry.get("authorGithub")),
        contact=_normalize_optional_text(repo_entry.get("contact")),
        extra=_normalize_optional_text(repo_entry.get("extra")),
        stars=_normalize_optional_int(repo_entry.get("stars")),
        ownerLogin=_normalize_optional_text(repo_entry.get("ownerLogin")) or None,
        ownerAvatar=_normalize_optional_text(repo_entry.get("ownerAvatar")) or None,
        authorLogin=_normalize_optional_text(repo_entry.get("authorLogin")) or None,
        authorAvatar=_normalize_optional_text(repo_entry.get("authorAvatar")) or None,
        repoUpdatedAt=_normalize_optional_text(repo_entry.get("repoUpdatedAt")) or None,
        updatedAt=_normalize_optional_text(repo_entry.get("updatedAt")) or None,
        license=_normalize_optional_text(repo_entry.get("license")),
    )


def _merge_gallery_repo_metadata(
    source: IluGallerySource,
    inspected_metadata: object,
    catalog: _GalleryCatalog | None = None,
) -> IluGalleryRepoMetadata:
    resolved_catalog = catalog
    if resolved_catalog is None:
        try:
            resolved_catalog = _load_gallery_catalog_for_source(source)
        except (OSError, URLError, TimeoutError, json.JSONDecodeError):
            resolved_catalog = _GalleryCatalog(repo_entries={}, preview_entries={})
    repo_entry = _select_repo_entry(source, resolved_catalog) or {}
    repo_metadata = _coerce_gallery_repo_metadata(inspected_metadata)
    repo_entry_stars = _normalize_optional_int(repo_entry.get("stars")) if isinstance(repo_entry, dict) else None
    return IluGalleryRepoMetadata(
        org=_normalize_optional_text(repo_entry.get("org")) or repo_metadata.org,
        summary=_normalize_optional_text(repo_entry.get("summary")) or repo_metadata.summary,
        demo=_normalize_optional_text(repo_entry.get("demo")) or repo_metadata.demo,
        tags=(
            _normalize_repo_metadata_list(repo_entry.get("tags") if isinstance(repo_entry, dict) else [])
            or repo_metadata.tags
        ),
        license=_normalize_optional_text(repo_entry.get("license")) or repo_metadata.license,
        authorWebsite=_normalize_optional_text(repo_entry.get("authorWebsite")) or repo_metadata.author_website,
        authorX=_normalize_optional_text(repo_entry.get("authorX")) or repo_metadata.author_x,
        authorLinkedin=_normalize_optional_text(repo_entry.get("authorLinkedin")) or repo_metadata.author_linkedin,
        authorGithub=_normalize_optional_text(repo_entry.get("authorGithub")) or repo_metadata.author_github,
        contact=_normalize_optional_text(repo_entry.get("contact")) or repo_metadata.contact,
        extra=_normalize_optional_text(repo_entry.get("extra")) or repo_metadata.extra,
        stars=repo_entry_stars if repo_entry_stars is not None else repo_metadata.stars,
        ownerLogin=_normalize_optional_text(repo_entry.get("ownerLogin")) or repo_metadata.owner_login,
        ownerAvatar=_normalize_optional_text(repo_entry.get("ownerAvatar")) or repo_metadata.owner_avatar,
        authorLogin=_normalize_optional_text(repo_entry.get("authorLogin")) or repo_metadata.author_login,
        authorAvatar=_normalize_optional_text(repo_entry.get("authorAvatar")) or repo_metadata.author_avatar,
        repoUpdatedAt=_normalize_optional_text(repo_entry.get("repoUpdatedAt")) or repo_metadata.repo_updated_at,
    )


def _build_repo_robot_index(repo_entry: dict) -> dict[str, dict]:
    robots = repo_entry.get("robots")
    if not isinstance(robots, list):
        return {}

    direct_matches: dict[str, dict] = {}
    basename_matches: dict[str, dict] = {}
    stem_matches: dict[str, dict] = {}
    for robot in robots:
        if not isinstance(robot, dict):
            continue
        file_base = str(robot.get("fileBase") or "").strip()
        file_path = _normalize_repo_or_path(str(robot.get("file") or ""))
        robot_name = str(robot.get("name") or "").strip()
        if not file_base or not file_path:
            continue
        robot_record = {
            "fileBase": file_base,
            "file": file_path,
            "name": robot_name,
            "macroTags": _normalize_text_list(robot.get("macroTags")),
            "meshCount": _normalize_optional_int(robot.get("meshCount")),
            "linkCount": _normalize_optional_int(robot.get("linkCount")),
            "jointCount": _normalize_optional_int(robot.get("jointCount")),
            "armCount": _normalize_optional_int(robot.get("armCount")),
            "legCount": _normalize_optional_int(robot.get("legCount")),
            "wheelCount": _normalize_optional_int(robot.get("wheelCount")),
        }
        direct_matches[file_path] = robot_record
        basename = file_path.split("/")[-1]
        stem = _strip_robot_source_extension(basename).lower()
        basename_matches.setdefault(basename, robot_record)
        stem_matches.setdefault(stem, robot_record)
    return {**stem_matches, **basename_matches, **direct_matches}


def _resolve_gallery_catalog_text_list(
    preview_entry: dict | None,
    robot_entry: dict | None,
    key: str,
) -> list[str]:
    preview_values = _normalize_text_list(preview_entry.get(key)) if isinstance(preview_entry, dict) else []
    if preview_values:
        return preview_values
    return _normalize_text_list(robot_entry.get(key)) if isinstance(robot_entry, dict) else []


def _resolve_gallery_catalog_int(
    preview_entry: dict | None,
    robot_entry: dict | None,
    key: str,
) -> int | None:
    preview_value = _normalize_optional_int(preview_entry.get(key)) if isinstance(preview_entry, dict) else None
    if preview_value is not None:
        return preview_value
    return _normalize_optional_int(robot_entry.get(key)) if isinstance(robot_entry, dict) else None


def _resolve_gallery_preview_entry(
    catalog: _GalleryCatalog,
    source: IluGallerySource,
    candidate_path: str,
) -> tuple[dict | None, dict | None, dict | None]:
    repo_key = _normalize_repo_key(source.owner, source.repo)
    repo_entry = _select_repo_entry(source, catalog, candidate_path)
    if repo_entry is None:
        return None, None, None

    file_base_index = _build_repo_robot_index(repo_entry)
    normalized_candidate_path = _normalize_repo_or_path(candidate_path)
    candidate_basename = normalized_candidate_path.split("/")[-1]
    candidate_stem = _strip_robot_source_extension(candidate_basename).lower()
    robot_entry = (
        file_base_index.get(normalized_candidate_path)
        or file_base_index.get(candidate_basename)
        or file_base_index.get(candidate_stem)
    )
    if not isinstance(robot_entry, dict):
        return repo_entry, None, None

    preview_key = f"{repo_key}::{str(robot_entry.get('fileBase') or '').strip()}"
    return repo_entry, catalog.preview_entries.get(preview_key), robot_entry


def _build_candidate_lookup(raw_candidates: list[dict]) -> dict[str, dict]:
    lookup: dict[str, dict] = {}
    for candidate in raw_candidates:
        if not isinstance(candidate, dict):
            continue
        candidate_path = _normalize_repo_or_path(str(candidate.get("path") or ""))
        source_file = _normalize_repo_or_path(str(candidate.get("sourceFile") or ""))
        if candidate_path:
            lookup.setdefault(candidate_path, candidate)
            basename = candidate_path.split("/")[-1]
            lookup.setdefault(basename, candidate)
            lookup.setdefault(_strip_robot_source_extension(basename).lower(), candidate)
        if source_file:
            basename = source_file.split("/")[-1]
            lookup.setdefault(source_file, candidate)
            lookup.setdefault(basename, candidate)
            lookup.setdefault(_strip_robot_source_extension(basename).lower(), candidate)
    return lookup


def _load_gallery_live_candidate_lookup(source: IluGallerySource) -> dict[str, dict]:
    try:
        payload = list_repo_candidates(
            owner=source.owner,
            repo=source.repo,
            path=source.path or "",
            branch=source.branch,
        )
    except GitHubPublicProxyError:
        return {}

    raw_candidates = payload.get("candidates") if isinstance(payload, dict) else []
    if not isinstance(raw_candidates, list):
        return {}
    return _build_candidate_lookup(raw_candidates)


def _build_gallery_candidate_path(repo_entry: dict, robot_entry: dict) -> str:
    robot_path = _normalize_repo_path(str(robot_entry.get("path") or "")) or ""
    if robot_path:
        return robot_path
    repo_path = _normalize_repo_path(str(repo_entry.get("path") or "")) or ""
    robot_file = _normalize_repo_or_path(str(robot_entry.get("file") or "")) or ""
    if repo_path and robot_file:
        return f"{repo_path}/{robot_file}".strip("/")
    return robot_file


def _matches_requested_urdf_path(source: IluGallerySource, candidate_path: str, robot_entry: dict) -> bool:
    if not source.urdf_path:
        return True
    target = _normalize_repo_or_path(source.urdf_path) or ""
    if not target:
        return True
    source_file = _normalize_repo_or_path(str(robot_entry.get("file") or "")) or ""
    basename = candidate_path.split("/")[-1] if candidate_path else ""
    return target in {candidate_path, source_file, basename}


def _resolve_catalog_candidate(
    source: IluGallerySource,
    repo_entry: dict,
    robot_entry: dict,
    live_candidate_lookup: dict[str, dict],
) -> dict:
    catalog_candidate_path = _build_gallery_candidate_path(repo_entry, robot_entry)
    source_file = _normalize_repo_or_path(str(robot_entry.get("file") or "")) or ""
    source_basename = source_file.split("/")[-1] if source_file else ""
    source_stem = _strip_robot_source_extension(source_basename).lower() if source_basename else ""
    live_candidate = (
        live_candidate_lookup.get(_normalize_repo_or_path(catalog_candidate_path) or catalog_candidate_path)
        or live_candidate_lookup.get(source_file)
        or live_candidate_lookup.get(source_basename)
        or live_candidate_lookup.get(source_stem)
    )
    resolved_path = (
        _normalize_repo_or_path(str(live_candidate.get("path") or ""))
        if isinstance(live_candidate, dict)
        else ""
    ) or catalog_candidate_path
    resolved_basename = resolved_path.split("/")[-1] if resolved_path else ""
    inspection_mode = (
        str(live_candidate.get("inspectionMode") or "").strip()
        if isinstance(live_candidate, dict)
        else ""
    ) or ("xacro-source" if resolved_basename.lower().endswith(".xacro") else "urdf")
    return {
        "path": resolved_path,
        "sourceFile": (
            str(live_candidate.get("sourceFile") or "").strip()
            if isinstance(live_candidate, dict)
            else ""
        )
        or str(robot_entry.get("file") or "").strip(),
        "displayName": (
            str(live_candidate.get("displayName") or "").strip()
            if isinstance(live_candidate, dict)
            else ""
        )
        or str(robot_entry.get("name") or "").strip(),
        "fileBase": str(robot_entry.get("fileBase") or "").strip()
        or (
            str(live_candidate.get("fileBase") or "").strip()
            if isinstance(live_candidate, dict)
            else ""
        ),
        "inspectionMode": inspection_mode,
        "hasRenderableGeometry": True if str(robot_entry.get("fileBase") or "").strip() else None,
        "unresolvedMeshReferenceCount": 0,
    }


def _build_gallery_manifest_item(
    *,
    source: IluGallerySource,
    candidate_path: str,
    candidate: dict,
    repo_entry: dict | None,
    preview_entry: dict | None,
    robot_entry: dict | None,
    repo_file_bytes_by_path: dict[str, bytes] | None,
    resolve_robot_traits: bool = GALLERY_RESOLVE_ROBOT_TRAITS_DURING_INSPECTION,
) -> dict[str, object]:
    inspection_mode = str(candidate.get("inspectionMode") or "").strip()
    inspect_status = _build_gallery_item_status(candidate)
    thumbnail_url = _build_gallery_media_url(preview_entry.get("png")) if isinstance(preview_entry, dict) else None
    preview_url = _build_gallery_media_url(preview_entry.get("webp")) if isinstance(preview_entry, dict) else None
    video_url = None
    if isinstance(preview_entry, dict):
        video_url = _build_gallery_media_url(preview_entry.get("webm")) or _build_gallery_media_url(preview_entry.get("mp4"))
    gallery_repo_key = ""
    gallery_file_base = str(candidate.get("fileBase") or "").strip()
    gallery_png_path = ""
    gallery_webm_path = ""
    if isinstance(preview_entry, dict):
        gallery_repo_key = str(preview_entry.get("repoKey") or "").strip()
        gallery_file_base = str(preview_entry.get("fileBase") or "").strip()
        gallery_png_path = str(preview_entry.get("png") or "").strip()
        gallery_webm_path = str(preview_entry.get("webm") or "").strip()
    gallery_robot_name = str(
        (robot_entry.get("name") if isinstance(robot_entry, dict) else None)
        or candidate.get("displayName")
        or ""
    ).strip()
    gallery_source_file = str(
        (robot_entry.get("file") if isinstance(robot_entry, dict) else None)
        or candidate.get("sourceFile")
        or ""
    ).strip()
    attention_notes = _build_gallery_attention_notes(raw_item=candidate, repo_cataloged=repo_entry is not None)
    robot_traits = (
        _resolve_gallery_robot_traits(
            source,
            candidate_path,
            inspection_mode,
            repo_file_bytes_by_path,
        )
        if resolve_robot_traits
        else None
    )
    preview_macro_tags = _resolve_gallery_catalog_text_list(preview_entry, robot_entry, "macroTags")
    preview_tags = _resolve_gallery_catalog_text_list(preview_entry, robot_entry, "tags")
    return {
        "candidatePath": candidate_path,
        "status": _build_gallery_media_status(
            inspect_status=inspect_status,
            thumbnail_url=thumbnail_url,
            preview_url=preview_url,
            video_url=video_url,
            repo_cataloged=repo_entry is not None,
        ),
        "thumbnailPath": "",
        "thumbnailUrl": thumbnail_url or "",
        "previewUrl": preview_url or "",
        "videoUrl": video_url or "",
        "galleryRepoKey": gallery_repo_key,
        "galleryFileBase": gallery_file_base,
        "galleryRobotName": gallery_robot_name,
        "sourceFile": gallery_source_file,
        "sourcePath": candidate_path,
        "galleryPngPath": gallery_png_path,
        "galleryWebmPath": gallery_webm_path,
        "attentionNotes": attention_notes,
        "tags": preview_tags,
        "macroTags": preview_macro_tags,
        "meshCount": _resolve_gallery_catalog_int(preview_entry, robot_entry, "meshCount"),
        "linkCount": _resolve_gallery_catalog_int(preview_entry, robot_entry, "linkCount"),
        "jointCount": _resolve_gallery_catalog_int(preview_entry, robot_entry, "jointCount"),
        "armCount": _resolve_gallery_catalog_int(preview_entry, robot_entry, "armCount"),
        "legCount": _resolve_gallery_catalog_int(preview_entry, robot_entry, "legCount"),
        "wheelCount": _resolve_gallery_catalog_int(preview_entry, robot_entry, "wheelCount"),
        "robotTraits": (
            robot_traits.model_dump(mode="json", by_alias=True)
            if robot_traits is not None
            else None
        ),
    }


def _build_gallery_manifest_from_inspection(source: IluGallerySource, output_root: Path, inspection: dict) -> dict:
    raw_candidates = inspection.get("candidates")
    if not isinstance(raw_candidates, list):
        raise RuntimeError("ilu inspect-repo returned an invalid candidates list")
    if not raw_candidates:
        raise RuntimeError("No renderable .urdf or .xacro file found in the repository.")

    catalog: _GalleryCatalog | None = None
    try:
        catalog = _load_gallery_catalog_for_source(source)
    except (OSError, URLError, TimeoutError, json.JSONDecodeError):
        catalog = None
    catalog_snapshot = _catalog_snapshot_from_catalog(catalog) if catalog is not None else None
    has_urdf_candidate = any(
        isinstance(candidate, dict) and str(candidate.get("inspectionMode") or "").strip() == "urdf"
        for candidate in raw_candidates
    )
    should_resolve_robot_traits = GALLERY_RESOLVE_ROBOT_TRAITS_DURING_INSPECTION
    repo_file_bytes_by_path = (
        _load_gallery_repo_file_bytes_by_path(source)
        if should_resolve_robot_traits and has_urdf_candidate
        else None
    )

    manifest_items: list[dict[str, object]] = []
    candidate_lookup = _build_candidate_lookup(raw_candidates)
    selected_repo_entry = _select_repo_entry(source, catalog) if catalog is not None else None
    repo_robots = selected_repo_entry.get("robots") if isinstance(selected_repo_entry, dict) else None
    if isinstance(repo_robots, list) and repo_robots:
        repo_key = _normalize_repo_key(source.owner, source.repo)
        for raw_robot in repo_robots:
            if not isinstance(raw_robot, dict):
                continue
            catalog_candidate_path = _build_gallery_candidate_path(selected_repo_entry, raw_robot)
            if not catalog_candidate_path or not _matches_requested_urdf_path(source, catalog_candidate_path, raw_robot):
                continue
            lookup_key = _normalize_repo_or_path(catalog_candidate_path) or catalog_candidate_path
            basename = lookup_key.split("/")[-1]
            stem = _strip_robot_source_extension(basename).lower()
            candidate = (
                candidate_lookup.get(lookup_key)
                or candidate_lookup.get(basename)
                or candidate_lookup.get(stem)
                or {
                    "path": catalog_candidate_path,
                    "sourceFile": str(raw_robot.get("file") or "").strip(),
                    "displayName": str(raw_robot.get("name") or "").strip(),
                    "fileBase": str(raw_robot.get("fileBase") or "").strip(),
                    "inspectionMode": "xacro-source" if basename.lower().endswith(".xacro") else "urdf",
                    "hasRenderableGeometry": True if str(raw_robot.get("fileBase") or "").strip() else None,
                    "unresolvedMeshReferenceCount": 0,
                }
            )
            candidate_path = _normalize_repo_or_path(str(candidate.get("path") or "")) or catalog_candidate_path
            preview_entry = catalog.preview_entries.get(f"{repo_key}::{str(raw_robot.get('fileBase') or '').strip()}") if catalog is not None else None
            manifest_items.append(
                _build_gallery_manifest_item(
                    source=source,
                    candidate_path=candidate_path,
                    candidate=candidate,
                    repo_entry=selected_repo_entry,
                    preview_entry=preview_entry,
                    robot_entry=raw_robot,
                    repo_file_bytes_by_path=repo_file_bytes_by_path,
                    resolve_robot_traits=should_resolve_robot_traits,
                )
            )
    else:
        for candidate in raw_candidates:
            if not isinstance(candidate, dict):
                continue
            candidate_path = str(candidate.get("path") or "").strip()
            if not candidate_path:
                continue
            if catalog is not None:
                repo_entry, preview_entry, robot_entry = _resolve_gallery_preview_entry(catalog, source, candidate_path)
            else:
                repo_entry, preview_entry, robot_entry = (None, None, None)
            manifest_items.append(
                _build_gallery_manifest_item(
                    source=source,
                    candidate_path=candidate_path,
                    candidate=candidate,
                    repo_entry=repo_entry,
                    preview_entry=preview_entry,
                    robot_entry=robot_entry,
                    repo_file_bytes_by_path=repo_file_bytes_by_path,
                    resolve_robot_traits=should_resolve_robot_traits,
                )
            )

    manifest = {
        "outputRoot": str(output_root),
        "repoMetadata": inspection.get("repoMetadata"),
        "catalogSnapshot": catalog_snapshot,
        "items": manifest_items,
    }
    _write_manifest(output_root, manifest)
    return manifest


@dataclass
class _GalleryJobProgressCurrent:
    stage: str | None = None
    step: int | None = None
    item_id: str | None = None
    asset_kind: str | None = None
    label: str | None = None


@dataclass
class _GalleryJobRecord:
    job_id: str
    status: str
    phase: str
    source: IluGallerySource
    repo_metadata: IluGalleryRepoMetadata
    published_repo: IluGalleryPublishedRepo | None
    items: list[IluGalleryEntry]
    error: str | None
    output_root: str | None
    created_at: datetime
    updated_at: datetime
    progress_completed: int = 0
    progress_total: int = 0
    progress_current: _GalleryJobProgressCurrent | None = None


@dataclass
class _GalleryInspectCacheEntry:
    expires_at: float
    manifest: dict


_gallery_jobs: dict[str, _GalleryJobRecord] = {}
_gallery_job_order: list[str] = []
_gallery_jobs_lock = threading.Lock()
_gallery_inspect_cache_by_source: dict[str, _GalleryInspectCacheEntry] = {}
_gallery_inspect_cache_order: list[str] = []
_gallery_active_inspect_job_id_by_source: dict[str, str] = {}
_gallery_generation_semaphore = threading.BoundedSemaphore(GALLERY_GENERATE_MAX_CONCURRENCY)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_repo_path(path: str | None) -> str | None:
    if path is None:
        return None
    normalized = path.replace("\\", "/").strip().strip("/")
    return normalized or None


def _build_gallery_source_cache_key(source: IluGallerySource) -> str:
    return json.dumps(
        {
            "schema": GALLERY_INSPECT_CACHE_SCHEMA_VERSION,
            "repo": _normalize_repo_key(source.owner, source.repo),
            "path": _normalize_repo_path(source.path) or "",
            "branch": (source.branch or "").strip(),
            "urdfPath": _normalize_repo_path(source.urdf_path) or "",
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def _job_workdir(job_id: str) -> Path:
    return GALLERY_JOB_ROOT / job_id


def _build_gallery_job_progress(record: _GalleryJobRecord) -> IluGalleryJobProgress | None:
    total = max(0, record.progress_total)
    if total == 0:
        return None
    completed = min(max(0, record.progress_completed), total)
    completed_percent = min(
        GALLERY_PROGRESS_COMPLETE_PERCENT,
        round((completed / total) * GALLERY_PROGRESS_COMPLETE_PERCENT),
    )
    percent = (
        max(GALLERY_PROGRESS_STARTED_PERCENT, completed_percent)
        if record.status == "running" and completed == 0
        else completed_percent
    )
    current_progress = record.progress_current if record.status == "running" else None
    current_step = current_progress.step if current_progress is not None else None
    return IluGalleryJobProgress(
        completed=completed,
        total=total,
        percent=percent,
        currentStage=current_progress.stage if current_progress is not None else None,
        currentStep=(
            min(max(GALLERY_PROGRESS_FIRST_STEP, current_step), total)
            if current_step is not None
            else None
        ),
        currentItemId=current_progress.item_id if current_progress is not None else None,
        currentAssetKind=current_progress.asset_kind if current_progress is not None else None,
        currentLabel=current_progress.label if current_progress is not None else None,
    )


def _job_response_from_record(record: _GalleryJobRecord) -> IluGalleryJobResponse:
    return IluGalleryJobResponse(
        job_id=record.job_id,
        status=record.status,
        phase=record.phase,
        source=record.source,
        repo_metadata=record.repo_metadata,
        published_repo=record.published_repo,
        items=record.items,
        progress=_build_gallery_job_progress(record),
        error=record.error,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _get_job_record(job_id: str) -> _GalleryJobRecord:
    with _gallery_jobs_lock:
        record = _gallery_jobs.get(job_id)
        if record is None:
            raise KeyError(job_id)
        return record


def _store_job_record(record: _GalleryJobRecord) -> None:
    with _gallery_jobs_lock:
        _store_job_record_locked(record)


def _store_job_record_locked(record: _GalleryJobRecord) -> None:
    _gallery_jobs[record.job_id] = record
    if record.job_id not in _gallery_job_order:
        _gallery_job_order.append(record.job_id)
    while len(_gallery_job_order) > GALLERY_JOB_RETENTION_LIMIT:
        expired_job_id = _gallery_job_order.pop(0)
        _gallery_jobs.pop(expired_job_id, None)


def _clear_active_gallery_inspect_job(source_key: str, job_id: str) -> None:
    with _gallery_jobs_lock:
        if _gallery_active_inspect_job_id_by_source.get(source_key) == job_id:
            _gallery_active_inspect_job_id_by_source.pop(source_key, None)


def _prune_gallery_inspect_cache_locked(now: float) -> None:
    _gallery_inspect_cache_order[:] = [
        source_key
        for source_key in _gallery_inspect_cache_order
        if source_key in _gallery_inspect_cache_by_source
        and _gallery_inspect_cache_by_source[source_key].expires_at > now
    ]
    expired_source_keys = [
        source_key
        for source_key, entry in _gallery_inspect_cache_by_source.items()
        if entry.expires_at <= now
    ]
    for source_key in expired_source_keys:
        _gallery_inspect_cache_by_source.pop(source_key, None)
    while len(_gallery_inspect_cache_order) > GALLERY_INSPECT_CACHE_RETENTION_LIMIT:
        evicted_source_key = _gallery_inspect_cache_order.pop(0)
        _gallery_inspect_cache_by_source.pop(evicted_source_key, None)


def _store_cached_gallery_manifest(source_key: str, manifest: dict) -> None:
    with _gallery_jobs_lock:
        now = time.time()
        _gallery_inspect_cache_by_source[source_key] = _GalleryInspectCacheEntry(
            expires_at=now + GALLERY_INSPECT_CACHE_TTL_SECONDS,
            manifest=deepcopy(manifest),
        )
        _gallery_inspect_cache_order[:] = [entry_key for entry_key in _gallery_inspect_cache_order if entry_key != source_key]
        _gallery_inspect_cache_order.append(source_key)
        _prune_gallery_inspect_cache_locked(now)


def _update_job_record(
    job_id: str,
    *,
    status: str | None = None,
    phase: str | None = None,
    repo_metadata: IluGalleryRepoMetadata | None = None,
    published_repo: IluGalleryPublishedRepo | None = None,
    items: list[IluGalleryEntry] | None = None,
    error: str | None = None,
    output_root: str | None = None,
    progress_completed: int | None = None,
    progress_total: int | None = None,
    progress_current: _GalleryJobProgressCurrent | None = None,
    clear_progress_current: bool = False,
) -> None:
    with _gallery_jobs_lock:
        record = _gallery_jobs[job_id]
        _gallery_jobs[job_id] = _GalleryJobRecord(
            job_id=record.job_id,
            status=status or record.status,
            phase=phase or record.phase,
            source=record.source,
            repo_metadata=repo_metadata or record.repo_metadata,
            published_repo=published_repo if published_repo is not None else record.published_repo,
            items=items if items is not None else record.items,
            error=error,
            output_root=output_root if output_root is not None else record.output_root,
            created_at=record.created_at,
            updated_at=_utc_now(),
            progress_completed=(
                max(0, progress_completed)
                if progress_completed is not None
                else record.progress_completed
            ),
            progress_total=(
                max(0, progress_total)
                if progress_total is not None
                else record.progress_total
            ),
            progress_current=(
                None
                if clear_progress_current
                else progress_current
                if progress_current is not None
                else record.progress_current
            ),
        )


def _run_ilu_gallery_generate_from_repo(source: IluGallerySource, output_root: Path) -> dict:
    output_root.mkdir(parents=True, exist_ok=True)

    try:
        candidate_summary = list_repo_candidates(
            owner=source.owner,
            repo=source.repo,
            path=source.path or "",
            branch=source.branch,
        )
    except GitHubPublicProxyError:
        candidate_summary = None
    else:
        if isinstance(candidate_summary.get("candidates"), list):
            return _build_gallery_manifest_from_inspection(
                source,
                output_root,
                {
                    "repoMetadata": {},
                    "candidates": candidate_summary["candidates"],
                },
            )

    cli_path = _resolve_ilu_cli_path()

    github_ref = _build_github_repo_url(source)
    args = [NODE_BIN, str(cli_path), ILU_GALLERY_INSPECT_COMMAND, "--github", github_ref]
    if source.branch:
        args.extend(["--ref", source.branch])
    if source.path:
        args.extend(["--path", source.path])
    github_token = resolve_server_github_token()
    if github_token:
        args.extend(["--token", github_token])

    process = subprocess.run(
        args,
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=ILU_GALLERY_TIMEOUT_SECONDS,
        check=False,
    )
    if process.returncode != 0:
        detail = (process.stderr or process.stdout or "ilu inspect-repo failed").strip()
        raise RuntimeError(detail)

    try:
        inspection = json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("ilu inspect-repo did not produce readable JSON") from error
    return _build_gallery_manifest_from_inspection(source, output_root, inspection)


def _run_ilu_gallery_generate(source: IluGallerySource, output_root: Path) -> dict:
    cached_catalog_manifest = _build_gallery_manifest_from_catalog(source, output_root)
    if cached_catalog_manifest is not None:
        return cached_catalog_manifest
    return _run_ilu_gallery_generate_from_repo(source, output_root)


def _read_job_manifest(output_root: Path) -> dict:
    manifest_path = _manifest_path(output_root)
    if not manifest_path.exists():
        raise FileNotFoundError("Gallery manifest is missing.")
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Gallery manifest is unreadable: {manifest_path}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"Gallery manifest is invalid: {manifest_path}")
    return payload


def _resolve_selected_candidate_paths(record: _GalleryJobRecord, request: IluGalleryJobGenerateRequest) -> list[str]:
    available_paths = [item.urdf_path for item in record.items if item.urdf_path]
    if request.mode == "repo":
        return list(available_paths)
    selected = [item_id.strip() for item_id in request.item_ids if item_id.strip()]
    if not selected:
        raise RuntimeError("Select at least one robot to generate.")
    missing = sorted(set(selected) - set(available_paths))
    if missing:
        raise RuntimeError(f"Unknown gallery robot selection: {', '.join(missing)}")
    return selected


def _resolve_generate_asset_kinds(request: IluGalleryJobGenerateRequest) -> list[str]:
    normalized: list[str] = []
    for asset_kind in request.asset_kinds:
        value = str(asset_kind).strip().lower()
        if value and value not in normalized:
            normalized.append(value)
    if not normalized:
        raise RuntimeError("Select at least one asset kind to generate.")
    return normalized


def _resolve_gallery_generation_progress_total(candidate_paths: list[str], asset_kinds: list[str]) -> int:
    return len(candidate_paths) * len(asset_kinds)


def _chunk_gallery_render_values(values: list[str], batch_size: int) -> list[list[str]]:
    return [
        values[index:index + batch_size]
        for index in range(0, len(values), batch_size)
    ]


def _path_exists(path_value: str) -> bool:
    return Path(path_value).exists()


def _sanitize_generated_gallery_item(raw_item: dict, asset_kinds: list[str]) -> dict:
    item = dict(raw_item)
    if GALLERY_GENERATE_ASSET_KIND_IMAGE in asset_kinds:
        thumbnail_path = str(item.get("thumbnailPath") or "").strip()
        item["thumbnailPath"] = thumbnail_path if thumbnail_path and _path_exists(thumbnail_path) else ""
    if GALLERY_GENERATE_ASSET_KIND_VIDEO in asset_kinds:
        video_path = str(item.get("videoPath") or "").strip()
        item["videoPath"] = video_path if video_path and _path_exists(video_path) else ""
    return item


def _count_generated_gallery_item_assets(item: dict, asset_kinds: list[str]) -> int:
    generated_count = 0
    thumbnail_path = str(item.get("thumbnailPath") or "").strip()
    video_path = str(item.get("videoPath") or "").strip()
    if GALLERY_GENERATE_ASSET_KIND_IMAGE in asset_kinds and thumbnail_path and _path_exists(thumbnail_path):
        generated_count += 1
    if GALLERY_GENERATE_ASSET_KIND_VIDEO in asset_kinds and video_path and _path_exists(video_path):
        generated_count += 1
    return generated_count


def _count_generated_gallery_manifest_assets(generated_manifest: dict, asset_kinds: list[str]) -> int:
    return sum(
        _count_generated_gallery_item_assets(item, asset_kinds)
        for item in _require_manifest_items(
            generated_manifest,
            "Generated gallery manifest returned an invalid items list",
        )
        if isinstance(item, dict)
    )


def _merge_generated_gallery_items_by_candidate_path(generated_items: list[dict]) -> list[dict]:
    merged_by_candidate_path: dict[str, dict] = {}
    for item in generated_items:
        candidate_path = str(item.get("candidatePath") or "").strip()
        if not candidate_path:
            continue
        merged_item = merged_by_candidate_path.setdefault(candidate_path, {"candidatePath": candidate_path})
        for key, value in item.items():
            if key in {"thumbnailPath", "videoPath"}:
                if str(value or "").strip():
                    merged_item[key] = value
                continue
            if key not in merged_item or not str(merged_item.get(key) or "").strip():
                merged_item[key] = value
    return list(merged_by_candidate_path.values())


def _build_gallery_progress_target_label(candidate_paths: list[str]) -> str:
    return ", ".join(path.rsplit("/", 1)[-1] for path in candidate_paths)


def _build_gallery_progress_asset_label(asset_kinds: list[str]) -> str:
    return ", ".join(asset_kinds)


def _build_gallery_progress_preparing_label(candidate_paths: list[str], asset_kinds: list[str]) -> str:
    candidate_label = _build_gallery_progress_target_label(candidate_paths)
    asset_label = _build_gallery_progress_asset_label(asset_kinds)
    return f"Preparing {asset_label} render for {candidate_label}"


def _build_gallery_progress_rendering_label(candidate_paths: list[str], asset_kinds: list[str]) -> str:
    candidate_label = _build_gallery_progress_target_label(candidate_paths)
    asset_label = _build_gallery_progress_asset_label(asset_kinds)
    return f"Rendering {asset_label} for {candidate_label}"


def _build_gallery_progress_rendering_current(
    current_step: int,
    candidate_paths: list[str],
    asset_kinds: list[str],
) -> _GalleryJobProgressCurrent:
    return _GalleryJobProgressCurrent(
        stage=GALLERY_PROGRESS_STAGE_RENDERING,
        step=current_step,
        item_id=",".join(candidate_paths),
        asset_kind=",".join(asset_kinds),
        label=_build_gallery_progress_rendering_label(candidate_paths, asset_kinds),
    )


def _build_gallery_progress_preparing_current(
    candidate_paths: list[str],
    asset_kinds: list[str],
) -> _GalleryJobProgressCurrent:
    return _GalleryJobProgressCurrent(
        stage=GALLERY_PROGRESS_STAGE_PREPARING,
        item_id=",".join(candidate_paths),
        asset_kind=",".join(asset_kinds),
        label=_build_gallery_progress_preparing_label(candidate_paths, asset_kinds),
    )


def _increment_gallery_generation_progress(job_id: str, increment: int) -> None:
    with _gallery_jobs_lock:
        record = _gallery_jobs[job_id]
        progress_total = max(0, record.progress_total)
        progress_completed = min(
            progress_total,
            max(0, record.progress_completed) + max(0, increment),
        )
        _gallery_jobs[job_id] = _GalleryJobRecord(
            job_id=record.job_id,
            status=record.status,
            phase=record.phase,
            source=record.source,
            repo_metadata=record.repo_metadata,
            published_repo=record.published_repo,
            items=record.items,
            error=record.error,
            output_root=record.output_root,
            created_at=record.created_at,
            updated_at=_utc_now(),
            progress_completed=progress_completed,
            progress_total=progress_total,
            progress_current=record.progress_current,
        )


def _resolve_candidate_file_base(candidate_path: str, raw_item: dict) -> str:
    configured = str(raw_item.get("galleryFileBase") or raw_item.get("fileBase") or "").strip()
    if configured:
        return configured
    raise RuntimeError(f"Gallery file base is missing for {candidate_path}")


def _resolve_gallery_repo_asset_paths(source: IluGallerySource, raw_item: dict, candidate_path: str) -> dict[str, str]:
    repo_key = str(raw_item.get("galleryRepoKey") or "").strip()
    file_base = str(raw_item.get("galleryFileBase") or "").strip()
    png_path = str(raw_item.get("galleryPngPath") or "").strip()
    webm_path = str(raw_item.get("galleryWebmPath") or "").strip()
    if repo_key and file_base and png_path and webm_path:
        return {
            "repoKey": repo_key,
            "fileBase": file_base,
            "png": png_path,
            "webm": webm_path,
        }
    resolved_file_base = _resolve_candidate_file_base(candidate_path, raw_item)
    repo_key = _normalize_repo_key(source.owner, source.repo)
    return {
        "repoKey": repo_key,
        "fileBase": resolved_file_base,
        "png": f"thumbnails/{repo_key}/{resolved_file_base}.png",
        "webm": f"previews/{repo_key}/{resolved_file_base}.webm",
    }


def _has_gallery_asset_path(raw_item: dict, asset_key: str) -> bool:
    return bool(str(raw_item.get(asset_key) or "").strip())


def _resolve_job_asset_url(job_id: str, candidate_path: str, raw_item: dict, url_key: str, path_key: str, kind: str) -> str | None:
    asset_url = str(raw_item.get(url_key) or "").strip() or None
    if asset_url is None and _has_gallery_asset_path(raw_item, path_key):
        asset_url = _build_gallery_asset_endpoint(job_id, candidate_path, kind)
    return asset_url


def _run_gallery_asset_generation(
    source: IluGallerySource,
    output_root: Path,
    candidate_paths: list[str],
    asset_kinds: list[str],
    on_candidate_generated: Callable[[str, int], None] | None = None,
    on_render_step_started: Callable[[list[str], list[str]], None] | None = None,
) -> dict:
    cli_path = _resolve_ilu_cli_path()
    if not candidate_paths:
        raise RuntimeError("No gallery candidates selected for generation.")
    if not asset_kinds:
        raise RuntimeError("No gallery asset kinds selected for generation.")

    with _resolve_gallery_render_app_url() as render_app_url:
        generated_items: list[dict] = []
        candidate_path_batches = _chunk_gallery_render_values(candidate_paths, GALLERY_RENDER_BATCH_SIZE)
        asset_kind_batches = _chunk_gallery_render_values(asset_kinds, GALLERY_RENDER_ASSET_BATCH_SIZE)
        for candidate_path_batch in candidate_path_batches:
            for asset_kind_batch in asset_kind_batches:
                if on_render_step_started is not None:
                    on_render_step_started(candidate_path_batch, asset_kind_batch)
                args = [
                    NODE_BIN,
                    str(cli_path),
                    ILU_GALLERY_RENDER_COMMAND,
                    "--app",
                    render_app_url,
                    "--out",
                    str(output_root),
                ]
                if source.owner and source.repo:
                    args.extend([
                        "--github",
                        _build_github_repo_url(source),
                    ])
                else:
                    raise RuntimeError("Gallery generation requires a GitHub repository source.")
                if source.branch:
                    args.extend(["--ref", source.branch])
                if source.path:
                    args.extend(["--path", source.path])
                for asset_kind in asset_kind_batch:
                    args.extend(["--asset", asset_kind])
                for candidate_path in candidate_path_batch:
                    args.extend(["--urdf", candidate_path])

                process_env = os.environ.copy()
                if PLAYWRIGHT_BROWSERS_PATH.exists():
                    process_env["PLAYWRIGHT_BROWSERS_PATH"] = str(PLAYWRIGHT_BROWSERS_PATH)

                process = subprocess.run(
                    args,
                    cwd=str(REPO_ROOT),
                    capture_output=True,
                    text=True,
                    timeout=ILU_GALLERY_GENERATE_TIMEOUT_SECONDS,
                    check=False,
                    env=process_env,
                )
                if process.returncode != 0:
                    detail = (process.stderr or process.stdout or "ilu gallery generation failed").strip()
                    raise RuntimeError(detail)
                try:
                    generated_manifest = json.loads(process.stdout)
                except json.JSONDecodeError as error:
                    raise RuntimeError("ilu gallery generation did not produce readable JSON") from error
                candidate_generated_items = [
                    _sanitize_generated_gallery_item(item, asset_kind_batch)
                    for item in _require_manifest_items(
                        generated_manifest,
                        "Generated gallery manifest returned an invalid items list",
                    )
                    if isinstance(item, dict)
                ]
                generated_items.extend(candidate_generated_items)
                if on_candidate_generated is not None:
                    candidate_generated_asset_count = sum(
                        _count_generated_gallery_item_assets(item, asset_kind_batch)
                        for item in candidate_generated_items
                    )
                    on_candidate_generated(
                        ",".join(candidate_path_batch),
                        candidate_generated_asset_count,
                    )

        combined_manifest = {
            "outputRoot": str(output_root),
            "items": _merge_generated_gallery_items_by_candidate_path(generated_items),
        }
        output_root.mkdir(parents=True, exist_ok=True)
        _write_manifest(output_root, combined_manifest)
        return combined_manifest


def _merge_generated_manifest(
    source: IluGallerySource,
    output_root: Path,
    current_manifest: dict,
    generated_manifest: dict,
    asset_kinds: list[str],
) -> dict:
    generated_by_path = {
        str(item.get("candidatePath") or "").strip(): item
        for item in _require_manifest_items(generated_manifest, "Generated gallery manifest returned an invalid items list")
        if str(item.get("candidatePath") or "").strip()
    }

    merged_items: list[dict] = []
    for raw_item in current_manifest.get("items", []):
        if not isinstance(raw_item, dict):
            continue
        candidate_path = str(raw_item.get("candidatePath") or "").strip()
        generated_item = generated_by_path.get(candidate_path)
        if generated_item is None:
            merged_items.append(raw_item)
            continue
        repo_asset_paths = _resolve_gallery_repo_asset_paths(source, raw_item, candidate_path)
        merged_item = dict(raw_item)
        if GALLERY_GENERATE_ASSET_KIND_IMAGE in asset_kinds:
            generated_thumbnail_path = str(generated_item.get("thumbnailPath") or "").strip()
            if generated_thumbnail_path:
                merged_item["thumbnailPath"] = generated_thumbnail_path
                merged_item["thumbnailUrl"] = ""
        if GALLERY_GENERATE_ASSET_KIND_VIDEO in asset_kinds:
            generated_video_path = str(generated_item.get("videoPath") or "").strip()
            if generated_video_path:
                merged_item["videoPath"] = generated_video_path
                merged_item["videoUrl"] = ""
                merged_item["previewUrl"] = ""
        merged_item["galleryRepoKey"] = repo_asset_paths["repoKey"]
        merged_item["galleryFileBase"] = repo_asset_paths["fileBase"]
        if _has_gallery_asset_path(merged_item, "thumbnailPath") or _has_gallery_asset_path(merged_item, "thumbnailUrl"):
            merged_item["galleryPngPath"] = repo_asset_paths["png"]
        else:
            merged_item["galleryPngPath"] = str(raw_item.get("galleryPngPath") or "").strip()
        if _has_gallery_asset_path(merged_item, "videoPath") or _has_gallery_asset_path(merged_item, "videoUrl"):
            merged_item["galleryWebmPath"] = repo_asset_paths["webm"]
        else:
            merged_item["galleryWebmPath"] = str(raw_item.get("galleryWebmPath") or "").strip()
        has_thumbnail = bool(str(merged_item.get("thumbnailPath") or "").strip() or str(merged_item.get("thumbnailUrl") or "").strip())
        has_preview = bool(str(merged_item.get("previewUrl") or "").strip())
        has_video = bool(str(merged_item.get("videoPath") or "").strip() or str(merged_item.get("videoUrl") or "").strip())
        merged_item["status"] = _build_gallery_media_status(
            inspect_status=f"{', '.join(asset_kinds)} generated locally",
            thumbnail_url="generated" if has_thumbnail else None,
            preview_url="generated" if has_preview else None,
            video_url="generated" if has_video else None,
            repo_cataloged=True,
        )
        merged_items.append(merged_item)

    merged_manifest = {
        "outputRoot": str(output_root),
        "repoMetadata": current_manifest.get("repoMetadata"),
        "catalogSnapshot": current_manifest.get("catalogSnapshot"),
        "items": merged_items,
    }
    _write_manifest(output_root, merged_manifest)
    return merged_manifest


def _publish_spec_path(output_root: Path) -> Path:
    return output_root / "publish-spec.json"


def _write_publish_spec(record: _GalleryJobRecord, output_root: Path) -> Path:
    spec_path = _publish_spec_path(output_root)
    spec_payload = {
        "jobId": record.job_id,
        "source": record.source.model_dump(mode="json", by_alias=True),
        "repoMetadata": record.repo_metadata.model_dump(mode="json", by_alias=True),
        "items": [
            {
                "id": item.id,
                "title": item.title,
            }
            for item in record.items
        ],
        "manifestPath": str(_manifest_path(output_root)),
    }
    spec_path.write_text(f"{json.dumps(spec_payload, indent=2)}\n", encoding="utf-8")
    return spec_path


def _decode_pr_draft_json_file(draft_file: IluGalleryPrDraftFile) -> object | None:
    try:
        raw_bytes = (
            base64.b64decode(draft_file.content)
            if draft_file.encoding == "base64"
            else draft_file.content.encode("utf-8")
        )
        return json.loads(raw_bytes.decode("utf-8"))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def _build_pr_draft_json_file(path: str, payload: object) -> IluGalleryPrDraftFile:
    return IluGalleryPrDraftFile(path=path, content=f"{json.dumps(payload, indent=2)}\n")


def _upsert_pr_draft_file(files: list[IluGalleryPrDraftFile], draft_file: IluGalleryPrDraftFile) -> list[IluGalleryPrDraftFile]:
    updated_files: list[IluGalleryPrDraftFile] = []
    replaced = False
    for existing_file in files:
        if existing_file.path == draft_file.path:
            if not replaced:
                updated_files.append(draft_file)
                replaced = True
            continue
        updated_files.append(existing_file)
    if not replaced:
        updated_files.append(draft_file)
    return updated_files


def _augment_publish_draft_with_repo_shards(
    record: _GalleryJobRecord,
    draft: IluGalleryPrDraftResponse,
) -> IluGalleryPrDraftResponse:
    repo_key = _normalize_repo_key(record.source.owner, record.source.repo)
    robots_file = next((draft_file for draft_file in draft.files if draft_file.path == GALLERY_ROBOTS_DOCS_PATH), None)
    previews_file = next((draft_file for draft_file in draft.files if draft_file.path == GALLERY_PREVIEWS_DOCS_PATH), None)
    if robots_file is None or previews_file is None:
        return draft

    robots_payload = _decode_pr_draft_json_file(robots_file)
    previews_payload = _decode_pr_draft_json_file(previews_file)
    if not isinstance(robots_payload, list):
        return draft

    repo_entries = [
        entry
        for entry in robots_payload
        if isinstance(entry, dict)
        and _normalize_repo_or_path(str(entry.get("repoKey") or "")) == repo_key
    ]
    preview_entries = [
        entry
        for entry in _normalize_preview_entries(previews_payload)
        if _normalize_repo_or_path(str(entry.get("repoKey") or "")) == repo_key
    ]
    if not repo_entries and not preview_entries:
        return draft

    repo_shard_file = _build_pr_draft_json_file(
        _build_gallery_repo_shard_docs_path(GALLERY_REPO_SHARDS_DOCS_DIR, repo_key),
        repo_entries,
    )
    preview_shard_file = _build_pr_draft_json_file(
        _build_gallery_repo_shard_docs_path(GALLERY_PREVIEW_SHARDS_DOCS_DIR, repo_key),
        {"previews": preview_entries},
    )
    files = _upsert_pr_draft_file(list(draft.files), repo_shard_file)
    files = _upsert_pr_draft_file(files, preview_shard_file)
    return draft.model_copy(update={"files": files})


def _run_ilu_gallery_publish_build(record: _GalleryJobRecord, output_root: Path) -> IluGalleryPrDraftResponse:
    cli_path = _resolve_ilu_cli_path()
    spec_path = _write_publish_spec(record, output_root)
    args = [
        NODE_BIN,
        str(cli_path),
        ILU_GALLERY_BUILD_PUBLISH_COMMAND,
        "--spec",
        str(spec_path),
    ]
    process = subprocess.run(
        args,
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=ILU_GALLERY_TIMEOUT_SECONDS,
        check=False,
    )
    if process.returncode != 0:
        detail = (process.stderr or process.stdout or "ilu gallery publish build failed").strip()
        raise RuntimeError(detail)
    try:
        payload = json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("ilu gallery publish build did not produce readable JSON") from error
    draft = IluGalleryPrDraftResponse.model_validate(payload)
    return _augment_publish_draft_with_repo_shards(record, draft)


def _github_api_request(
    method: str,
    path: str,
    token: str,
    payload: object | None = None,
) -> object:
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "User-Agent": HTTP_USER_AGENT,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
    }
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(f"{GITHUB_API_BASE_URL}{path}", data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=GALLERY_MANIFEST_TIMEOUT_SECONDS) as response:
            content = response.read()
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"GitHub API request failed ({error.code}): {detail or path}") from error
    except URLError as error:
        raise RuntimeError(f"GitHub API request failed: {error.reason}") from error
    if not content:
        return {}
    try:
        return json.loads(content.decode("utf-8"))
    except json.JSONDecodeError as error:
        raise RuntimeError("GitHub API returned unreadable JSON") from error


def _github_get_repo_default_branch(repo_slug: str, token: str) -> str:
    response = _github_api_request("GET", f"/repos/{repo_slug}", token)
    default_branch = str(response.get("default_branch") or "").strip() if isinstance(response, dict) else ""
    if not default_branch:
        raise RuntimeError(f"GitHub repo {repo_slug} does not expose a default branch.")
    return default_branch


def _github_get_ref_sha(repo_slug: str, ref: str, token: str) -> str | None:
    try:
        response = _github_api_request("GET", f"/repos/{repo_slug}/git/ref/{ref}", token)
    except RuntimeError as error:
        if "404" in str(error):
            return None
        raise
    if not isinstance(response, dict):
        raise RuntimeError(f"GitHub ref lookup returned invalid payload for {repo_slug}:{ref}")
    ref_object = response.get("object")
    sha = str(ref_object.get("sha") or "").strip() if isinstance(ref_object, dict) else ""
    return sha or None


def _github_get_commit_tree_sha(repo_slug: str, commit_sha: str, token: str) -> str:
    response = _github_api_request("GET", f"/repos/{repo_slug}/git/commits/{commit_sha}", token)
    if not isinstance(response, dict):
        raise RuntimeError(f"GitHub commit lookup returned invalid payload for {repo_slug}:{commit_sha}")
    tree = response.get("tree")
    tree_sha = str(tree.get("sha") or "").strip() if isinstance(tree, dict) else ""
    if not tree_sha:
        raise RuntimeError(f"GitHub commit {commit_sha} does not expose a tree SHA.")
    return tree_sha


def _github_create_blob(
    repo_slug: str,
    token: str,
    content: str,
    encoding: str,
) -> str:
    response = _github_api_request(
        "POST",
        f"/repos/{repo_slug}/git/blobs",
        token,
        payload={"content": content, "encoding": encoding},
    )
    sha = str(response.get("sha") or "").strip() if isinstance(response, dict) else ""
    if not sha:
        raise RuntimeError(f"GitHub blob creation did not return a blob SHA for {repo_slug}.")
    return sha


def _github_create_tree(
    repo_slug: str,
    token: str,
    base_tree_sha: str,
    files: list[tuple[str, str, str]],
) -> str:
    tree_payload = {
        "base_tree": base_tree_sha,
        "tree": [
            {
                "path": path,
                "mode": GITHUB_GIT_FILE_MODE,
                "type": GITHUB_GIT_BLOB_TYPE,
                "sha": blob_sha,
            }
            for path, blob_sha, _encoding in files
        ],
    }
    response = _github_api_request("POST", f"/repos/{repo_slug}/git/trees", token, payload=tree_payload)
    sha = str(response.get("sha") or "").strip() if isinstance(response, dict) else ""
    if not sha:
        raise RuntimeError(f"GitHub tree creation did not return a tree SHA for {repo_slug}.")
    return sha


def _github_create_commit(repo_slug: str, token: str, message: str, tree_sha: str, parent_sha: str) -> str:
    response = _github_api_request(
        "POST",
        f"/repos/{repo_slug}/git/commits",
        token,
        payload={"message": message, "tree": tree_sha, "parents": [parent_sha]},
    )
    sha = str(response.get("sha") or "").strip() if isinstance(response, dict) else ""
    if not sha:
        raise RuntimeError(f"GitHub commit creation did not return a commit SHA for {repo_slug}.")
    return sha


def _github_upsert_ref(repo_slug: str, token: str, branch_name: str, commit_sha: str) -> None:
    ref_path = f"/repos/{repo_slug}/git/refs/heads/{branch_name}"
    existing_sha = _github_get_ref_sha(repo_slug, f"heads/{branch_name}", token)
    if existing_sha:
        _github_api_request("PATCH", ref_path, token, payload={"sha": commit_sha, "force": False})
        return
    _github_api_request(
        "POST",
        f"/repos/{repo_slug}/git/refs",
        token,
        payload={"ref": f"refs/heads/{branch_name}", "sha": commit_sha},
    )


def _github_find_open_pull_request(repo_slug: str, token: str, branch_name: str) -> dict | None:
    repo_owner = repo_slug.split("/", 1)[0].strip()
    response = _github_api_request(
        "GET",
        f"/repos/{repo_slug}/pulls?state=open&head={repo_owner}:{branch_name}",
        token,
    )
    if not isinstance(response, list) or not response:
        return None
    first = response[0]
    return first if isinstance(first, dict) else None


def _github_create_pull_request(
    repo_slug: str,
    token: str,
    title: str,
    body: str,
    branch_name: str,
    base_branch: str,
) -> dict:
    response = _github_api_request(
        "POST",
        f"/repos/{repo_slug}/pulls",
        token,
        payload={"title": title, "head": branch_name, "base": base_branch, "body": body},
    )
    if not isinstance(response, dict):
        raise RuntimeError(f"GitHub pull request creation returned invalid payload for {repo_slug}.")
    return response


def _guess_tags(candidate_path: str) -> list[str]:
    lowered = candidate_path.lower()
    return ["xacro"] if lowered.endswith(".xacro") else ["urdf"]


def _default_gallery_title(candidate_path: str, raw_item: dict) -> str:
    configured_name = str(raw_item.get("galleryRobotName") or "").strip()
    if configured_name:
        return configured_name
    source_file = str(raw_item.get("sourceFile") or "").strip()
    if source_file:
        return _strip_robot_source_extension(source_file.split("/")[-1])
    file_name = candidate_path.split("/")[-1]
    return file_name.rsplit(".", 1)[0] if "." in file_name else file_name


def _rehydrate_gallery_item_from_catalog_snapshot(
    source: IluGallerySource,
    raw_item: dict,
    catalog: _GalleryCatalog | None,
) -> dict:
    if catalog is None:
        return raw_item

    candidate_path = str(raw_item.get("candidatePath") or "").strip()
    gallery_repo_key = _normalize_repo_or_path(str(raw_item.get("galleryRepoKey") or ""))
    gallery_file_base = str(raw_item.get("galleryFileBase") or "").strip()

    preview_entry = (
        catalog.preview_entries.get(f"{gallery_repo_key}::{gallery_file_base}")
        if gallery_repo_key and gallery_file_base
        else None
    )
    robot_entry: dict | None = None
    if candidate_path:
        _repo_entry, matched_preview_entry, robot_entry = _resolve_gallery_preview_entry(catalog, source, candidate_path)
        if preview_entry is None:
            preview_entry = matched_preview_entry

    rehydrated = dict(raw_item)
    if not _normalize_text_list(raw_item.get("tags")):
        rehydrated["tags"] = _resolve_gallery_catalog_text_list(preview_entry, robot_entry, "tags")
    if not _normalize_text_list(raw_item.get("macroTags")):
        rehydrated["macroTags"] = _resolve_gallery_catalog_text_list(preview_entry, robot_entry, "macroTags")

    for key in ("meshCount", "linkCount", "jointCount", "armCount", "legCount", "wheelCount"):
        if _normalize_optional_int(raw_item.get(key)) is None:
            rehydrated[key] = _resolve_gallery_catalog_int(preview_entry, robot_entry, key)

    if not str(raw_item.get("galleryRobotName") or "").strip() and isinstance(robot_entry, dict):
        rehydrated["galleryRobotName"] = str(robot_entry.get("name") or "").strip()
    if not str(raw_item.get("sourceFile") or "").strip() and isinstance(robot_entry, dict):
        rehydrated["sourceFile"] = str(robot_entry.get("file") or "").strip()
    if not str(raw_item.get("galleryRepoKey") or "").strip() and isinstance(preview_entry, dict):
        rehydrated["galleryRepoKey"] = str(preview_entry.get("repoKey") or "").strip()
    if not str(raw_item.get("galleryFileBase") or "").strip() and isinstance(preview_entry, dict):
        rehydrated["galleryFileBase"] = str(preview_entry.get("fileBase") or "").strip()
    return rehydrated


def _map_gallery_items(job_id: str, source: IluGallerySource, manifest: dict) -> tuple[list[IluGalleryEntry], str | None]:
    output_root = str(manifest.get("outputRoot") or "").strip() or None
    catalog_snapshot = manifest.get("catalogSnapshot")
    catalog = _catalog_from_snapshot(catalog_snapshot) if isinstance(catalog_snapshot, dict) else None
    items: list[IluGalleryEntry] = []
    for raw_item in _require_manifest_items(manifest, "ilu gallery manifest returned an invalid items list"):
        enriched_item = _rehydrate_gallery_item_from_catalog_snapshot(source, raw_item, catalog)
        candidate_path = str(enriched_item.get("candidatePath") or "").strip()
        if not candidate_path:
            continue
        title = _default_gallery_title(candidate_path, enriched_item)
        thumbnail_url = _resolve_job_asset_url(
            job_id,
            candidate_path,
            enriched_item,
            "thumbnailUrl",
            "thumbnailPath",
            GALLERY_ASSET_KIND_THUMBNAIL,
        )
        preview_url = str(enriched_item.get("previewUrl") or "").strip() or None
        video_url = _resolve_job_asset_url(
            job_id,
            candidate_path,
            enriched_item,
            "videoUrl",
            "videoPath",
            GALLERY_ASSET_KIND_VIDEO,
        )
        items.append(
            IluGalleryEntry(
                id=candidate_path,
                title=title or source.repo,
                summary=str(enriched_item.get("status") or "").strip() or None,
                attention_notes=_normalize_text_list(enriched_item.get("attentionNotes")),
                owner=source.owner,
                repo=source.repo,
                path=source.path,
                branch=source.branch,
                urdf_path=candidate_path,
                source_file=str(enriched_item.get("sourceFile") or "").strip() or None,
                thumbnail_url=thumbnail_url,
                preview_url=preview_url,
                video_url=video_url,
                gallery_repo_key=str(enriched_item.get("galleryRepoKey") or "").strip() or None,
                gallery_file_base=str(enriched_item.get("galleryFileBase") or "").strip() or None,
                macro_tags=_normalize_text_list(enriched_item.get("macroTags")),
                mesh_count=_normalize_optional_int(enriched_item.get("meshCount")),
                link_count=_normalize_optional_int(enriched_item.get("linkCount")),
                joint_count=_normalize_optional_int(enriched_item.get("jointCount")),
                arm_count=_normalize_optional_int(enriched_item.get("armCount")),
                leg_count=_normalize_optional_int(enriched_item.get("legCount")),
                wheel_count=_normalize_optional_int(enriched_item.get("wheelCount")),
                robot_traits=_coerce_gallery_robot_traits(enriched_item.get("robotTraits")),
                tags=_merge_text_lists(_normalize_text_list(enriched_item.get("tags")), _guess_tags(candidate_path)),
            )
        )

    if source.urdf_path:
        normalized_target = source.urdf_path.strip("/")
        items = [item for item in items if item.urdf_path == normalized_target]
    return items, output_root


def get_gallery_repo_preview(
    source: IluGallerySource,
    candidates: list[dict] | None = None,
) -> IluGalleryRepoPreviewResponse:
    try:
        catalog = _load_gallery_catalog_for_source(source)
    except (OSError, URLError, TimeoutError, json.JSONDecodeError):
        catalog = _GalleryCatalog(repo_entries={}, preview_entries={})

    published_repo = _build_gallery_published_repo(source, catalog)
    if published_repo is None:
        return IluGalleryRepoPreviewResponse(source=source, publishedRepo=None, items=[])

    raw_candidates = _resolve_gallery_preview_candidates(source, candidates)
    if raw_candidates is None:
        return IluGalleryRepoPreviewResponse(source=source, publishedRepo=published_repo, items=[])

    preview_items: list[IluGalleryEntry] = []
    for raw_candidate in raw_candidates:
        if not isinstance(raw_candidate, dict):
            continue
        candidate_path = _normalize_repo_or_path(str(raw_candidate.get("path") or ""))
        if not candidate_path:
            continue
        repo_entry, preview_entry, robot_entry = _resolve_gallery_preview_entry(catalog, source, candidate_path)
        if repo_entry is None:
            continue
        manifest_item = _build_gallery_manifest_item(
            source=source,
            candidate_path=candidate_path,
            candidate=raw_candidate,
            repo_entry=repo_entry,
            preview_entry=preview_entry,
            robot_entry=robot_entry,
            repo_file_bytes_by_path=None,
            resolve_robot_traits=False,
        )
        preview_items.append(
            IluGalleryEntry(
                id=candidate_path,
                title=_default_gallery_title(candidate_path, manifest_item) or source.repo,
                summary=str(manifest_item.get("status") or "").strip() or None,
                attentionNotes=_normalize_text_list(manifest_item.get("attentionNotes")),
                owner=source.owner,
                repo=source.repo,
                path=source.path,
                branch=source.branch,
                urdfPath=candidate_path,
                sourceFile=str(manifest_item.get("sourceFile") or "").strip() or None,
                thumbnailUrl=str(manifest_item.get("thumbnailUrl") or "").strip() or None,
                previewUrl=str(manifest_item.get("previewUrl") or "").strip() or None,
                videoUrl=str(manifest_item.get("videoUrl") or "").strip() or None,
                galleryRepoKey=str(manifest_item.get("galleryRepoKey") or "").strip() or None,
                galleryFileBase=str(manifest_item.get("galleryFileBase") or "").strip() or None,
                macroTags=_normalize_text_list(manifest_item.get("macroTags")),
                meshCount=_normalize_optional_int(manifest_item.get("meshCount")),
                linkCount=_normalize_optional_int(manifest_item.get("linkCount")),
                jointCount=_normalize_optional_int(manifest_item.get("jointCount")),
                armCount=_normalize_optional_int(manifest_item.get("armCount")),
                legCount=_normalize_optional_int(manifest_item.get("legCount")),
                wheelCount=_normalize_optional_int(manifest_item.get("wheelCount")),
                robotTraits=_coerce_gallery_robot_traits(manifest_item.get("robotTraits")),
                tags=_normalize_text_list(manifest_item.get("tags")),
            )
        )

    return IluGalleryRepoPreviewResponse(
        source=source,
        publishedRepo=published_repo,
        items=preview_items,
    )


def _resolve_gallery_preview_candidates(source: IluGallerySource, candidates: list[dict] | None = None) -> list[dict] | None:
    if candidates is not None:
        return [dict(candidate) for candidate in candidates if isinstance(candidate, dict)]
    try:
        candidate_payload = list_repo_candidates(
            owner=source.owner,
            repo=source.repo,
            path=source.path or "",
            branch=source.branch,
        )
    except (GitHubPublicProxyError, OSError, TimeoutError, json.JSONDecodeError):
        return None
    raw_candidates = candidate_payload.get("candidates") if isinstance(candidate_payload, dict) else None
    if not isinstance(raw_candidates, list):
        return None
    return [dict(candidate) for candidate in raw_candidates if isinstance(candidate, dict)]


def _build_gallery_manifest_from_catalog(source: IluGallerySource, output_root: Path) -> dict | None:
    if (source.branch or "").strip():
        return None
    try:
        catalog = _load_gallery_catalog_for_source(source)
    except (OSError, URLError, TimeoutError, json.JSONDecodeError):
        return None

    selected_repo_entry = _select_repo_entry(source, catalog)
    repo_robots = selected_repo_entry.get("robots") if isinstance(selected_repo_entry, dict) else None
    if not isinstance(repo_robots, list) or not repo_robots:
        return None

    repo_key = _normalize_repo_key(source.owner, source.repo)
    live_candidate_lookup = _load_gallery_live_candidate_lookup(source)
    if not live_candidate_lookup:
        return None
    manifest_items: list[dict[str, object]] = []
    for raw_robot in repo_robots:
        if not isinstance(raw_robot, dict):
            continue
        catalog_candidate_path = _build_gallery_candidate_path(selected_repo_entry, raw_robot)
        source_file = _normalize_repo_or_path(str(raw_robot.get("file") or "")) or ""
        source_basename = source_file.split("/")[-1] if source_file else ""
        source_stem = _strip_robot_source_extension(source_basename).lower() if source_basename else ""
        live_candidate = (
            live_candidate_lookup.get(_normalize_repo_or_path(catalog_candidate_path) or catalog_candidate_path)
            or live_candidate_lookup.get(source_file)
            or live_candidate_lookup.get(source_basename)
            or live_candidate_lookup.get(source_stem)
        )
        if not isinstance(live_candidate, dict):
            continue
        candidate = _resolve_catalog_candidate(
            source,
            selected_repo_entry,
            raw_robot,
            live_candidate_lookup,
        )
        candidate_path = str(candidate.get("path") or "").strip()
        if not candidate_path or not _matches_requested_urdf_path(source, candidate_path, raw_robot):
            continue
        preview_key = f"{repo_key}::{str(raw_robot.get('fileBase') or '').strip()}"
        manifest_items.append(
            _build_gallery_manifest_item(
                source=source,
                candidate_path=candidate_path,
                candidate=candidate,
                repo_entry=selected_repo_entry,
                preview_entry=catalog.preview_entries.get(preview_key),
                robot_entry=raw_robot,
                repo_file_bytes_by_path=None,
                resolve_robot_traits=False,
            )
        )
    if not manifest_items:
        return None

    output_root.mkdir(parents=True, exist_ok=True)
    manifest = {
        "outputRoot": str(output_root),
        "repoMetadata": {},
        "catalogSnapshot": _catalog_snapshot_from_catalog(catalog),
        "items": manifest_items,
    }
    _write_manifest(output_root, manifest)
    return manifest


def _materialize_gallery_manifest(output_root: Path, manifest: dict) -> dict:
    output_root.mkdir(parents=True, exist_ok=True)
    materialized_manifest = deepcopy(manifest)
    materialized_manifest["outputRoot"] = str(output_root)
    _write_manifest(output_root, materialized_manifest)
    return materialized_manifest


def _resolve_gallery_job_completion(
    job_id: str,
    source: IluGallerySource,
    manifest: dict,
) -> tuple[IluGalleryRepoMetadata, IluGalleryPublishedRepo | None, list[IluGalleryEntry], str]:
    items, output_root = _map_gallery_items(job_id, source, manifest)
    catalog = _catalog_from_snapshot(manifest.get("catalogSnapshot"))
    repo_metadata = _merge_gallery_repo_metadata(
        source,
        manifest.get("repoMetadata"),
        catalog,
    )
    published_repo = _build_gallery_published_repo(
        source,
        catalog,
    )
    return repo_metadata, published_repo, items, output_root or str(_job_workdir(job_id))


def _build_cached_gallery_job_record(
    job_id: str,
    source: IluGallerySource,
    created_at: datetime,
    cached_manifest: dict,
) -> _GalleryJobRecord:
    materialized_manifest = _materialize_gallery_manifest(_job_workdir(job_id), cached_manifest)
    repo_metadata, published_repo, items, output_root = _resolve_gallery_job_completion(
        job_id,
        source,
        materialized_manifest,
    )
    completed_at = _utc_now()
    return _GalleryJobRecord(
        job_id=job_id,
        status="completed",
        phase="inspect",
        source=source,
        repo_metadata=repo_metadata,
        published_repo=published_repo,
        items=items,
        error=None,
        output_root=output_root,
        created_at=created_at,
        updated_at=completed_at,
    )


def _run_gallery_job(job_id: str) -> None:
    _update_job_record(job_id, status="running", phase="inspect", error=None)
    record = _get_job_record(job_id)
    source_key = _build_gallery_source_cache_key(record.source)
    try:
        manifest = _run_ilu_gallery_generate(record.source, _job_workdir(job_id))
        _store_cached_gallery_manifest(source_key, manifest)
        repo_metadata, published_repo, items, output_root = _resolve_gallery_job_completion(
            job_id,
            record.source,
            manifest,
        )
        _update_job_record(
            job_id,
            status="completed",
            phase="inspect",
            repo_metadata=repo_metadata,
            published_repo=published_repo,
            items=items,
            error=None,
            output_root=output_root or str(_job_workdir(job_id)),
        )
    except Exception as error:
        _update_job_record(job_id, status="failed", phase="inspect", items=[], error=str(error))
    finally:
        _clear_active_gallery_inspect_job(source_key, job_id)


def _run_gallery_generation_job(job_id: str, request: IluGalleryJobGenerateRequest) -> None:
    with _gallery_generation_semaphore:
        _execute_gallery_generation_job(job_id, request)


def _execute_gallery_generation_job(job_id: str, request: IluGalleryJobGenerateRequest) -> None:
    _update_job_record(
        job_id,
        status="running",
        phase="generate",
        error=None,
        clear_progress_current=True,
    )
    try:
        record = _get_job_record(job_id)
        output_root = Path(record.output_root or _job_workdir(job_id))
        initial_candidate_paths = _resolve_selected_candidate_paths(record, request)
        asset_kinds = _resolve_generate_asset_kinds(request)
        _update_job_record(
            job_id,
            progress_current=_build_gallery_progress_preparing_current(
                initial_candidate_paths,
                asset_kinds,
            ),
        )
        current_manifest = _run_ilu_gallery_generate_from_repo(record.source, output_root)
        current_items, resolved_output_root = _map_gallery_items(job_id, record.source, current_manifest)
        current_record = record.__class__(
            job_id=record.job_id,
            status=record.status,
            phase=record.phase,
            source=record.source,
            repo_metadata=record.repo_metadata,
            published_repo=record.published_repo,
            items=current_items,
            error=record.error,
            output_root=resolved_output_root or record.output_root,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )
        candidate_paths = _resolve_selected_candidate_paths(current_record, request)
        progress_total = _resolve_gallery_generation_progress_total(candidate_paths, asset_kinds)
        _update_job_record(
            job_id,
            status="running",
            phase="generate",
            error=None,
            progress_completed=0,
            progress_total=progress_total,
            progress_current=_build_gallery_progress_preparing_current(
                candidate_paths,
                asset_kinds,
            ),
        )

        def _mark_candidate_generated(_candidate_path: str, generated_asset_count: int) -> None:
            _increment_gallery_generation_progress(job_id, generated_asset_count)

        def _mark_render_step_started(candidate_path_batch: list[str], asset_kind_batch: list[str]) -> None:
            progress_record = _get_job_record(job_id)
            current_step = min(
                progress_total,
                max(0, progress_record.progress_completed) + GALLERY_PROGRESS_FIRST_STEP,
            )
            _update_job_record(
                job_id,
                progress_current=_build_gallery_progress_rendering_current(
                    current_step,
                    candidate_path_batch,
                    asset_kind_batch,
                ),
            )

        try:
            generated_manifest = _run_gallery_asset_generation(
                record.source,
                output_root,
                candidate_paths,
                asset_kinds,
                on_candidate_generated=_mark_candidate_generated,
                on_render_step_started=_mark_render_step_started,
            )
        except Exception as error:
            if GALLERY_RENDER_MISSING_TARGET_ERROR not in str(error):
                raise
            refreshed_manifest = _run_ilu_gallery_generate_from_repo(record.source, output_root)
            refreshed_items, _resolved_output_root = _map_gallery_items(job_id, record.source, refreshed_manifest)
            refreshed_record = record.__class__(
                job_id=record.job_id,
                status=record.status,
                phase=record.phase,
                source=record.source,
                repo_metadata=record.repo_metadata,
                published_repo=record.published_repo,
                items=refreshed_items,
                error=record.error,
                output_root=record.output_root,
                created_at=record.created_at,
                updated_at=record.updated_at,
            )
            candidate_paths = _resolve_selected_candidate_paths(refreshed_record, request)
            current_manifest = refreshed_manifest
            progress_total = _resolve_gallery_generation_progress_total(candidate_paths, asset_kinds)
            _update_job_record(
                job_id,
                status="running",
                phase="generate",
                error=None,
                progress_completed=0,
                progress_total=progress_total,
                progress_current=_build_gallery_progress_preparing_current(
                    candidate_paths,
                    asset_kinds,
                ),
            )
            try:
                generated_manifest = _run_gallery_asset_generation(
                    record.source,
                    output_root,
                    candidate_paths,
                    asset_kinds,
                    on_candidate_generated=_mark_candidate_generated,
                    on_render_step_started=_mark_render_step_started,
                )
            except Exception as retry_error:
                if GALLERY_RENDER_MISSING_TARGET_ERROR not in str(retry_error):
                    raise
                raise RuntimeError(_build_gallery_live_source_missing_target_message(record.source)) from retry_error
        merged_manifest = _merge_generated_manifest(
            record.source,
            output_root,
            current_manifest,
            generated_manifest,
            asset_kinds,
        )
        generated_asset_count = _count_generated_gallery_manifest_assets(generated_manifest, asset_kinds)
        if generated_asset_count == 0:
            raise RuntimeError(
                "Gallery generation did not produce any new local assets. Existing gallery assets were preserved."
            )
        items, resolved_output_root = _map_gallery_items(job_id, record.source, merged_manifest)
        _update_job_record(
            job_id,
            status="completed",
            phase="generate",
            items=items,
            error=None,
            output_root=resolved_output_root or str(output_root),
            progress_completed=generated_asset_count,
            progress_total=progress_total,
            clear_progress_current=True,
        )
    except Exception as error:
        _update_job_record(
            job_id,
            status="failed",
            phase="generate",
            error=str(error),
            clear_progress_current=True,
        )


def create_gallery_job(request: IluGalleryJobCreateRequest) -> IluGalleryJobResponse:
    normalized_source = IluGallerySource(
        owner=request.source.owner,
        repo=request.source.repo,
        path=_normalize_repo_path(request.source.path),
        branch=request.source.branch,
        urdfPath=_normalize_repo_path(request.source.urdf_path),
    )
    source_key = _build_gallery_source_cache_key(normalized_source)
    created_at = _utc_now()
    cached_manifest: dict | None = None
    queued_record: _GalleryJobRecord | None = None
    with _gallery_jobs_lock:
        active_job_id = _gallery_active_inspect_job_id_by_source.get(source_key)
        active_record = _gallery_jobs.get(active_job_id) if active_job_id else None
        if active_record is not None and active_record.phase == "inspect" and active_record.status in {"queued", "running"}:
            return _job_response_from_record(active_record)
        if active_job_id and active_record is None:
            _gallery_active_inspect_job_id_by_source.pop(source_key, None)

        now = time.time()
        _prune_gallery_inspect_cache_locked(now)
        cache_entry = _gallery_inspect_cache_by_source.get(source_key)
        if cache_entry is not None:
            cached_manifest = deepcopy(cache_entry.manifest)
        else:
            job_id = str(uuid.uuid4())
            queued_record = _GalleryJobRecord(
                job_id=job_id,
                status="queued",
                phase="inspect",
                source=normalized_source,
                repo_metadata=IluGalleryRepoMetadata(),
                published_repo=None,
                items=[],
                error=None,
                output_root=None,
                created_at=created_at,
                updated_at=created_at,
            )
            _store_job_record_locked(queued_record)
            _gallery_active_inspect_job_id_by_source[source_key] = job_id

    if cached_manifest is not None:
        record = _build_cached_gallery_job_record(
            str(uuid.uuid4()),
            normalized_source,
            created_at,
            cached_manifest,
        )
        _store_job_record(record)
        return _job_response_from_record(record)

    assert queued_record is not None
    worker = threading.Thread(
        target=_run_gallery_job,
        args=(queued_record.job_id,),
        daemon=True,
        name=f"ilu-gallery-{queued_record.job_id}",
    )
    worker.start()
    return _job_response_from_record(queued_record)


def get_gallery_job(job_id: str) -> IluGalleryJobResponse:
    return _job_response_from_record(_get_job_record(job_id))


def generate_gallery_job(job_id: str, request: IluGalleryJobGenerateRequest) -> IluGalleryJobResponse:
    record = _get_job_record(job_id)
    is_retryable_failed_generation = (
        record.phase == "generate"
        and record.status == "failed"
        and bool(record.items)
    )
    if record.status != "completed" and not is_retryable_failed_generation:
        raise RuntimeError("Gallery job is not ready for generation.")
    candidate_paths = _resolve_selected_candidate_paths(record, request)
    asset_kinds = _resolve_generate_asset_kinds(request)
    progress_total = _resolve_gallery_generation_progress_total(candidate_paths, asset_kinds)
    _update_job_record(
        job_id,
        status="queued",
        phase="generate",
        error=None,
        progress_completed=0,
        progress_total=progress_total,
        clear_progress_current=True,
    )
    worker = threading.Thread(
        target=_run_gallery_generation_job,
        args=(job_id, request),
        daemon=True,
        name=f"ilu-gallery-generate-{job_id}",
    )
    worker.start()
    return get_gallery_job(job_id)


def update_gallery_job_metadata(job_id: str, request: IluGalleryJobMetadataUpdateRequest | dict) -> IluGalleryJobResponse:
    normalized_request = (
        request
        if isinstance(request, IluGalleryJobMetadataUpdateRequest)
        else IluGalleryJobMetadataUpdateRequest.model_validate(request)
    )
    record = _get_job_record(job_id)
    item_updates = {
        item.id: item.title.strip()
        for item in normalized_request.items
        if item.title.strip()
    }
    known_item_ids = {item.id for item in record.items}
    unknown_ids = sorted(set(item_updates) - known_item_ids)
    if unknown_ids:
        raise RuntimeError(f"Unknown gallery robot metadata entry: {', '.join(unknown_ids)}")

    updated_items = [
        item.model_copy(update={"title": item_updates.get(item.id, item.title)})
        for item in record.items
    ]
    with _gallery_jobs_lock:
        current = _gallery_jobs[job_id]
        _gallery_jobs[job_id] = _GalleryJobRecord(
            job_id=current.job_id,
            status=current.status,
            phase=current.phase,
            source=current.source,
            repo_metadata=normalized_request.repo_metadata,
            published_repo=current.published_repo,
            items=updated_items,
            error=current.error,
            output_root=current.output_root,
            created_at=current.created_at,
            updated_at=_utc_now(),
            progress_completed=current.progress_completed,
            progress_total=current.progress_total,
        )
    return get_gallery_job(job_id)


def build_gallery_job_bundle(job_id: str) -> tuple[bytes, str]:
    record = _get_job_record(job_id)
    payload = get_gallery_job(job_id).model_dump(mode="json", by_alias=True)
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("gallery-job.json", f"{json.dumps(payload, indent=2)}\n")
        if record.output_root:
            output_root = Path(record.output_root)
            if output_root.exists():
                for file_path in sorted(output_root.rglob("*")):
                    if file_path.is_file():
                        archive.write(file_path, arcname=file_path.relative_to(output_root).as_posix())
    return buffer.getvalue(), f"ilu-gallery-{job_id}.zip"


def build_gallery_job_pr_draft(job_id: str) -> IluGalleryPrDraftResponse:
    response = get_gallery_job(job_id)
    if response.status != "completed":
        raise RuntimeError("Gallery job is not ready for PR draft generation.")
    record = _get_job_record(job_id)
    output_root = Path(record.output_root or _job_workdir(job_id))
    return _run_ilu_gallery_publish_build(record, output_root)


def publish_gallery_job(job_id: str) -> IluGalleryPublishResponse:
    response = get_gallery_job(job_id)
    if response.status != "completed":
        raise RuntimeError("Gallery job is not ready to publish.")
    token = resolve_server_github_token()
    if not token:
        raise RuntimeError("GitHub publishing requires server GitHub auth.")

    record = _get_job_record(job_id)
    output_root = Path(record.output_root or _job_workdir(job_id))
    draft = _run_ilu_gallery_publish_build(record, output_root)
    if not draft.files:
        raise RuntimeError("Gallery publish build did not produce any files to publish.")

    repo_slug = draft.repo_slug.strip()
    branch_name = draft.branch_name.strip()
    if "/" not in repo_slug:
        raise RuntimeError(f"Invalid gallery repo slug: {repo_slug}")

    default_branch = _github_get_repo_default_branch(repo_slug, token)
    base_commit_sha = (
        _github_get_ref_sha(repo_slug, f"heads/{branch_name}", token)
        or _github_get_ref_sha(repo_slug, f"heads/{default_branch}", token)
    )
    if not base_commit_sha:
        raise RuntimeError(f"Unable to resolve a base commit for {repo_slug}#{branch_name}.")
    base_tree_sha = _github_get_commit_tree_sha(repo_slug, base_commit_sha, token)

    file_blobs = [
        (
            draft_file.path,
            _github_create_blob(repo_slug, token, draft_file.content, draft_file.encoding),
            draft_file.encoding,
        )
        for draft_file in draft.files
    ]
    tree_sha = _github_create_tree(repo_slug, token, base_tree_sha, file_blobs)
    commit_sha = _github_create_commit(
        repo_slug,
        token,
        message=f"{draft.title}\n\nGenerated via URDF Studio gallery publisher.",
        tree_sha=tree_sha,
        parent_sha=base_commit_sha,
    )
    _github_upsert_ref(repo_slug, token, branch_name, commit_sha)

    existing_pr = _github_find_open_pull_request(repo_slug, token, branch_name)
    pull_request = existing_pr or _github_create_pull_request(
        repo_slug,
        token,
        title=draft.title,
        body=draft.body,
        branch_name=branch_name,
        base_branch=default_branch,
    )
    pull_request_number = int(pull_request.get("number") or 0) if isinstance(pull_request, dict) else 0
    pull_request_url = str(pull_request.get("html_url") or "").strip() if isinstance(pull_request, dict) else ""
    if pull_request_number <= 0 or not pull_request_url:
        raise RuntimeError("GitHub publish did not return a valid pull request.")

    return IluGalleryPublishResponse(
        title=draft.title,
        repo_slug=repo_slug,
        branch_name=branch_name,
        base_branch=default_branch,
        pull_request_number=pull_request_number,
        pull_request_url=pull_request_url,
        files_changed=len(draft.files),
        reused_existing_pull_request=existing_pr is not None,
    )


def read_gallery_job_asset_file(job_id: str, item_id: str, kind: str) -> tuple[bytes, str]:
    record = _get_job_record(job_id)
    if not record.output_root:
        raise FileNotFoundError(item_id)
    output_root = Path(record.output_root)
    manifest = _read_job_manifest(output_root)
    raw_items = manifest.get("items")
    if not isinstance(raw_items, list):
        raise FileNotFoundError(item_id)
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            continue
        if str(raw_item.get("candidatePath") or "").strip() != item_id:
            continue
        asset_path_by_kind = {
            GALLERY_ASSET_KIND_THUMBNAIL: str(raw_item.get("thumbnailPath") or "").strip(),
            GALLERY_ASSET_KIND_VIDEO: str(raw_item.get("videoPath") or "").strip(),
        }
        asset_path = asset_path_by_kind.get(kind, "")
        if not asset_path:
            raise FileNotFoundError(item_id)
        file_path = Path(asset_path)
        if not file_path.exists():
            raise FileNotFoundError(item_id)
        media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        return file_path.read_bytes(), media_type
    raise FileNotFoundError(item_id)


def read_gallery_thumbnail_file(job_id: str, item_id: str) -> tuple[bytes, str]:
    return read_gallery_job_asset_file(job_id, item_id, GALLERY_ASSET_KIND_THUMBNAIL)
