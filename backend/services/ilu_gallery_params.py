from __future__ import annotations

import math
import os
from pathlib import Path

from backend.core.paths import BASE_DIR

DEFAULT_GALLERY_JOB_RETENTION_LIMIT = 16
DEFAULT_GALLERY_INSPECT_CACHE_RETENTION_LIMIT = 32
DEFAULT_GALLERY_JOB_ROOT = BASE_DIR / ".cache" / "ilu-gallery-jobs"
DEFAULT_ILU_GALLERY_TIMEOUT_SECONDS = 300.0
DEFAULT_ILU_GALLERY_GENERATE_TIMEOUT_SECONDS = 900.0
DEFAULT_GALLERY_MANIFEST_TIMEOUT_SECONDS = 15.0
DEFAULT_GALLERY_MANIFEST_CACHE_TTL_SECONDS = 120.0
DEFAULT_GALLERY_INSPECT_CACHE_TTL_SECONDS = 60.0
DEFAULT_GALLERY_RESOLVE_ROBOT_TRAITS_DURING_INSPECTION = False
DEFAULT_GALLERY_RENDER_BATCH_SIZE = 1
DEFAULT_GALLERY_RENDER_ASSET_BATCH_SIZE = 1
DEFAULT_GALLERY_GENERATE_MAX_CONCURRENCY = 1


def _read_raw_env(name: str) -> str | None:
    raw = os.getenv(name)
    return raw if isinstance(raw, str) else None


def _read_path_env(name: str, default: Path) -> Path:
    raw = (_read_raw_env(name) or "").strip()
    if not raw:
        return default
    return Path(raw).expanduser().resolve(strict=False)


def _read_positive_float_env(name: str, default: float) -> float:
    raw = (_read_raw_env(name) or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    if not math.isfinite(value):
        return default
    return value if value > 0 else default


def _read_positive_int_env(name: str, default: int) -> int:
    raw = (_read_raw_env(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _read_bool_env(name: str, default: bool) -> bool:
    raw = (_read_raw_env(name) or "").strip().lower()
    if not raw:
        return default
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return default


GALLERY_JOB_RETENTION_LIMIT = _read_positive_int_env(
    "URDF_GALLERY_JOB_RETENTION_LIMIT",
    DEFAULT_GALLERY_JOB_RETENTION_LIMIT,
)
GALLERY_INSPECT_CACHE_RETENTION_LIMIT = _read_positive_int_env(
    "URDF_GALLERY_INSPECT_CACHE_RETENTION_LIMIT",
    DEFAULT_GALLERY_INSPECT_CACHE_RETENTION_LIMIT,
)
GALLERY_JOB_ROOT = _read_path_env(
    "URDF_GALLERY_JOB_ROOT",
    DEFAULT_GALLERY_JOB_ROOT,
)
ILU_GALLERY_TIMEOUT_SECONDS = _read_positive_float_env(
    "URDF_ILU_GALLERY_TIMEOUT_SECONDS",
    DEFAULT_ILU_GALLERY_TIMEOUT_SECONDS,
)
ILU_GALLERY_GENERATE_TIMEOUT_SECONDS = _read_positive_float_env(
    "URDF_ILU_GALLERY_GENERATE_TIMEOUT_SECONDS",
    DEFAULT_ILU_GALLERY_GENERATE_TIMEOUT_SECONDS,
)
GALLERY_MANIFEST_TIMEOUT_SECONDS = _read_positive_float_env(
    "URDF_GALLERY_MANIFEST_TIMEOUT_SECONDS",
    DEFAULT_GALLERY_MANIFEST_TIMEOUT_SECONDS,
)
GALLERY_MANIFEST_CACHE_TTL_SECONDS = _read_positive_float_env(
    "URDF_GALLERY_MANIFEST_CACHE_TTL_SECONDS",
    DEFAULT_GALLERY_MANIFEST_CACHE_TTL_SECONDS,
)
GALLERY_INSPECT_CACHE_TTL_SECONDS = _read_positive_float_env(
    "URDF_GALLERY_INSPECT_CACHE_TTL_SECONDS",
    DEFAULT_GALLERY_INSPECT_CACHE_TTL_SECONDS,
)
GALLERY_RESOLVE_ROBOT_TRAITS_DURING_INSPECTION = _read_bool_env(
    "URDF_GALLERY_RESOLVE_ROBOT_TRAITS_DURING_INSPECTION",
    DEFAULT_GALLERY_RESOLVE_ROBOT_TRAITS_DURING_INSPECTION,
)
GALLERY_RENDER_BATCH_SIZE = _read_positive_int_env(
    "URDF_GALLERY_RENDER_BATCH_SIZE",
    DEFAULT_GALLERY_RENDER_BATCH_SIZE,
)
GALLERY_RENDER_ASSET_BATCH_SIZE = _read_positive_int_env(
    "URDF_GALLERY_RENDER_ASSET_BATCH_SIZE",
    DEFAULT_GALLERY_RENDER_ASSET_BATCH_SIZE,
)
GALLERY_GENERATE_MAX_CONCURRENCY = _read_positive_int_env(
    "URDF_GALLERY_GENERATE_MAX_CONCURRENCY",
    DEFAULT_GALLERY_GENERATE_MAX_CONCURRENCY,
)
