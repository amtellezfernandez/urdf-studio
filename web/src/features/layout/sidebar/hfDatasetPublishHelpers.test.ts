import { describe, expect, it } from "vitest";

import type { Episode } from "@/features/dataset";
import {
  buildDefaultHfDatasetPublishBranchName,
  buildHfDatasetPublishArchivePath,
  normalizeHfDatasetVisibility,
  resolveDefaultHfDatasetPublishRepoId,
  resolveHfDatasetPublishUrls,
  sanitizeHfDatasetPublishBranchName,
} from "@/features/layout/sidebar/hfDatasetPublishHelpers";

const makeEpisode = (additional?: Record<string, unknown>): Episode =>
  ({
    id: "episode-1",
    number: 1,
    frames: [],
    createdAt: 1,
    metadata: additional ? { additional } : undefined,
  }) as Episode;

describe("resolveDefaultHfDatasetPublishRepoId", () => {
  it("prefers explicit hfDatasetRepo metadata from episodes", () => {
    expect(
      resolveDefaultHfDatasetPublishRepoId({
        episodes: [
          makeEpisode({
            sourceType: "hf",
            hfDatasetRepo: "openai/first-dataset",
          }),
        ],
        datasetSources: [],
        identityName: "demo-user",
        robotBaseName: "robot",
      })
    ).toBe("openai/first-dataset");
  });

  it("strips partition suffixes from source display names", () => {
    expect(
      resolveDefaultHfDatasetPublishRepoId({
        episodes: [],
        datasetSources: [
          {
            type: "hf",
            name: "openai/war-robot [default/train]",
            timestamp: 1,
          },
        ],
        identityName: "demo-user",
        robotBaseName: "robot",
      })
    ).toBe("openai/war-robot");
  });

  it("falls back to the active identity when no hf source exists", () => {
    expect(
      resolveDefaultHfDatasetPublishRepoId({
        episodes: [],
        datasetSources: [],
        identityName: "demo-user",
        robotBaseName: "robot",
      })
    ).toBe("demo-user/robot-edits");
  });
});

describe("HF dataset publish path helpers", () => {
  const publishedAt = new Date("2026-03-23T12:34:56.789Z");

  it("builds a default publish branch name from the configured prefix", () => {
    expect(buildDefaultHfDatasetPublishBranchName(publishedAt)).toBe(
      "urdf-studio-edits-2026-03-23-12-34-56-789z"
    );
  });

  it("sanitizes user-provided branch names", () => {
    expect(sanitizeHfDatasetPublishBranchName("  Team Review / Final  ")).toBe(
      "team-review-/-final"
    );
  });

  it("normalizes dataset visibility safely", () => {
    expect(normalizeHfDatasetVisibility("public")).toBe("public");
    expect(normalizeHfDatasetVisibility("PRIVATE")).toBe("private");
    expect(normalizeHfDatasetVisibility(undefined)).toBe("private");
  });

  it("builds stable archive publish paths", () => {
    expect(
      buildHfDatasetPublishArchivePath({
        robotBaseName: "warbot",
        publishedAt,
      })
    ).toBe("urdf-studio/edits/warbot/2026-03-23-12-34-56-789z.zip");
  });

  it("resolves PR and branch URLs from upload payloads", () => {
    expect(
      resolveHfDatasetPublishUrls({
        repoId: "openai/war-robot",
        branch: "review-1",
        uploadPayload: {
          pr_url: "https://huggingface.co/datasets/openai/war-robot/discussions/1",
        },
      })
    ).toEqual({
      prUrl: "https://huggingface.co/datasets/openai/war-robot/discussions/1",
      branchUrl: "https://huggingface.co/datasets/openai/war-robot/tree/review-1",
      discussionsUrl:
        "https://huggingface.co/datasets/openai/war-robot/discussions",
    });
  });
});
