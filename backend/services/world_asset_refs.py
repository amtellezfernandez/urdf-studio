from __future__ import annotations

PORTABLE_WORLD_ASSET_REF_ERROR = "must be a portable relative asset reference"


def normalize_portable_world_asset_ref(value: str) -> str:
    normalized = value.replace("\\", "/").strip()
    while normalized.startswith("./"):
        normalized = normalized[2:]
    if (
        not normalized
        or normalized in {".", ".."}
        or normalized.startswith("/")
        or normalized.startswith("../")
        or "/../" in f"/{normalized}/"
        or ":" in normalized
    ):
        raise ValueError(PORTABLE_WORLD_ASSET_REF_ERROR)
    return normalized
