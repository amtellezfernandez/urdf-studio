from __future__ import annotations

import os
from pathlib import Path

SECONDS_PER_MINUTE = 60
PATH_LIST_SEPARATOR = os.pathsep
BYTES_PER_KIB = 1024
BYTES_PER_MIB = BYTES_PER_KIB * BYTES_PER_KIB

DATASET_MIX_SCRIPT_TIMEOUT_SEC = 5 * SECONDS_PER_MINUTE
DEFAULT_DATASET_MIX_ARCHIVE_MAX_ENTRY_COUNT = 2_000
DEFAULT_DATASET_MIX_ARCHIVE_MAX_ENTRY_BYTES = 64 * BYTES_PER_MIB
DEFAULT_DATASET_MIX_ARCHIVE_MAX_TOTAL_BYTES = 512 * BYTES_PER_MIB


def _read_int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _read_allowed_local_roots() -> tuple[Path, ...]:
    raw = os.getenv("URDF_DATASET_MIX_ALLOWED_LOCAL_ROOTS", "").strip()
    if not raw:
        return ()
    roots: list[Path] = []
    for entry in raw.split(PATH_LIST_SEPARATOR):
        normalized = entry.strip()
        if not normalized:
            continue
        roots.append(Path(normalized).expanduser().resolve(strict=False))
    return tuple(dict.fromkeys(roots))


def resolve_dataset_mix_local_path(path_value: str) -> Path:
    return Path(path_value).expanduser().resolve(strict=False)


def is_dataset_mix_local_path_allowed(path_value: str | Path) -> bool:
    if not DATASET_MIX_ALLOWED_LOCAL_ROOTS:
        return False
    resolved = path_value if isinstance(path_value, Path) else resolve_dataset_mix_local_path(path_value)
    return any(resolved == root or root in resolved.parents for root in DATASET_MIX_ALLOWED_LOCAL_ROOTS)


DATASET_MIX_ALLOWED_LOCAL_ROOTS = _read_allowed_local_roots()
DATASET_MIX_ARCHIVE_MAX_ENTRY_COUNT = _read_int_env(
    "URDF_DATASET_MIX_ARCHIVE_MAX_ENTRY_COUNT",
    DEFAULT_DATASET_MIX_ARCHIVE_MAX_ENTRY_COUNT,
)
DATASET_MIX_ARCHIVE_MAX_ENTRY_BYTES = _read_int_env(
    "URDF_DATASET_MIX_ARCHIVE_MAX_ENTRY_BYTES",
    DEFAULT_DATASET_MIX_ARCHIVE_MAX_ENTRY_BYTES,
)
DATASET_MIX_ARCHIVE_MAX_TOTAL_BYTES = _read_int_env(
    "URDF_DATASET_MIX_ARCHIVE_MAX_TOTAL_BYTES",
    DEFAULT_DATASET_MIX_ARCHIVE_MAX_TOTAL_BYTES,
)
