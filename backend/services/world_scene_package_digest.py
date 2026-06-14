from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from backend.models.world_scene_package import WorldScenePackageManifest


def _canonical_json_payload(value: Any) -> Any:
    if isinstance(value, float):
        if math.isfinite(value) and value.is_integer():
            return int(value)
        return value
    if isinstance(value, dict):
        return {key: _canonical_json_payload(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_canonical_json_payload(item) for item in value]
    return value


def _canonical_json_dump(payload: Any) -> str:
    return json.dumps(
        _canonical_json_payload(payload),
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


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
