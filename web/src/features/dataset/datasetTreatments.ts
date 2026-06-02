import {
  DEFAULT_INDEXED_REPRESENTATION_ID,
  DEFAULT_SEMANTIC_REPRESENTATION_ID,
  NAMING_STATUS_NAMED,
} from "@/features/dataset/datasetAlignmentParams";
import {
  DATASET_CONTENT_SIGNATURE_KIND,
  type DatasetContentSignature,
} from "@/features/dataset/datasetTreatmentSignatures";
import { DATASET_TREATMENT_PARAMS } from "@/features/dataset/datasetTreatmentParams";
import type { NamingStatus } from "@/features/dataset/io/episodeTypes";
import { API_BASE_URL } from "@/shared/config/runtime";

export type DatasetTreatmentIssue = {
  code: string;
  message: string;
  dataset_id?: string;
  source_id?: string;
};

export type DatasetTreatmentSourceManifest = {
  source_id: string;
  dataset_id: string;
  source_kind: "repo" | "local" | "virtual";
  source_value: string;
  canonical_source: string;
  content_fingerprint?: string;
  content_fingerprint_kind?: typeof DATASET_CONTENT_SIGNATURE_KIND;
  embodiment_id?: string;
  representation_id: string;
  naming_status: NamingStatus;
  profile_id: string;
  profile_version: string;
  canonical_fingerprint?: string;
  normalization_actions: string[];
  duplicate_group_id?: string;
  duplicate_group_size: number;
  duplicate_match_kind?: "exact" | "normalized";
};

export type DatasetTreatmentManifest = {
  manifest_version: string;
  required_representation_id: string;
  sources: DatasetTreatmentSourceManifest[];
  normalization_actions: string[];
  warnings: DatasetTreatmentIssue[];
  errors: DatasetTreatmentIssue[];
  stats: {
    total_sources: number;
    repo_source_count: number;
    local_source_count: number;
    unique_canonical_sources: number;
    duplicate_group_count: number;
    exact_duplicate_group_count: number;
    normalized_duplicate_group_count: number;
    alignment_error_count: number;
    alignment_warning_count: number;
    unnamed_source_count: number;
    representation_ids: string[];
    embodiment_ids: string[];
  };
};

export type DatasetTreatmentAnalysisResponse = {
  success: boolean;
  warnings: string[];
  error?: string;
  alignment?: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
  treatment_manifest: DatasetTreatmentManifest;
};

export type DatasetTreatmentAdditional = ReturnType<
  typeof buildDatasetTreatmentAdditional
>;

export type DatasetTreatmentAdditionalFieldsParams = {
  sourceType: string;
  sourceName: string;
  baseAdditional?: Record<string, unknown>;
  extraAdditional?: Record<string, unknown>;
  hfDatasetRepo?: string;
  canonicalSource?: string;
  sourceId?: string;
  sourceKind?: string;
  treatmentAdditional?: Record<string, unknown>;
  treatmentManifest?: Record<string, unknown>;
};

export type DatasetTreatmentAnalyzeRequest = {
  repo_ids?: string[];
  local_paths?: string[];
  alignment: {
    datasets: Array<{
      dataset_id: string;
      embodiment_id?: string;
      representation_id: string;
      naming_status: NamingStatus;
      content_fingerprint?: string;
      content_fingerprint_kind?: "episode-series-v1";
      content_signature?: DatasetContentSignature;
    }>;
    required_representation_id: string;
  };
};

const DATASET_TREATMENTS_ANALYZE_PATH = DATASET_TREATMENT_PARAMS.analyzePath;

const readErrorDetail = async (response: Response) => {
  try {
    const body = (await response.json()) as { detail?: string; error?: string };
    return body.detail ?? body.error ?? `Dataset treatment request failed (${response.status})`;
  } catch {
    return `Dataset treatment request failed (${response.status})`;
  }
};

export const analyzeDatasetTreatment = async (
  request: DatasetTreatmentAnalyzeRequest
): Promise<DatasetTreatmentAnalysisResponse> => {
  const response = await fetch(`${API_BASE_URL}${DATASET_TREATMENTS_ANALYZE_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }

  return (await response.json()) as DatasetTreatmentAnalysisResponse;
};

export const analyzeSingleDatasetTreatment = async ({
  datasetId,
  embodimentId,
  namingStatus,
  representationId = DEFAULT_INDEXED_REPRESENTATION_ID,
  requiredRepresentationId = DEFAULT_SEMANTIC_REPRESENTATION_ID,
  contentSignature,
  repoIds,
  localPaths,
}: {
  datasetId: string;
  embodimentId?: string;
  namingStatus: NamingStatus;
  representationId?: string;
  requiredRepresentationId?: string;
  contentSignature?: DatasetContentSignature;
  repoIds?: string[];
  localPaths?: string[];
}) =>
  analyzeDatasetTreatment({
    ...(repoIds && repoIds.length > 0 ? { repo_ids: repoIds } : {}),
    ...(localPaths && localPaths.length > 0 ? { local_paths: localPaths } : {}),
    alignment: {
      datasets: [
        {
          dataset_id: datasetId,
          embodiment_id: embodimentId,
          representation_id: representationId,
          naming_status: namingStatus,
          ...(contentSignature
            ? {
                content_signature: contentSignature,
              }
            : {}),
        },
      ],
      required_representation_id: requiredRepresentationId,
    },
  });

export const analyzeHfDatasetTreatment = async ({
  repoId,
  datasetId,
  embodimentId,
  namingStatus = NAMING_STATUS_NAMED,
  representationId = DEFAULT_INDEXED_REPRESENTATION_ID,
  requiredRepresentationId = DEFAULT_SEMANTIC_REPRESENTATION_ID,
  contentSignature,
}: {
  repoId: string;
  datasetId: string;
  embodimentId?: string;
  namingStatus?: NamingStatus;
  representationId?: string;
  requiredRepresentationId?: string;
  contentSignature?: DatasetContentSignature;
}) =>
  analyzeSingleDatasetTreatment({
    repoIds: [repoId],
    datasetId,
    embodimentId,
    namingStatus,
    representationId,
    requiredRepresentationId,
    contentSignature,
  });

const resolveDatasetTreatmentSource = (
  treatment: DatasetTreatmentAnalysisResponse | null,
  datasetId: string
) =>
  treatment?.treatment_manifest.sources.find((entry) => entry.dataset_id === datasetId) ?? null;

const buildDatasetTreatmentAdditional = (
  treatment: DatasetTreatmentAnalysisResponse | null,
  datasetId: string
) => {
  if (!treatment) {
    return undefined;
  }
  const source = resolveDatasetTreatmentSource(treatment, datasetId);
  return {
    manifest_version: treatment.treatment_manifest.manifest_version,
    required_representation_id: treatment.treatment_manifest.required_representation_id,
    source_id: source?.source_id,
    sourceId: source?.source_id,
    source_kind: source?.source_kind,
    sourceKind: source?.source_kind,
    canonical_source: source?.canonical_source,
    canonicalSource: source?.canonical_source,
    content_fingerprint: source?.content_fingerprint,
    contentFingerprint: source?.content_fingerprint,
    content_fingerprint_kind: source?.content_fingerprint_kind,
    contentFingerprintKind: source?.content_fingerprint_kind,
    canonical_fingerprint: source?.canonical_fingerprint,
    canonicalFingerprint: source?.canonical_fingerprint,
    profile_id: source?.profile_id,
    profile_version: source?.profile_version,
    normalization_actions: source?.normalization_actions ?? [],
    duplicate_group_id: source?.duplicate_group_id,
    duplicate_group_size: source?.duplicate_group_size,
    duplicate_match_kind: source?.duplicate_match_kind,
    duplicateMatchKind: source?.duplicate_match_kind,
    warning_codes: treatment.treatment_manifest.warnings.map((warning) => warning.code),
    error_codes: treatment.treatment_manifest.errors.map((error) => error.code),
  };
};

export const formatDatasetTreatmentWarningPreview = (
  treatment: DatasetTreatmentAnalysisResponse | null,
  previewCount = DATASET_TREATMENT_PARAMS.warningPreviewCount
) =>
  treatment?.treatment_manifest.warnings
    .slice(0, previewCount)
    .map((warning) => warning.message)
    .join(" ") ?? "";

const listDatasetTreatmentWarningMessages = (
  treatment: DatasetTreatmentAnalysisResponse | null
) => treatment?.treatment_manifest.warnings.map((warning) => warning.message) ?? [];

export const resolveDatasetTreatmentContext = (
  treatment: DatasetTreatmentAnalysisResponse | null,
  datasetId: string
) => ({
  treatment,
  treatmentSource: resolveDatasetTreatmentSource(treatment, datasetId),
  treatmentAdditional: buildDatasetTreatmentAdditional(treatment, datasetId),
  treatmentWarningMessages: listDatasetTreatmentWarningMessages(treatment),
  treatmentWarningPreview: formatDatasetTreatmentWarningPreview(treatment),
  treatmentWarningCount: treatment?.treatment_manifest.warnings.length ?? 0,
});

export const buildDatasetTreatmentAdditionalFields = ({
  sourceType,
  sourceName,
  baseAdditional,
  extraAdditional,
  hfDatasetRepo,
  canonicalSource,
  sourceId,
  sourceKind,
  treatmentAdditional,
  treatmentManifest,
}: DatasetTreatmentAdditionalFieldsParams) => ({
  ...(baseAdditional ?? {}),
  sourceType,
  sourceName,
  ...(hfDatasetRepo ? { hfDatasetRepo } : {}),
  ...(canonicalSource ? { canonicalSource } : {}),
  ...(sourceId ? { sourceId } : {}),
  ...(sourceKind ? { sourceKind } : {}),
  ...(extraAdditional ?? {}),
  ...(treatmentAdditional ? { datasetTreatment: treatmentAdditional } : {}),
  ...(treatmentManifest ? { datasetTreatmentManifest: treatmentManifest } : {}),
});
