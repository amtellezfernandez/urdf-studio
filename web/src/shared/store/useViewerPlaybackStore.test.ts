import { beforeEach, describe, expect, it, vi } from "vitest";

import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";
import type { Episode } from "@/features/dataset/episodes";

const PLAYBACK_FRAME_COUNT = 1;
const PLAYBACK_START_FRAME = 0;
const PLAYBACK_ANIMATION_FRAMES = Array.from(
  { length: PLAYBACK_FRAME_COUNT },
  () => ({
    timestamp: 0,
    joints: {},
  })
);

const PLAYBACK_EPISODE: Episode = {
  id: "episode-store-test",
  number: 1,
  createdAt: 0,
  frames: [
    {
      timestamp: 0,
      jointPositions: { joint_a: 0 },
    },
  ],
  metadata: {
    episode_index: 0,
  },
};

beforeEach(() => {
  useViewerPlaybackStore.setState({
    handlers: {},
    pendingCommands: [],
    activeEpisodePlayback: null,
    playbackEpisode: null,
    isPlaying: false,
    currentFrame: 0,
  });
});

describe("useViewerPlaybackStore", () => {
  it("tracks the playback episode context passed to playEpisode", () => {
    const playEpisode = vi.fn();
    useViewerPlaybackStore.getState().registerHandlers({ playEpisode });

    useViewerPlaybackStore.getState().playEpisode(
      PLAYBACK_ANIMATION_FRAMES,
      {
        autoplay: false,
        applyInitialFrame: false,
        startFrame: PLAYBACK_START_FRAME,
        playbackEpisode: PLAYBACK_EPISODE,
      }
    );

    expect(playEpisode).toHaveBeenCalledOnce();
    expect(useViewerPlaybackStore.getState().playbackEpisode).toBe(
      PLAYBACK_EPISODE
    );
  });

  it("clears the playback episode context when animation is cleared", () => {
    const clearAnimation = vi.fn();
    useViewerPlaybackStore.setState({
      handlers: { clearAnimation },
      pendingCommands: [],
      activeEpisodePlayback: {
        frames: PLAYBACK_ANIMATION_FRAMES,
        options: {
          autoplay: false,
          applyInitialFrame: false,
          startFrame: PLAYBACK_START_FRAME,
          playbackEpisode: PLAYBACK_EPISODE,
        },
      },
      playbackEpisode: PLAYBACK_EPISODE,
    });

    useViewerPlaybackStore.getState().clearAnimation();

    expect(clearAnimation).toHaveBeenCalledOnce();
    expect(useViewerPlaybackStore.getState().playbackEpisode).toBeNull();
    expect(useViewerPlaybackStore.getState().activeEpisodePlayback).toBeNull();
  });

  it("replays queued playback commands when handlers register later", () => {
    const playEpisode = vi.fn();
    const playAnimation = vi.fn();

    useViewerPlaybackStore.getState().playEpisode(
      PLAYBACK_ANIMATION_FRAMES,
      {
        autoplay: true,
        applyInitialFrame: true,
        startFrame: PLAYBACK_START_FRAME,
        playbackEpisode: PLAYBACK_EPISODE,
      }
    );
    useViewerPlaybackStore.getState().playAnimation(true);

    expect(useViewerPlaybackStore.getState().pendingCommands).toHaveLength(2);
    expect(playEpisode).not.toHaveBeenCalled();
    expect(playAnimation).not.toHaveBeenCalled();

    useViewerPlaybackStore.getState().registerHandlers({
      playEpisode,
      playAnimation,
    });

    expect(playEpisode).toHaveBeenCalledOnce();
    expect(playEpisode).toHaveBeenCalledWith(PLAYBACK_ANIMATION_FRAMES, {
      autoplay: true,
      applyInitialFrame: true,
      startFrame: PLAYBACK_START_FRAME,
      playbackEpisode: PLAYBACK_EPISODE,
    });
    expect(playAnimation).toHaveBeenCalledOnce();
    expect(playAnimation).toHaveBeenCalledWith(true);
    expect(useViewerPlaybackStore.getState().pendingCommands).toHaveLength(0);
    expect(useViewerPlaybackStore.getState().playbackEpisode).toBe(
      PLAYBACK_EPISODE
    );
  });

  it("does not rehydrate active episode playback only from stored state on handler re-register", () => {
    const firstHandlerPlayEpisode = vi.fn();
    const nextHandlerPlayEpisode = vi.fn();

    useViewerPlaybackStore.getState().registerHandlers({
      playEpisode: firstHandlerPlayEpisode,
    });
    useViewerPlaybackStore.getState().playEpisode(
      PLAYBACK_ANIMATION_FRAMES,
      {
        autoplay: true,
        applyInitialFrame: true,
        startFrame: PLAYBACK_START_FRAME,
        playbackEpisode: PLAYBACK_EPISODE,
      }
    );
    useViewerPlaybackStore.getState().setFrameInfo(PLAYBACK_START_FRAME, PLAYBACK_FRAME_COUNT);
    useViewerPlaybackStore.getState().setHasFrames(true);
    useViewerPlaybackStore.getState().setIsPlaying(true);

    expect(firstHandlerPlayEpisode).toHaveBeenCalledOnce();

    useViewerPlaybackStore.getState().clearHandlers();
    useViewerPlaybackStore.getState().registerHandlers({
      playEpisode: nextHandlerPlayEpisode,
    });

    expect(nextHandlerPlayEpisode).not.toHaveBeenCalled();
    expect(useViewerPlaybackStore.getState().playbackEpisode).toBe(
      PLAYBACK_EPISODE
    );
  });

  it("does not auto-rehydrate active playback on handler register before frames are known", () => {
    const playEpisode = vi.fn();

    useViewerPlaybackStore.setState({
      handlers: {},
      pendingCommands: [],
      activeEpisodePlayback: {
        frames: PLAYBACK_ANIMATION_FRAMES,
        options: {
          autoplay: true,
          applyInitialFrame: true,
          startFrame: PLAYBACK_START_FRAME,
          playbackEpisode: PLAYBACK_EPISODE,
        },
      },
      playbackEpisode: PLAYBACK_EPISODE,
      hasFrames: false,
      isPlaying: true,
      currentFrame: PLAYBACK_START_FRAME,
    });

    useViewerPlaybackStore.getState().registerHandlers({ playEpisode });

    expect(playEpisode).not.toHaveBeenCalled();
  });
});
