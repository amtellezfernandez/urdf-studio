/** @vitest-environment jsdom */
import { act, createElement } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DatasetReviewStandalonePage,
  DatasetReviewWorkspace,
} from "@/features/dataset/DatasetReviewStandalonePage";
import { DATASET_REVIEW_SESSION_PARAMS } from "@/features/dataset/datasetSessionParams";
import {
  fetchDatasetSessionSummary,
  listDatasetSessionEpisodes,
} from "@/features/dataset/datasetSessionApi";
import type {
  DatasetSessionEpisodeListResponse,
  DatasetSessionEpisodeSummary,
  DatasetSessionSummary,
} from "@/features/dataset/datasetSessionTypes";
import { createEpisode } from "@/features/dataset/episodes";
import {
  buildDatasetReviewSnapshot,
  writeDatasetReviewSnapshot,
} from "@/features/dataset/datasetReviewSnapshot";
import { writeLatestDatasetReviewSessionId } from "@/shared/config/datasetReviewRoutes";

vi.mock("@/features/dataset/datasetSessionApi", () => ({
  deleteDatasetSessionEpisodes: vi.fn(),
  fetchDatasetSessionSummary: vi.fn(),
  listDatasetSessionEpisodes: vi.fn(),
  updateDatasetSessionFlags: vi.fn(),
}));

const buildStoredReviewSession = () => {
  const episode: DatasetSessionEpisodeSummary = {
    episode_id: "hf-so101-pickplace-episode-000004",
    episode_number: 4,
    frame_count: 120,
    duration_sec: 6,
    fps: 20,
    flagged: true,
    detected_reasons: ["timing_irregularity"],
    manual_reasons: [],
    review_reasons: ["timing_irregularity"],
    source_kind: "hf",
    source_name: "lerobot/svla_so101_pickplace",
    source_id: "hf:lerobot/svla_so101_pickplace:main:train:4",
    canonical_source: "lerobot/svla_so101_pickplace",
  };
  const summary: DatasetSessionSummary = {
    schema_version: "dataset-session/v1",
    session_id: "review-session-so101-defense",
    dataset_label: "SO101 Defense Mixed Review",
    source_kind: "mixed",
    source_name: "mixed",
    episode_count: 1,
    total_frame_count: episode.frame_count,
    total_duration_sec: episode.duration_sec,
    flagged_episode_count: 1,
    review_counts: [{ reason: "timing_irregularity", episode_count: 1 }],
    created_at_ns: 1_700_000_000,
    updated_at_ns: 1_700_000_001,
  };
  const page: DatasetSessionEpisodeListResponse = {
    schema_version: summary.schema_version,
    session_id: summary.session_id,
    total: summary.episode_count,
    offset: 0,
    limit: DATASET_REVIEW_SESSION_PARAMS.pageLimit,
    episodes: [episode],
  };
  return { page, summary };
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const renderWithRoute = async (route: string, element: ReactElement) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [route] }, element));
    await flushPromises();
  });
  return { container, root };
};

const unmount = async (root: Root) => {
  await act(async () => {
    root.unmount();
  });
};

describe("DatasetReviewStandalonePage", () => {
  beforeEach(() => {
    const { page, summary } = buildStoredReviewSession();
    document.body.innerHTML = "";
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(fetchDatasetSessionSummary).mockResolvedValue(summary);
    vi.mocked(listDatasetSessionEpisodes).mockResolvedValue(page);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("uses the stored backend session id for standalone review", async () => {
    const { summary } = buildStoredReviewSession();
    writeLatestDatasetReviewSessionId(summary.session_id);

    const { container, root } = await renderWithRoute(
      "/dataset-review",
      createElement(DatasetReviewStandalonePage)
    );

    expect(fetchDatasetSessionSummary).toHaveBeenCalledWith(
      summary.session_id,
      expect.any(AbortSignal)
    );
    expect(listDatasetSessionEpisodes).toHaveBeenCalledWith({
      sessionId: summary.session_id,
      flaggedOnly: false,
      limit: DATASET_REVIEW_SESSION_PARAMS.pageLimit,
      offset: 0,
      reason: undefined,
    });
    expect(container.textContent).toContain("SO101 Defense Mixed Review");

    await unmount(root);
  });

  it("uses the UrdfOps query session when embedded", async () => {
    const { summary } = buildStoredReviewSession();
    const { container, root } = await renderWithRoute(
      `/urdfops?tab=review&session=${summary.session_id}`,
      createElement(DatasetReviewWorkspace, { embedded: true })
    );

    expect(fetchDatasetSessionSummary).toHaveBeenCalledWith(
      summary.session_id,
      expect.any(AbortSignal)
    );
    expect(container.querySelector("main")?.className).toContain("h-full");
    expect(container.textContent).toContain("episode 4 from lerobot/svla_so101_pickplace");

    await unmount(root);
  });

  it("renders stored episode snapshots when no backend session is available", async () => {
    const snapshot = buildDatasetReviewSnapshot([
      createEpisode(
        "demo-pickup",
        1,
        [
          { timestamp: 0, jointPositions: { shoulder: 0 } },
          { timestamp: 1_000, jointPositions: { shoulder: 1 } },
        ],
        { source: "demo", fps: 1 }
      ),
      createEpisode(
        "demo-inspect",
        2,
        [
          { timestamp: 0, jointPositions: { shoulder: 1 } },
          { timestamp: 1_000, jointPositions: { shoulder: 0 } },
        ],
        { source: "demo", fps: 1 }
      ),
    ]);
    writeDatasetReviewSnapshot(snapshot);

    const { container, root } = await renderWithRoute(
      "/dataset-review",
      createElement(DatasetReviewStandalonePage)
    );

    expect(fetchDatasetSessionSummary).not.toHaveBeenCalled();
    expect(listDatasetSessionEpisodes).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Demo dataset");
    expect(container.textContent).toContain("2 episodes");
    expect(container.textContent).toContain("Episode 1");
    expect(container.textContent).toContain("Episode 2");
    expect(container.textContent).not.toContain("Waiting for dataset review session");

    await unmount(root);
  });
});
