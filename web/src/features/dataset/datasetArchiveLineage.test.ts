import { describe, expect, it } from "vitest";

import { collectDatasetArchiveLineage } from "@/features/dataset/datasetArchiveLineage";
import type { Episode } from "@/features/dataset/episodes";

const buildEpisode = (
  id: string,
  number: number,
  sourceType: string,
  sourceName: string
): Episode => ({
  id,
  number,
  createdAt: number,
  frames: [
    {
      timestamp: 0,
      jointPositions: { joint_a: 0.1 },
    },
  ],
  metadata: {
    additional: {
      sourceType,
      sourceName,
      datasetTreatmentManifest: {
        manifest_version: "v1",
      },
    },
  },
});

describe("datasetArchiveLineage", () => {
  it("collects source keys, lineage records, and representative treatment manifest", () => {
    const lineage = collectDatasetArchiveLineage([
      buildEpisode("episode-1", 1, "hf", "hf:repo-a:train"),
      buildEpisode("episode-2", 2, "local", "local-folder"),
    ]);

    expect(lineage.episodeIndexToSourceKey.get(0)).toBe("hf:hf:repo-a:train");
    expect(lineage.episodeIndexToSourceKey.get(1)).toBe("local:local-folder");
    expect(lineage.representativeTreatmentManifest).toEqual({
      manifest_version: "v1",
    });
    expect(lineage.sourceLineageRecords).toEqual([
      expect.objectContaining({
        source_key: "hf:hf:repo-a:train",
        source_type: "hf",
      }),
      expect.objectContaining({
        source_key: "local:local-folder",
        source_type: "local",
      }),
    ]);
  });
});
