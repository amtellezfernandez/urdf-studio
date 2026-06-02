// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultDatasetConstraintSettings } from "@/features/dataset/episode-viewer/constraintSettings";
import type { Episode } from "@/features/dataset";
import { EpisodesPanel } from "@/features/layout/panels/EpisodesPanel";
import { withDatasetEpisodeMjlabValidation } from "@/features/layout/sidebar/datasetMjlabValidation";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { useJointStore } from "@/shared/store/useJointStore";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const noop = vi.fn();
const EPISODES_PANEL_TEST_VALUES = {
  createdAt: 0,
  firstFrameTimestamp: 0,
  secondFrameTimestamp: 1000,
  firstJointPosition: 0,
  secondJointPosition: 0.1,
  fps: 30,
  playbackSpeed: 1,
} as const;

const buildEpisode = (): Episode => ({
  id: "episode-1",
  number: 1,
  createdAt: EPISODES_PANEL_TEST_VALUES.createdAt,
  frames: [
    {
      timestamp: EPISODES_PANEL_TEST_VALUES.firstFrameTimestamp,
      jointPositions: {
        shoulder: EPISODES_PANEL_TEST_VALUES.firstJointPosition,
      },
    },
    {
      timestamp: EPISODES_PANEL_TEST_VALUES.secondFrameTimestamp,
      jointPositions: {
        shoulder: EPISODES_PANEL_TEST_VALUES.secondJointPosition,
      },
    },
  ],
  metadata: {
    additional: {},
  },
});

const renderEpisodesPanel = async (episodes: Episode[]) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(EpisodesPanel, {
          episodes,
          isRecording: false,
          recordingStats: { frames: 0, seconds: 0 },
          recordingFps: EPISODES_PANEL_TEST_VALUES.fps,
          setRecordingFps: noop,
          fpsTarget: EPISODES_PANEL_TEST_VALUES.fps,
          setFpsTarget: noop,
          applyFpsTarget: noop,
          limitCorrectionMode: "report",
          setLimitCorrectionMode: noop,
          constraintSettings: createDefaultDatasetConstraintSettings(),
          setConstraintSettings: noop,
          getEpisodeFps: () => EPISODES_PANEL_TEST_VALUES.fps,
          getEpisodeVelocityStatus: () => ({
            overCount: 0,
            maxRatio: 0,
            worstJoint: null,
            worstFrame: null,
            worstTimeSec: null,
          }),
          startRecording: noop,
          stopRecording: noop,
          handleFileUpload: noop,
          playAllEpisodes: noop,
          stopAllPlayback: noop,
          setEpisodeAndFrame: noop,
          setCurrentPlayingEpisodeIndex: noop,
          playEpisode: noop,
          moveEpisode: noop,
          retakeEpisode: noop,
          exportEpisodeToDataFile: noop,
          deleteEpisode: noop,
          isPlayingAll: false,
          currentPlayingEpisodeIndex: null,
          playbackSpeed: EPISODES_PANEL_TEST_VALUES.playbackSpeed,
          setPlaybackSpeed: noop,
        }),
      ),
    );
  });
  await act(async () => {
    await Promise.resolve();
  });

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

afterEach(() => {
  noop.mockClear();
  useJointStore.getState().setDataZeroJointValues({});
  useJointStore.getState().setLeRobotDataZeroJointValues({});
  useJointStore.getState().setDataZeroJointSource("auto");
  useJointStore.getState().setAvailableJoints([]);
  vi.unstubAllGlobals();
});

describe("EpisodesPanel MJLab status", () => {
  it("renders pending MJLab status inside the episode row", async () => {
    const { container, cleanup } = await renderEpisodesPanel([
      withDatasetEpisodeMjlabValidation(
        buildEpisode(),
        {
          phase: "pending",
          episodeId: "episode-1",
          message: "Sending episode 1 to MJLab.",
        },
      ),
    ]);

    expect(container.textContent).toContain(
      "MJLab: Sending episode 1 to MJLab.",
    );
    expect(container.textContent).toContain("MJLab sending");

    await cleanup();
  });

  it("shows rejected MJLab episodes as a compact badge only", async () => {
    const { container, cleanup } = await renderEpisodesPanel([
      withDatasetEpisodeMjlabValidation(
        buildEpisode(),
        {
          phase: "rejected",
          episodeId: "episode-1",
          message:
            "Episode 1 rejected by MJLab with 1 issue(s): max velocity 4.20 rad/s, max acceleration 8.00 rad/s^2.",
          issueSummaries: [
            "joint_velocity_limit (joint shoulder, sample 4): MJLab trajectory exceeds joint velocity limit. value 4.200 > limit 2.000",
          ],
        },
      ),
    ]);

    expect(container.textContent).toContain("MJLab rejected");
    expect(container.textContent).not.toContain(
      "max velocity 4.20 rad/s, max acceleration 8.00 rad/s^2",
    );
    expect(container.textContent).not.toContain(
      "Open the timeline to inspect highlighted samples on the curves.",
    );
    expect(container.textContent).not.toContain(
      "joint_velocity_limit (joint shoulder, sample 4)",
    );

    await cleanup();
  });

  it("does not render a general MJLab row when no episode has validation", async () => {
    const { container, cleanup } = await renderEpisodesPanel([]);

    expect(container.textContent).not.toContain("MJLab:");

    await cleanup();
  });

  it("does not render camera pose preset controls", async () => {
    const { container, cleanup } = await renderEpisodesPanel([]);

    expect(container.textContent).not.toContain("Poses");
    expect(
      container.querySelector(
        '[title="Capture current camera setup as a new pose"]',
      ),
    ).toBeNull();

    await cleanup();
  });

  it("does not render manual dataset zero capture controls", async () => {
    const { container, cleanup } = await renderEpisodesPanel([]);

    expect(
      container.querySelector(
        '[title="Capture current robot joints as dataset zero pose"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector('[title="Clear dataset zero pose"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("Capture Zero");

    await cleanup();
  });

  it("renders target and raw zero pose statuses", async () => {
    useJointStore.getState().setDataZeroJointValues({
      shoulder: EPISODES_PANEL_TEST_VALUES.secondJointPosition,
    });

    const { container, cleanup } = await renderEpisodesPanel([]);

    expect(container.textContent).toContain("Replay zero");
    expect(container.textContent).toContain("Target: 1 joint");
    expect(container.textContent).toContain("Raw: HF/Web3D");

    await cleanup();
  });

  it("selects HF Web3D raw coordinates as the active replay source", async () => {
    useJointStore.getState().setDataZeroJointValues({
      shoulder_pan: EPISODES_PANEL_TEST_VALUES.secondJointPosition,
    });

    const { container, cleanup } = await renderEpisodesPanel([]);

    const rawButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Raw: HF/Web3D"),
    );
    expect(rawButton).toBeTruthy();

    await act(async () => {
      rawButton?.click();
    });

    expect(useJointStore.getState().dataZeroJointSource).toBe("lerobot");
    expect(useJointStore.getState().getActiveDataZeroJointValues()).toEqual({});

    await cleanup();
  });

  it("does not render local LeRobot calibration sources as zero poses", async () => {
    const { container, cleanup } = await renderEpisodesPanel([]);

    expect(container.textContent).toContain("Raw: HF/Web3D");
    expect(container.textContent).not.toContain("sources");
    expect(
      container.querySelector('[aria-label="LeRobot zero pose source"]'),
    ).toBeNull();

    await cleanup();
  });
});
