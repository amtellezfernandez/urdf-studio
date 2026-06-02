/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";

import { createEpisode, type Episode } from "@/features/dataset";
import type { LoadedReplayEpisode } from "@/features/layout/sidebar/useReplaySessionController";
import { useEpisodeReviewController } from "@/features/layout/sidebar/useEpisodeReviewController";
import { viewerPlayback } from "@/features/viewer/playback/viewerPlayback";
import type { EpisodeSaveHandler } from "@/shared/types/feature";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/features/viewer/playback/viewerPlayback", () => ({
  viewerPlayback: {
    playEpisode: vi.fn(),
  },
}));

const EPISODE_SAVE_REPLAY_FIXTURE = {
  currentFrameIndex: 1,
  editedJointValue: 1.5,
  jointName: "joint_a",
  resampleEndJointValue: 0.3,
  robotBaseName: "test_robot",
  savedEpisodeIndex: 0,
  saveEndJointValue: 0.25,
  sourceEpisodeId: "episode-save",
  sourceEpisodeNumber: 1,
  sourceStartJointValue: 0,
  sourceStartTimestampMs: 0,
  sourceEndTimestampMs: 100,
  targetFps: 30,
} as const;

const createRef = <T,>(current: T): MutableRefObject<T> => ({ current });

describe("useEpisodeReviewController", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
  });

  it("replays overwritten episode frames without relying on a synchronous state updater", async () => {
    const {
      currentFrameIndex,
      editedJointValue,
      jointName,
      robotBaseName,
      savedEpisodeIndex,
      saveEndJointValue,
      sourceEpisodeId,
      sourceEpisodeNumber,
      sourceStartJointValue,
      sourceStartTimestampMs,
      sourceEndTimestampMs,
      targetFps,
    } = EPISODE_SAVE_REPLAY_FIXTURE;
    const sourceEpisode = createEpisode(
      sourceEpisodeId,
      sourceEpisodeNumber,
      [
        {
          timestamp: sourceStartTimestampMs,
          jointPositions: { [jointName]: sourceStartJointValue },
        },
        {
          timestamp: sourceEndTimestampMs,
          jointPositions: { [jointName]: saveEndJointValue },
        },
      ],
      undefined
    );
    const editedEpisode: Episode = {
      ...sourceEpisode,
      frames: sourceEpisode.frames.map((frame, index) =>
        index === currentFrameIndex
          ? {
              ...frame,
              jointPositions: {
                ...frame.jointPositions,
                [jointName]: editedJointValue,
              },
            }
          : frame
      ),
    };
    const episodesRef = createRef<Episode[]>([sourceEpisode]);
    const setEpisodes = vi.fn();
    const setCurrentPlayingEpisodeIndex = vi.fn();
    const currentLoadedEpisodeRef = createRef<LoadedReplayEpisode | null>(null);
    const isPlayingAllRef = createRef(false);
    const onViewerEpisodeChange = vi.fn();
    const onViewerOpenChange = vi.fn();
    const onViewerSplitViewChange = vi.fn();
    let saveHandler: EpisodeSaveHandler | undefined;

    const Harness = () => {
      useEpisodeReviewController({
        jointLimits: {},
        robotBaseName,
        targetFps,
        currentFrame: currentFrameIndex,
        episodesRef,
        setEpisodes,
        setCurrentPlayingEpisodeIndex,
        currentLoadedEpisodeRef,
        isPlayingAllRef,
        getJointOrderForFrames: () => [jointName],
        onEpisodeSaveHandlerChange: (handler) => {
          saveHandler = handler;
        },
        onViewerEpisodeChange,
        onViewerOpenChange,
        onViewerSplitViewChange,
      });
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
    });

    expect(saveHandler).toBeDefined();
    act(() => {
      saveHandler?.(editedEpisode, false);
    });

    const savedEpisode = episodesRef.current[savedEpisodeIndex];
    expect(setEpisodes).toHaveBeenCalledWith(episodesRef.current);
    expect(setEpisodes.mock.calls[0]?.[0]).not.toEqual(expect.any(Function));
    expect(savedEpisode?.frames[currentFrameIndex]?.jointPositions[jointName]).toBe(
      editedJointValue
    );
    expect(setCurrentPlayingEpisodeIndex).toHaveBeenCalledWith(savedEpisodeIndex);
    expect(onViewerSplitViewChange).toHaveBeenCalledWith(true);
    expect(onViewerOpenChange).toHaveBeenCalledWith(true);
    expect(onViewerEpisodeChange).toHaveBeenCalledWith(savedEpisode);
    expect(currentLoadedEpisodeRef.current).toEqual({
      index: savedEpisodeIndex,
      episodeId: sourceEpisode.id,
      framesRef: savedEpisode?.frames,
    });
    expect(viewerPlayback.playEpisode).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          joints: expect.objectContaining({ [jointName]: editedJointValue }),
        }),
      ]),
      expect.objectContaining({
        autoplay: false,
        startFrame: currentFrameIndex,
        playbackEpisode: savedEpisode,
      })
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("replays the active episode after target FPS resampling changes its frames", async () => {
    const {
      currentFrameIndex,
      jointName,
      resampleEndJointValue,
      robotBaseName,
      savedEpisodeIndex,
      sourceEpisodeId,
      sourceEpisodeNumber,
      sourceStartJointValue,
      sourceStartTimestampMs,
      sourceEndTimestampMs,
      targetFps,
    } = EPISODE_SAVE_REPLAY_FIXTURE;
    const sourceEpisode = createEpisode(
      sourceEpisodeId,
      sourceEpisodeNumber,
      [
        {
          timestamp: sourceStartTimestampMs,
          jointPositions: { [jointName]: sourceStartJointValue },
        },
        {
          timestamp: sourceEndTimestampMs,
          jointPositions: { [jointName]: resampleEndJointValue },
        },
      ],
      undefined
    );
    const episodesRef = createRef<Episode[]>([sourceEpisode]);
    const setEpisodes = vi.fn();
    const currentLoadedEpisodeRef = createRef<LoadedReplayEpisode | null>({
      index: savedEpisodeIndex,
      episodeId: sourceEpisode.id,
      framesRef: sourceEpisode.frames,
    });
    const isPlayingAllRef = createRef(true);
    const onViewerEpisodeChange = vi.fn();
    const onViewerOpenChange = vi.fn();
    const onViewerSplitViewChange = vi.fn();
    let controllerResult: ReturnType<typeof useEpisodeReviewController> | null = null;

    const Harness = () => {
      controllerResult = useEpisodeReviewController({
        jointLimits: {},
        robotBaseName,
        targetFps,
        currentFrame: currentFrameIndex,
        episodesRef,
        setEpisodes,
        setCurrentPlayingEpisodeIndex: vi.fn(),
        currentLoadedEpisodeRef,
        isPlayingAllRef,
        getJointOrderForFrames: () => [jointName],
        onViewerEpisodeChange,
        onViewerOpenChange,
        onViewerSplitViewChange,
      });
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
    });

    expect(controllerResult).not.toBeNull();
    act(() => {
      controllerResult?.applyTargetFps();
    });

    const resampledEpisode = episodesRef.current[savedEpisodeIndex];
    expect(setEpisodes).toHaveBeenCalledWith(episodesRef.current);
    expect(setEpisodes.mock.calls[0]?.[0]).not.toEqual(expect.any(Function));
    expect(resampledEpisode?.frames.length).toBeGreaterThan(
      sourceEpisode.frames.length
    );
    expect(currentLoadedEpisodeRef.current).toEqual({
      index: savedEpisodeIndex,
      episodeId: sourceEpisode.id,
      framesRef: resampledEpisode?.frames,
    });
    expect(onViewerSplitViewChange).toHaveBeenCalledWith(true);
    expect(onViewerOpenChange).toHaveBeenCalledWith(true);
    expect(onViewerEpisodeChange).toHaveBeenCalledWith(resampledEpisode);
    expect(viewerPlayback.playEpisode).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          joints: expect.objectContaining({ [jointName]: resampleEndJointValue }),
        }),
      ]),
      expect.objectContaining({
        autoplay: true,
        startFrame: currentFrameIndex,
        playbackEpisode: resampledEpisode,
      })
    );

    await act(async () => {
      root.unmount();
    });
  });
});
