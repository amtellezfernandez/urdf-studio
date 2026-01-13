import { describe, expect, it, beforeEach } from "vitest";
import { useViewerPlaybackStore } from "@/store/useViewerPlaybackStore";
import { viewerPlayback } from "@/features/viewerPlayback";

type SimState = {
  isPlaying: boolean;
  currentFrame: number;
  frames: Array<{ timestamp: number; joints: Record<string, number> }>;
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

const makeFrames = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    timestamp: index * 100,
    joints: {},
  }));

const setupFakeViewer = () => {
  const sim: SimState = {
    isPlaying: false,
    currentFrame: 0,
    frames: [],
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
    playEpisode: (frames: SimState["frames"], options?: { autoplay?: boolean; startFrame?: number }) => {
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
    while (sim.isPlaying && sim.frames.length > 0) {
      if (sim.currentFrame >= sim.frames.length - 1) {
        sim.isPlaying = false;
        publish();
        break;
      }
      sim.currentFrame += 1;
      publish();
    }
  };

  return { sim, advanceToEnd };
};

const snapshotState = () => {
  const state = useViewerPlaybackStore.getState();
  return {
    isPlaying: state.isPlaying,
    currentFrame: state.currentFrame,
    totalFrames: state.totalFrames,
    hasFrames: state.hasFrames,
  };
};

describe("playback contract", () => {
  beforeEach(() => {
    resetPlaybackStore();
  });

  it("stops at the last frame without restarting", () => {
    const { advanceToEnd } = setupFakeViewer();
    const frames = makeFrames(4);
    const trace: Array<Record<string, unknown>> = [];

    viewerPlayback.playEpisode(frames, { autoplay: true, startFrame: 0 });
    trace.push({ action: "playEpisode", state: snapshotState() });

    advanceToEnd();
    trace.push({ action: "end", state: snapshotState() });

    viewerPlayback.playAnimation(true);
    trace.push({ action: "playAtEnd", state: snapshotState() });

    expect(trace).toMatchInlineSnapshot(`
      [
        {
          "action": "playEpisode",
          "state": {
            "currentFrame": 0,
            "hasFrames": true,
            "isPlaying": true,
            "totalFrames": 4,
          },
        },
        {
          "action": "end",
          "state": {
            "currentFrame": 3,
            "hasFrames": true,
            "isPlaying": false,
            "totalFrames": 4,
          },
        },
        {
          "action": "playAtEnd",
          "state": {
            "currentFrame": 3,
            "hasFrames": true,
            "isPlaying": false,
            "totalFrames": 4,
          },
        },
      ]
    `);
  });

  it("stops without resetting the current frame", () => {
    setupFakeViewer();
    const frames = makeFrames(6);
    viewerPlayback.playEpisode(frames, { autoplay: true, startFrame: 2 });
    viewerPlayback.stopAnimation();

    expect(snapshotState()).toMatchInlineSnapshot(`
      {
        "currentFrame": 2,
        "hasFrames": true,
        "isPlaying": false,
        "totalFrames": 6,
      }
    `);
  });

  it("load-only episode keeps autoplay off", () => {
    setupFakeViewer();
    const frames = makeFrames(3);
    viewerPlayback.playEpisode(frames, { autoplay: false, startFrame: 0 });

    expect(snapshotState()).toMatchInlineSnapshot(`
      {
        "currentFrame": 0,
        "hasFrames": true,
        "isPlaying": false,
        "totalFrames": 3,
      }
    `);
  });
});
