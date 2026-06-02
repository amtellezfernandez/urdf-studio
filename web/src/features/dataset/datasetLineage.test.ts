import { describe, expect, it } from "vitest";

import {
  buildEpisodeSourceKey,
  buildEpisodeSourceLineageRecord,
  resolveEpisodeHfRepoId,
  resolveEpisodeSourceDescriptor,
  resolveSourceTypeDisplayLabel,
} from "@/features/dataset/datasetLineage";
import type { Episode } from "@/features/dataset/episodes";

const buildEpisode = (additional?: Record<string, unknown>): Episode => ({
  id: "episode-1",
  number: 1,
  createdAt: 1,
  frames: [],
  metadata: additional ? { additional } : {},
});

describe("datasetLineage", () => {
  it("resolves source descriptors from episode metadata", () => {
    const episode = buildEpisode({
      sourceType: "hf",
      sourceName: "openai/demo [train]",
      sourceId: "repo:0",
      sourceKind: "repo",
      canonicalSource: "openai/demo",
    });

    expect(resolveEpisodeSourceDescriptor(episode)).toEqual({
      sourceType: "hf",
      sourceName: "openai/demo [train]",
      sourceId: "repo:0",
      sourceKind: "repo",
      canonicalSource: "openai/demo",
      hfDatasetRepo: undefined,
      datasetTreatment: undefined,
      datasetTreatmentManifest: undefined,
    });
  });

  it("builds source lineage records and resolves hf repo ids", () => {
    const episode = buildEpisode({
      sourceType: "hf",
      sourceName: "hf:openai/demo:train",
      hfDatasetRepo: "openai/demo",
      datasetTreatmentManifest: {
        manifest_version: "v1",
      },
    });

    expect(buildEpisodeSourceKey(episode, 0)).toBe("hf:hf:openai/demo:train");
    expect(buildEpisodeSourceLineageRecord(episode, 0)).toEqual(
      expect.objectContaining({
        source_key: "hf:hf:openai/demo:train",
        source_type: "hf",
        source_name: "hf:openai/demo:train",
        hf_dataset_repo: "openai/demo",
      })
    );
    expect(resolveEpisodeHfRepoId(episode)).toBe("openai/demo");
  });

  it("maps known source types to stable display labels", () => {
    expect(resolveSourceTypeDisplayLabel("hf")).toBe("HF");
    expect(resolveSourceTypeDisplayLabel("local")).toBe("Local");
    expect(resolveSourceTypeDisplayLabel("recorded")).toBe("REC");
    expect(resolveSourceTypeDisplayLabel("custom")).toBe("custom");
  });
});
