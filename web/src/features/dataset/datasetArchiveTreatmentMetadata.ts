type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readDatasetTreatmentManifestFromAdditional = (
  value: unknown
): JsonRecord | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const manifest = value.datasetTreatmentManifest;
  return isRecord(manifest) ? manifest : undefined;
};

export const buildArchiveTreatmentMetadata = ({
  metadataAdditional,
  fallbackAdditional,
  sourceLineageRecords,
}: {
  metadataAdditional?: unknown;
  fallbackAdditional?: unknown;
  sourceLineageRecords?: JsonRecord[];
}) => {
  const manifest =
    readDatasetTreatmentManifestFromAdditional(metadataAdditional) ??
    readDatasetTreatmentManifestFromAdditional(fallbackAdditional);

  return {
    ...(manifest ? { dataset_treatment_manifest: manifest } : {}),
    ...(sourceLineageRecords && sourceLineageRecords.length > 0
      ? { dataset_treatment_sources: sourceLineageRecords }
      : {}),
  };
};

export const mergeArchiveTreatmentAdditional = ({
  additional,
  metadataRecord,
}: {
  additional?: unknown;
  metadataRecord?: unknown;
}) => {
  const metadata = isRecord(metadataRecord) ? metadataRecord : undefined;
  const manifest = metadata?.dataset_treatment_manifest;
  return {
    ...(isRecord(additional) ? additional : {}),
    ...(isRecord(manifest)
      ? {
          datasetTreatmentManifest: manifest,
        }
      : {}),
  };
};
