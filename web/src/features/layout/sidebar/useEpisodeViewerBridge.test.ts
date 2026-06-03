/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEpisode } from "@/features/dataset";
import { VIEWER3D_FRAME_UPDATE_EVENT_NAME } from "@/features/layout/sidebar/episodeViewerBridgeParams";
import {
  resolveViewerEpisodeForPlaybackIndex,
  resolveViewerFrameUpdateDetail,
  useEpisodeViewerBridge,
} from "@/features/layout/sidebar/useEpisodeViewerBridge";

type HookOptions = Parameters<typeof useEpisodeViewerBridge>[0];

const FIRST_EPISODE = createEpisode(
  "episode-a",
  1,
  [{ timestamp: 0, jointPositions: { joint_a: 0 } }],
  undefined
);
const SECOND_EPISODE = createEpisode(
  "episode-b",
  2,
  [{ timestamp: 0, jointPositions: { joint_b: 0 } }],
  undefined
);

describe("resolveViewerFrameUpdateDetail", () => {
  it("returns null when playback selection is incomplete", () => {
    expect(
      resolveViewerFrameUpdateDetail({
        currentFrame: 3,
        currentPlayingEpisodeIndex: null,
        totalFrames: 12,
      })
    ).toBeNull();
  });

  it("returns the frame update payload when playback selection is complete", () => {
    expect(
      resolveViewerFrameUpdateDetail({
        currentFrame: 3,
        currentPlayingEpisodeIndex: 1,
        totalFrames: 12,
      })
    ).toEqual({
      frame: 3,
      episodeIndex: 1,
      totalFrames: 12,
    });
  });
});

describe("resolveViewerEpisodeForPlaybackIndex", () => {
  it("returns the selected episode when the playback index is valid", () => {
    expect(
      resolveViewerEpisodeForPlaybackIndex({
        episodes: [FIRST_EPISODE, SECOND_EPISODE],
        currentPlayingEpisodeIndex: 1,
      })
    ).toBe(SECOND_EPISODE);
  });

  it("returns null when the playback index is out of range", () => {
    expect(
      resolveViewerEpisodeForPlaybackIndex({
        episodes: [FIRST_EPISODE],
        currentPlayingEpisodeIndex: 4,
      })
    ).toBeNull();
  });
});

describe("useEpisodeViewerBridge", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("dispatches frame update events and syncs the selected viewer episode", async () => {
    const onViewerEpisodeChange = vi.fn();
    const onViewerOpenChange = vi.fn();
    const onViewerSplitViewChange = vi.fn();
    const stopReplayPlaybackState = vi.fn();
    const resetReplayFrameToStart = vi.fn();
    const setCurrentPlayingEpisodeIndex = vi.fn();
    const receivedDetails: Array<unknown> = [];
    const handleFrameUpdate = (event: Event) => {
      receivedDetails.push((event as CustomEvent).detail);
    };
    window.addEventListener(
      VIEWER3D_FRAME_UPDATE_EVENT_NAME,
      handleFrameUpdate as EventListener
    );

    const optionsRef: { current: HookOptions } = {
      current: {
        episodes: [FIRST_EPISODE, SECOND_EPISODE],
        currentPlayingEpisodeIndex: 1,
        currentFrame: 4,
        totalFrames: 20,
        onViewerEpisodeChange,
        onViewerOpenChange,
        onViewerSplitViewChange,
        stopReplayPlaybackState,
        resetReplayFrameToStart,
        setCurrentPlayingEpisodeIndex,
      },
    };
    const Harness = () => {
      useEpisodeViewerBridge(optionsRef.current);
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
    });

    expect(receivedDetails).toEqual([
      {
        frame: 4,
        episodeIndex: 1,
        totalFrames: 20,
      },
    ]);
    expect(onViewerSplitViewChange).toHaveBeenCalledWith(true);
    expect(onViewerOpenChange).toHaveBeenCalledWith(true);
    expect(onViewerEpisodeChange).toHaveBeenCalledWith(SECOND_EPISODE);
    expect(stopReplayPlaybackState).not.toHaveBeenCalled();

    window.removeEventListener(
      VIEWER3D_FRAME_UPDATE_EVENT_NAME,
      handleFrameUpdate as EventListener
    );
    await act(async () => {
      root.unmount();
    });
  });

  it("stops playback and resets viewer state when the episode list becomes empty", async () => {
    const stopReplayPlaybackState = vi.fn();
    const resetReplayFrameToStart = vi.fn();
    const setCurrentPlayingEpisodeIndex = vi.fn();
    const onViewerEpisodeChange = vi.fn();

    const optionsRef: { current: HookOptions } = {
      current: {
        episodes: [FIRST_EPISODE],
        currentPlayingEpisodeIndex: 0,
        currentFrame: 0,
        totalFrames: 1,
        onViewerEpisodeChange,
        stopReplayPlaybackState,
        resetReplayFrameToStart,
        setCurrentPlayingEpisodeIndex,
      },
    };

    const Harness = () => {
      useEpisodeViewerBridge(optionsRef.current);
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
    });

    optionsRef.current = {
      ...optionsRef.current,
      episodes: [],
      currentPlayingEpisodeIndex: null,
    };
    await act(async () => {
      root.render(createElement(Harness));
    });

    expect(onViewerEpisodeChange).toHaveBeenLastCalledWith(null);
    expect(stopReplayPlaybackState).toHaveBeenCalledWith({
      clearLoadedEpisode: true,
    });
    expect(setCurrentPlayingEpisodeIndex).toHaveBeenCalledWith(null);
    expect(resetReplayFrameToStart).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the loaded viewer episode when episodes exist but no playback index is selected", async () => {
    const onViewerEpisodeChange = vi.fn();
    const stopReplayPlaybackState = vi.fn();
    const resetReplayFrameToStart = vi.fn();
    const setCurrentPlayingEpisodeIndex = vi.fn();

    const optionsRef: { current: HookOptions } = {
      current: {
        episodes: [FIRST_EPISODE, SECOND_EPISODE],
        currentPlayingEpisodeIndex: null,
        currentFrame: 0,
        totalFrames: 1,
        onViewerEpisodeChange,
        stopReplayPlaybackState,
        resetReplayFrameToStart,
        setCurrentPlayingEpisodeIndex,
      },
    };

    const Harness = () => {
      useEpisodeViewerBridge(optionsRef.current);
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
    });

    expect(onViewerEpisodeChange).not.toHaveBeenCalled();
    expect(stopReplayPlaybackState).not.toHaveBeenCalled();
    expect(setCurrentPlayingEpisodeIndex).not.toHaveBeenCalled();
    expect(resetReplayFrameToStart).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
