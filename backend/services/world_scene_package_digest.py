from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from backend.models.world_scene_package import WorldScenePackageManifest


def _expand_exponent_notation(number_text: str) -> str:
    sign = ""
    unsigned = number_text
    if unsigned.startswith("-"):
        sign = "-"
        unsigned = unsigned[1:]
    coefficient, exponent_text = unsigned.lower().split("e", 1)
    exponent = int(exponent_text)
    integer_part, _, fractional_part = coefficient.partition(".")
    digits = f"{integer_part}{fractional_part}".lstrip("0") or "0"
    decimal_position = len(integer_part) + exponent
    if decimal_position <= 0:
        expanded = f"0.{'0' * abs(decimal_position)}{digits}"
    elif decimal_position >= len(digits):
        expanded = f"{digits}{'0' * (decimal_position - len(digits))}"
    else:
        expanded = f"{digits[:decimal_position]}.{digits[decimal_position:]}"
    if "." in expanded:
        expanded = expanded.rstrip("0").rstrip(".")
    return f"{sign}{expanded}"


def _normalize_exponent_notation(number_text: str) -> str:
    if "e" not in number_text and "E" not in number_text:
        return number_text
    coefficient, exponent_text = number_text.lower().split("e", 1)
    exponent = int(exponent_text)
    sign = "+" if exponent >= 0 else "-"
    return f"{coefficient}e{sign}{abs(exponent)}"


def _canonical_json_number(value: int | float) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if not math.isfinite(value):
        raise ValueError("Cannot canonicalize a non-finite world scene package number.")
    if value == 0:
        return "0"
    magnitude = abs(value)
    number_text = repr(value)
    if value.is_integer() and magnitude < 1e21:
        return str(int(value))
    if 1e-6 <= magnitude < 1e21 and ("e" in number_text or "E" in number_text):
        return _expand_exponent_notation(number_text)
    return _normalize_exponent_notation(number_text)


def _canonical_json_dump(payload: Any) -> str:
    if payload is None:
        return "null"
    if isinstance(payload, bool):
        return "true" if payload else "false"
    if isinstance(payload, int | float):
        return _canonical_json_number(payload)
    if isinstance(payload, str):
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if isinstance(payload, list):
        return f"[{','.join(_canonical_json_dump(item) for item in payload)}]"
    if isinstance(payload, dict):
        fields = (
            (
                f"{json.dumps(key, ensure_ascii=False, separators=(',', ':'))}:"
                f"{_canonical_json_dump(payload[key])}"
            )
            for key in sorted(payload)
        )
        return f"{{{','.join(fields)}}}"
    raise TypeError(f"Cannot canonicalize {type(payload).__name__} in world scene package JSON.")


def canonical_world_scene_package_json(manifest: WorldScenePackageManifest) -> str:
    payload = manifest.model_dump(mode="json")
    return _canonical_json_dump(payload)


def world_scene_package_digest(manifest: WorldScenePackageManifest) -> str:
    canonical_json = canonical_world_scene_package_json(manifest)
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def canonical_world_snapshot_json(manifest: WorldScenePackageManifest) -> str:
    payload = manifest.world_snapshot.model_dump(mode="json")
    return _canonical_json_dump(payload)


def computed_world_snapshot_digest(manifest: WorldScenePackageManifest) -> str:
    canonical_json = canonical_world_snapshot_json(manifest)
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def declared_world_snapshot_digest(manifest: WorldScenePackageManifest) -> str | None:
    digests = declared_world_snapshot_digests(manifest)
    return digests[0] if digests else None


def declared_world_snapshot_digests(manifest: WorldScenePackageManifest) -> tuple[str, ...]:
    return tuple(
        artifact.digest_sha256.lower()
        for artifact in manifest.artifacts
        if artifact.kind == "world_snapshot"
    )


def validate_world_snapshot_artifact_digests(
    manifest: WorldScenePackageManifest,
) -> list[str]:
    declared_digests = declared_world_snapshot_digests(manifest)
    if not declared_digests:
        return []
    actual_digest = computed_world_snapshot_digest(manifest)
    return [
        f"artifacts[world_snapshot:{index}].digest_sha256 does not match world_snapshot."
        for index, digest in enumerate(declared_digests)
        if digest != actual_digest
    ]
