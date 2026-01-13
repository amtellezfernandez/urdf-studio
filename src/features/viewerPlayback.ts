import type { AnimationFrame } from "@/components/viewer3d/viewer3d-types";
import { recordPlaybackTrace } from "@/debug/playbackTrace";
import { useViewerPlaybackStore, type EpisodePlaybackOptions } from "@/store/useViewerPlaybackStore";

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
  playEpisode: (frames: AnimationFrame[], options?: EpisodePlaybackOptions) => {
    recordPlaybackTrace("cmd:playEpisode", {
      frameCount: frames.length,
      options: options ? { ...options } : undefined,
    });
    useViewerPlaybackStore.getState().playEpisode(frames, options);
  },
  uploadMotionData: (file: File) => {
    recordPlaybackTrace("cmd:uploadMotionData", { name: file.name, size: file.size });
    useViewerPlaybackStore.getState().uploadMotionData(file);
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
