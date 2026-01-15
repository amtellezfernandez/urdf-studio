from __future__ import annotations

import base64
import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import HTTPException

from backend.core.app_config import get_config_value, read_app_config
from backend.models.samples import SampleEntry, SampleFile, SampleFilesResponse


@dataclass(frozen=True)
class SampleDefinition:
    id: str
    label: str
    repo_path: str
    urdf_path: str


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
        if not repo_path or not urdf_path:
            continue
        definitions[sample_id] = SampleDefinition(
            id=sample_id,
            label=label,
            repo_path=repo_path,
            urdf_path=urdf_path,
        )
    return quickstart_id, definitions


def list_samples() -> tuple[Optional[str], List[SampleEntry]]:
    quickstart_id, definitions = _load_samples_config()
    entries = [
        SampleEntry(id=sample.id, label=sample.label, urdf_path=sample.urdf_path)
        for sample in definitions.values()
    ]
    return quickstart_id, entries


def _resolve_sample_path(sample: SampleDefinition) -> tuple[Path, Path]:
    repo_root = Path(__file__).resolve().parents[2]
    repo_path = repo_root / sample.repo_path
    urdf_path = repo_path / sample.urdf_path
    if not repo_path.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                f"Sample repo not found at {repo_path}. "
                "Run `git submodule update --init --recursive` to fetch it."
            ),
        )
    if not urdf_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"URDF not found at {urdf_path}. Check samples config.",
        )
    return repo_path, urdf_path


def _collect_mesh_files(urdf_path: Path) -> List[Path]:
    urdf_dir = urdf_path.parent
    mesh_files: List[Path] = []
    seen: set[Path] = set()
    for pattern in ("*.stl", "*.STL"):
        for path in urdf_dir.rglob(pattern):
            if path not in seen:
                seen.add(path)
                mesh_files.append(path)
    return mesh_files


def _encode_file(path: Path, repo_root: Path) -> SampleFile:
    try:
        relative_path = path.relative_to(repo_root).as_posix()
    except ValueError:
        relative_path = path.name
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

    for mesh in _collect_mesh_files(urdf_path):
        files.append(_encode_file(mesh, repo_root))

    return SampleFilesResponse(
        id=sample.id,
        label=sample.label,
        urdf_path=sample.urdf_path,
        files=files,
    )
