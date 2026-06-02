import type { Episode } from "@/features/dataset/episodes";

export type DatasetLineageAdditional = {
  sourceType?: string;
  sourceName?: string;
  sourceId?: string;
  sourceKind?: string;
  canonicalSource?: string;
  contentFingerprint?: string;
  hfDatasetRepo?: string;
  datasetTreatment?: Record<string, unknown>;
  datasetTreatmentManifest?: Record<string, unknown>;
};

export type DatasetTreatmentSourceLineageRecord = {
  source_key: string;
  source_type: string;
  source_name: string;
  source_id?: string;
  source_kind?: string;
  canonical_source?: string;
  content_fingerprint?: string;
  hf_dataset_repo?: string;
  dataset_treatment?: Record<string, unknown>;
  dataset_treatment_manifest?: Record<string, unknown>;
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  hf: "HF",
  local: "Local",
  recorded: "REC",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const resolveDatasetLineageAdditional = (
  episode: Episode | null | undefined
): DatasetLineageAdditional | null => {
  const additional = episode?.metadata?.additional;
  return isRecord(additional) ? (additional as DatasetLineageAdditional) : null;
};

export const resolveEpisodeSourceDescriptor = (
  episode: Episode | null | undefined,
  fallbackName?: string
) => {
  const additional = resolveDatasetLineageAdditional(episode);
  const datasetTreatment =
    isRecord(additional?.datasetTreatment) ? additional.datasetTreatment : undefined;
  const sourceType =
    typeof additional?.sourceType === "string" ? additional.sourceType : undefined;
  const sourceName =
    typeof additional?.sourceName === "string" && additional.sourceName.trim().length > 0
      ? additional.sourceName.trim()
      : fallbackName;
  return {
    sourceType,
    sourceName,
    sourceId: typeof additional?.sourceId === "string" ? additional.sourceId : undefined,
    sourceKind:
      typeof additional?.sourceKind === "string" ? additional.sourceKind : undefined,
    canonicalSource:
      typeof additional?.canonicalSource === "string"
        ? additional.canonicalSource
        : undefined,
    contentFingerprint:
      typeof additional?.contentFingerprint === "string"
        ? additional.contentFingerprint
        : typeof datasetTreatment?.contentFingerprint === "string"
          ? datasetTreatment.contentFingerprint
        : undefined,
    hfDatasetRepo:
      typeof additional?.hfDatasetRepo === "string" ? additional.hfDatasetRepo : undefined,
    datasetTreatment,
    datasetTreatmentManifest:
      isRecord(additional?.datasetTreatmentManifest)
        ? additional.datasetTreatmentManifest
        : undefined,
  };
};

export const buildEpisodeSourceKey = (
  episode: Episode | null | undefined,
  episodeIndex: number
) => {
  const descriptor = resolveEpisodeSourceDescriptor(
    episode,
    `episode-${episodeIndex + 1}`
  );
  return `${descriptor.sourceType ?? "unknown"}:${descriptor.sourceName ?? `episode-${episodeIndex + 1}`}`;
};

export const buildEpisodeSourceLineageRecord = (
  episode: Episode,
  episodeIndex: number
): DatasetTreatmentSourceLineageRecord => {
  const descriptor = resolveEpisodeSourceDescriptor(
    episode,
    `episode-${episodeIndex + 1}`
  );
  return {
    source_key: buildEpisodeSourceKey(episode, episodeIndex),
    source_type: descriptor.sourceType ?? "unknown",
    source_name: descriptor.sourceName ?? `episode-${episodeIndex + 1}`,
    ...(descriptor.sourceId ? { source_id: descriptor.sourceId } : {}),
    ...(descriptor.sourceKind ? { source_kind: descriptor.sourceKind } : {}),
    ...(descriptor.canonicalSource
      ? { canonical_source: descriptor.canonicalSource }
      : {}),
    ...(descriptor.contentFingerprint
      ? { content_fingerprint: descriptor.contentFingerprint }
      : {}),
    ...(descriptor.hfDatasetRepo ? { hf_dataset_repo: descriptor.hfDatasetRepo } : {}),
    ...(descriptor.datasetTreatment
      ? { dataset_treatment: descriptor.datasetTreatment }
      : {}),
    ...(descriptor.datasetTreatmentManifest
      ? { dataset_treatment_manifest: descriptor.datasetTreatmentManifest }
      : {}),
  };
};

const HF_SOURCE_NAME_PREFIX = /^hf:/i;

export const extractHfRepoIdFromSourceName = (
  sourceName: string | null | undefined
): string | undefined => {
  if (!sourceName) {
    return undefined;
  }
  const trimmed = sourceName.trim();
  if (!trimmed) {
    return undefined;
  }
  if (HF_SOURCE_NAME_PREFIX.test(trimmed)) {
    const withoutPrefix = trimmed.replace(HF_SOURCE_NAME_PREFIX, "");
    const repoId = withoutPrefix.split(":", 1)[0]?.trim();
    return repoId || undefined;
  }
  const repoCandidate = trimmed.split(" [", 1)[0]?.trim() ?? "";
  return repoCandidate.includes("/") ? repoCandidate : undefined;
};

export const resolveEpisodeHfRepoId = (
  episode: Episode | null | undefined
): string | undefined => {
  const descriptor = resolveEpisodeSourceDescriptor(episode);
  return (
    descriptor.hfDatasetRepo ??
    extractHfRepoIdFromSourceName(descriptor.sourceName)
  );
};

export const resolveSourceTypeDisplayLabel = (
  sourceType: string | null | undefined
) => {
  if (!sourceType) {
    return undefined;
  }
  return SOURCE_TYPE_LABELS[sourceType] ?? sourceType;
};
