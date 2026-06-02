import type { AnimationFrame } from "@/features/viewer/viewer-types";
import { recordPlaybackTrace } from "@/shared/debug/playbackTrace";
import { useViewerPlaybackStore, type EpisodePlaybackOptions } from "@/shared/store/useViewerPlaybackStore";

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
    const traceOptions = options
      ? {
          autoplay: options.autoplay,
          startFrame: options.startFrame,
          playbackEpisodeId: options.playbackEpisode?.id ?? null,
          playbackEpisodeFrameCount: options.playbackEpisode?.frames.length ?? null,
        }
      : undefined;
    recordPlaybackTrace("cmd:playEpisode", {
      frameCount: frames.length,
      options: traceOptions,
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
