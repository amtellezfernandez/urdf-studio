import { beforeEach, describe, expect, it, vi } from "vitest";

import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";

const PLAYBACK_FRAME_COUNT = 1;
const PLAYBACK_START_FRAME = 0;
const PLAYBACK_ANIMATION_FRAMES = Array.from(
  { length: PLAYBACK_FRAME_COUNT },
  () => ({
    timestamp: 0,
    joints: {},
  })
);
const PLAYBACK_OPTIONS = {
  autoplay: true,
  applyInitialFrame: true,
  startFrame: PLAYBACK_START_FRAME,
};

beforeEach(() => {
  useViewerPlaybackStore.setState({
    handlers: {},
    pendingCommands: [],
    activeFramePlayback: null,
    isPlaying: false,
    currentFrame: 0,
  });
});

describe("useViewerPlaybackStore", () => {
  it("tracks the active frame playback passed to playFrames", () => {
    const playFrames = vi.fn();
    useViewerPlaybackStore.getState().registerHandlers({ playFrames });

    useViewerPlaybackStore.getState().playFrames(
      PLAYBACK_ANIMATION_FRAMES,
      PLAYBACK_OPTIONS
    );

    expect(playFrames).toHaveBeenCalledOnce();
    expect(useViewerPlaybackStore.getState().activeFramePlayback).toEqual({
      frames: PLAYBACK_ANIMATION_FRAMES,
      options: PLAYBACK_OPTIONS,
    });
  });

  it("clears active frame playback when animation is cleared", () => {
    const clearAnimation = vi.fn();
    useViewerPlaybackStore.setState({
      handlers: { clearAnimation },
      pendingCommands: [],
      activeFramePlayback: {
        frames: PLAYBACK_ANIMATION_FRAMES,
        options: PLAYBACK_OPTIONS,
      },
    });

    useViewerPlaybackStore.getState().clearAnimation();

    expect(clearAnimation).toHaveBeenCalledOnce();
    expect(useViewerPlaybackStore.getState().activeFramePlayback).toBeNull();
  });

  it("replays queued playback commands when handlers register later", () => {
    const playFrames = vi.fn();
    const playAnimation = vi.fn();

    useViewerPlaybackStore.getState().playFrames(
      PLAYBACK_ANIMATION_FRAMES,
      PLAYBACK_OPTIONS
    );
    useViewerPlaybackStore.getState().playAnimation(true);

    expect(useViewerPlaybackStore.getState().pendingCommands).toHaveLength(2);
    expect(playFrames).not.toHaveBeenCalled();
    expect(playAnimation).not.toHaveBeenCalled();

    useViewerPlaybackStore.getState().registerHandlers({
      playFrames,
      playAnimation,
    });

    expect(playFrames).toHaveBeenCalledOnce();
    expect(playFrames).toHaveBeenCalledWith(PLAYBACK_ANIMATION_FRAMES, PLAYBACK_OPTIONS);
    expect(playAnimation).toHaveBeenCalledOnce();
    expect(playAnimation).toHaveBeenCalledWith(true);
    expect(useViewerPlaybackStore.getState().pendingCommands).toHaveLength(0);
    expect(useViewerPlaybackStore.getState().activeFramePlayback).toEqual({
      frames: PLAYBACK_ANIMATION_FRAMES,
      options: PLAYBACK_OPTIONS,
    });
  });

  it("does not rehydrate active frame playback only from stored state on handler re-register", () => {
    const firstHandlerPlayFrames = vi.fn();
    const nextHandlerPlayFrames = vi.fn();

    useViewerPlaybackStore.getState().registerHandlers({
      playFrames: firstHandlerPlayFrames,
    });
    useViewerPlaybackStore.getState().playFrames(
      PLAYBACK_ANIMATION_FRAMES,
      PLAYBACK_OPTIONS
    );
    useViewerPlaybackStore.getState().setFrameInfo(PLAYBACK_START_FRAME, PLAYBACK_FRAME_COUNT);
    useViewerPlaybackStore.getState().setHasFrames(true);
    useViewerPlaybackStore.getState().setIsPlaying(true);

    expect(firstHandlerPlayFrames).toHaveBeenCalledOnce();

    useViewerPlaybackStore.getState().clearHandlers();
    useViewerPlaybackStore.getState().registerHandlers({
      playFrames: nextHandlerPlayFrames,
    });

    expect(nextHandlerPlayFrames).not.toHaveBeenCalled();
    expect(useViewerPlaybackStore.getState().activeFramePlayback).toEqual({
      frames: PLAYBACK_ANIMATION_FRAMES,
      options: PLAYBACK_OPTIONS,
    });
  });

  it("does not auto-rehydrate active playback on handler register before frames are known", () => {
    const playFrames = vi.fn();

    useViewerPlaybackStore.setState({
      handlers: {},
      pendingCommands: [],
      activeFramePlayback: {
        frames: PLAYBACK_ANIMATION_FRAMES,
        options: PLAYBACK_OPTIONS,
      },
      hasFrames: false,
      isPlaying: true,
      currentFrame: PLAYBACK_START_FRAME,
    });

    useViewerPlaybackStore.getState().registerHandlers({ playFrames });

    expect(playFrames).not.toHaveBeenCalled();
  });
});
