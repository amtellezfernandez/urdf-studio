from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Dict, List, Sequence

from pydantic import ValidationError

from backend.core.settings import settings
from backend.models.world_scene_package import (
    WorldRegistryCapabilitiesResponse,
    WorldScenePackageListEntry,
    WorldScenePackageManifest,
    WorldScenePackagePublishResponse,
    WorldScenePackageValidationResponse,
    WorldScenePackageVersionRecord,
)
from backend.services.world_scene_package_params import (
    MAX_WORLD_SCENE_PACKAGE_MANIFEST_BYTES,
    REGISTRY_FILE_VERSION,
    WORLD_SCENE_PACKAGE_TRUST_METADATA_COMPLETE,
    WORLD_SCENE_PACKAGE_TRUST_METADATA_ONLY,
    WORLD_SCENE_PACKAGE_TRUST_SIGNED_METADATA,
    WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1,
)
from backend.services.world_scene_package_digest import (
    canonical_world_scene_package_json,
    validate_world_snapshot_artifact_digests,
    world_scene_package_digest,
)
from backend.services.world_asset_refs import (
    normalize_portable_world_asset_ref,
    read_world_object_asset_ref,
)

logger = logging.getLogger("urdf.world_registry")


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_parent(path: Path) -> None:
    if path.parent and not path.parent.exists():
        path.parent.mkdir(parents=True, exist_ok=True)


def _resolve_trust_level(manifest: WorldScenePackageManifest) -> str:
    has_signature = bool(manifest.security.signature_ref)
    has_attestation = len(manifest.security.attestation_refs) > 0
    has_sbom = bool(manifest.security.sbom_ref)
    if has_signature and has_attestation and has_sbom:
        return WORLD_SCENE_PACKAGE_TRUST_METADATA_COMPLETE
    if has_signature:
        return WORLD_SCENE_PACKAGE_TRUST_SIGNED_METADATA
    return WORLD_SCENE_PACKAGE_TRUST_METADATA_ONLY


def _runtime_targets_summary(manifest: WorldScenePackageManifest) -> list[str]:
    return [f"{target.name}:{target.mode}" for target in manifest.runtime_targets]


def _normalize_optional_string(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _extract_owner(manifest: WorldScenePackageManifest) -> str | None:
    return _normalize_optional_string(manifest.provenance.get("owner"))


def _extract_tags(manifest: WorldScenePackageManifest) -> list[str]:
    raw = manifest.provenance.get("tags")
    if not isinstance(raw, list):
        return []
    tags: list[str] = []
    for value in raw:
        normalized = _normalize_optional_string(value)
        if normalized:
            tags.append(normalized.lower())
    return sorted(list(dict.fromkeys(tags)))


def _extract_preview_image_url(manifest: WorldScenePackageManifest) -> str | None:
    return _normalize_optional_string(manifest.provenance.get("preview_image_url"))


def _extract_source_registry(manifest: WorldScenePackageManifest) -> str | None:
    return _normalize_optional_string(manifest.provenance.get("source_registry"))


def _matches_query(entry: WorldScenePackageListEntry, query: str | None) -> bool:
    if not query:
        return True
    q = query.strip().lower()
    if not q:
        return True
    haystacks = [
        entry.package_id,
        entry.latest_version,
        entry.title,
        entry.description or "",
        entry.owner or "",
        " ".join(entry.tags),
        " ".join(entry.runtime_targets),
    ]
    return any(q in haystack.lower() for haystack in haystacks)


def _matches_owner(entry: WorldScenePackageListEntry, owner: str | None) -> bool:
    normalized_owner = owner.strip().lower() if owner else ""
    if not normalized_owner:
        return True
    return (entry.owner or "").strip().lower() == normalized_owner


def _matches_tags(entry: WorldScenePackageListEntry, tags: Sequence[str] | None) -> bool:
    if not tags:
        return True
    requested = {tag.strip().lower() for tag in tags if tag.strip()}
    if not requested:
        return True
    available = {tag.strip().lower() for tag in entry.tags if tag.strip()}
    return requested.issubset(available)


def _validate_world_snapshot_timing(manifest: WorldScenePackageManifest) -> list[str]:
    scenario_time_ms = manifest.world_snapshot.scenario_time_ms
    scenario_duration_ms = manifest.world_snapshot.scenario_duration_ms

    if scenario_duration_ms == 0 and scenario_time_ms != 0:
        return ["scenario_time_ms must be 0 when scenario_duration_ms is 0."]
    if scenario_time_ms > scenario_duration_ms:
        return ["scenario_time_ms must be <= scenario_duration_ms."]
    return []


def _validate_world_snapshot_asset_refs(manifest: WorldScenePackageManifest) -> list[str]:
    errors: list[str] = []
    for index, item in enumerate(manifest.world_snapshot.objects):
        object_type = item.get("type")
        asset_ref_entry = read_world_object_asset_ref(item)
        if object_type == "mesh" and asset_ref_entry is None:
            errors.append(
                f"world_snapshot.objects[{index}].mesh asset reference is required for mesh objects."
            )
            continue
        if asset_ref_entry is None:
            continue
        try:
            normalize_portable_world_asset_ref(asset_ref_entry.value)
        except ValueError:
            errors.append(
                f"world_snapshot.objects[{index}].{asset_ref_entry.field_path} must be a portable relative asset reference."
            )
    return errors


@dataclass
class _RegistryState:
    packages: Dict[str, Dict[str, WorldScenePackageVersionRecord]]


class WorldRegistryService:
    def __init__(self, registry_path: str) -> None:
        self._path = Path(registry_path)
        self._lock = Lock()

    def validate(self, manifest: WorldScenePackageManifest) -> WorldScenePackageValidationResponse:
        errors: List[str] = []
        warnings: List[str] = []
        digest = world_scene_package_digest(manifest)

        if manifest.schema_version != WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1:
            errors.append(
                "Unsupported schema_version. "
                f"Expected {WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1}, received {manifest.schema_version}."
            )
        if not manifest.runtime_targets:
            warnings.append("No runtime_targets declared. Cross-runtime compatibility cannot be inferred.")
        if not manifest.artifacts:
            warnings.append("No external artifacts declared. Package is embedded-only.")
        if not manifest.security.signature_ref:
            warnings.append("No signature_ref present. Package remains metadata-only.")
        errors.extend(validate_world_snapshot_artifact_digests(manifest))
        manifest_bytes = len(canonical_world_scene_package_json(manifest).encode("utf-8"))
        if manifest_bytes > MAX_WORLD_SCENE_PACKAGE_MANIFEST_BYTES:
            errors.append(
                "World scene package manifest exceeds the allowed serialized size: "
                f"{manifest_bytes} > {MAX_WORLD_SCENE_PACKAGE_MANIFEST_BYTES} bytes."
            )
        errors.extend(_validate_world_snapshot_timing(manifest))
        errors.extend(_validate_world_snapshot_asset_refs(manifest))
        return WorldScenePackageValidationResponse(
            valid=len(errors) == 0,
            digest_sha256=digest,
            warnings=warnings,
            errors=errors,
        )

    def publish(self, manifest: WorldScenePackageManifest) -> WorldScenePackagePublishResponse:
        validation = self.validate(manifest)
        if not validation.valid:
            raise ValueError("; ".join(validation.errors))

        with self._lock:
            state = self._load_locked()
            package_versions = state.packages.setdefault(manifest.package_id, {})
            if manifest.version in package_versions:
                raise FileExistsError(
                    f"Package {manifest.package_id} version {manifest.version} already exists."
                )
            published_at = _now_utc()
            record = WorldScenePackageVersionRecord(
                package_id=manifest.package_id,
                version=manifest.version,
                digest_sha256=validation.digest_sha256,
                published_at=published_at,
                manifest=manifest,
            )
            package_versions[manifest.version] = record
            self._save_locked(state)
            return WorldScenePackagePublishResponse(
                package_id=manifest.package_id,
                version=manifest.version,
                digest_sha256=validation.digest_sha256,
                created=True,
            )

    def list_packages(
        self,
        *,
        query: str | None = None,
        owner: str | None = None,
        tags: Sequence[str] | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[WorldScenePackageListEntry]:
        with self._lock:
            state = self._load_locked()
            entries: List[WorldScenePackageListEntry] = []
            for package_id, versions in state.packages.items():
                latest_record = self._latest_record(versions)
                if latest_record is None:
                    continue
                entries.append(
                    WorldScenePackageListEntry(
                        package_id=package_id,
                        latest_version=latest_record.version,
                        latest_digest_sha256=latest_record.digest_sha256,
                        updated_at=latest_record.published_at,
                        title=latest_record.manifest.title,
                        description=latest_record.manifest.description,
                        owner=_extract_owner(latest_record.manifest),
                        tags=_extract_tags(latest_record.manifest),
                        preview_image_url=_extract_preview_image_url(latest_record.manifest),
                        source_registry=_extract_source_registry(latest_record.manifest),
                        trust_level=_resolve_trust_level(latest_record.manifest),
                        runtime_targets=_runtime_targets_summary(latest_record.manifest),
                    )
                )
            entries.sort(key=lambda entry: entry.updated_at, reverse=True)
            filtered = [
                entry
                for entry in entries
                if _matches_query(entry, query)
                and _matches_owner(entry, owner)
                and _matches_tags(entry, tags)
            ]
            start = max(offset, 0)
            end = start + max(limit, 0)
            return filtered[start:end]

    def get_capabilities(self) -> WorldRegistryCapabilitiesResponse:
        return WorldRegistryCapabilitiesResponse(
            source="urdf-studio-world-registry",
            available=True,
            unavailable_backends=[],
            can_list=True,
            can_get_version=True,
            can_publish=True,
        )

    def get_version(self, package_id: str, version: str) -> WorldScenePackageVersionRecord:
        with self._lock:
            state = self._load_locked()
            versions = state.packages.get(package_id)
            if not versions:
                raise KeyError(f"Package {package_id} was not found.")
            record = versions.get(version)
            if not record:
                raise KeyError(f"Version {version} was not found for package {package_id}.")
            return record

    def _latest_record(
        self, versions: Dict[str, WorldScenePackageVersionRecord]
    ) -> WorldScenePackageVersionRecord | None:
        if not versions:
            return None
        return sorted(
            versions.values(),
            key=lambda record: record.published_at,
            reverse=True,
        )[0]

    def _load_locked(self) -> _RegistryState:
        if not self._path.exists():
            return _RegistryState(packages={})
        try:
            raw_text = self._path.read_text(encoding="utf-8")
        except OSError as exc:
            logger.warning("Failed to read world registry file %s: %s", self._path, exc)
            return _RegistryState(packages={})
        try:
            raw = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            logger.error("Invalid world registry JSON in %s: %s", self._path, exc)
            return _RegistryState(packages={})
        if not isinstance(raw, dict):
            logger.error(
                "Invalid world registry payload in %s: root is not an object",
                self._path,
            )
            return _RegistryState(packages={})
        file_version = raw.get("registry_file_version")
        if file_version not in (None, REGISTRY_FILE_VERSION):
            logger.warning(
                "Unexpected world registry file version in %s: %r",
                self._path,
                file_version,
            )
        packages_raw = raw.get("packages", {})
        if not isinstance(packages_raw, dict):
            logger.error("Invalid world registry payload in %s: packages is not an object", self._path)
            return _RegistryState(packages={})
        packages: Dict[str, Dict[str, WorldScenePackageVersionRecord]] = {}
        for package_id, version_map in packages_raw.items():
            if not isinstance(version_map, dict):
                logger.warning(
                    "Skipping invalid package entry for %s in %s: expected object",
                    package_id,
                    self._path,
                )
                continue
            package_versions: Dict[str, WorldScenePackageVersionRecord] = {}
            for version, payload in version_map.items():
                try:
                    package_versions[version] = WorldScenePackageVersionRecord.model_validate(payload)
                except ValidationError as exc:
                    logger.warning(
                        "Skipping invalid package version %s@%s in %s: %s",
                        package_id,
                        version,
                        self._path,
                        exc,
                    )
            packages[package_id] = package_versions
        return _RegistryState(packages=packages)

    def _save_locked(self, state: _RegistryState) -> None:
        _ensure_parent(self._path)
        payload = {
            "registry_file_version": REGISTRY_FILE_VERSION,
            "updated_at": _now_utc().isoformat(),
            "packages": {
                package_id: {
                    version: record.model_dump(mode="json")
                    for version, record in version_map.items()
                }
                for package_id, version_map in state.packages.items()
            },
        }
        serialized = json.dumps(payload, indent=2, sort_keys=True)
        temp_path = self._path.with_suffix(f"{self._path.suffix}.tmp")
        temp_path.write_text(serialized, encoding="utf-8")
        temp_path.replace(self._path)


world_registry_service = WorldRegistryService(settings.world_registry_path)
