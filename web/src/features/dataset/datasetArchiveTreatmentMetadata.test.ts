import { describe, expect, it } from "vitest";

import {
  buildArchiveTreatmentMetadata,
  mergeArchiveTreatmentAdditional,
} from "@/features/dataset/datasetArchiveTreatmentMetadata";

describe("datasetArchiveTreatmentMetadata", () => {
  it("builds archive treatment metadata from manifest and lineage records", () => {
    expect(
      buildArchiveTreatmentMetadata({
        metadataAdditional: {
          datasetTreatmentManifest: {
            manifest_version: "v1",
          },
        },
        sourceLineageRecords: [{ source_key: "hf:demo" }],
      })
    ).toEqual({
      dataset_treatment_manifest: {
        manifest_version: "v1",
      },
      dataset_treatment_sources: [{ source_key: "hf:demo" }],
    });
  });

  it("merges archive treatment manifest into runtime additional metadata", () => {
    expect(
      mergeArchiveTreatmentAdditional({
        additional: { sourceType: "hf" },
        metadataRecord: {
          dataset_treatment_manifest: {
            manifest_version: "v1",
          },
        },
      })
    ).toEqual({
      sourceType: "hf",
      datasetTreatmentManifest: {
        manifest_version: "v1",
      },
    });
  });
});
