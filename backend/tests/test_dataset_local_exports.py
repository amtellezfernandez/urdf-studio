from __future__ import annotations

from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pytest

from backend.services.dataset_local_exports import (
    DatasetLocalExportError,
    extract_lerobot_archive_for_ops,
)


def _build_archive(entries: dict[str, bytes]) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        for path, content in entries.items():
            archive.writestr(path, content)
    return buffer.getvalue()


def test_extract_lerobot_archive_for_ops_writes_single_dataset_root(tmp_path: Path) -> None:
    archive = _build_archive(
        {
            "studio_recorded_v3/meta/info.json": b'{"total_episodes": 2}',
            "studio_recorded_v3/meta/tasks.parquet": b"PAR1tasks",
            "studio_recorded_v3/meta/episodes/chunk-000/file-000.parquet": b"PAR1episodes",
            "studio_recorded_v3/data/chunk-000/file-000.parquet": b"PAR1data",
        }
    )

    result = extract_lerobot_archive_for_ops(
        archive,
        dataset_name="SO101 recorded v3",
        output_root=tmp_path,
    )

    assert result.dataset_name == "SO101-recorded-v3"
    assert result.dataset_path == tmp_path / "SO101-recorded-v3"
    assert result.file_count == 4
    assert (result.dataset_path / "meta" / "info.json").read_bytes() == b'{"total_episodes": 2}'
    assert (result.dataset_path / "data" / "chunk-000" / "file-000.parquet").read_bytes() == b"PAR1data"


def test_extract_lerobot_archive_for_ops_rejects_unsafe_paths(tmp_path: Path) -> None:
    archive = _build_archive(
        {
            "studio_recorded_v3/meta/info.json": b"{}",
            "studio_recorded_v3/data/chunk-000/file-000.parquet": b"PAR1data",
            "../escape.txt": b"nope",
        }
    )

    with pytest.raises(DatasetLocalExportError, match="unsafe path"):
        extract_lerobot_archive_for_ops(
            archive,
            dataset_name="studio-recorded-v3",
            output_root=tmp_path,
        )
