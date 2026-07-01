from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path


ILU_SESSION_ROOT = Path.home() / ".i-love-urdf" / "sessions"
ILU_SESSION_METADATA = "session.json"
SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")


@dataclass(frozen=True)
class IluSessionError(RuntimeError):
    status_code: int
    detail: str


@dataclass(frozen=True)
class _LocalAssetContext:
    root_dir: Path
    working_asset_path: str


@dataclass(frozen=True)
class IluSessionLocalUrdfSourceContext:
    source_urdf_path: Path
    source_root_dir: Path
    working_urdf_path: Path
    extra_search_roots: tuple[Path, ...]


def _validate_session_id(session_id: str) -> str:
    normalized = session_id.strip()
    if not normalized or not SESSION_ID_PATTERN.match(normalized):
        raise IluSessionError(status_code=400, detail="Invalid ilu session id.")
    return normalized


def _get_session_metadata_path(session_id: str) -> Path:
    return ILU_SESSION_ROOT / _validate_session_id(session_id) / ILU_SESSION_METADATA


def _read_session_payload(session_id: str) -> dict:
    metadata_path = _get_session_metadata_path(session_id)
    if not metadata_path.exists():
        raise IluSessionError(status_code=404, detail=f"ilu session not found: {session_id}")
    try:
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise IluSessionError(status_code=500, detail="Failed to read ilu session metadata.") from exc
    if not isinstance(payload, dict):
        raise IluSessionError(status_code=500, detail="ilu session metadata is invalid.")
    return payload


def _normalize_working_asset_path(value: str | None, fallback: str) -> str:
    candidate = (value or fallback or "").replace("\\", "/").strip()
    candidate = re.sub(r"/+", "/", candidate).lstrip("/")
    if not candidate:
        candidate = fallback or "robot.urdf"
    return re.sub(r"\.(urdf\.xacro|xacro)$", ".urdf", candidate, flags=re.IGNORECASE)


def _read_loaded_source(payload: dict) -> dict:
    loaded_source = payload.get("loadedSource")
    return loaded_source if isinstance(loaded_source, dict) else {}


def _resolve_local_asset_context(payload: dict, working_urdf_path: Path) -> _LocalAssetContext:
    loaded_source = _read_loaded_source(payload)
    if loaded_source.get("source") == "local-repo":
        raw_root = loaded_source.get("localPath")
        if not isinstance(raw_root, str) or not raw_root.strip():
            raise IluSessionError(status_code=404, detail="ilu session local repository is unavailable.")
        root_dir = Path(raw_root).expanduser()
        working_asset_path = _normalize_working_asset_path(
            loaded_source.get("repositoryUrdfPath") if isinstance(loaded_source.get("repositoryUrdfPath"), str) else None,
            working_urdf_path.name,
        )
    else:
        raw_local_path = loaded_source.get("localPath") or loaded_source.get("urdfPath")
        if not isinstance(raw_local_path, str) or not raw_local_path.strip():
            raise IluSessionError(status_code=404, detail="ilu session local source is unavailable.")
        local_path = Path(raw_local_path).expanduser()
        root_dir = local_path if local_path.is_dir() else local_path.parent
        working_asset_path = _normalize_working_asset_path(local_path.name, working_urdf_path.name)

    if not root_dir.exists() or not root_dir.is_dir():
        raise IluSessionError(
            status_code=404,
            detail=f"ilu session local asset root is missing: {root_dir}",
        )
    return _LocalAssetContext(
        root_dir=root_dir.resolve(),
        working_asset_path=working_asset_path,
    )


def get_ilu_session_local_urdf_source_context(
    session_id: str,
) -> IluSessionLocalUrdfSourceContext:
    payload = _read_session_payload(session_id)
    working_urdf_path = payload.get("workingUrdfPath")
    if not isinstance(working_urdf_path, str):
        raise IluSessionError(status_code=500, detail="ilu session metadata is incomplete.")

    working_file = Path(working_urdf_path).expanduser()
    local_context = _resolve_local_asset_context(payload, working_file)
    source_urdf_path = (local_context.root_dir / local_context.working_asset_path).resolve()
    if not source_urdf_path.exists() or not source_urdf_path.is_file():
        source_urdf_path = working_file.resolve()
    extra_search_roots = tuple(
        dict.fromkeys(
            path.resolve()
            for path in (
                local_context.root_dir,
                source_urdf_path.parent,
                working_file.parent,
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
