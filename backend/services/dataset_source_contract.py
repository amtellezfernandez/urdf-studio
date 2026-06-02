from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Sequence

from fastapi import HTTPException

from backend.services.datasets_params import (
    DATASET_MIX_ALLOWED_LOCAL_ROOTS,
    is_dataset_mix_local_path_allowed,
    resolve_dataset_mix_local_path,
)


LOCAL_DATASET_PATHS_DISABLED_DETAIL = (
    "Local dataset paths are disabled. Configure URDF_DATASET_MIX_ALLOWED_LOCAL_ROOTS "
    "on the backend to allow specific roots."
)


@dataclass(frozen=True, slots=True)
class DatasetSourceContract:
    source_kind: Literal["repo", "local"]
    source_value: str
    canonical_source: str


def normalize_local_dataset_paths(
    local_paths: Sequence[str],
    *,
    allowed_roots: Sequence[Path] | None = None,
    path_resolver: Callable[[str], Path] | None = None,
    path_allowed: Callable[[str | Path], bool] | None = None,
) -> list[str]:
    if not local_paths:
        return []
    resolved_allowed_roots = (
        DATASET_MIX_ALLOWED_LOCAL_ROOTS if allowed_roots is None else allowed_roots
    )
    resolved_path_resolver = path_resolver or resolve_dataset_mix_local_path
    resolved_path_allowed = path_allowed or is_dataset_mix_local_path_allowed

    if not resolved_allowed_roots:
        raise HTTPException(status_code=403, detail=LOCAL_DATASET_PATHS_DISABLED_DETAIL)

    normalized_paths: list[str] = []
    for local_path in local_paths:
        resolved_path = resolved_path_resolver(local_path)
        if not resolved_path_allowed(resolved_path):
            raise HTTPException(
                status_code=403,
                detail=f"Local dataset path is outside configured allowlisted roots: {local_path}",
            )
        normalized_paths.append(str(resolved_path))
    return normalized_paths


def resolve_dataset_source_contract(
    *,
    source: str,
    repo_id: str | None,
    local_path: str | None,
) -> DatasetSourceContract:
    normalized_source = source.strip().lower()
    normalized_repo_id = (repo_id or "").strip()
    normalized_local_path = (local_path or "").strip()

    if normalized_source == "huggingface":
        if not normalized_repo_id:
            raise ValueError("Hugging Face training datasets require a repo ID.")
        return DatasetSourceContract(
            source_kind="repo",
            source_value=normalized_repo_id,
            canonical_source=normalized_repo_id,
        )

    if normalized_source == "local":
        if not normalized_local_path:
            raise ValueError("Local training datasets require a dataset directory.")
        normalized_paths = normalize_local_dataset_paths([normalized_local_path])
        return DatasetSourceContract(
            source_kind="local",
            source_value=normalized_local_path,
            canonical_source=normalized_paths[0],
        )

    raise ValueError(f"Unsupported dataset source: {source}")
