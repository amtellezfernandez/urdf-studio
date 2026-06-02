import { beforeEach, describe, expect, it, vi } from "vitest";

const { guardedFetchMock } = vi.hoisted(() => ({
  guardedFetchMock: vi.fn(),
}));

vi.mock("@/shared/lib/backendGuard", () => ({
  guardedFetch: guardedFetchMock,
}));

vi.mock("@/shared/config/runtime", () => ({
  IKD_BASE_URL: "http://localhost:8088",
}));

import {
  createDatasetSession,
  deleteDatasetSessionEpisodes,
  fetchDatasetSessionEpisode,
  fetchDatasetSessionReview,
  fetchDatasetSessionSummary,
  listDatasetSessionEpisodes,
  updateDatasetSessionFlags,
} from "@/features/dataset/datasetSessionApi";

describe("datasetSessionApi", () => {
  beforeEach(() => {
    guardedFetchMock.mockReset();
  });

  it("creates a dataset session through IKD", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schema_version: "1",
          session_id: "dss-00000001",
          source_kind: "recorded",
          episode_count: 1,
          total_frame_count: 2,
          total_duration_sec: 1,
          flagged_episode_count: 0,
          review_counts: [],
          created_at_ns: 1,
          updated_at_ns: 1,
        }),
        { status: 200 }
      )
    );

    const response = await createDatasetSession({
      schema_version: "1",
      source_kind: "recorded",
      episodes: [],
    });

    expect(response.session_id).toBe("dss-00000001");
    expect(guardedFetchMock).toHaveBeenCalledWith(
      "http://localhost:8088/datasets/sessions",
      expect.objectContaining({
        method: "POST",
      }),
      expect.objectContaining({
        context: "Dataset session creation",
        requiredBackends: ["ikd"],
      })
    );
  });

  it("builds the list endpoint query correctly", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schema_version: "1",
          session_id: "dss-00000001",
          total: 0,
          offset: 5,
          limit: 20,
          episodes: [],
        }),
        { status: 200 }
      )
    );

    await listDatasetSessionEpisodes({
      sessionId: "dss-00000001",
      offset: 5,
      limit: 20,
      flaggedOnly: true,
      reason: "low_motion",
    });

    expect(guardedFetchMock).toHaveBeenCalledWith(
      "http://localhost:8088/datasets/sessions/dss-00000001/episodes?offset=5&limit=20&flagged_only=true&reason=low_motion",
      expect.any(Object),
      expect.objectContaining({
        context: "Dataset session episode listing",
      })
    );
  });

  it("targets the summary, review, detail, flag, and delete endpoints", async () => {
    guardedFetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            schema_version: "1",
            session_id: "dss-00000001",
            source_kind: "recorded",
            episode_count: 1,
            total_frame_count: 2,
            total_duration_sec: 1,
            flagged_episode_count: 0,
            review_counts: [],
            created_at_ns: 1,
            updated_at_ns: 1,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            schema_version: "1",
            session_id: "dss-00000001",
            flagged_episode_ids: [],
            review_counts: [],
            summary: {
              schema_version: "1",
              session_id: "dss-00000001",
              source_kind: "recorded",
              episode_count: 1,
              total_frame_count: 2,
              total_duration_sec: 1,
              flagged_episode_count: 0,
              review_counts: [],
              created_at_ns: 1,
              updated_at_ns: 1,
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            schema_version: "1",
            session_id: "dss-00000001",
            episode: {
              episode_id: "episode-1",
              episode_number: 1,
              frame_count: 2,
              duration_sec: 1,
              fps: 1,
              flagged: false,
              detected_reasons: [],
              manual_reasons: [],
              review_reasons: [],
              source_kind: "recorded",
            },
            frames: [],
            metadata: {},
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            schema_version: "1",
            session_id: "dss-00000001",
            flagged_episode_count: 1,
            review_counts: [],
            updated_episode_ids: ["episode-1"],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            schema_version: "1",
            session_id: "dss-00000001",
            deleted_episode_ids: ["episode-1"],
            remaining_episode_count: 0,
          }),
          { status: 200 }
        )
      );

    await fetchDatasetSessionSummary("dss-00000001");
    await fetchDatasetSessionReview("dss-00000001");
    await fetchDatasetSessionEpisode({
      sessionId: "dss-00000001",
      episodeId: "episode-1",
    });
    await updateDatasetSessionFlags({
      sessionId: "dss-00000001",
      request: {
        schema_version: "1",
        updates: [{ episode_id: "episode-1", flagged: true }],
      },
    });
    await deleteDatasetSessionEpisodes({
      sessionId: "dss-00000001",
      request: {
        schema_version: "1",
        episode_ids: ["episode-1"],
      },
    });

    expect(guardedFetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8088/datasets/sessions/dss-00000001/summary",
      expect.any(Object),
      expect.objectContaining({ context: "Dataset session summary" })
    );
    expect(guardedFetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8088/datasets/sessions/dss-00000001/review",
      expect.any(Object),
      expect.objectContaining({ context: "Dataset session review" })
    );
    expect(guardedFetchMock).toHaveBeenNthCalledWith(
      3,
      "http://localhost:8088/datasets/sessions/dss-00000001/episodes/episode-1",
      expect.any(Object),
      expect.objectContaining({ context: "Dataset session episode detail" })
    );
    expect(guardedFetchMock).toHaveBeenNthCalledWith(
      4,
      "http://localhost:8088/datasets/sessions/dss-00000001/flags",
      expect.objectContaining({ method: "POST" }),
      expect.objectContaining({ context: "Dataset session flag update" })
    );
    expect(guardedFetchMock).toHaveBeenNthCalledWith(
      5,
      "http://localhost:8088/datasets/sessions/dss-00000001/delete",
      expect.objectContaining({ method: "POST" }),
      expect.objectContaining({ context: "Dataset session delete" })
    );
  });
});
