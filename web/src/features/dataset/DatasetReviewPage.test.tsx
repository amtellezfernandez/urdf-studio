/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DatasetReviewPage } from "@/features/dataset/DatasetReviewPage";
import type { DatasetActions } from "@/features/dataset/datasetActions";
import { DATASET_REVIEW_SESSION_PARAMS } from "@/features/dataset/datasetSessionParams";
import type {
  DatasetSessionEpisodeListResponse,
  DatasetSessionEpisodeSummary,
  DatasetSessionSummary,
} from "@/features/dataset/datasetSessionTypes";
import { createDefaultDatasetConstraintSettings } from "@/features/dataset/episode-viewer/constraintSettings";

const buildMixedDefenseSession = () => {
  const hfEpisode: DatasetSessionEpisodeSummary = {
    episode_id: "hf-so101-pickplace-episode-000004",
    episode_number: 4,
    frame_count: 120,
    duration_sec: 6,
    fps: 20,
    flagged: true,
    detected_reasons: ["timing_irregularity"],
    manual_reasons: ["fps_mismatch"],
    review_reasons: ["timing_irregularity", "fps_mismatch"],
    review_note: "Operator confirmed timing drift during review",
    source_kind: "hf",
    source_name: "lerobot/svla_so101_pickplace",
    source_id: "hf:lerobot/svla_so101_pickplace:main:train:4",
    canonical_source: "lerobot/svla_so101_pickplace",
    content_fingerprint: "sha256:so101-pickplace-episode-000004",
    recorded_video_camera_count: 2,
    recorded_video_stream_count: 2,
    robot_type: "so101",
    naming_status: "named",
  };
  const localEpisode: DatasetSessionEpisodeSummary = {
    episode_id: "local-inspection-run-17-episode-000002",
    episode_number: 2,
    frame_count: 96,
    duration_sec: 4.8,
    fps: 20,
    flagged: false,
    detected_reasons: [],
    manual_reasons: [],
    review_reasons: [],
    source_kind: "local",
    source_name: "/mnt/defense/inspection-run-17",
    source_id: "local:/mnt/defense/inspection-run-17:episode-2",
    canonical_source: "/mnt/defense/inspection-run-17",
    recorded_video_camera_count: 1,
    recorded_video_stream_count: 1,
    robot_type: "so101",
    naming_status: "named",
  };
  const summary: DatasetSessionSummary = {
    schema_version: "dataset-session/v1",
    session_id: "review-session-so101-defense",
    dataset_label: "SO101 Defense Mixed Review",
    source_kind: "mixed",
    source_name: "mixed",
    robot_type: "so101",
    episode_count: 2,
    total_frame_count: hfEpisode.frame_count + localEpisode.frame_count,
    total_duration_sec: hfEpisode.duration_sec + localEpisode.duration_sec,
    flagged_episode_count: 1,
    review_counts: [
      { reason: "timing_irregularity", episode_count: 1 },
      { reason: "fps_mismatch", episode_count: 1 },
    ],
    created_at_ns: 1_700_000_000,
    updated_at_ns: 1_700_000_001,
  };
  const page: DatasetSessionEpisodeListResponse = {
    schema_version: summary.schema_version,
    session_id: summary.session_id,
    total: summary.episode_count,
    offset: 0,
    limit: DATASET_REVIEW_SESSION_PARAMS.pageLimit,
    episodes: [hfEpisode, localEpisode],
  };
  return { hfEpisode, localEpisode, page, summary };
};

const buildHighLossCurationSession = () => {
  const session = buildMixedDefenseSession();
  const highLossEpisode: DatasetSessionEpisodeSummary = {
    ...session.hfEpisode,
    episode_id: "hf-so101-pickplace-episode-high-loss",
    episode_number: 8,
    flagged: false,
    detected_reasons: ["high_loss"],
    manual_reasons: [],
    review_reasons: ["high_loss"],
    review_note: undefined,
  };
  const summary: DatasetSessionSummary = {
    ...session.summary,
    episode_count: 2,
    total_frame_count: highLossEpisode.frame_count + session.localEpisode.frame_count,
    total_duration_sec: highLossEpisode.duration_sec + session.localEpisode.duration_sec,
    flagged_episode_count: 0,
    review_counts: [{ reason: "high_loss", episode_count: 1 }],
  };
  const page: DatasetSessionEpisodeListResponse = {
    ...session.page,
    total: summary.episode_count,
    episodes: [highLossEpisode, session.localEpisode],
  };
  const highLossPage: DatasetSessionEpisodeListResponse = {
    ...page,
    total: 1,
    episodes: [highLossEpisode],
  };
  return { highLossEpisode, highLossPage, page, summary };
};

const buildVlaCurationSession = () => {
  const session = buildMixedDefenseSession();
  const vlaEpisode: DatasetSessionEpisodeSummary = {
    ...session.hfEpisode,
    episode_id: "recorded-so101-vla-failed-demo",
    episode_number: 9,
    flagged: false,
    detected_reasons: [
      "sensor_gap",
      "action_outlier",
      "language_mismatch",
      "failed_demo",
      "duplicate_episode",
    ],
    manual_reasons: [],
    review_reasons: [
      "sensor_gap",
      "action_outlier",
      "language_mismatch",
      "failed_demo",
      "duplicate_episode",
    ],
    review_note: undefined,
    source_kind: "recorded",
    source_name: "operator-vla-run",
  };
  const summary: DatasetSessionSummary = {
    ...session.summary,
    episode_count: 1,
    total_frame_count: vlaEpisode.frame_count,
    total_duration_sec: vlaEpisode.duration_sec,
    flagged_episode_count: 0,
    review_counts: [
      { reason: "sensor_gap", episode_count: 1 },
      { reason: "action_outlier", episode_count: 1 },
      { reason: "language_mismatch", episode_count: 1 },
      { reason: "failed_demo", episode_count: 1 },
      { reason: "duplicate_episode", episode_count: 1 },
    ],
  };
  const page: DatasetSessionEpisodeListResponse = {
    ...session.page,
    total: summary.episode_count,
    episodes: [vlaEpisode],
  };
  return { page, summary, vlaEpisode };
};

const createDatasetActions = (
  session = buildMixedDefenseSession()
): DatasetActions => ({
  loadFromLocal: vi.fn(),
  loadFromHuggingFace: vi.fn(),
  exportToLocal: vi.fn(),
  exportToHuggingFace: vi.fn(),
  loadDemoEpisodes: vi.fn(),
  isImportingFromHF: false,
  isExportingDataset: false,
  isUploadingToHF: false,
  hasEpisodes: true,
  limitCorrectionMode: "report",
  setLimitCorrectionMode: vi.fn(),
  constraintSettings: createDefaultDatasetConstraintSettings(),
  setConstraintSettings: vi.fn(),
  huggingFaceExportGate: {
    kind: "credential",
    enabled: true,
    unavailableSuffix: "",
    unavailableReason: "",
    disabledBadge: "",
    requiredCredentials: [],
  },
  episodes: [],
  currentEpisodeId: session.hfEpisode.episode_id,
  selectEpisode: vi.fn(),
  playEpisodeById: vi.fn().mockResolvedValue(undefined),
  playReviewEpisode: vi.fn().mockResolvedValue(undefined),
  deleteEpisodes: vi.fn().mockResolvedValue(undefined),
  datasetSessionSummary: session.summary,
  datasetSessionStatus: "ready",
  datasetSessionError: null,
  listReviewEpisodes: vi.fn().mockResolvedValue(session.page),
  getReviewState: vi.fn().mockResolvedValue(null),
  updateReviewFlags: vi.fn().mockResolvedValue({
    schema_version: session.summary.schema_version,
    session_id: session.summary.session_id,
    flagged_episode_count: session.summary.flagged_episode_count,
    review_counts: session.summary.review_counts,
    updated_episode_ids: [session.hfEpisode.episode_id],
  }),
});

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const renderReview = async (
  datasetActions: DatasetActions,
  onLeaveReview = vi.fn()
) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(DatasetReviewPage, {
        datasetActions,
        onLeaveReview,
      })
    );
    await flushPromises();
  });
  return { container, onLeaveReview, root };
};

const unmount = async (root: Root) => {
  await act(async () => {
    root.unmount();
  });
};

describe("DatasetReviewPage", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("renders a backend mixed-source review queue with source correspondence", async () => {
    const session = buildMixedDefenseSession();
    const datasetActions = createDatasetActions(session);
    const { container, root } = await renderReview(datasetActions);

    const renderedText = container.textContent ?? "";
    expect(renderedText).toContain(session.summary.dataset_label);
    expect(renderedText).toContain("IKD session");
    expect(renderedText).toContain("Mixed lineage resolver");
    expect(renderedText).toContain("episode 4 from lerobot/svla_so101_pickplace");
    expect(renderedText).toContain("episode 2 from /mnt/defense/inspection-run-17");
    expect(renderedText).toContain("Video 2 cams");
    expect(renderedText).toContain("Timing");
    expect(datasetActions.listReviewEpisodes).toHaveBeenCalledWith({
      flaggedOnly: false,
      limit: DATASET_REVIEW_SESSION_PARAMS.pageLimit,
      offset: 0,
      reason: undefined,
    });

    await unmount(root);
  });

  it("delegates filtering and row actions to the backend session contract", async () => {
    const session = buildMixedDefenseSession();
    const datasetActions = createDatasetActions(session);
    const { container, root } = await renderReview(datasetActions);

    const findButton = (label: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === label
      );

    await act(async () => {
      findButton("Flagged only 1")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      await flushPromises();
    });
    expect(datasetActions.listReviewEpisodes).toHaveBeenLastCalledWith({
      flaggedOnly: true,
      limit: DATASET_REVIEW_SESSION_PARAMS.pageLimit,
      offset: 0,
      reason: undefined,
    });

    await act(async () => {
      findButton("Timing 1")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });
    expect(datasetActions.listReviewEpisodes).toHaveBeenLastCalledWith({
      flaggedOnly: true,
      limit: DATASET_REVIEW_SESSION_PARAMS.pageLimit,
      offset: 0,
      reason: "timing_irregularity",
    });

    await act(async () => {
      container
        .querySelector(`button[aria-label="Open Episode ${session.hfEpisode.episode_number} in 3D replay with synced recorded video"]`)
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });
    expect(datasetActions.playReviewEpisode).toHaveBeenCalledWith(
      session.hfEpisode.episode_id
    );

    await act(async () => {
      container
        .querySelector(`button[aria-label="Unflag Episode ${session.hfEpisode.episode_number}"]`)
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });
    expect(datasetActions.updateReviewFlags).toHaveBeenCalledWith([
      {
        episode_id: session.hfEpisode.episode_id,
        flagged: false,
        reasons: session.hfEpisode.review_reasons,
      },
    ]);

    await act(async () => {
      container
        .querySelector(`button[aria-label="Delete Episode ${session.hfEpisode.episode_number}"]`)
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });
    expect(datasetActions.deleteEpisodes).toHaveBeenCalledWith([
      expect.objectContaining({
        episode_id: session.hfEpisode.episode_id,
        source_id: session.hfEpisode.source_id,
      }),
    ]);

    await unmount(root);
  });

  it("filters and bulk-discards visible high-loss samples", async () => {
    const session = buildHighLossCurationSession();
    const datasetActions = createDatasetActions({
      ...session,
      hfEpisode: session.highLossEpisode,
      localEpisode: buildMixedDefenseSession().localEpisode,
    });
    vi.mocked(datasetActions.listReviewEpisodes).mockImplementation(async (options) =>
      options?.reason === "high_loss" ? session.highLossPage : session.page
    );
    const { container, root } = await renderReview(datasetActions);

    const findButton = (label: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === label
      );

    await act(async () => {
      findButton("High Loss 1")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });
    expect(datasetActions.listReviewEpisodes).toHaveBeenLastCalledWith({
      flaggedOnly: false,
      limit: DATASET_REVIEW_SESSION_PARAMS.pageLimit,
      offset: 0,
      reason: "high_loss",
    });

    await act(async () => {
      findButton("Discard visible High Loss 1")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      await flushPromises();
    });
    expect(datasetActions.deleteEpisodes).toHaveBeenCalledWith([
      expect.objectContaining({
        episode_id: session.highLossEpisode.episode_id,
        source_id: session.highLossEpisode.source_id,
      }),
    ]);

    await unmount(root);
  });

  it("renders VLA curation reason filters from backend review counts", async () => {
    const session = buildVlaCurationSession();
    const datasetActions = createDatasetActions({
      ...session,
      hfEpisode: session.vlaEpisode,
      localEpisode: session.vlaEpisode,
    });
    vi.mocked(datasetActions.listReviewEpisodes).mockResolvedValue(session.page);
    const { container, root } = await renderReview(datasetActions);

    const renderedText = container.textContent ?? "";
    expect(renderedText).toContain("Sensor Gap");
    expect(renderedText).toContain("Action Outlier");
    expect(renderedText).toContain("Language");
    expect(renderedText).toContain("Failed Demo");
    expect(renderedText).toContain("Duplicate");

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Sensor Gap 1")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });
    expect(datasetActions.listReviewEpisodes).toHaveBeenLastCalledWith({
      flaggedOnly: false,
      limit: DATASET_REVIEW_SESSION_PARAMS.pageLimit,
      offset: 0,
      reason: "sensor_gap",
    });

    await unmount(root);
  });

  it("clamps pagination from backend totals instead of locally deleting rows", async () => {
    const session = buildMixedDefenseSession();
    const datasetActions = createDatasetActions(session);
    vi.mocked(datasetActions.listReviewEpisodes).mockImplementation(async (options) => {
      const deletedLastPage = vi.mocked(datasetActions.deleteEpisodes).mock.calls.length > 0;
      const pageLimit = DATASET_REVIEW_SESSION_PARAMS.pageLimit;
      const requestedOffset = options?.offset ?? 0;
      return {
        ...session.page,
        total: deletedLastPage ? pageLimit : pageLimit + 1,
        offset: requestedOffset,
        episodes:
          requestedOffset === pageLimit
            ? deletedLastPage
              ? []
              : [session.localEpisode]
            : [session.hfEpisode],
      };
    });
    const { container, root } = await renderReview(datasetActions);

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Next")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });
    expect(datasetActions.listReviewEpisodes).toHaveBeenLastCalledWith({
      flaggedOnly: false,
      limit: DATASET_REVIEW_SESSION_PARAMS.pageLimit,
      offset: DATASET_REVIEW_SESSION_PARAMS.pageLimit,
      reason: undefined,
    });

    await act(async () => {
      container
        .querySelector(`button[aria-label="Delete Episode ${session.localEpisode.episode_number}"]`)
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });
    expect(datasetActions.listReviewEpisodes).toHaveBeenLastCalledWith({
      flaggedOnly: false,
      limit: DATASET_REVIEW_SESSION_PARAMS.pageLimit,
      offset: 0,
      reason: undefined,
    });

    await unmount(root);
  });

  it("does not expose 3D replay without backend-detail playback", async () => {
    const session = buildMixedDefenseSession();
    const datasetActions = createDatasetActions(session);
    datasetActions.playReviewEpisode = undefined;
    const { container, root } = await renderReview(datasetActions);

    expect(
      container.querySelector(
        `button[aria-label="Open Episode ${session.hfEpisode.episode_number} in 3D replay with synced recorded video"]`
      )
    ).toBeNull();

    await unmount(root);
  });
});
