/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  buildDatasetArchiveArtifactMock,
  toastSuccessMock,
  uploadDatasetArchiveForOpsMock,
} = vi.hoisted(() => ({
  buildDatasetArchiveArtifactMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  uploadDatasetArchiveForOpsMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: toastSuccessMock,
  },
}));

vi.mock("@/features/layout/sidebar/datasetArchiveExport", () => ({
  buildDatasetArchiveArtifact: buildDatasetArchiveArtifactMock,
}));

vi.mock("@/features/layout/sidebar/datasetLocalExportApi", () => ({
  uploadDatasetArchiveForOps: uploadDatasetArchiveForOpsMock,
}));

import type { Episode } from "@/features/dataset";
import { useDatasetExportController } from "@/features/layout/sidebar/useDatasetExportController";

type HookOptions = Parameters<typeof useDatasetExportController>[0];

const createFrame = (timestamp: number, shoulder: number): Episode["frames"][number] => ({
  timestamp,
  jointPositions: {
    shoulder,
  },
});

const createTestEpisode = ({
  id,
  number,
  frames,
  additional,
}: {
  id: string;
  number: number;
  frames: Episode["frames"];
  additional?: Record<string, unknown>;
}): Episode => ({
  id,
  number,
  createdAt: number,
  frames,
  metadata: {
    robot_type: "Demo Bot",
    additional,
  },
});

const createHookOptions = (episodes: Episode[]): HookOptions => ({
  episodes,
  datasetSources: [],
  getHfLazyEpisodeRef: () => null,
  robotBaseName: "Demo Bot",
  robotName: "Demo Robot",
  availableJoints: ["shoulder"],
  exportLimitMode: "report",
  jointLimits: {},
  metricsEnabled: true,
  loadJSZip: vi.fn(),
  effectiveHfToken: null,
  hfTokenUnavailableReason: "",
  logMetric: vi.fn(),
});

describe("useDatasetExportController", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    buildDatasetArchiveArtifactMock.mockReset();
    toastSuccessMock.mockReset();
    uploadDatasetArchiveForOpsMock.mockReset();
  });

  it("exports loaded recorded episodes to Ops through the Studio v3 archive builder", async () => {
    const archiveBlob = new Blob(["v3-archive"], { type: "application/zip" });
    buildDatasetArchiveArtifactMock.mockResolvedValue({
      blob: archiveBlob,
      datasetName: "demo-bot-recorded-v3",
      totalFrames: 2,
      packDurationMs: 12,
    });
    uploadDatasetArchiveForOpsMock.mockResolvedValue({
      datasetPath: "/tmp/urdf-studio-teleop-replays/demo-bot-recorded-v3",
      datasetName: "demo-bot-recorded-v3",
      fileCount: 6,
    });

    const recordedEpisode = createTestEpisode({
      id: "recorded-episode",
      number: 1,
      frames: [createFrame(0, 0.1), createFrame(50, 0.2)],
      additional: {
        isRecorded: true,
        sourceType: "recorded",
      },
    });
    const nonRecordedEpisode = createTestEpisode({
      id: "hf-episode",
      number: 2,
      frames: [createFrame(0, 0.3)],
      additional: {
        sourceType: "hf",
      },
    });
    const emptyRecordedEpisode = createTestEpisode({
      id: "empty-recorded-episode",
      number: 3,
      frames: [],
      additional: {
        sourceType: "recorded",
      },
    });

    const options = createHookOptions([
      recordedEpisode,
      nonRecordedEpisode,
      emptyRecordedEpisode,
    ]);
    let latestResult: ReturnType<typeof useDatasetExportController> | null = null;

    const Harness = () => {
      latestResult = useDatasetExportController(options);
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
    });

    let exportResult;
    await act(async () => {
      exportResult = await latestResult?.exportRecordedEpisodesForOps();
    });

    expect(buildDatasetArchiveArtifactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        episodes: [recordedEpisode],
        robotBaseName: "Demo Bot",
        robotName: "Demo Robot",
        availableJoints: ["shoulder"],
        datasetName: "demo-bot-recorded-v3",
      }),
    );
    expect(uploadDatasetArchiveForOpsMock).toHaveBeenCalledWith({
      archive: archiveBlob,
      datasetName: "demo-bot-recorded-v3",
    });
    expect(options.logMetric).toHaveBeenCalledWith(
      "dataset.export.ops_local",
      expect.objectContaining({
        episodes: 1,
        skipped: 2,
        datasetPath: "/tmp/urdf-studio-teleop-replays/demo-bot-recorded-v3",
      }),
    );
    expect(exportResult).toEqual({
      datasetPaths: ["/tmp/urdf-studio-teleop-replays/demo-bot-recorded-v3"],
      exportedCount: 1,
      skippedCount: 2,
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Exported 1 recorded episode for URDF Ops",
    );

    await act(async () => {
      root.unmount();
    });
  });
});
