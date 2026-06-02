/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createDatasetSessionMock,
  deleteDatasetSessionEpisodesMock,
  fetchDatasetSessionReviewMock,
  fetchDatasetSessionSummaryMock,
  listUnavailableBackendsMock,
  listDatasetSessionEpisodesMock,
  updateDatasetSessionFlagsMock,
} = vi.hoisted(() => ({
  createDatasetSessionMock: vi.fn(),
  deleteDatasetSessionEpisodesMock: vi.fn(),
  fetchDatasetSessionReviewMock: vi.fn(),
  fetchDatasetSessionSummaryMock: vi.fn(),
  listUnavailableBackendsMock: vi.fn(() => []),
  listDatasetSessionEpisodesMock: vi.fn(),
  updateDatasetSessionFlagsMock: vi.fn(),
}));

vi.mock("@/shared/config/backends", () => ({
  listUnavailableBackends: listUnavailableBackendsMock,
}));

vi.mock("@/features/dataset/datasetSessionApi", () => ({
  createDatasetSession: createDatasetSessionMock,
  deleteDatasetSessionEpisodes: deleteDatasetSessionEpisodesMock,
  fetchDatasetSessionReview: fetchDatasetSessionReviewMock,
  fetchDatasetSessionSummary: fetchDatasetSessionSummaryMock,
  listDatasetSessionEpisodes: listDatasetSessionEpisodesMock,
  updateDatasetSessionFlags: updateDatasetSessionFlagsMock,
}));

import { createEpisode } from "@/features/dataset/episodes";
import { DATASET_SESSION_SYNC_DEBOUNCE_MS } from "@/features/dataset/datasetSessionParams";
import { useDatasetSessionController } from "@/features/layout/sidebar/useDatasetSessionController";

type HookOptions = Parameters<typeof useDatasetSessionController>[0];

describe("useDatasetSessionController", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    createDatasetSessionMock.mockReset();
    deleteDatasetSessionEpisodesMock.mockReset();
    fetchDatasetSessionReviewMock.mockReset();
    fetchDatasetSessionSummaryMock.mockReset();
    listUnavailableBackendsMock.mockReset();
    listUnavailableBackendsMock.mockReturnValue([]);
    listDatasetSessionEpisodesMock.mockReset();
    updateDatasetSessionFlagsMock.mockReset();
  });

  it("stays idle when only zero-frame non-HF placeholders are present", async () => {
    let latestResult: ReturnType<typeof useDatasetSessionController> | null = null;
    const optionsRef: { current: HookOptions } = {
      current: {
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
      },
    };

    const Harness = () => {
      latestResult = useDatasetSessionController(optionsRef.current);
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DATASET_SESSION_SYNC_DEBOUNCE_MS + 1);
    });

    expect(createDatasetSessionMock).not.toHaveBeenCalled();
    expect(latestResult?.datasetSessionStatus).toBe("idle");
    expect(latestResult?.datasetSessionSummary).toBeNull();
    expect(latestResult?.datasetSessionError).toBeNull();

    await act(async () => {
      root.unmount();
    });
    vi.useRealTimers();
  });

  it("stays idle when the dataset review backend is unavailable", async () => {
    let latestResult: ReturnType<typeof useDatasetSessionController> | null = null;
    listUnavailableBackendsMock.mockReturnValue([{ id: "ikd" }]);
    const optionsRef: { current: HookOptions } = {
      current: {
        episodes: [
          createEpisode(
            "episode-1",
            1,
            [
              { timestamp: 0, jointPositions: { joint_1: 0 } },
              { timestamp: 1000, jointPositions: { joint_1: 0.1 } },
            ],
            {
              robot_type: "so100",
            }
          ),
        ],
        datasetSources: [{ type: "recorded", name: "session-a", timestamp: 10 }],
      },
    };

    const Harness = () => {
      latestResult = useDatasetSessionController(optionsRef.current);
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DATASET_SESSION_SYNC_DEBOUNCE_MS + 1);
    });

    expect(createDatasetSessionMock).not.toHaveBeenCalled();
    expect(latestResult?.datasetSessionStatus).toBe("idle");
    expect(latestResult?.datasetSessionSummary).toBeNull();
    expect(latestResult?.datasetSessionError).toBeNull();

    await act(async () => {
      root.unmount();
    });
    vi.useRealTimers();
  });

  it("syncs lazy HF sessions without requiring materialized frames", async () => {
    let latestResult: ReturnType<typeof useDatasetSessionController> | null = null;
    createDatasetSessionMock.mockResolvedValue({
      schema_version: "1",
      session_id: "dss-00000001",
      source_kind: "hf",
      source_name: "openai/demo",
      episode_count: 1,
      total_frame_count: 32,
      total_duration_sec: 1.2,
      flagged_episode_count: 0,
      review_counts: [],
      created_at_ns: 1,
      updated_at_ns: 1,
    });
    const optionsRef: { current: HookOptions } = {
      current: {
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
      },
    };

    const Harness = () => {
      latestResult = useDatasetSessionController(optionsRef.current);
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DATASET_SESSION_SYNC_DEBOUNCE_MS + 1);
    });

    expect(createDatasetSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source_kind: "hf",
        episodes: [],
        hf_source: {
          dataset: "openai/demo",
          config: "default",
          split: "train",
          dataset_label: "openai/demo",
          source_name: "openai/demo",
        },
      }),
      expect.any(AbortSignal)
    );
    expect(latestResult?.datasetSessionStatus).toBe("ready");
    expect(latestResult?.datasetSessionSummary?.session_id).toBe("dss-00000001");

    await act(async () => {
      root.unmount();
    });
    vi.useRealTimers();
  });
});
