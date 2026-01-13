import { beforeEach, describe, expect, it } from "vitest";
import { viewerPlayback } from "@/features/viewerPlayback";
import { useViewerPlaybackStore } from "@/store/useViewerPlaybackStore";
import { getPlaybackEndAction } from "@/features/playback/episodeCoordinator";

type Episode = {
  frames: Array<{ timestamp: number; joints: Record<string, number> }>;
};

type HarnessState = {
  isPlayingAll: boolean;
  playbackMode: "all" | "single" | null;
  currentPlayingEpisodeIndex: number | null;
};

const resetPlaybackStore = () => {
  useViewerPlaybackStore.setState({
    handlers: {},
    playbackSpeed: 1.0,
    isPlaying: false,
    currentFrame: 0,
    totalFrames: 0,
    hasFrames: false,
  });
};

const makeEpisodes = (counts: number[]): Episode[] =>
  counts.map((count) => ({
    frames: Array.from({ length: count }, (_, index) => ({
      timestamp: index * 100,
      joints: {},
    })),
  }));

const setupFakeViewer = () => {
  const sim = {
    isPlaying: false,
    currentFrame: 0,
    frames: [] as Episode["frames"],
  };

  const publish = () => {
    const store = useViewerPlaybackStore.getState();
    store.setIsPlaying(sim.isPlaying);
    store.setHasFrames(sim.frames.length > 0);
    store.setFrameInfo(sim.currentFrame, sim.frames.length);
  };

  const handlers = {
    playAnimation: (forceState?: boolean) => {
      if (sim.frames.length === 0) return;
      const nextState = forceState ?? !sim.isPlaying;
      const lastIndex = sim.frames.length - 1;
      if (nextState && sim.currentFrame >= lastIndex) {
        return;
      }
      sim.isPlaying = nextState;
      publish();
    },
    uploadMotionData: () => undefined,
    playEpisode: (frames: Episode["frames"], options?: { autoplay?: boolean; startFrame?: number }) => {
      sim.frames = frames;
      const startFrame = options?.startFrame ?? 0;
      const clamped = Math.max(0, Math.min(startFrame, frames.length - 1));
      sim.currentFrame = clamped;
      sim.isPlaying = options?.autoplay ?? true;
      publish();
    },
    stopAnimation: () => {
      sim.isPlaying = false;
      publish();
    },
    clearAnimation: () => {
      sim.isPlaying = false;
      sim.currentFrame = 0;
      sim.frames = [];
      publish();
    },
    setFrame: (frameIndex: number) => {
      if (sim.frames.length === 0) return;
      const clamped = Math.max(0, Math.min(frameIndex, sim.frames.length - 1));
      sim.currentFrame = clamped;
      sim.isPlaying = false;
      publish();
    },
  };

  useViewerPlaybackStore.getState().registerHandlers(handlers);
  publish();

  const advanceToEnd = () => {
    if (!sim.isPlaying || sim.frames.length === 0) {
      return;
    }
    sim.currentFrame = Math.max(sim.frames.length - 1, 0);
    sim.isPlaying = false;
    publish();
  };

  return { advanceToEnd };
};

const snapshotStore = () => {
  const state = useViewerPlaybackStore.getState();
  return {
    isPlaying: state.isPlaying,
    currentFrame: state.currentFrame,
    totalFrames: state.totalFrames,
    hasFrames: state.hasFrames,
  };
};

const createHarness = (episodes: Episode[]) => {
  const viewerSim = setupFakeViewer();

  const state: HarnessState = {
    isPlayingAll: false,
    playbackMode: null,
    currentPlayingEpisodeIndex: null,
  };
  let currentLoadedEpisodeIndex: number | null = null;
  let previousIsPlaying = useViewerPlaybackStore.getState().isPlaying;

  const setEpisodeAndFrame = (episodeIndex: number, frameIndex: number) => {
    if (episodeIndex < 0 || episodeIndex >= episodes.length) return;
    const episode = episodes[episodeIndex];
    if (!episode || episode.frames.length === 0) return;

    const clampedFrame = Math.max(
      0,
      Math.min(frameIndex, episode.frames.length - 1)
    );
    const shouldAutoplay = state.isPlayingAll;
    const needsReload = currentLoadedEpisodeIndex !== episodeIndex;

    if (needsReload) {
      viewerPlayback.playEpisode(episode.frames, {
        autoplay: shouldAutoplay,
        startFrame: clampedFrame,
      });
      currentLoadedEpisodeIndex = episodeIndex;
    } else {
      viewerPlayback.setFrame(clampedFrame);
      if (shouldAutoplay) {
        viewerPlayback.playAnimation(true);
      }
    }

    state.currentPlayingEpisodeIndex = episodeIndex;
    syncPlaybackEnd();
  };

  const stopAllPlayback = () => {
    state.isPlayingAll = false;
    state.playbackMode = null;
    viewerPlayback.stopAnimation();
    currentLoadedEpisodeIndex = null;
    syncPlaybackEnd();
  };

  const playAllEpisodes = (overrideFrame?: number) => {
    if (episodes.length === 0) return;
    if (state.isPlayingAll) {
      stopAllPlayback();
      return;
    }

    state.playbackMode = "all";
    state.isPlayingAll = true;
    const startIndex = state.currentPlayingEpisodeIndex ?? 0;
    const storeFrame = useViewerPlaybackStore.getState().currentFrame;
    const startFrame = overrideFrame !== undefined ? overrideFrame : storeFrame;
    setEpisodeAndFrame(startIndex, startFrame);
    syncPlaybackEnd();
  };

  const playEpisode = (episodeIndex: number) => {
    if (episodeIndex < 0 || episodeIndex >= episodes.length) return;
    const episode = episodes[episodeIndex];
    if (!episode || episode.frames.length === 0) {
      stopAllPlayback();
      return;
    }

    const isCurrentlyPlaying =
      state.currentPlayingEpisodeIndex === episodeIndex && state.isPlayingAll;
    if (isCurrentlyPlaying) {
      state.isPlayingAll = false;
      state.playbackMode = null;
      viewerPlayback.stopAnimation();
      syncPlaybackEnd();
      return;
    }

    state.playbackMode = "single";
    state.isPlayingAll = true;
    setEpisodeAndFrame(episodeIndex, 0);
    syncPlaybackEnd();
  };

  const nextEpisode = () => {
    if (episodes.length === 0) return;
    stopAllPlayback();
    const currentIndex = state.currentPlayingEpisodeIndex ?? 0;
    const nextIndex = (currentIndex + 1) % episodes.length;
    setEpisodeAndFrame(nextIndex, 0);
    state.currentPlayingEpisodeIndex = nextIndex;
    syncPlaybackEnd();
  };

  const previousEpisode = () => {
    if (episodes.length === 0) return;
    const currentIndex = state.currentPlayingEpisodeIndex ?? 0;
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : episodes.length - 1;
    setEpisodeAndFrame(prevIndex, 0);
    state.currentPlayingEpisodeIndex = prevIndex;
    syncPlaybackEnd();
  };

  const syncPlaybackEnd = () => {
    const store = useViewerPlaybackStore.getState();
    const wasPlaying = previousIsPlaying;
    previousIsPlaying = store.isPlaying;

    if (!wasPlaying || store.isPlaying) {
      return;
    }

    const action = getPlaybackEndAction({
      mode: state.playbackMode,
      currentFrame: store.currentFrame,
      totalFrames: store.totalFrames,
      currentEpisodeIndex: state.currentPlayingEpisodeIndex,
      episodes,
    });

    if (action.type === "advance") {
      state.playbackMode = "all";
      state.isPlayingAll = true;
      setEpisodeAndFrame(action.nextIndex, 0);
      return;
    }

    if (action.type === "stop") {
      stopAllPlayback();
      return;
    }

    if (state.isPlayingAll) {
      state.isPlayingAll = false;
    }
  };

  const advanceToEnd = () => {
    viewerSim.advanceToEnd();
    syncPlaybackEnd();
  };

  const scrubToFrame = (frameIndex: number) => {
    viewerPlayback.setFrame(frameIndex);
    syncPlaybackEnd();
  };

  const snapshot = () => ({
    ...state,
    store: snapshotStore(),
  });

  return {
    advanceToEnd,
    playAllEpisodes,
    playEpisode,
    nextEpisode,
    previousEpisode,
    scrubToFrame,
    stopAllPlayback,
    snapshot,
  };
};

describe("playback scenarios", () => {
  beforeEach(() => {
    resetPlaybackStore();
  });

  it("advances through playable episodes when playing all", () => {
    const harness = createHarness(makeEpisodes([3, 0, 2]));

    harness.playAllEpisodes();
    expect(harness.snapshot()).toMatchInlineSnapshot(`
      {
        "currentPlayingEpisodeIndex": 0,
        "isPlayingAll": true,
        "playbackMode": "all",
        "store": {
          "currentFrame": 0,
          "hasFrames": true,
          "isPlaying": true,
          "totalFrames": 3,
        },
      }
    `);

    harness.advanceToEnd();
    expect(harness.snapshot()).toMatchInlineSnapshot(`
      {
        "currentPlayingEpisodeIndex": 2,
        "isPlayingAll": true,
        "playbackMode": "all",
        "store": {
          "currentFrame": 0,
          "hasFrames": true,
          "isPlaying": true,
          "totalFrames": 2,
        },
      }
    `);

    harness.advanceToEnd();
    expect(harness.snapshot().currentPlayingEpisodeIndex).toBe(0);
    expect(harness.snapshot().isPlayingAll).toBe(true);
  });

  it("stops at end of a single episode without advancing", () => {
    const harness = createHarness(makeEpisodes([2, 2]));

    harness.playEpisode(1);
    harness.advanceToEnd();

    expect(harness.snapshot()).toMatchInlineSnapshot(`
      {
        "currentPlayingEpisodeIndex": 1,
        "isPlayingAll": false,
        "playbackMode": null,
        "store": {
          "currentFrame": 1,
          "hasFrames": true,
          "isPlaying": false,
          "totalFrames": 2,
        },
      }
    `);
  });

  it("next episode loads frame 0 and stays paused", () => {
    const harness = createHarness(makeEpisodes([2, 2, 2]));

    harness.playAllEpisodes();
    harness.nextEpisode();

    expect(harness.snapshot()).toMatchInlineSnapshot(`
      {
        "currentPlayingEpisodeIndex": 1,
        "isPlayingAll": false,
        "playbackMode": null,
        "store": {
          "currentFrame": 0,
          "hasFrames": true,
          "isPlaying": false,
          "totalFrames": 2,
        },
      }
    `);
  });

  it("scrub stops playback and resumes from the same frame", () => {
    const harness = createHarness(makeEpisodes([5]));

    harness.playAllEpisodes();
    harness.scrubToFrame(3);
    const afterScrub = harness.snapshot();

    expect(afterScrub.store.isPlaying).toBe(false);
    expect(afterScrub.store.currentFrame).toBe(3);
    expect(afterScrub.isPlayingAll).toBe(false);

    harness.playAllEpisodes();
    expect(harness.snapshot().store.currentFrame).toBe(3);
  });

  it("stop keeps the current frame position", () => {
    const harness = createHarness(makeEpisodes([4]));

    harness.playAllEpisodes();
    harness.scrubToFrame(2);
    harness.stopAllPlayback();

    expect(harness.snapshot().store.currentFrame).toBe(2);
  });

  it("previous episode respects paused state", () => {
    const harness = createHarness(makeEpisodes([2, 2]));

    harness.playAllEpisodes();
    harness.stopAllPlayback();
    harness.previousEpisode();

    expect(harness.snapshot()).toMatchInlineSnapshot(`
      {
        "currentPlayingEpisodeIndex": 1,
        "isPlayingAll": false,
        "playbackMode": null,
        "store": {
          "currentFrame": 0,
          "hasFrames": true,
          "isPlaying": false,
          "totalFrames": 2,
        },
      }
    `);
  });
});
