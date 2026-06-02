from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from pydantic import ValidationError

from backend.core.settings import settings
from backend.models.dataset_alignment import (
    DatasetAlignmentInput,
    DatasetAlignmentRegistrySnapshot,
    DatasetRepresentationValidationRequest,
    DatasetRepresentationValidationResponse,
    EmbodimentRef,
    EmbodimentResolveRequest,
    EmbodimentResolveResponse,
    MappingListQuery,
    MappingSpec,
)
from backend.services.dataset_alignment_params import (
    ALIGNMENT_REGISTRY_FILE_VERSION,
    EMBODIMENT_HASH_SUFFIX_LENGTH,
    KINEMATIC_FINGERPRINT_VERSION_V1,
    NAMING_STATUS_UNNAMED,
    UNKNOWN_EMBODIMENT_PREFIX,
    UNKNOWN_UNFINGERPRINTED_EMBODIMENT_ID,
)
from backend.services.embodiment_fingerprint import (
    compute_kinematic_fingerprint,
    compute_sha256_text,
)

logger = logging.getLogger("urdf.dataset_alignment")
_DATASET_ALIGNMENT_SERVICE: DatasetAlignmentService | None = None


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _canonical_json(payload: object) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _ensure_parent(path: Path) -> None:
    if path.parent and not path.parent.exists():
        path.parent.mkdir(parents=True, exist_ok=True)


def _normalize_optional(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _build_unknown_embodiment_id(seed: str | None) -> str:
    if not seed:
        return UNKNOWN_UNFINGERPRINTED_EMBODIMENT_ID
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return f"{UNKNOWN_EMBODIMENT_PREFIX}{digest[:EMBODIMENT_HASH_SUFFIX_LENGTH]}"


@dataclass
class _RegistryState:
    embodiments: dict[str, EmbodimentRef]
    mappings: dict[str, MappingSpec]


class DatasetAlignmentService:
    def __init__(self, registry_path: str) -> None:
        self._path = Path(registry_path)
        self._lock = Lock()

    def resolve_embodiment(self, request: EmbodimentResolveRequest) -> EmbodimentResolveResponse:
        with self._lock:
            state = self._load_locked()

            provided_embodiment_id = _normalize_optional(request.embodiment_id)
            if provided_embodiment_id and provided_embodiment_id in state.embodiments:
                return EmbodimentResolveResponse(
                    embodiment=state.embodiments[provided_embodiment_id],
                    matched_existing=True,
                )

            robot_type = _normalize_optional(request.robot_type)
            base_frame = _normalize_optional(request.base_frame)
            ee_frame = _normalize_optional(request.ee_frame)
            urdf_xml = _normalize_optional(request.urdf_xml)

            kinematic_fingerprint: str | None = None
            urdf_sha256: str | None = None
            if urdf_xml:
                urdf_sha256 = compute_sha256_text(urdf_xml)
                try:
                    fingerprint = compute_kinematic_fingerprint(urdf_xml)
                    kinematic_fingerprint = fingerprint.strict
                except Exception as exc:  # defensive fallback for malformed URDF payloads
                    logger.warning("Failed to compute kinematic fingerprint: %s", exc)
                    kinematic_fingerprint = None

                if kinematic_fingerprint:
                    for embodiment in state.embodiments.values():
                        if embodiment.kinematic_fingerprint == kinematic_fingerprint:
                            return EmbodimentResolveResponse(
                                embodiment=embodiment,
                                matched_existing=True,
                            )

            embodiment_id = provided_embodiment_id
            if not embodiment_id:
                if kinematic_fingerprint:
                    embodiment_id = f"{UNKNOWN_EMBODIMENT_PREFIX}{kinematic_fingerprint}"
                else:
                    seed = _canonical_json(
                        {
                            "robot_type": robot_type,
                            "base_frame": base_frame,
                            "ee_frame": ee_frame,
                        }
                    )
                    embodiment_id = _build_unknown_embodiment_id(seed)

            embodiment = EmbodimentRef(
                embodiment_id=embodiment_id,
                kinematic_fingerprint=kinematic_fingerprint,
                kinematic_fingerprint_version=(
                    KINEMATIC_FINGERPRINT_VERSION_V1 if kinematic_fingerprint else None
                ),
                robot_type=robot_type,
                urdf_sha256=urdf_sha256,
                base_frame=base_frame,
                ee_frame=ee_frame,
            )

            state.embodiments[embodiment.embodiment_id] = embodiment
            self._save_locked(state)
            return EmbodimentResolveResponse(
                embodiment=embodiment,
                matched_existing=False,
            )

    def list_embodiments(self) -> list[EmbodimentRef]:
        with self._lock:
            state = self._load_locked()
            return sorted(state.embodiments.values(), key=lambda entry: entry.embodiment_id)

    def upsert_mapping(self, mapping_spec: MappingSpec) -> MappingSpec:
        with self._lock:
            state = self._load_locked()
            mapping_id = mapping_spec.mapping_id or self._build_mapping_id(mapping_spec)
            normalized = mapping_spec.model_copy(
                update={
                    "mapping_id": mapping_id,
                    "created_at": mapping_spec.created_at or _now_utc(),
                }
            )
            state.mappings[mapping_id] = normalized
            self._save_locked(state)
            return normalized

    def list_mappings(self, query: MappingListQuery | None = None) -> list[MappingSpec]:
        with self._lock:
            state = self._load_locked()
            mappings = list(state.mappings.values())

        if query is None:
            return sorted(mappings, key=lambda entry: entry.mapping_id or "")

        filtered: list[MappingSpec] = []
        for mapping in mappings:
            if query.source_embodiment_id and mapping.source.embodiment_id != query.source_embodiment_id:
                continue
            if query.source_representation_id and mapping.source.representation_id != query.source_representation_id:
                continue
            if query.target_embodiment_id and mapping.target.embodiment_id != query.target_embodiment_id:
                continue
            if query.target_representation_id and mapping.target.representation_id != query.target_representation_id:
                continue
            filtered.append(mapping)
        return sorted(filtered, key=lambda entry: entry.mapping_id or "")

    def validate_dataset_representations(
        self,
        request: DatasetRepresentationValidationRequest,
    ) -> DatasetRepresentationValidationResponse:
        errors: list[str] = []
        warnings: list[str] = []

        if not request.datasets:
            errors.append("At least one dataset alignment descriptor is required.")
            return DatasetRepresentationValidationResponse(valid=False, errors=errors, warnings=warnings)

        with self._lock:
            state = self._load_locked()

        representation_ids = {dataset.representation_id for dataset in request.datasets}
        if len(representation_ids) > 1 and not request.required_representation_id:
            errors.append(
                "Datasets have mixed representation_id values. Provide required_representation_id or explicit mappings."
            )

        for dataset in request.datasets:
            dataset_errors, dataset_warnings = self._validate_single_dataset(
                dataset=dataset,
                request=request,
                mappings=list(state.mappings.values()),
            )
            errors.extend(dataset_errors)
            warnings.extend(dataset_warnings)

        return DatasetRepresentationValidationResponse(
            valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
        )

    def get_snapshot(self) -> DatasetAlignmentRegistrySnapshot:
        with self._lock:
            state = self._load_locked()
        return DatasetAlignmentRegistrySnapshot(
            embodiments=sorted(state.embodiments.values(), key=lambda entry: entry.embodiment_id),
            mappings=sorted(state.mappings.values(), key=lambda entry: entry.mapping_id or ""),
        )

    def _validate_single_dataset(
        self,
        *,
        dataset: DatasetAlignmentInput,
        request: DatasetRepresentationValidationRequest,
        mappings: list[MappingSpec],
    ) -> tuple[list[str], list[str]]:
        errors: list[str] = []
        warnings: list[str] = []
        dataset_label = f"{dataset.dataset_id}"

        if not dataset.embodiment_id:
            errors.append(f"Dataset {dataset_label} is missing embodiment_id.")

        if dataset.naming_status == NAMING_STATUS_UNNAMED:
            errors.append(
                f"Dataset {dataset_label} has unnamed joints; semantic alignment is unsafe without mapping."
            )

        required_representation = request.required_representation_id
        if required_representation and dataset.representation_id != required_representation:
            has_mapping = any(
                mapping.source.representation_id == dataset.representation_id
                and mapping.target.representation_id == required_representation
                and (
                    not dataset.embodiment_id
                    or mapping.source.embodiment_id == dataset.embodiment_id
                )
                for mapping in mappings
            )
            if not has_mapping:
                errors.append(
                    "Dataset "
                    f"{dataset_label} uses {dataset.representation_id} and has no MappingSpec "
                    f"to required representation {required_representation}."
                )

        return errors, warnings

    def _build_mapping_id(self, mapping_spec: MappingSpec) -> str:
        payload = {
            "source": mapping_spec.source.model_dump(mode="json"),
            "target": mapping_spec.target.model_dump(mode="json"),
            "joint_rules": [rule.model_dump(mode="json") for rule in mapping_spec.joint_rules],
            "version": mapping_spec.version,
        }
        digest = hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()
        return f"map:{digest[:EMBODIMENT_HASH_SUFFIX_LENGTH]}"

    def _load_locked(self) -> _RegistryState:
        if not self._path.exists():
            return _RegistryState(embodiments={}, mappings={})

        raw = self._path.read_text(encoding="utf-8")
        if not raw.strip():
            return _RegistryState(embodiments={}, mappings={})

        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Dataset alignment registry contains invalid JSON; resetting state")
            return _RegistryState(embodiments={}, mappings={})

        if not isinstance(payload, dict):
            return _RegistryState(embodiments={}, mappings={})

        embodiments_payload = payload.get("embodiments", {})
        mappings_payload = payload.get("mappings", {})

        embodiments: dict[str, EmbodimentRef] = {}
        if isinstance(embodiments_payload, dict):
            for embodiment_id, value in embodiments_payload.items():
                if not isinstance(embodiment_id, str):
                    continue
                if not isinstance(value, dict):
                    continue
                try:
                    embodiment = EmbodimentRef.model_validate(value)
                except ValidationError:
                    continue
                embodiments[embodiment_id] = embodiment

        mappings: dict[str, MappingSpec] = {}
        if isinstance(mappings_payload, dict):
            for mapping_id, value in mappings_payload.items():
                if not isinstance(mapping_id, str):
                    continue
                if not isinstance(value, dict):
                    continue
                try:
                    mapping = MappingSpec.model_validate(value)
                except ValidationError:
                    continue
                mappings[mapping_id] = mapping

        return _RegistryState(embodiments=embodiments, mappings=mappings)

    def _save_locked(self, state: _RegistryState) -> None:
        _ensure_parent(self._path)
        payload: dict[str, Any] = {
            "version": ALIGNMENT_REGISTRY_FILE_VERSION,
            "embodiments": {
                embodiment_id: entry.model_dump(mode="json")
                for embodiment_id, entry in state.embodiments.items()
            },
            "mappings": {
                mapping_id: entry.model_dump(mode="json")
                for mapping_id, entry in state.mappings.items()
            },
        }
        self._path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def get_dataset_alignment_service() -> DatasetAlignmentService:
    global _DATASET_ALIGNMENT_SERVICE
    if _DATASET_ALIGNMENT_SERVICE is None:
        _DATASET_ALIGNMENT_SERVICE = DatasetAlignmentService(settings.embodiment_registry_path)
    return _DATASET_ALIGNMENT_SERVICE
