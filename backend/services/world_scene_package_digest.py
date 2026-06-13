from __future__ import annotations

import hashlib
import json

from backend.models.world_scene_package import WorldScenePackageManifest


def canonical_world_scene_package_json(manifest: WorldScenePackageManifest) -> str:
    payload = manifest.model_dump(mode="json")
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def world_scene_package_digest(manifest: WorldScenePackageManifest) -> str:
    canonical_json = canonical_world_scene_package_json(manifest)
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def canonical_world_snapshot_json(manifest: WorldScenePackageManifest) -> str:
    payload = manifest.world_snapshot.model_dump(mode="json")
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def computed_world_snapshot_digest(manifest: WorldScenePackageManifest) -> str:
    canonical_json = canonical_world_snapshot_json(manifest)
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def declared_world_snapshot_digest(manifest: WorldScenePackageManifest) -> str | None:
    for artifact in manifest.artifacts:
        if artifact.kind == "world_snapshot":
            return artifact.digest_sha256.lower()
    return None
