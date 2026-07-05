from __future__ import annotations

import base64
import binascii
import http.client
import json
import math
import mimetypes
import os
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import OrderedDict
from collections.abc import Mapping
from dataclasses import dataclass
from io import BytesIO
from typing import TypeAlias
from urllib.parse import urlencode

from backend.core.paths import SCRIPTS_DIR
from backend.models.json_payload import JsonObject
from backend.services.github_auth import resolve_server_github_token
from backend.services.github_public_params import (
    GITHUB_PUBLIC_ARCHIVE_MAX_DOWNLOAD_BYTES,
    GITHUB_PUBLIC_ARCHIVE_MAX_ENTRY_COUNT,
    GITHUB_PUBLIC_ARCHIVE_MAX_SINGLE_FILE_BYTES,
    GITHUB_PUBLIC_ARCHIVE_MAX_TOTAL_UNCOMPRESSED_BYTES,
    GITHUB_PUBLIC_FETCH_CHUNK_BYTES,
    GITHUB_PUBLIC_HTML_MAX_DOWNLOAD_BYTES,
    GITHUB_PUBLIC_TREE_MAX_DOWNLOAD_BYTES,
)


def _read_env_str(name: str, default: str) -> str:
    raw = os.getenv(name)
    if not isinstance(raw, str):
        return default
    normalized = raw.strip()
    return normalized or default


def _read_float_env(name: str, default: float, *, minimum: float | None = None) -> float:
    raw = os.getenv(name)
    if not isinstance(raw, str):
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    if not math.isfinite(value):
        return default
    if minimum is not None and value < minimum:
        return default
    return value

NODE_BIN = _read_env_str("URDF_NODE_BIN", "node")
NODE_TIMEOUT_SECONDS = _read_float_env("URDF_GITHUB_BRIDGE_TIMEOUT_SECONDS", 30.0, minimum=0.0)
BRIDGE_SCRIPT = SCRIPTS_DIR / "ilu_github_bridge.mjs"
ARCHIVE_CACHE_TTL_SECONDS = _read_float_env(
    "URDF_GITHUB_ARCHIVE_CACHE_TTL_SECONDS",
    300.0,
    minimum=0.0,
)
HTTP_USER_AGENT = _read_env_str("URDF_STUDIO_HTTP_USER_AGENT", "urdf-studio/1.0")
GITHUB_API_BASE_URL = "https://api.github.com"
GITHUB_API_VERSION = "2022-11-28"

BridgePayload: TypeAlias = Mapping[str, object]
RepositoryFileEntry: TypeAlias = dict[str, object]
RepositoryCandidate: TypeAlias = dict[str, object]


@dataclass(frozen=True)
class GitHubPublicProxyError(RuntimeError):
    status_code: int
    detail: str


@dataclass(frozen=True)
class _ArchiveSnapshot:
    resolved_ref: str
    files: list[RepositoryFileEntry]
    file_bytes_by_path: dict[str, bytes]


@dataclass
class _ArchiveCacheEntry:
    expires_at: float
    snapshot: _ArchiveSnapshot


_archive_cache: OrderedDict[tuple[str, str, str], _ArchiveCacheEntry] = OrderedDict()


def _map_bridge_error(detail: str) -> GitHubPublicProxyError:
    lowered = detail.lower()
    if "not found" in lowered:
        return GitHubPublicProxyError(status_code=404, detail=detail)
    if "rate limit" in lowered or "access denied" in lowered or "no access" in lowered:
        return GitHubPublicProxyError(status_code=403, detail=detail)
    if "invalid github token" in lowered or "invalid token" in lowered:
        return GitHubPublicProxyError(status_code=401, detail=detail)
    return GitHubPublicProxyError(status_code=502, detail=detail)


def _run_bridge(command: str, payload: BridgePayload) -> JsonObject:
    try:
        completed_process = subprocess.run(
            [NODE_BIN, str(BRIDGE_SCRIPT), command],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=NODE_TIMEOUT_SECONDS,
            check=False,
        )
    except (FileNotFoundError, subprocess.SubprocessError, OSError) as error:
        raise GitHubPublicProxyError(
            status_code=502,
            detail=f"Failed to execute ilu bridge: {error}",
        ) from error

    stdout = completed_process.stdout.strip()
    stderr = completed_process.stderr.strip()

    if completed_process.returncode != 0:
        detail = stderr or stdout or f"ilu bridge command failed: {command}"
        raise _map_bridge_error(detail)

    try:
        response = json.loads(stdout or "{}")
    except json.JSONDecodeError as error:
        raise GitHubPublicProxyError(
            status_code=502,
            detail="ilu bridge returned invalid JSON.",
        ) from error
    if not isinstance(response, dict):
        raise GitHubPublicProxyError(
            status_code=502,
            detail="ilu bridge returned an invalid JSON object.",
        )
    return response


def _build_backend_file_url(
    owner: str,
    repo: str,
    path: str,
    sha: str | None,
    branch: str | None = None,
) -> str:
    query = {
        "owner": owner,
        "repo": repo,
        "path": path,
    }
    if sha:
        query["sha"] = sha
    if branch:
        query["branch"] = branch
    return f"/ilu/file?{urlencode(query)}"


def _is_xacro_path(file_name: str) -> bool:
    lowered = file_name.lower()
    return lowered.endswith(".xacro") or lowered.endswith(".urdf.xacro")


def _is_urdf_xacro_path(file_name: str) -> bool:
    return file_name.lower().endswith(".urdf.xacro")


def _is_support_xacro_file(file_name: str) -> bool:
    lowered = file_name.lower()
    if not _is_xacro_path(lowered) or _is_urdf_xacro_path(lowered):
        return False
    stem = re.sub(r"\.xacro$", "", lowered)
    return stem in {
        "material",
        "materials",
        "gazebo",
        "trans",
        "transmission",
        "transmissions",
        "macro",
        "macros",
        "include",
        "includes",
        "common",
    }


def _has_path_segment(path: str, expected_segment: str) -> bool:
    return any(segment.lower() == expected_segment.lower() for segment in path.split("/") if segment)


def _read_entry_str(entry: RepositoryFileEntry, key: str) -> str:
    value = entry.get(key)
    return value if isinstance(value, str) else ""


def _read_entry_int(entry: RepositoryFileEntry, key: str, default: int = 0) -> int:
    value = entry.get(key)
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            return default
        try:
            return int(candidate)
        except ValueError:
            return default
    return default


def _is_ignorable_repository_metadata_file(entry: RepositoryFileEntry) -> bool:
    name = _read_entry_str(entry, "name").lower()
    path = _read_entry_str(entry, "path")
    return name.startswith("._") or name == ".ds_store" or _has_path_segment(path, "__macosx")


def _trim_robot_source_extension(value: str) -> str:
    return re.sub(r"\.(urdf\.xacro|xacro|urdf)$", "", value, flags=re.IGNORECASE)


def _slugify_candidate_name(value: str) -> str:
    sanitized = re.sub(r'[\\/:*?"<>|]+', "-", value)
    sanitized = re.sub(r"\s+", "-", sanitized)
    sanitized = re.sub(r"-+", "-", sanitized)
    return sanitized.strip("-").lower()


def _hash_repository_path(value: str) -> str:
    hash_value = 2166136261
    for char in value:
        hash_value ^= ord(char)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return format(hash_value, "x")


def _build_candidate_display_name(file_name: str) -> str:
    trimmed = _trim_robot_source_extension(file_name.split("/")[-1] or file_name)
    return trimmed or "robot"


def _build_candidate_file_base(candidate_path: str) -> str:
    normalized = candidate_path.replace("\\", "/").lstrip("/")
    name = normalized.split("/")[-1] or normalized
    slug = _slugify_candidate_name(_trim_robot_source_extension(name)) or "robot"
    return f"{slug}--{_hash_repository_path(normalized)}"


def _find_mesh_folder(files: list[RepositoryFileEntry], dir_path: str) -> str | None:
    normalized_dir = dir_path.lower().strip("/")
    for entry in files:
        if _read_entry_str(entry, "type") != "dir":
            continue
        file_path = _read_entry_str(entry, "path").lower().strip("/")
        file_name = _read_entry_str(entry, "name").lower()
        if file_name not in {"meshes", "assets"}:
            continue
        if file_path in {
            f"{normalized_dir}/meshes".strip("/"),
            f"{normalized_dir}/assets".strip("/"),
        }:
            return _read_entry_str(entry, "path").strip("/")
    return None


def _find_meshes_folder_for_candidate(
    files: list[RepositoryFileEntry],
    candidate_path: str,
) -> str | None:
    path_parts = _normalize_repository_path(candidate_path).split("/")
    urdf_dir = "/".join(path_parts[:-1])
    same_dir = _find_mesh_folder(files, urdf_dir)
    if same_dir:
        return same_dir
    if urdf_dir:
        parent_dir = "/".join(urdf_dir.split("/")[:-1])
        sibling_dir = _find_mesh_folder(files, parent_dir)
        if sibling_dir:
            return sibling_dir
    search_parts = [segment for segment in urdf_dir.split("/") if segment]
    for index in range(len(search_parts) - 1, max(-1, len(search_parts) - 5), -1):
        candidate_dir = "/".join(search_parts[: index + 1])
        parent_dir = _find_mesh_folder(files, candidate_dir)
        if parent_dir:
            return parent_dir
    return None


def _strip_candidate_extension(file_name: str) -> str:
    return re.sub(r"(\.urdf\.xacro|\.xacro|\.urdf)$", "", file_name.lower(), flags=re.IGNORECASE)


def _repository_basename(path: str) -> str:
    parts = [segment for segment in path.split("/") if segment]
    return (parts[-1] if parts else "").lower()


def _score_repository_candidate(candidate: RepositoryCandidate) -> int:
    path_lower = str(candidate.get("path", "")).lower()
    name_lower = str(candidate.get("name", "")).lower()
    candidate_stem = _strip_candidate_extension(name_lower)
    parent_dir = _repository_basename("/".join(path_lower.split("/")[:-1]))
    score = 0
    if candidate.get("hasMeshesFolder"):
        score += 50
    if "/robots/" in path_lower:
        score += 35
    if "/urdf/" in path_lower:
        score += 8
    if "/description/" in path_lower:
        score += 12
    if _is_urdf_xacro_path(name_lower):
        score += 15
    if name_lower.endswith(".urdf"):
        score += 12
    if "robot" in name_lower:
        score += 10
    if "description" in name_lower:
        score += 8
    if "model" in name_lower:
        score += 6
    if parent_dir and candidate_stem == parent_dir:
        score += 24
    if _has_path_segment(path_lower, "config"):
        score -= 25
    if _has_path_segment(path_lower, "launch"):
        score -= 20
    if _has_path_segment(path_lower, "test"):
        score -= 20
    if _has_path_segment(path_lower, "ros2_control"):
        score -= 15
    if _has_path_segment(path_lower, "module"):
        score -= 12
    if "simulation" in path_lower:
        score -= 18
    if "pybullet" in path_lower:
        score -= 12
    if name_lower.startswith("_"):
        score -= 40
    for penalty_name, penalty in {
        "macro": 30,
        "gazebo": 25,
        "material": 20,
        "transmission": 20,
        "sensor": 15,
        "test": 15,
        "common": 10,
        "include": 10,
    }.items():
        if penalty_name in name_lower:
            score -= penalty
    if parent_dir and candidate_stem.startswith(f"{parent_dir}_"):
        score -= 8
    if re.search(r"_arm$|_base$|_gripper$|_head$|_end_effector$", candidate_stem):
        score -= 6
    if candidate_stem in {"field", "world"}:
        score -= 30
    if candidate_stem in {"arena", "stadium"}:
        score -= 20
    if candidate.get("isXacro") and not _is_urdf_xacro_path(name_lower):
        score -= 10
    elif candidate.get("isXacro"):
        score -= 2
    return score


def _find_repo_candidates_from_files(
    files: list[RepositoryFileEntry],
) -> list[RepositoryCandidate]:
    candidates: list[RepositoryCandidate] = []
    for entry in files:
        if _read_entry_str(entry, "type") != "file":
            continue
        if _is_ignorable_repository_metadata_file(entry):
            continue
        file_name = _read_entry_str(entry, "name")
        lowered_name = file_name.lower()
        if _is_support_xacro_file(lowered_name):
            continue
        if not (lowered_name.endswith(".urdf") or _is_xacro_path(lowered_name)):
            continue
        candidate_path = _normalize_repository_path(_read_entry_str(entry, "path"))
        if not candidate_path:
            continue
        meshes_folder = _find_meshes_folder_for_candidate(files, candidate_path)
        candidates.append(
            {
                "path": candidate_path,
                "name": file_name,
                "displayName": _build_candidate_display_name(file_name),
                "fileBase": _build_candidate_file_base(candidate_path),
                "sourceFile": file_name,
                "hasMeshesFolder": bool(meshes_folder),
                "meshesFolderPath": meshes_folder,
                "isXacro": _is_xacro_path(file_name),
            }
        )
    return sorted(
        candidates,
        key=lambda candidate: (
            -_score_repository_candidate(candidate),
            str(candidate.get("path", "")).lower(),
        ),
    )


def _guess_repository_file_mime_type(path: str) -> str:
    lower = path.lower()
    if lower.endswith((".urdf", ".xacro", ".xml")):
        return "application/xml"
    guessed = mimetypes.guess_type(path)[0]
    return guessed or "application/octet-stream"


def _normalize_repository_path(path: str) -> str:
    return "/".join(segment for segment in path.replace("\\", "/").split("/") if segment not in ("", "."))


def _extract_github_error_detail(status_code: int, body: str, reason: str) -> str:
    detail = body.strip() or f"{status_code} {reason}"
    try:
        payload = json.loads(detail)
    except json.JSONDecodeError:
        payload = None
    if isinstance(payload, dict):
        message = str(payload.get("message") or "").strip()
        if message:
            detail = message
    if status_code in (401, 403) and "rate limit exceeded" in detail.lower():
        return "GitHub public API rate limit exceeded. Configure server GitHub auth or retry later."
    return detail


def _parse_content_length(raw_content_length: str | None) -> int | None:
    if not raw_content_length:
        return None
    try:
        return int(raw_content_length)
    except ValueError:
        return None


def _fetch_url_bytes(url: str, *, max_bytes: int, headers: dict[str, str] | None = None) -> bytes:
    request_headers = {"User-Agent": HTTP_USER_AGENT}
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=NODE_TIMEOUT_SECONDS) as response:
            declared_content_length = _parse_content_length(
                response.headers.get("Content-Length")
            )
            if declared_content_length is not None and declared_content_length > max_bytes:
                raise GitHubPublicProxyError(
                    413, "GitHub response exceeds configured size limit."
                )

            chunks: list[bytes] = []
            total_bytes = 0
            while True:
                chunk = response.read(GITHUB_PUBLIC_FETCH_CHUNK_BYTES)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > max_bytes:
                    raise GitHubPublicProxyError(413, "GitHub response exceeds configured size limit.")
                chunks.append(chunk)
            return b"".join(chunks)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "ignore").strip()
        detail = _extract_github_error_detail(error.code, body, error.reason)
        if error.code == 404:
            raise GitHubPublicProxyError(404, detail) from error
        if error.code in (401, 403):
            raise GitHubPublicProxyError(403, detail) from error
        raise GitHubPublicProxyError(502, detail) from error
    except GitHubPublicProxyError:
        raise
    except (
        http.client.HTTPException,
        OSError,
        TimeoutError,
        urllib.error.URLError,
    ) as error:
        raise GitHubPublicProxyError(502, f"Failed to reach GitHub public archive: {error}") from error


def _resolve_default_branch_from_html(owner: str, repo: str) -> str:
    html = _fetch_url_bytes(
        f"https://github.com/{owner}/{repo}",
        max_bytes=GITHUB_PUBLIC_HTML_MAX_DOWNLOAD_BYTES,
    ).decode("utf-8", "ignore")
    marker = '"defaultBranch":"'
    start = html.find(marker)
    if start >= 0:
        start += len(marker)
        end = html.find('"', start)
        if end > start:
            branch = html[start:end].strip()
            if branch:
                return branch
    raise GitHubPublicProxyError(502, "Failed to determine the repository default branch.")


def _build_github_api_headers(access_token: str | None = None) -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
    }
    resolved_token = resolve_server_github_token(access_token)
    if resolved_token:
        headers["Authorization"] = f"Bearer {resolved_token}"
    return headers


def _load_public_git_tree_files(
    owner: str,
    repo: str,
    branch: str | None = None,
) -> tuple[str, list[RepositoryFileEntry]]:
    resolved_ref = branch or _resolve_default_branch_from_html(owner, repo)
    quoted_ref = urllib.parse.quote(resolved_ref, safe="")
    tree_url = f"{GITHUB_API_BASE_URL}/repos/{owner}/{repo}/git/trees/{quoted_ref}?recursive=1"
    raw_payload = _fetch_url_bytes(
        tree_url,
        max_bytes=GITHUB_PUBLIC_TREE_MAX_DOWNLOAD_BYTES,
        headers=_build_github_api_headers(),
    )
    try:
        payload = json.loads(raw_payload.decode("utf-8"))
    except json.JSONDecodeError as error:
        raise GitHubPublicProxyError(502, "GitHub tree listing returned invalid JSON.") from error

    if payload.get("truncated") is True:
        raise GitHubPublicProxyError(413, "GitHub tree listing exceeds configured size limit.")

    raw_tree = payload.get("tree")
    if not isinstance(raw_tree, list):
        raise GitHubPublicProxyError(502, "GitHub tree listing returned an invalid payload.")

    directories: dict[str, RepositoryFileEntry] = {}
    files: dict[str, RepositoryFileEntry] = {}
    for raw_entry in raw_tree:
        if not isinstance(raw_entry, dict):
            continue
        normalized_path = _normalize_repository_path(_read_entry_str(raw_entry, "path"))
        if not normalized_path:
            continue
        entry_type = _read_entry_str(raw_entry, "type").strip().lower()
        if entry_type == "tree":
            directories[normalized_path] = {
                "name": normalized_path.split("/")[-1],
                "path": normalized_path,
                "type": "dir",
                "download_url": None,
                "size": 0,
                "sha": None,
                "encoding": None,
            }
            continue
        if entry_type != "blob":
            continue

        path_parts = normalized_path.split("/")
        for index in range(1, len(path_parts)):
            directory_path = "/".join(path_parts[:index])
            directories.setdefault(
                directory_path,
                {
                    "name": path_parts[index - 1],
                    "path": directory_path,
                    "type": "dir",
                    "download_url": None,
                    "size": 0,
                    "sha": None,
                    "encoding": None,
                },
            )
        files[normalized_path] = {
            "name": path_parts[-1],
            "path": normalized_path,
            "type": "file",
            "download_url": None,
            "size": _read_entry_int(raw_entry, "size", 0),
            "sha": _read_entry_str(raw_entry, "sha").strip() or None,
            "encoding": None,
        }

    merged_files = sorted(
        [*directories.values(), *files.values()],
        key=lambda item: (item["path"], 0 if item["type"] == "dir" else 1),
    )
    return resolved_ref, merged_files


def _archive_cache_get(owner: str, repo: str, ref: str) -> _ArchiveSnapshot | None:
    key = (owner.lower(), repo.lower(), ref)
    entry = _archive_cache.get(key)
    if entry is None:
        return None
    if time.time() > entry.expires_at:
        _archive_cache.pop(key, None)
        return None
    _archive_cache.move_to_end(key)
    return entry.snapshot


def _archive_cache_put(owner: str, repo: str, ref: str, snapshot: _ArchiveSnapshot) -> None:
    key = (owner.lower(), repo.lower(), ref)
    _archive_cache[key] = _ArchiveCacheEntry(
        expires_at=time.time() + ARCHIVE_CACHE_TTL_SECONDS,
        snapshot=snapshot,
    )
    _archive_cache.move_to_end(key)
    while len(_archive_cache) > 8:
        _archive_cache.popitem(last=False)


def _archive_cache_delete(owner: str, repo: str, ref: str) -> None:
    key = (owner.lower(), repo.lower(), ref)
    _archive_cache.pop(key, None)


def _build_archive_url(owner: str, repo: str, ref: str) -> str:
    quoted_ref = urllib.parse.quote(ref, safe="/")
    return f"https://github.com/{owner}/{repo}/archive/refs/heads/{quoted_ref}.zip"


def _load_public_archive_snapshot(
    owner: str,
    repo: str,
    branch: str | None = None,
    *,
    force_refresh: bool = False,
) -> _ArchiveSnapshot:
    resolved_ref = branch or _resolve_default_branch_from_html(owner, repo)
    cached = None if force_refresh else _archive_cache_get(owner, repo, resolved_ref)
    if cached is not None and cached.files and cached.file_bytes_by_path:
        return cached
    if cached is not None:
        _archive_cache_delete(owner, repo, resolved_ref)

    archive_bytes = _fetch_url_bytes(
        _build_archive_url(owner, repo, resolved_ref),
        max_bytes=GITHUB_PUBLIC_ARCHIVE_MAX_DOWNLOAD_BYTES,
    )
    try:
        with zipfile.ZipFile(BytesIO(archive_bytes)) as archive:
            members = archive.infolist()
            if not members:
                raise GitHubPublicProxyError(502, "GitHub archive returned no files.")
            root_prefix = members[0].filename.split("/", 1)[0]
            files: list[RepositoryFileEntry] = []
            file_bytes_by_path: dict[str, bytes] = {}
            directories = set()
            file_count = 0
            total_uncompressed_bytes = 0

            for member in members:
                zip_name = member.filename
                if not zip_name or member.is_dir() or zip_name.endswith("/"):
                    continue
                relative = zip_name[len(root_prefix) + 1 :] if zip_name.startswith(f"{root_prefix}/") else zip_name
                normalized = _normalize_repository_path(relative)
                if not normalized:
                    continue

                file_count += 1
                if file_count > GITHUB_PUBLIC_ARCHIVE_MAX_ENTRY_COUNT:
                    raise GitHubPublicProxyError(
                        413,
                        "GitHub archive exceeds configured file-count limit.",
                    )
                if member.file_size > GITHUB_PUBLIC_ARCHIVE_MAX_SINGLE_FILE_BYTES:
                    raise GitHubPublicProxyError(
                        413,
                        "GitHub archive contains a file that exceeds the configured size limit.",
                    )
                total_uncompressed_bytes += member.file_size
                if total_uncompressed_bytes > GITHUB_PUBLIC_ARCHIVE_MAX_TOTAL_UNCOMPRESSED_BYTES:
                    raise GitHubPublicProxyError(
                        413,
                        "GitHub archive exceeds configured total-size limit.",
                    )

                file_bytes_by_path[normalized] = archive.read(member)
                parts = normalized.split("/")
                for index in range(1, len(parts)):
                    directories.add("/".join(parts[:index]))
                files.append(
                    {
                        "name": parts[-1],
                        "path": normalized,
                        "type": "file",
                        "download_url": None,
                        "size": len(file_bytes_by_path[normalized]),
                        "sha": None,
                        "encoding": None,
                    }
                )

            for directory in sorted(directories):
                files.append(
                    {
                        "name": directory.split("/")[-1],
                        "path": directory,
                        "type": "dir",
                        "download_url": None,
                        "size": 0,
                        "sha": None,
                        "encoding": None,
                    }
                )

            files.sort(key=lambda item: (item["path"], 0 if item["type"] == "dir" else 1))
    except GitHubPublicProxyError:
        raise
    except (
        RuntimeError,
        ValueError,
        zipfile.BadZipFile,
        zipfile.LargeZipFile,
    ) as error:
        raise GitHubPublicProxyError(502, f"Failed to read GitHub archive: {error}") from error

    snapshot = _ArchiveSnapshot(
        resolved_ref=resolved_ref,
        files=files,
        file_bytes_by_path=file_bytes_by_path,
    )
    _archive_cache_put(owner, repo, resolved_ref, snapshot)
    return snapshot


def _filter_archive_files(
    snapshot: _ArchiveSnapshot,
    path: str,
) -> list[RepositoryFileEntry]:
    normalized_prefix = _normalize_repository_path(path)
    if not normalized_prefix:
        return [dict(item) for item in snapshot.files]

    filtered: list[RepositoryFileEntry] = []
    for item in snapshot.files:
        item_path = str(item.get("path", ""))
        if item_path == normalized_prefix or item_path.startswith(f"{normalized_prefix}/"):
            filtered.append(dict(item))
    return filtered


def _list_repo_candidates_from_archive(
    owner: str,
    repo: str,
    path: str = "",
    branch: str | None = None,
) -> JsonObject:
    snapshot = _load_public_archive_snapshot(owner, repo, branch)
    files = _filter_archive_files(snapshot, path)
    if path and not files:
        snapshot = _load_public_archive_snapshot(owner, repo, branch, force_refresh=True)
        files = _filter_archive_files(snapshot, path)
    return {
        "ref": snapshot.resolved_ref,
        "candidates": _find_repo_candidates_from_files(files),
    }


def _list_repo_candidates_from_git_tree(
    owner: str,
    repo: str,
    path: str = "",
    branch: str | None = None,
) -> JsonObject:
    resolved_ref, files = _load_public_git_tree_files(owner, repo, branch)
    filtered_files = _filter_archive_files(
        _ArchiveSnapshot(resolved_ref=resolved_ref, files=files, file_bytes_by_path={}),
        path,
    )
    return {
        "ref": resolved_ref,
        "candidates": _find_repo_candidates_from_files(filtered_files),
    }


def list_repo_contents(
    owner: str,
    repo: str,
    path: str = "",
    branch: str | None = None,
) -> list[RepositoryFileEntry]:
    resolved_ref = branch
    try:
        access_token = resolve_server_github_token()
        payload = _run_bridge(
            "repo-contents",
            {
                "owner": owner,
                "repo": repo,
                "path": path,
                "branch": branch,
                "accessToken": access_token,
            },
        )
        files = payload.get("files")
        if not isinstance(files, list):
            raise GitHubPublicProxyError(502, "ilu bridge returned an invalid repository listing.")
        if path:
            files = _filter_archive_files(
                _ArchiveSnapshot(
                    resolved_ref=str(payload.get("ref") or branch or "").strip() or branch or "",
                    files=files,
                    file_bytes_by_path={},
                ),
                path,
            )
        resolved_ref = str(payload.get("ref") or branch or "").strip() or branch
    except GitHubPublicProxyError:
        snapshot = _load_public_archive_snapshot(owner, repo, branch)
        files = _filter_archive_files(snapshot, path)
        if path and not files:
            snapshot = _load_public_archive_snapshot(owner, repo, branch, force_refresh=True)
            files = _filter_archive_files(snapshot, path)
        resolved_ref = snapshot.resolved_ref

    output: list[RepositoryFileEntry] = []
    for entry in files:
        if not isinstance(entry, dict):
            continue
        normalized = dict(entry)
        if normalized.get("type") == "file":
            raw_sha = normalized.get("sha")
            normalized["download_url"] = _build_backend_file_url(
                owner=owner,
                repo=repo,
                path=str(normalized.get("path", "")),
                sha=raw_sha.strip() if isinstance(raw_sha, str) and raw_sha.strip() else None,
                branch=resolved_ref,
            )
        else:
            normalized["download_url"] = None
        output.append(normalized)
    return output


def list_repo_candidates(
    owner: str,
    repo: str,
    path: str = "",
    branch: str | None = None,
) -> JsonObject:
    resolved_ref = branch
    try:
        access_token = resolve_server_github_token()
        payload = _run_bridge(
            "repo-candidates",
            {
                "owner": owner,
                "repo": repo,
                "path": path,
                "branch": branch,
                "accessToken": access_token,
            },
        )
        candidates = payload.get("candidates")
        if not isinstance(candidates, list):
            raise GitHubPublicProxyError(502, "ilu bridge returned an invalid repository candidate list.")
        resolved_ref = str(payload.get("ref") or branch or "").strip() or branch
        return {
            "ref": resolved_ref,
            "candidates": candidates,
        }
    except GitHubPublicProxyError:
        try:
            return _list_repo_candidates_from_archive(owner=owner, repo=repo, path=path, branch=branch)
        except GitHubPublicProxyError as archive_error:
            if archive_error.status_code == 413:
                return _list_repo_candidates_from_git_tree(owner=owner, repo=repo, path=path, branch=branch)
            raise


def fetch_file_bytes(
    owner: str,
    repo: str,
    path: str,
    sha: str | None = None,
    branch: str | None = None,
) -> tuple[bytes, str]:
    try:
        access_token = resolve_server_github_token()
        payload = _run_bridge(
            "file-bytes",
            {
                "owner": owner,
                "repo": repo,
                "path": path,
                "sha": sha,
                "accessToken": access_token,
            },
        )
        content_b64 = payload.get("contentBase64")
        if not isinstance(content_b64, str) or not content_b64:
            raise GitHubPublicProxyError(502, f"ilu bridge did not return file content for {path}.")
        try:
            raw = base64.b64decode(content_b64)
        except (binascii.Error, ValueError) as error:
            raise GitHubPublicProxyError(502, f"Failed to decode file content for {path}.") from error

        mime_type = payload.get("mimeType")
        if not isinstance(mime_type, str) or not mime_type:
            mime_type = _guess_repository_file_mime_type(path)
        return raw, mime_type
    except GitHubPublicProxyError:
        snapshot = _load_public_archive_snapshot(owner, repo, branch)
        normalized_path = _normalize_repository_path(path)
        raw = snapshot.file_bytes_by_path.get(normalized_path)
        if raw is None:
            snapshot = _load_public_archive_snapshot(owner, repo, branch, force_refresh=True)
            raw = snapshot.file_bytes_by_path.get(normalized_path)
        if raw is None:
            raise GitHubPublicProxyError(404, f"File not found in GitHub archive: {path}")
        return raw, _guess_repository_file_mime_type(path)
