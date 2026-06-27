from __future__ import annotations

import re
import shutil
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path, PurePosixPath

from backend.services.teleop_replay_params import TELEOP_REPLAY_OUTPUT_ROOT

LOCAL_DATASET_EXPORT_OUTPUT_ROOT = TELEOP_REPLAY_OUTPUT_ROOT
LOCAL_DATASET_EXPORT_MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
LEROBOT_META_DIRNAME = "meta"
LEROBOT_DATA_DIRNAME = "data"
LEROBOT_INFO_FILENAME = "info.json"
SAFE_DATASET_NAME_PATTERN = re.compile(r"[^A-Za-z0-9_.-]+")


class DatasetLocalExportError(ValueError):
    pass


@dataclass(frozen=True)
class DatasetLocalExportResult:
    dataset_path: Path
    dataset_name: str
    file_count: int


def sanitize_local_dataset_name(value: str | None) -> str:
    normalized = SAFE_DATASET_NAME_PATTERN.sub("-", (value or "").strip()).strip(".-")
    return normalized or "studio-recorded-v3"


def _normalize_zip_path(name: str) -> PurePosixPath | None:
    path = PurePosixPath(name)
    if path.is_absolute():
        raise DatasetLocalExportError("Dataset archive contains an absolute path.")
    parts = path.parts
    if not parts:
        return None
    if any(part in {"", ".", ".."} for part in parts):
        raise DatasetLocalExportError("Dataset archive contains an unsafe path.")
    return path


def _find_lerobot_dataset_root(paths: list[PurePosixPath]) -> tuple[str, ...]:
    roots: set[tuple[str, ...]] = set()
    path_parts = [path.parts for path in paths]
    for parts in path_parts:
        if len(parts) < 2:
            continue
        if parts[-2:] != (LEROBOT_META_DIRNAME, LEROBOT_INFO_FILENAME):
            continue
        candidate_root = parts[:-2]
        has_data_file = any(
            other_parts[: len(candidate_root)] == candidate_root
            and len(other_parts) > len(candidate_root)
            and other_parts[len(candidate_root)] == LEROBOT_DATA_DIRNAME
            for other_parts in path_parts
        )
        if has_data_file:
            roots.add(candidate_root)

    if not roots:
        raise DatasetLocalExportError("Archive does not contain a LeRobot dataset root.")
    if len(roots) > 1:
        raise DatasetLocalExportError("Archive contains multiple LeRobot dataset roots.")
    return next(iter(roots))


def _relative_to_root(path: PurePosixPath, root_parts: tuple[str, ...]) -> Path | None:
    parts = path.parts
    if root_parts:
        if parts[: len(root_parts)] != root_parts:
            return None
        relative_parts = parts[len(root_parts) :]
    else:
        relative_parts = parts
    if not relative_parts:
        return None
    return Path(*relative_parts)


def extract_lerobot_archive_for_ops(
    archive_bytes: bytes,
    *,
    dataset_name: str | None,
    output_root: Path = LOCAL_DATASET_EXPORT_OUTPUT_ROOT,
) -> DatasetLocalExportResult:
    if len(archive_bytes) > LOCAL_DATASET_EXPORT_MAX_ARCHIVE_BYTES:
        raise DatasetLocalExportError("Dataset archive is too large.")

    output_root = output_root.expanduser().resolve(strict=False)
    target_name = sanitize_local_dataset_name(dataset_name)
    target_dir = (output_root / target_name).resolve(strict=False)
    if output_root != target_dir and output_root not in target_dir.parents:
        raise DatasetLocalExportError("Dataset export target escaped the output root.")

    try:
        archive = zipfile.ZipFile(BytesIO(archive_bytes))
    except zipfile.BadZipFile as exc:
        raise DatasetLocalExportError("Dataset archive is not a valid zip file.") from exc

    with archive:
        file_entries = [
            (info, normalized)
            for info in archive.infolist()
            if not info.is_dir()
            if (normalized := _normalize_zip_path(info.filename)) is not None
        ]
        paths = [path for _, path in file_entries]
        dataset_root = _find_lerobot_dataset_root(paths)

        if target_dir.exists():
            shutil.rmtree(target_dir)
        target_dir.mkdir(parents=True, exist_ok=True)

        extracted_count = 0
        for info, path in file_entries:
            relative_path = _relative_to_root(path, dataset_root)
            if relative_path is None:
                continue
            destination = (target_dir / relative_path).resolve(strict=False)
            if target_dir != destination and target_dir not in destination.parents:
                raise DatasetLocalExportError("Dataset archive contains an unsafe path.")
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source, destination.open("wb") as target:
                shutil.copyfileobj(source, target)
            extracted_count += 1

    if not (target_dir / LEROBOT_META_DIRNAME / LEROBOT_INFO_FILENAME).is_file():
        raise DatasetLocalExportError("Extracted dataset is missing meta/info.json.")
    if not (target_dir / LEROBOT_DATA_DIRNAME).is_dir():
        raise DatasetLocalExportError("Extracted dataset is missing data files.")

    return DatasetLocalExportResult(
        dataset_path=target_dir,
        dataset_name=target_name,
        file_count=extracted_count,
    )
