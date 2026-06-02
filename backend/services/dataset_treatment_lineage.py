from __future__ import annotations

import json
import logging
import subprocess
from collections import Counter
from dataclasses import dataclass

from backend.services.dataset_treatment_fingerprints import (
    fingerprint_text,
    normalize_content_fingerprint,
)
from backend.services.dataset_treatments_params import (
    CONTENT_FINGERPRINT_KIND_EPISODE_SERIES_V1,
    DATASET_TREATMENT_RUST_BIN,
    DATASET_TREATMENT_RUST_TIMEOUT_MS,
)

logger = logging.getLogger("urdf.dataset_treatment_lineage")


@dataclass(frozen=True)
class DatasetSourceDuplicateCluster:
    source_id: str
    canonical_source: str
    canonical_fingerprint: str
    duplicate_group_id: str | None
    duplicate_group_size: int
    duplicate_match_kind: str | None


def _cluster_sources_python(
    sources: list[tuple[str, str, str | None]],
) -> list[DatasetSourceDuplicateCluster]:
    exact_counts = Counter(canonical_source for _source_id, canonical_source, _content_fingerprint in sources)
    normalized_by_source = {
        source_id: _normalize_source_key(canonical_source)
        for source_id, canonical_source, _content_fingerprint in sources
    }
    normalized_counts = Counter(normalized_by_source.values())
    content_fingerprint_by_source = {
        source_id: normalized_content_fingerprint
        for source_id, _canonical_source, content_fingerprint in sources
        if (
            normalized_content_fingerprint := normalize_content_fingerprint(
                content_fingerprint,
                CONTENT_FINGERPRINT_KIND_EPISODE_SERIES_V1,
            )
        )
    }
    content_fingerprint_counts = Counter(content_fingerprint_by_source.values())
    exact_duplicate_group_ids: dict[str, str] = {}
    normalized_duplicate_group_ids: dict[str, str] = {}
    content_duplicate_group_ids: dict[str, str] = {}
    clusters: list[DatasetSourceDuplicateCluster] = []
    for source_id, canonical_source, _content_fingerprint in sources:
        normalized_key = normalized_by_source[source_id]
        content_fingerprint = content_fingerprint_by_source.get(source_id)
        exact_count = exact_counts[canonical_source]
        normalized_count = normalized_counts[normalized_key]
        content_fingerprint_count = (
            content_fingerprint_counts[content_fingerprint]
            if content_fingerprint is not None
            else 0
        )
        duplicate_group_id = None
        duplicate_match_kind = None
        duplicate_group_size = 1
        canonical_fingerprint = (
            content_fingerprint
            if content_fingerprint is not None
            else fingerprint_text(normalized_key)
        )
        if content_fingerprint is not None:
            if content_fingerprint_count > 1:
                duplicate_group_id = content_duplicate_group_ids.setdefault(
                    content_fingerprint,
                    f"dup:content:{len(content_duplicate_group_ids)}",
                )
                duplicate_group_size = content_fingerprint_count
                duplicate_match_kind = "exact"
        elif exact_count > 1:
            duplicate_group_id = exact_duplicate_group_ids.setdefault(
                canonical_source,
                f"dup:exact:{len(exact_duplicate_group_ids)}",
            )
            duplicate_group_size = exact_count
            duplicate_match_kind = "exact"
        elif normalized_count > 1:
            duplicate_group_id = normalized_duplicate_group_ids.setdefault(
                normalized_key,
                f"dup:normalized:{len(normalized_duplicate_group_ids)}",
            )
            duplicate_group_size = normalized_count
            duplicate_match_kind = "normalized"
        clusters.append(
            DatasetSourceDuplicateCluster(
                source_id=source_id,
                canonical_source=canonical_source,
                canonical_fingerprint=canonical_fingerprint,
                duplicate_group_id=duplicate_group_id,
                duplicate_group_size=duplicate_group_size,
                duplicate_match_kind=duplicate_match_kind,
            )
        )
    return clusters


def _normalize_source_key(canonical_source: str) -> str:
    stripped = canonical_source.strip().replace("\\", "/")
    while "//" in stripped:
        stripped = stripped.replace("//", "/")
    stripped = stripped.rstrip("/")
    if stripped.startswith("/"):
        return stripped
    return stripped.lower()

def _parse_rust_clusters(payload: object) -> list[DatasetSourceDuplicateCluster]:
    if not isinstance(payload, list):
        raise ValueError("Rust lineage payload must be a list")
    clusters: list[DatasetSourceDuplicateCluster] = []
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError("Rust lineage cluster entry must be an object")
        source_id = item.get("source_id")
        canonical_source = item.get("canonical_source")
        canonical_fingerprint = item.get("canonical_fingerprint")
        duplicate_group_id = item.get("duplicate_group_id")
        duplicate_group_size = item.get("duplicate_group_size")
        duplicate_match_kind = item.get("duplicate_match_kind")
        if not isinstance(source_id, str) or not isinstance(canonical_source, str):
            raise ValueError("Rust lineage cluster entry is missing source identity")
        if not isinstance(canonical_fingerprint, str) or not canonical_fingerprint:
            raise ValueError("Rust lineage cluster entry is missing canonical fingerprint")
        if duplicate_group_id is not None and not isinstance(duplicate_group_id, str):
            raise ValueError("Rust lineage duplicate group id must be a string or null")
        if not isinstance(duplicate_group_size, int) or duplicate_group_size < 1:
            raise ValueError("Rust lineage duplicate group size must be a positive integer")
        if duplicate_match_kind is not None and duplicate_match_kind not in {"exact", "normalized"}:
            raise ValueError("Rust lineage duplicate match kind must be exact, normalized, or null")
        clusters.append(
            DatasetSourceDuplicateCluster(
                source_id=source_id,
                canonical_source=canonical_source,
                canonical_fingerprint=canonical_fingerprint,
                duplicate_group_id=duplicate_group_id,
                duplicate_group_size=duplicate_group_size,
                duplicate_match_kind=duplicate_match_kind,
            )
        )
    return clusters


def _cluster_sources_rust(
    sources: list[tuple[str, str, str | None]],
) -> list[DatasetSourceDuplicateCluster] | None:
    if not DATASET_TREATMENT_RUST_BIN:
        return None

    payload = [
        {
            "source_id": source_id,
            "canonical_source": canonical_source,
            "content_fingerprint": content_fingerprint,
        }
        for source_id, canonical_source, content_fingerprint in sources
    ]
    try:
        result = subprocess.run(
            [DATASET_TREATMENT_RUST_BIN],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=DATASET_TREATMENT_RUST_TIMEOUT_MS / 1000,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("Rust lineage accelerator unavailable: %s", exc)
        return None

    if result.returncode != 0:
        logger.warning("Rust lineage accelerator failed: %s", result.stderr.strip())
        return None

    try:
        parsed = json.loads(result.stdout)
        return _parse_rust_clusters(parsed)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("Rust lineage accelerator returned invalid payload: %s", exc)
        return None


def cluster_dataset_sources(
    sources: list[tuple[str, str, str | None]],
) -> list[DatasetSourceDuplicateCluster]:
    rust_clusters = _cluster_sources_rust(sources)
    if rust_clusters is not None:
        return rust_clusters
    return _cluster_sources_python(sources)
