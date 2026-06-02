from __future__ import annotations

import os

TREATMENT_MANIFEST_VERSION = "v1"
TREATMENT_PROFILE_VERSION = "v1"

TREATMENT_PROFILE_SEMANTIC = "semantic-aligned"
TREATMENT_PROFILE_INDEXED = "indexed-joint-order"
TREATMENT_PROFILE_UNKNOWN = "unknown"

TREATMENT_ACTION_REQUIRES_MAPPING = "requires_mapping"
TREATMENT_ACTION_REQUIRES_NAMING_REVIEW = "requires_naming_review"
TREATMENT_ACTION_CANONICALIZE_LOCAL_PATH = "canonicalize_local_path"
TREATMENT_ACTION_CANONICALIZE_CONTENT_FINGERPRINT = "canonicalize_content_fingerprint"
TREATMENT_ACTION_REVIEW_DUPLICATES = "review_duplicate_sources"

TREATMENT_CODE_ALIGNMENT_ERROR = "alignment_error"
TREATMENT_CODE_ALIGNMENT_WARNING = "alignment_warning"
TREATMENT_CODE_DUPLICATE_SOURCE = "duplicate_source"
TREATMENT_CODE_UNNAMED_SOURCE = "unnamed_source"
TREATMENT_CODE_MIXED_REPRESENTATION = "mixed_representation"
TREATMENT_CODE_INVALID_CONTENT_FINGERPRINT = "invalid_content_fingerprint"

CONTENT_FINGERPRINT_KIND_EPISODE_SERIES_V1 = "episode-series-v1"
CONTENT_FINGERPRINT_HEX_LENGTH = 16

SECONDS_PER_MILLISECOND = 1000
DEFAULT_TREATMENT_RUST_TIMEOUT_MS = 1500


def _read_positive_int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


DATASET_TREATMENT_RUST_BIN = os.getenv("URDF_DATASET_TREATMENT_RUST_BIN", "").strip()
DATASET_TREATMENT_RUST_TIMEOUT_MS = _read_positive_int_env(
    "URDF_DATASET_TREATMENT_RUST_TIMEOUT_MS",
    DEFAULT_TREATMENT_RUST_TIMEOUT_MS,
)
