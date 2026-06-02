from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from backend.models.dataset_alignment import (
    DatasetAlignmentInput,
    DatasetRepresentationValidationRequest,
)
from backend.models.datasets import (
    DatasetMixRequest,
    DatasetTreatmentAnalysisResponse,
    DatasetTreatmentIssue,
    DatasetTreatmentManifest,
    DatasetTreatmentSourceManifest,
    DatasetTreatmentStats,
)
from backend.services.dataset_alignment import get_dataset_alignment_service
from backend.services.dataset_treatment_fingerprints import (
    compute_content_fingerprint_from_signature,
    normalize_content_fingerprint,
)
from backend.services.dataset_treatment_lineage import (
    DatasetSourceDuplicateCluster,
    cluster_dataset_sources,
)
from backend.services.dataset_treatments_params import (
    TREATMENT_ACTION_CANONICALIZE_LOCAL_PATH,
    TREATMENT_ACTION_CANONICALIZE_CONTENT_FINGERPRINT,
    TREATMENT_ACTION_REQUIRES_MAPPING,
    TREATMENT_ACTION_REQUIRES_NAMING_REVIEW,
    TREATMENT_ACTION_REVIEW_DUPLICATES,
    TREATMENT_CODE_ALIGNMENT_ERROR,
    TREATMENT_CODE_ALIGNMENT_WARNING,
    TREATMENT_CODE_DUPLICATE_SOURCE,
    TREATMENT_CODE_INVALID_CONTENT_FINGERPRINT,
    TREATMENT_CODE_MIXED_REPRESENTATION,
    TREATMENT_CODE_UNNAMED_SOURCE,
    TREATMENT_MANIFEST_VERSION,
    TREATMENT_PROFILE_INDEXED,
    TREATMENT_PROFILE_SEMANTIC,
    TREATMENT_PROFILE_UNKNOWN,
    TREATMENT_PROFILE_VERSION,
)


@dataclass(frozen=True)
class NormalizedDatasetSource:
    source_id: str
    dataset_id: str
    source_kind: str
    source_value: str
    canonical_source: str
    representation_id: str
    embodiment_id: str | None
    naming_status: str
    content_fingerprint: str | None
    content_fingerprint_kind: str | None
    content_fingerprint_valid: bool
    normalization_actions: tuple[str, ...]


def _resolve_profile_id(representation_id: str) -> str:
    normalized_representation = representation_id.strip().lower()
    if "semantic" in normalized_representation:
        return TREATMENT_PROFILE_SEMANTIC
    if "index" in normalized_representation:
        return TREATMENT_PROFILE_INDEXED
    return TREATMENT_PROFILE_UNKNOWN


def _build_sources(
    req: DatasetMixRequest,
    normalized_local_paths: list[str],
) -> list[NormalizedDatasetSource]:
    sources: list[NormalizedDatasetSource] = []
    alignment_datasets = list(req.alignment.datasets)

    for index, repo_id in enumerate(req.repo_ids):
        dataset = alignment_datasets[index]
        signature_fingerprint, signature_kind = compute_content_fingerprint_from_signature(
            dataset.content_signature
        )
        content_fingerprint = normalize_content_fingerprint(
            signature_fingerprint or dataset.content_fingerprint,
            signature_kind or dataset.content_fingerprint_kind,
        )
        normalization_actions: list[str] = []
        requested_content_fingerprint = (
            signature_fingerprint
            if signature_fingerprint is not None
            else dataset.content_fingerprint
        )
        requested_content_fingerprint_kind = (
            signature_kind if signature_kind is not None else dataset.content_fingerprint_kind
        )
        content_fingerprint_valid = (
            dataset.content_signature is None
            if requested_content_fingerprint is None
            else content_fingerprint is not None
        )
        if requested_content_fingerprint is not None:
            content_fingerprint_valid = content_fingerprint is not None
        if requested_content_fingerprint and content_fingerprint is not None:
            if requested_content_fingerprint != content_fingerprint:
                normalization_actions.append(
                    TREATMENT_ACTION_CANONICALIZE_CONTENT_FINGERPRINT
                )
        sources.append(
            NormalizedDatasetSource(
                source_id=f"repo:{index}",
                dataset_id=dataset.dataset_id,
                source_kind="repo",
                source_value=repo_id,
                canonical_source=repo_id,
                representation_id=dataset.representation_id,
                embodiment_id=dataset.embodiment_id,
                naming_status=dataset.naming_status,
                content_fingerprint=content_fingerprint,
                content_fingerprint_kind=requested_content_fingerprint_kind,
                content_fingerprint_valid=content_fingerprint_valid,
                normalization_actions=tuple(normalization_actions),
            )
        )

    local_start_index = len(req.repo_ids)
    for local_index, local_path in enumerate(normalized_local_paths):
        dataset = alignment_datasets[local_start_index + local_index]
        requested_local_path = req.local_paths[local_index]
        normalization_actions: list[str] = []
        signature_fingerprint, signature_kind = compute_content_fingerprint_from_signature(
            dataset.content_signature
        )
        content_fingerprint = normalize_content_fingerprint(
            signature_fingerprint or dataset.content_fingerprint,
            signature_kind or dataset.content_fingerprint_kind,
        )
        requested_content_fingerprint = (
            signature_fingerprint
            if signature_fingerprint is not None
            else dataset.content_fingerprint
        )
        requested_content_fingerprint_kind = (
            signature_kind if signature_kind is not None else dataset.content_fingerprint_kind
        )
        content_fingerprint_valid = (
            dataset.content_signature is None
            if requested_content_fingerprint is None
            else content_fingerprint is not None
        )
        if requested_content_fingerprint is not None:
            content_fingerprint_valid = content_fingerprint is not None
        if requested_local_path != local_path:
            normalization_actions.append(TREATMENT_ACTION_CANONICALIZE_LOCAL_PATH)
        if requested_content_fingerprint and content_fingerprint is not None:
            if requested_content_fingerprint != content_fingerprint:
                normalization_actions.append(
                    TREATMENT_ACTION_CANONICALIZE_CONTENT_FINGERPRINT
                )
        sources.append(
            NormalizedDatasetSource(
                source_id=f"local:{local_index}",
                dataset_id=dataset.dataset_id,
                source_kind="local",
                source_value=requested_local_path,
                canonical_source=local_path,
                representation_id=dataset.representation_id,
                embodiment_id=dataset.embodiment_id,
                naming_status=dataset.naming_status,
                content_fingerprint=content_fingerprint,
                content_fingerprint_kind=requested_content_fingerprint_kind,
                content_fingerprint_valid=content_fingerprint_valid,
                normalization_actions=tuple(normalization_actions),
            )
        )

    if not req.repo_ids and not normalized_local_paths:
        for index, dataset in enumerate(alignment_datasets):
            signature_fingerprint, signature_kind = compute_content_fingerprint_from_signature(
                dataset.content_signature
            )
            content_fingerprint = normalize_content_fingerprint(
                signature_fingerprint or dataset.content_fingerprint,
                signature_kind or dataset.content_fingerprint_kind,
            )
            normalization_actions: list[str] = []
            requested_content_fingerprint = (
                signature_fingerprint
                if signature_fingerprint is not None
                else dataset.content_fingerprint
            )
            requested_content_fingerprint_kind = (
                signature_kind if signature_kind is not None else dataset.content_fingerprint_kind
            )
            content_fingerprint_valid = (
                dataset.content_signature is None
                if requested_content_fingerprint is None
                else content_fingerprint is not None
            )
            if requested_content_fingerprint is not None:
                content_fingerprint_valid = content_fingerprint is not None
            if requested_content_fingerprint and content_fingerprint is not None:
                if requested_content_fingerprint != content_fingerprint:
                    normalization_actions.append(
                        TREATMENT_ACTION_CANONICALIZE_CONTENT_FINGERPRINT
                    )
            sources.append(
                NormalizedDatasetSource(
                    source_id=f"virtual:{index}",
                    dataset_id=dataset.dataset_id,
                    source_kind="virtual",
                    source_value=dataset.dataset_id,
                    canonical_source=dataset.dataset_id,
                    representation_id=dataset.representation_id,
                    embodiment_id=dataset.embodiment_id,
                    naming_status=dataset.naming_status,
                    content_fingerprint=content_fingerprint,
                    content_fingerprint_kind=requested_content_fingerprint_kind,
                    content_fingerprint_valid=content_fingerprint_valid,
                    normalization_actions=tuple(normalization_actions),
                )
            )

    return sources


def analyze_dataset_treatment(
    req: DatasetMixRequest,
    normalized_local_paths: list[str],
) -> DatasetTreatmentAnalysisResponse:
    alignment_service = get_dataset_alignment_service()
    validation_request = DatasetRepresentationValidationRequest(
        datasets=[
            DatasetAlignmentInput(
                dataset_id=dataset.dataset_id,
                embodiment_id=dataset.embodiment_id,
                representation_id=dataset.representation_id,
                naming_status=dataset.naming_status,
            )
            for dataset in req.alignment.datasets
        ],
        required_representation_id=req.alignment.required_representation_id,
    )
    alignment = alignment_service.validate_dataset_representations(validation_request)
    sources = _build_sources(req=req, normalized_local_paths=normalized_local_paths)
    duplicate_clusters = cluster_dataset_sources(
        [
            (source.source_id, source.canonical_source, source.content_fingerprint)
            for source in sources
        ]
    )
    duplicate_cluster_by_source_id = {
        cluster.source_id: cluster for cluster in duplicate_clusters
    }
    representation_ids = sorted({source.representation_id for source in sources})
    embodiment_ids = sorted(
        {
            source.embodiment_id
            for source in sources
            if isinstance(source.embodiment_id, str) and source.embodiment_id.strip()
        }
    )

    warnings: list[DatasetTreatmentIssue] = []
    errors: list[DatasetTreatmentIssue] = []
    source_actions = defaultdict(list)

    if len(representation_ids) > 1:
        warnings.append(
            DatasetTreatmentIssue(
                code=TREATMENT_CODE_MIXED_REPRESENTATION,
                message=(
                    "Sources contain multiple representation IDs; the backend treatment "
                    "manifest requires explicit mapping or a common target representation."
                ),
            )
        )

    for message in alignment.warnings:
        warnings.append(
            DatasetTreatmentIssue(
                code=TREATMENT_CODE_ALIGNMENT_WARNING,
                message=message,
            )
        )
    for message in alignment.errors:
        errors.append(
            DatasetTreatmentIssue(
                code=TREATMENT_CODE_ALIGNMENT_ERROR,
                message=message,
            )
        )

    manifest_sources: list[DatasetTreatmentSourceManifest] = []
    for source in sources:
        duplicate_cluster = duplicate_cluster_by_source_id.get(source.source_id)
        if duplicate_cluster is None:
            duplicate_cluster = DatasetSourceDuplicateCluster(
                source_id=source.source_id,
                canonical_source=source.canonical_source,
                duplicate_group_id=None,
                duplicate_group_size=1,
            )
        group_size = duplicate_cluster.duplicate_group_size
        duplicate_group_id = duplicate_cluster.duplicate_group_id
        if duplicate_group_id is not None:
            source_actions[source.source_id].append(TREATMENT_ACTION_REVIEW_DUPLICATES)
            warnings.append(
                DatasetTreatmentIssue(
                    code=TREATMENT_CODE_DUPLICATE_SOURCE,
                    message=(
                        f"Source {source.dataset_id} shares canonical source "
                        f"{source.canonical_source} with {group_size - 1} other input(s)."
                    ),
                    dataset_id=source.dataset_id,
                    source_id=source.source_id,
                )
            )

        if source.naming_status == "unnamed":
            source_actions[source.source_id].append(TREATMENT_ACTION_REQUIRES_NAMING_REVIEW)
            warnings.append(
                DatasetTreatmentIssue(
                    code=TREATMENT_CODE_UNNAMED_SOURCE,
                    message=f"Source {source.dataset_id} has unnamed joints and requires mapping review.",
                    dataset_id=source.dataset_id,
                    source_id=source.source_id,
                )
            )

        if (
            req.alignment.required_representation_id
            and source.representation_id != req.alignment.required_representation_id
        ):
            source_actions[source.source_id].append(TREATMENT_ACTION_REQUIRES_MAPPING)
        if not source.content_fingerprint_valid:
            warnings.append(
                DatasetTreatmentIssue(
                    code=TREATMENT_CODE_INVALID_CONTENT_FINGERPRINT,
                    message=(
                        f"Source {source.dataset_id} provided an invalid content fingerprint; "
                        "backend duplicate detection ignored it."
                    ),
                    dataset_id=source.dataset_id,
                    source_id=source.source_id,
                )
            )

        normalization_actions = [
            *source.normalization_actions,
            *source_actions[source.source_id],
        ]
        manifest_sources.append(
            DatasetTreatmentSourceManifest(
                source_id=source.source_id,
                dataset_id=source.dataset_id,
                source_kind=source.source_kind,
                source_value=source.source_value,
                canonical_source=source.canonical_source,
                content_fingerprint=source.content_fingerprint,
                content_fingerprint_kind=source.content_fingerprint_kind,
                embodiment_id=source.embodiment_id,
                representation_id=source.representation_id,
                naming_status=source.naming_status,
                profile_id=_resolve_profile_id(source.representation_id),
                profile_version=TREATMENT_PROFILE_VERSION,
                canonical_fingerprint=duplicate_cluster.canonical_fingerprint,
                normalization_actions=normalization_actions,
                duplicate_group_id=duplicate_group_id,
                duplicate_group_size=group_size,
                duplicate_match_kind=duplicate_cluster.duplicate_match_kind,
            )
        )

    manifest = DatasetTreatmentManifest(
        manifest_version=TREATMENT_MANIFEST_VERSION,
        required_representation_id=req.alignment.required_representation_id,
        sources=manifest_sources,
        normalization_actions=sorted(
            {
                action
                for source in manifest_sources
                for action in source.normalization_actions
            }
        ),
        warnings=warnings,
        errors=errors,
        stats=DatasetTreatmentStats(
            total_sources=len(manifest_sources),
            repo_source_count=sum(1 for source in manifest_sources if source.source_kind == "repo"),
            local_source_count=sum(1 for source in manifest_sources if source.source_kind == "local"),
            unique_canonical_sources=len(
                {source.canonical_source for source in manifest_sources}
            ),
            duplicate_group_count=len(
                {
                    cluster.duplicate_group_id
                    for cluster in duplicate_clusters
                    if cluster.duplicate_group_id is not None
                }
            ),
            exact_duplicate_group_count=len(
                {
                    cluster.duplicate_group_id
                    for cluster in duplicate_clusters
                    if cluster.duplicate_match_kind == "exact"
                    and cluster.duplicate_group_id is not None
                }
            ),
            normalized_duplicate_group_count=len(
                {
                    cluster.duplicate_group_id
                    for cluster in duplicate_clusters
                    if cluster.duplicate_match_kind == "normalized"
                    and cluster.duplicate_group_id is not None
                }
            ),
            alignment_error_count=len(alignment.errors),
            alignment_warning_count=len(alignment.warnings),
            unnamed_source_count=sum(
                1 for source in manifest_sources if source.naming_status == "unnamed"
            ),
            representation_ids=representation_ids,
            embodiment_ids=embodiment_ids,
        ),
    )
    return DatasetTreatmentAnalysisResponse(
        success=alignment.valid,
        warnings=[warning.message for warning in warnings],
        error=None if alignment.valid else "Dataset alignment validation failed",
        alignment=alignment,
        treatment_manifest=manifest,
    )
