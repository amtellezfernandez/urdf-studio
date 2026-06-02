from __future__ import annotations

import base64
import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import HTTPException

from backend.core.app_config import get_config_value, read_app_config
from backend.models.samples import SampleEntry, SampleFile, SampleFilesResponse

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_ALLOWED_ROOT_NAME = "third_party"
SAMPLE_ALLOWED_ROOT = REPO_ROOT / SAMPLE_ALLOWED_ROOT_NAME


@dataclass(frozen=True)
class SampleDefinition:
    id: str
    label: str
    repo_path: str
    urdf_path: str


def _normalize_relative_config_path(raw_path: object) -> str | None:
    if not isinstance(raw_path, str):
        return None
    normalized = raw_path.strip()
    if not normalized:
        return None
    path = Path(normalized)
    if path.is_absolute() or ".." in path.parts:
        return None
    return path.as_posix()


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _resolve_config_path(root: Path, raw_path: str, *, field_name: str) -> Path:
    normalized = _normalize_relative_config_path(raw_path)
    if normalized is None:
        raise HTTPException(status_code=400, detail=f"Invalid sample {field_name} configuration.")
    resolved_root = root.resolve()
    resolved_path = (resolved_root / normalized).resolve()
    if not _is_relative_to(resolved_path, resolved_root):
        raise HTTPException(status_code=400, detail=f"Invalid sample {field_name} configuration.")
    return resolved_path


def _is_safe_sample_definition(repo_path: object, urdf_path: object) -> tuple[str, str] | None:
    normalized_repo_path = _normalize_relative_config_path(repo_path)
    normalized_urdf_path = _normalize_relative_config_path(urdf_path)
    if normalized_repo_path is None or normalized_urdf_path is None:
        return None
    if Path(normalized_repo_path).parts[:1] != (SAMPLE_ALLOWED_ROOT_NAME,):
        return None
    return normalized_repo_path, normalized_urdf_path


def _load_samples_config() -> tuple[Optional[str], Dict[str, SampleDefinition]]:
    config = read_app_config()
    quickstart_id = get_config_value(config, ["samples", "quickStartId"], None)
    items = get_config_value(config, ["samples", "items"], {})
    if not isinstance(items, dict):
        items = {}
    definitions: Dict[str, SampleDefinition] = {}
    for sample_id, payload in items.items():
        if not isinstance(payload, dict):
            continue
        label = payload.get("label") or sample_id
        repo_path = payload.get("repoPath")
        urdf_path = payload.get("urdfPath")
        safe_paths = _is_safe_sample_definition(repo_path, urdf_path)
        if safe_paths is None:
            continue
        repo_path, urdf_path = safe_paths
        definitions[sample_id] = SampleDefinition(
            id=sample_id,
            label=label,
            repo_path=repo_path,
            urdf_path=urdf_path,
        )
    resolved_quickstart_id = (
        quickstart_id if isinstance(quickstart_id, str) and quickstart_id in definitions else None
    )
    return resolved_quickstart_id, definitions


def list_samples() -> tuple[Optional[str], List[SampleEntry]]:
    quickstart_id, definitions = _load_samples_config()
    entries = [
        SampleEntry(id=sample.id, label=sample.label, urdf_path=sample.urdf_path)
        for sample in definitions.values()
    ]
    return quickstart_id, entries


def _resolve_sample_path(sample: SampleDefinition) -> tuple[Path, Path]:
    repo_path = _resolve_config_path(REPO_ROOT, sample.repo_path, field_name="repoPath")
    allowed_sample_root = SAMPLE_ALLOWED_ROOT.resolve()
    if not _is_relative_to(repo_path, allowed_sample_root):
        raise HTTPException(status_code=400, detail="Sample repo is outside the allowed sample root.")

    urdf_path = _resolve_config_path(repo_path, sample.urdf_path, field_name="urdfPath")
    if not _is_relative_to(urdf_path, repo_path):
        raise HTTPException(status_code=400, detail="Sample URDF is outside the configured sample repo.")

    if not repo_path.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                "Sample repo not found. Run `git submodule update --init --recursive` to fetch it."
            ),
        )
    if not urdf_path.exists():
        raise HTTPException(
            status_code=404,
            detail="URDF not found. Check samples config.",
        )
    return repo_path, urdf_path


def _is_safe_sample_file(path: Path, resolved_repo_root: Path) -> bool:
    return path.is_file() and _is_relative_to(path.resolve(), resolved_repo_root)


def _collect_mesh_files(urdf_path: Path, repo_root: Path) -> List[Path]:
    urdf_dir = urdf_path.parent
    resolved_repo_root = repo_root.resolve()
    mesh_files: List[Path] = []
    seen: set[Path] = set()
    for pattern in ("*.stl", "*.STL"):
        for path in urdf_dir.rglob(pattern):
            if path in seen or not _is_safe_sample_file(path, resolved_repo_root):
                continue
            seen.add(path)
            mesh_files.append(path)
    return mesh_files


def _encode_file(path: Path, repo_root: Path) -> SampleFile:
    relative_path = path.relative_to(repo_root).as_posix()
    mime, _ = mimetypes.guess_type(path.as_posix())
    mime = mime or "application/octet-stream"
    content_base64 = base64.b64encode(path.read_bytes()).decode("ascii")
    return SampleFile(path=relative_path, content_base64=content_base64, mime=mime)


def load_sample_files(sample_id: str) -> SampleFilesResponse:
    _, definitions = _load_samples_config()
    sample = definitions.get(sample_id)
    if not sample:
        raise HTTPException(status_code=404, detail=f"Sample '{sample_id}' not configured.")

    repo_root, urdf_path = _resolve_sample_path(sample)
    files: List[SampleFile] = []
    files.append(_encode_file(urdf_path, repo_root))

    for mesh in _collect_mesh_files(urdf_path, repo_root):
        files.append(_encode_file(mesh, repo_root))

    return SampleFilesResponse(
        id=sample.id,
        label=sample.label,
        urdf_path=sample.urdf_path,
        files=files,
    )
