import { describe, expect, it } from "vitest";

import { createEpisode } from "@/features/dataset/episodes";
import {
  buildDatasetSessionCreateRequest,
  createDatasetSessionFingerprint,
  resolveDatasetSessionSyncPlan,
} from "@/features/dataset/datasetSessionBridge";

const createTestEpisode = (id: string, number: number, sourceType?: string, sourceName?: string) =>
  createEpisode(
    id,
    number,
    [
      {
        timestamp: 0,
        jointPositions: { joint_1: 0 },
      },
      {
        timestamp: 1_000,
        jointPositions: { joint_1: 0.2 },
      },
    ],
    {
      robot_type: "so100",
      ...(sourceType || sourceName
        ? {
            additional: {
              sourceType,
              sourceName,
            },
          }
        : {}),
    }
  );

describe("datasetSessionBridge", () => {
  it("builds a mixed-source session request from dataset sources", () => {
    const firstEpisode = createTestEpisode("episode-1", 1);
    const secondEpisode = createTestEpisode("episode-2", 2);

    const request = buildDatasetSessionCreateRequest({
      episodes: [firstEpisode, secondEpisode],
      datasetSources: [
        { type: "hf", name: "openai/demo", timestamp: 10 },
        { type: "local", name: "/tmp/demo", timestamp: 20 },
      ],
    });

    expect(request.source_kind).toBe("mixed");
    expect(request.dataset_label).toBe("Mixed dataset");
    expect(request.episodes).toHaveLength(2);
    expect(request.episodes[0]?.frames[0]).toEqual({
      timestamp: 0,
      joint_positions: { joint_1: 0 },
    });
  });

  it("falls back to lineage-derived source information when dataset source records are absent", () => {
    const episode = createTestEpisode("episode-1", 1, "hf", "openai/demo");

    const request = buildDatasetSessionCreateRequest({
      episodes: [episode],
      datasetSources: [],
    });

    expect(request.source_kind).toBe("hf");
    expect(request.source_name).toBe("openai/demo");
    expect(request.dataset_label).toBe("openai/demo");
  });

  it("preserves per-episode source lineage when episodes are moved across sources", () => {
    const firstEpisode = createTestEpisode("episode-1", 1, "hf", "openai/demo");
    const secondEpisode = createTestEpisode("episode-2", 2, "local", "/tmp/demo");

    const request = buildDatasetSessionCreateRequest({
      episodes: [firstEpisode, secondEpisode],
      datasetSources: [],
    });

    expect(request.source_kind).toBe("mixed");
    expect(request.episodes).toMatchObject([
      {
        episode_id: "episode-1",
        episode_number: 1,
        source_kind: "hf",
        source_name: "openai/demo",
      },
      {
        episode_id: "episode-2",
        episode_number: 2,
        source_kind: "local",
        source_name: "/tmp/demo",
      },
    ]);
  });

  it("prefers the source-backed HF session path when all episodes share one repo/config/split", () => {
    const episode = createEpisode(
      "episode-1",
      1,
      [
        {
          timestamp: 0,
          jointPositions: { joint_1: 0 },
        },
      ],
      {
        robot_type: "so100",
        additional: {
          sourceType: "hf",
          sourceName: "openai/demo",
          hfDatasetRepo: "openai/demo",
          hfConfig: "default",
          hfSplit: "train",
        },
      }
    );

    const request = buildDatasetSessionCreateRequest({
      episodes: [episode],
      datasetSources: [{ type: "hf", name: "openai/demo", timestamp: 10 }],
    });

    expect(request.episodes).toEqual([]);
    expect(request.hf_source).toEqual({
      dataset: "openai/demo",
      config: "default",
      split: "train",
      dataset_label: "openai/demo",
      source_name: "openai/demo",
    });
  });

  it("filters zero-frame placeholders out of direct session requests", () => {
    const request = buildDatasetSessionCreateRequest({
      episodes: [
        createEpisode("episode-1", 1, [], {
          robot_type: "so100",
          episode_length_sec: 1.2,
        }),
      ],
      datasetSources: [],
    });

    expect(request.episodes).toEqual([]);
  });

  it("does not build a sync plan for zero-frame non-HF placeholders", () => {
    const plan = resolveDatasetSessionSyncPlan({
      episodes: [
        createEpisode("episode-1", 1, [], {
          robot_type: "so100",
          episode_length_sec: 1.2,
          additional: {
            sourceType: "recorded",
            sourceName: "session-a",
          },
        }),
      ],
      datasetSources: [{ type: "recorded", name: "session-a", timestamp: 10 }],
    });

    expect(plan).toEqual({
      request: null,
      fingerprint: null,
    });
  });

  it("keeps lazy HF datasets syncable without materialized frames", () => {
    const plan = resolveDatasetSessionSyncPlan({
      episodes: [
        createEpisode("episode-1", 1, [], {
          robot_type: "so100",
          additional: {
            sourceType: "hf",
            sourceName: "openai/demo",
            hfDatasetRepo: "openai/demo",
            hfConfig: "default",
            hfSplit: "train",
          },
        }),
      ],
      datasetSources: [{ type: "hf", name: "openai/demo", timestamp: 10 }],
    });

    expect(plan.request?.episodes).toEqual([]);
    expect(plan.request?.hf_source).toEqual({
      dataset: "openai/demo",
      config: "default",
      split: "train",
      dataset_label: "openai/demo",
      source_name: "openai/demo",
    });
    expect(plan.fingerprint).toBe("hf:openai/demo:10::hf:openai/demo:default:train");
  });

  it("produces a stable fingerprint from episode and source changes", () => {
    const episode = createTestEpisode("episode-1", 1);

    const first = createDatasetSessionFingerprint({
      episodes: [episode],
      datasetSources: [{ type: "recorded", name: "session-a", timestamp: 10 }],
    });
    const second = createDatasetSessionFingerprint({
      episodes: [episode],
      datasetSources: [{ type: "recorded", name: "session-a", timestamp: 10 }],
    });
    const third = createDatasetSessionFingerprint({
      episodes: [episode],
      datasetSources: [{ type: "recorded", name: "session-b", timestamp: 10 }],
    });

    expect(first).toBe(second);
    expect(third).not.toBe(first);
  });
});
