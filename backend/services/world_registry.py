from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Sequence

from pydantic import ValidationError

from backend.core.settings import settings
from backend.models.world_scene_package import (
    WorldRegistryCapabilitiesResponse,
    WorldScenePackageListEntry,
    WorldSceneRegistryEnvelope,
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
)
from backend.services.world_scene_package_digest import (
    validate_world_snapshot_artifact_digests,
    validate_world_scene_registry_envelope_artifact_digests,
    world_scene_registry_envelope_digest,
    world_scene_package_digest,
)
from backend.services.world_scene_package_compat import (
    is_world_scene_registry_envelope_payload,
    read_world_scene_package_manifest,
    read_world_scene_registry_envelope,
)
from backend.services.world_asset_refs import (
    has_world_object_content_asset_ref,
    normalize_portable_world_asset_ref,
    read_world_object_content_asset_ref,
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


def _canonical_world_scene_registry_envelope_json(
    envelope: WorldSceneRegistryEnvelope,
) -> str:
    return json.dumps(
        envelope.model_dump(mode="json", exclude_none=True),
        sort_keys=True,
        separators=(",", ":"),
    )


def _normalize_optional_string(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _extract_owner(envelope: WorldSceneRegistryEnvelope) -> str | None:
    return _normalize_optional_string(envelope.provenance.get("owner"))


def _extract_tags(envelope: WorldSceneRegistryEnvelope) -> list[str]:
    raw_tags = envelope.provenance.get("tags")
    if not isinstance(raw_tags, list):
        return []
    tags: list[str] = []
    for value in raw_tags:
        normalized = _normalize_optional_string(value)
        if normalized:
            tags.append(normalized.lower())
    return sorted(list(dict.fromkeys(tags)))


def _extract_preview_image_url(envelope: WorldSceneRegistryEnvelope) -> str | None:
    return _normalize_optional_string(envelope.provenance.get("preview_image_url"))


def _extract_source_registry(envelope: WorldSceneRegistryEnvelope) -> str | None:
    return _normalize_optional_string(envelope.provenance.get("source_registry"))


def _record_title(record: WorldScenePackageVersionRecord) -> str:
    title = _normalize_optional_string(record.manifest.world.name)
    return title or record.package_id


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


def _validate_world_timing(envelope: WorldSceneRegistryEnvelope) -> list[str]:
    scenario_time_ms = envelope.world.scenario_time_ms
    scenario_duration_ms = envelope.world.scenario_duration_ms

    if scenario_duration_ms == 0 and scenario_time_ms != 0:
        return ["scenario_time_ms must be 0 when scenario_duration_ms is 0."]
    if scenario_time_ms > scenario_duration_ms:
        return ["scenario_time_ms must be <= scenario_duration_ms."]
    return []


def _validate_world_snapshot_timing(manifest: WorldScenePackageManifest) -> list[str]:
    scenario_time_ms = manifest.world_snapshot.scenario_time_ms
    scenario_duration_ms = manifest.world_snapshot.scenario_duration_ms

    if scenario_duration_ms == 0 and scenario_time_ms != 0:
        return ["scenario_time_ms must be 0 when scenario_duration_ms is 0."]
    if scenario_time_ms > scenario_duration_ms:
        return ["scenario_time_ms must be <= scenario_duration_ms."]
    return []


def _validate_world_asset_refs(envelope: WorldSceneRegistryEnvelope) -> list[str]:
    errors: list[str] = []
    for index, world_object in enumerate(envelope.world.objects):
        object_type = world_object.get("type")
        asset_ref_entry = read_world_object_asset_ref(world_object)
        content_asset_ref_entry = read_world_object_content_asset_ref(world_object)
        if object_type == "mesh" and content_asset_ref_entry is None:
            errors.append(
                f"world_snapshot.objects[{index}].mesh asset reference is required for mesh objects."
            )
            if asset_ref_entry is None:
                continue
        if object_type == "splat" and content_asset_ref_entry is None:
            errors.append(
                f"world_snapshot.objects[{index}].splat asset reference is required for splat objects."
            )
            if asset_ref_entry is None:
                continue
        if asset_ref_entry is None:
            continue
        try:
            normalize_portable_world_asset_ref(asset_ref_entry.value)
        except ValueError:
            errors.append(
                f"world_snapshot.objects[{index}].{asset_ref_entry.field_path} "
                "must be a portable relative asset reference."
            )
    return errors


def _validate_world_snapshot_asset_refs(manifest: WorldScenePackageManifest) -> list[str]:
    errors: list[str] = []
    for index, world_object in enumerate(manifest.world_snapshot.objects):
        object_type = world_object.get("type")
        asset_ref_entry = read_world_object_asset_ref(world_object)
        content_asset_ref_entry = read_world_object_content_asset_ref(world_object)
        if object_type == "mesh" and content_asset_ref_entry is None:
            errors.append(
                f"world_snapshot.objects[{index}].mesh asset reference is required for mesh objects."
            )
            if asset_ref_entry is None:
                continue
        if object_type == "splat" and content_asset_ref_entry is None:
            errors.append(
                f"world_snapshot.objects[{index}].splat asset reference is required for splat objects."
            )
            if asset_ref_entry is None:
                continue
        if asset_ref_entry is None:
            continue
        try:
            normalize_portable_world_asset_ref(asset_ref_entry.value)
        except ValueError:
            errors.append(
                f"world_snapshot.objects[{index}].{asset_ref_entry.field_path} "
                "must be a portable relative asset reference."
            )
    return errors


@dataclass
class _RegistryState:
    packages: dict[str, dict[str, WorldScenePackageVersionRecord]]


class WorldRegistryService:
    def __init__(self, registry_path: str) -> None:
        self._path = Path(registry_path)
        self._lock = Lock()

    def validate(self, payload: object) -> WorldScenePackageValidationResponse:
        errors: list[str] = []
        warnings: list[str] = []
        try:
            envelope = read_world_scene_registry_envelope(payload)
        except (ValidationError, ValueError):
            envelope = None

        if envelope is not None:
            envelope_bytes = len(_canonical_world_scene_registry_envelope_json(envelope).encode("utf-8"))
            digest = world_scene_registry_envelope_digest(envelope)
            if not envelope.artifacts:
                warnings.append("No external artifacts declared. Package is embedded-only.")
            errors.extend(validate_world_scene_registry_envelope_artifact_digests(envelope))
            if envelope_bytes > MAX_WORLD_SCENE_PACKAGE_MANIFEST_BYTES:
                errors.append(
                    "World scene document exceeds the allowed serialized size: "
                    f"{envelope_bytes} > {MAX_WORLD_SCENE_PACKAGE_MANIFEST_BYTES} bytes."
                )
            errors.extend(_validate_world_timing(envelope))
            errors.extend(_validate_world_asset_refs(envelope))
        else:
            manifest = read_world_scene_package_manifest(payload)
            digest = world_scene_package_digest(manifest)
            if not manifest.artifacts:
                warnings.append("No external artifacts declared. Package is embedded-only.")
            errors.extend(validate_world_snapshot_artifact_digests(manifest))
            envelope_bytes = len(
                json.dumps(
                    manifest.model_dump(mode="json", exclude_none=True),
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            )
            if envelope_bytes > MAX_WORLD_SCENE_PACKAGE_MANIFEST_BYTES:
                errors.append(
                    "World scene document exceeds the allowed serialized size: "
                    f"{envelope_bytes} > {MAX_WORLD_SCENE_PACKAGE_MANIFEST_BYTES} bytes."
                )
            errors.extend(_validate_world_snapshot_timing(manifest))
            errors.extend(_validate_world_snapshot_asset_refs(manifest))
        return WorldScenePackageValidationResponse(
            valid=not errors,
            digest_sha256=digest,
            warnings=warnings,
            errors=errors,
        )

    def publish(self, payload: object) -> WorldScenePackagePublishResponse:
        envelope = read_world_scene_registry_envelope(payload)
        validation = self.validate(envelope)
        if not validation.valid:
            raise ValueError("; ".join(validation.errors))
        manifest = (
            read_world_scene_package_manifest(payload)
            if isinstance(payload, WorldScenePackageManifest)
            or not is_world_scene_registry_envelope_payload(payload)
            else None
        )

        with self._lock:
            state = self._load_locked()
            package_versions = state.packages.setdefault(envelope.package_id, {})
            if envelope.version in package_versions:
                raise FileExistsError(
                    f"Package {envelope.package_id} version {envelope.version} already exists."
                )
            published_at = _now_utc()
            record = WorldScenePackageVersionRecord(
                package_id=envelope.package_id,
                version=envelope.version,
                digest_sha256=validation.digest_sha256,
                published_at=published_at,
                trust_level=(
                    _resolve_trust_level(manifest)
                    if manifest is not None
                    else WORLD_SCENE_PACKAGE_TRUST_METADATA_ONLY
                ),
                runtime_targets=_runtime_targets_summary(manifest) if manifest is not None else [],
                manifest=envelope,
            )
            package_versions[envelope.version] = record
            self._save_locked(state)
            return WorldScenePackagePublishResponse(
                package_id=envelope.package_id,
                version=envelope.version,
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
    ) -> list[WorldScenePackageListEntry]:
        with self._lock:
            state = self._load_locked()
            entries: list[WorldScenePackageListEntry] = []
            for package_id, version_records in state.packages.items():
                latest_record = self._latest_record(version_records)
                if latest_record is None:
                    continue
                entries.append(
                    WorldScenePackageListEntry(
                        package_id=package_id,
                        latest_version=latest_record.version,
                        latest_digest_sha256=latest_record.digest_sha256,
                        updated_at=latest_record.published_at,
                        title=_record_title(latest_record),
                        description=latest_record.manifest.description,
                        owner=_extract_owner(latest_record.manifest),
                        tags=_extract_tags(latest_record.manifest),
                        preview_image_url=_extract_preview_image_url(latest_record.manifest),
                        source_registry=_extract_source_registry(latest_record.manifest),
                        trust_level=latest_record.trust_level,
                        runtime_targets=latest_record.runtime_targets,
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
            package_versions = state.packages.get(package_id)
            if not package_versions:
                raise KeyError(f"Package {package_id} was not found.")
            record = package_versions.get(version)
            if not record:
                raise KeyError(f"Version {version} was not found for package {package_id}.")
            return record

    def _latest_record(
        self, version_records: dict[str, WorldScenePackageVersionRecord]
    ) -> WorldScenePackageVersionRecord | None:
        if not version_records:
            return None
        return sorted(
            version_records.values(),
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
            registry_payload = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            logger.error("Invalid world registry JSON in %s: %s", self._path, exc)
            return _RegistryState(packages={})
        if not isinstance(registry_payload, dict):
            logger.error(
                "Invalid world registry payload in %s: root is not an object",
                self._path,
            )
            return _RegistryState(packages={})
        file_version = registry_payload.get("registry_file_version")
        if file_version not in (None, REGISTRY_FILE_VERSION):
            logger.warning(
                "Unexpected world registry file version in %s: %r",
                self._path,
                file_version,
            )
        raw_packages = registry_payload.get("packages", {})
        if not isinstance(raw_packages, dict):
            logger.error(
                "Invalid world registry payload in %s: packages is not an object",
                self._path,
            )
            return _RegistryState(packages={})
        packages: dict[str, dict[str, WorldScenePackageVersionRecord]] = {}
        for package_id, version_payloads in raw_packages.items():
            if not isinstance(version_payloads, dict):
                logger.warning(
                    "Skipping invalid package entry for %s in %s: expected object",
                    package_id,
                    self._path,
                )
                continue
            package_versions: dict[str, WorldScenePackageVersionRecord] = {}
            for version, version_payload in version_payloads.items():
                try:
                    package_versions[version] = _read_world_scene_package_version_record(version_payload)
                except (ValidationError, ValueError) as exc:
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
        registry_payload = {
            "registry_file_version": REGISTRY_FILE_VERSION,
            "updated_at": _now_utc().isoformat(),
            "packages": {
                package_id: {
                    version: _world_scene_package_version_record_json_payload(record)
                    for version, record in package_versions.items()
                }
                for package_id, package_versions in state.packages.items()
            },
        }
        serialized = json.dumps(registry_payload, indent=2, sort_keys=True)
        temp_path = self._path.with_suffix(f"{self._path.suffix}.tmp")
        temp_path.write_text(serialized, encoding="utf-8")
        temp_path.replace(self._path)


def _world_scene_package_version_record_json_payload(
    record: WorldScenePackageVersionRecord,
) -> dict:
    return record.model_dump(mode="json", exclude_none=True)


def _read_world_scene_package_version_record(payload: object) -> WorldScenePackageVersionRecord:
    if not isinstance(payload, dict):
        raise ValueError("World scene package version record must be an object.")
    manifest_payload = payload.get("manifest")
    if manifest_payload is None:
        return WorldScenePackageVersionRecord.model_validate(payload)
    envelope = read_world_scene_registry_envelope(manifest_payload)
    manifest = read_world_scene_package_manifest(manifest_payload)
    normalized_payload = {
        "package_id": payload.get("package_id", envelope.package_id),
        "version": payload.get("version", envelope.version),
        "digest_sha256": payload.get(
            "digest_sha256",
            world_scene_registry_envelope_digest(envelope),
        ),
        "published_at": payload.get("published_at"),
        "trust_level": payload.get("trust_level", _resolve_trust_level(manifest)),
        "runtime_targets": payload.get("runtime_targets", _runtime_targets_summary(manifest)),
        "manifest": envelope,
    }
    return WorldScenePackageVersionRecord.model_validate(normalized_payload)


world_registry_service = WorldRegistryService(settings.world_registry_path)
