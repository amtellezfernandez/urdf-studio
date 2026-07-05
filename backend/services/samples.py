from __future__ import annotations

import base64
import mimetypes
import xml.etree.ElementTree as ET
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException

from backend.core.app_config import get_config_value, read_app_config
from backend.models.samples import SampleEntry, SampleFile, SampleFilesResponse

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_ALLOWED_ROOT_NAMES = ("third_party", "web/public/demo")


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


def _allowed_root_parts() -> tuple[tuple[str, ...], ...]:
    return tuple(Path(root_name).parts for root_name in SAMPLE_ALLOWED_ROOT_NAMES)


def _allowed_roots() -> tuple[Path, ...]:
    return tuple((REPO_ROOT / root_name).resolve() for root_name in SAMPLE_ALLOWED_ROOT_NAMES)


def _is_under_allowed_root(raw_path: str) -> bool:
    path_parts = Path(raw_path).parts
    return any(path_parts[: len(root_parts)] == root_parts for root_parts in _allowed_root_parts())


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
    if not _is_under_allowed_root(normalized_repo_path):
        return None
    return normalized_repo_path, normalized_urdf_path


def _normalize_sample_label(value: object, default_label: str) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else default_label


def _normalize_sample_id(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _load_samples_config() -> tuple[str | None, dict[str, SampleDefinition]]:
    config = read_app_config()
    quickstart_id = _normalize_sample_id(get_config_value(config, ["samples", "quickStartId"], None))
    raw_sample_configs = get_config_value(config, ["samples", "items"], {})
    if not isinstance(raw_sample_configs, Mapping):
        raw_sample_configs = {}
    definitions: dict[str, SampleDefinition] = {}
    for sample_id, sample_config in raw_sample_configs.items():
        if not isinstance(sample_id, str) or not sample_id:
            continue
        if not isinstance(sample_config, Mapping):
            continue
        label = _normalize_sample_label(sample_config.get("label"), sample_id)
        repo_path = sample_config.get("repoPath")
        urdf_path = sample_config.get("urdfPath")
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
        quickstart_id if quickstart_id in definitions else None
    )
    return resolved_quickstart_id, definitions


def list_samples() -> tuple[str | None, list[SampleEntry]]:
    quickstart_id, definitions = _load_samples_config()
    entries = [
        SampleEntry(id=sample.id, label=sample.label, urdf_path=sample.urdf_path)
        for sample in definitions.values()
    ]
    return quickstart_id, entries


def _resolve_sample_path(sample: SampleDefinition) -> tuple[Path, Path]:
    repo_path = _resolve_config_path(REPO_ROOT, sample.repo_path, field_name="repoPath")
    if not any(_is_relative_to(repo_path, root) for root in _allowed_roots()):
        raise HTTPException(status_code=400, detail="Sample source is outside the allowed sample roots.")

    urdf_path = _resolve_config_path(repo_path, sample.urdf_path, field_name="urdfPath")
    if not _is_relative_to(urdf_path, repo_path):
        raise HTTPException(status_code=400, detail="Sample URDF is outside the configured sample repo.")

    if not repo_path.exists():
        raise HTTPException(
            status_code=404,
            detail="Sample source not found. Run `npm run setup` or check samples config.",
        )
    if not urdf_path.exists():
        raise HTTPException(
            status_code=404,
            detail="URDF not found. Check samples config.",
        )
    return repo_path, urdf_path


def _is_safe_sample_file(path: Path, resolved_repo_root: Path) -> bool:
    return path.is_file() and _is_relative_to(path.resolve(), resolved_repo_root)


def _normalize_mesh_reference(filename: str) -> str | None:
    normalized = filename.strip().replace("\\", "/")
    if not normalized:
        return None
    if normalized.startswith(("http://", "https://", "data:", "file://")):
        return None
    if normalized.startswith("package://"):
        package_path = normalized.removeprefix("package://").lstrip("/")
        if not package_path:
            return None
        parts = package_path.split("/", 1)
        return parts[1] if len(parts) == 2 else parts[0]
    return normalized.lstrip("/")


def _resolve_mesh_reference(filename: str, urdf_dir: Path, repo_root: Path) -> Path | None:
    normalized = _normalize_mesh_reference(filename)
    if normalized is None:
        return None
    candidate = urdf_dir / normalized
    resolved_repo_root = repo_root.resolve()
    if _is_safe_sample_file(candidate, resolved_repo_root):
        return candidate.resolve()
    package_candidate = repo_root / normalized
    if _is_safe_sample_file(package_candidate, resolved_repo_root):
        return package_candidate.resolve()
    return None


def _collect_mesh_files(urdf_path: Path, repo_root: Path) -> list[Path]:
    urdf_dir = urdf_path.parent
    mesh_files: list[Path] = []
    seen: set[Path] = set()
    try:
        root = ET.parse(urdf_path).getroot()
    except ET.ParseError:
        return mesh_files
    for mesh_node in root.iter("mesh"):
        filename = mesh_node.attrib.get("filename")
        if not filename:
            continue
        path = _resolve_mesh_reference(filename, urdf_dir, repo_root)
        if path is None or path in seen:
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
    files: list[SampleFile] = []
    files.append(_encode_file(urdf_path, repo_root))

    for mesh_path in _collect_mesh_files(urdf_path, repo_root):
        files.append(_encode_file(mesh_path, repo_root))

    return SampleFilesResponse(
        id=sample.id,
        label=sample.label,
        urdf_path=sample.urdf_path,
        files=files,
    )
