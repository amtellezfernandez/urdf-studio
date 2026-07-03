import type { AnimationFrame } from "@/features/viewer/viewer-types";
import { recordPlaybackTrace } from "@/shared/debug/playbackTrace";
import { useViewerPlaybackStore, type FramePlaybackOptions } from "@/shared/store/useViewerPlaybackStore";

export const viewerPlayback = {
  playAnimation: (forceState?: boolean) => {
    recordPlaybackTrace("cmd:playAnimation", { forceState });
    useViewerPlaybackStore.getState().playAnimation(forceState);
  },
  stopAnimation: () => {
    recordPlaybackTrace("cmd:stopAnimation");
    useViewerPlaybackStore.getState().stopAnimation();
  },
  clearAnimation: () => {
    recordPlaybackTrace("cmd:clearAnimation");
    useViewerPlaybackStore.getState().clearAnimation();
  },
  playFrames: (frames: AnimationFrame[], options?: FramePlaybackOptions) => {
    const traceOptions = options
      ? {
          autoplay: options.autoplay,
          startFrame: options.startFrame,
        }
      : undefined;
    recordPlaybackTrace("cmd:playFrames", {
      frameCount: frames.length,
      options: traceOptions,
    });
    useViewerPlaybackStore.getState().playFrames(frames, options);
  },
  setFrame: (frameIndex: number) => {
    recordPlaybackTrace("cmd:setFrame", { frameIndex });
    useViewerPlaybackStore.getState().setFrame(frameIndex);
  },
  setPlaybackSpeed: (speed: number) => {
    recordPlaybackTrace("cmd:setPlaybackSpeed", { speed });
    useViewerPlaybackStore.getState().setPlaybackSpeed(speed);
  },
  getPlaybackSpeed: () => useViewerPlaybackStore.getState().playbackSpeed,
};
