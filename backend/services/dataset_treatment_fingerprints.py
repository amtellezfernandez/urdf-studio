from __future__ import annotations

import re

from backend.models.datasets import DatasetContentSignature
from backend.services.dataset_treatments_params import (
    CONTENT_FINGERPRINT_HEX_LENGTH,
    CONTENT_FINGERPRINT_KIND_EPISODE_SERIES_V1,
)

HASH_OFFSET_BASIS = 0xCBF29CE484222325
HASH_PRIME = 0x100000001B3
HASH_MASK = 0xFFFFFFFFFFFFFFFF


def fingerprint_text(value: str) -> str:
    hash_value = HASH_OFFSET_BASIS
    for byte in value.encode("utf-8"):
        hash_value ^= byte
        hash_value = (hash_value * HASH_PRIME) & HASH_MASK
    return f"{hash_value:016x}"


def normalize_content_fingerprint(
    value: str | None,
    kind: str | None,
) -> str | None:
    if not isinstance(value, str):
        return None
    if kind != CONTENT_FINGERPRINT_KIND_EPISODE_SERIES_V1:
        return None
    normalized = value.strip().lower()
    if len(normalized) != CONTENT_FINGERPRINT_HEX_LENGTH:
        return None
    if any(character not in "0123456789abcdef" for character in normalized):
        return None
    return normalized


_NATURAL_SORT_PATTERN = re.compile(r"\d+|\D+")


def _natural_sort_key(value: str) -> tuple[object, ...]:
    parts: list[object] = []
    for token in _NATURAL_SORT_PATTERN.findall(value):
        if token.isdigit():
            parts.append(int(token))
        else:
            parts.append(token.lower())
    return tuple(parts)


def _normalize_number(value: float) -> str:
    if value != value or value in {float("inf"), float("-inf")}:
        return "0.0000"
    return f"{value:.4f}"


def compute_content_fingerprint_from_signature(
    signature: DatasetContentSignature | None,
) -> tuple[str | None, str | None]:
    if signature is None:
        return None, None
    if signature.kind != CONTENT_FINGERPRINT_KIND_EPISODE_SERIES_V1:
        return None, None

    def update_hash(current_hash: int, text: str) -> int:
        next_hash = current_hash
        for byte in text.encode("utf-8"):
            next_hash ^= byte
            next_hash = (next_hash * HASH_PRIME) & HASH_MASK
        return next_hash

    hash_value = HASH_OFFSET_BASIS
    sorted_episodes = sorted(signature.episodes, key=lambda episode: episode.episode_index)
    hash_value = update_hash(hash_value, f"episodes:{len(sorted_episodes)}")
    for episode_index, episode in enumerate(sorted_episodes):
        hash_value = update_hash(hash_value, f"episode:{episode_index}")
        hash_value = update_hash(hash_value, f"frames:{len(episode.frames)}")
        for frame_index, frame in enumerate(episode.frames):
            hash_value = update_hash(
                hash_value,
                f"t:{frame_index}:{_normalize_number(frame.timestamp)}",
            )
            for joint_name in sorted(frame.joints.keys(), key=_natural_sort_key):
                hash_value = update_hash(
                    hash_value,
                    f"j:{joint_name}:{_normalize_number(frame.joints.get(joint_name, 0.0))}",
                )

    return f"{hash_value:016x}", CONTENT_FINGERPRINT_KIND_EPISODE_SERIES_V1
