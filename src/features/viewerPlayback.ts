import type { AnimationFrame } from "@/components/viewer3d/viewer3d-types";
import { useViewerPlaybackStore } from "@/store/useViewerPlaybackStore";

export const viewerPlayback = {
  playAnimation: (forceState?: boolean) => {
    useViewerPlaybackStore.getState().playAnimation(forceState);
  },
  stopAnimation: () => {
    useViewerPlaybackStore.getState().stopAnimation();
  },
  clearAnimation: () => {
    useViewerPlaybackStore.getState().clearAnimation();
  },
  playEpisode: (frames: AnimationFrame[]) => {
    useViewerPlaybackStore.getState().playEpisode(frames);
  },
  uploadMotionData: (file: File) => {
    useViewerPlaybackStore.getState().uploadMotionData(file);
  },
  setFrame: (frameIndex: number) => {
    useViewerPlaybackStore.getState().setFrame(frameIndex);
  },
  setPlaybackSpeed: (speed: number) => {
    useViewerPlaybackStore.getState().setPlaybackSpeed(speed);
  },
  getPlaybackSpeed: () => useViewerPlaybackStore.getState().playbackSpeed,
};
