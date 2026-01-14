import { create } from "zustand";
import type { ChangeEvent } from "react";
import type { AnimationFrame } from "@/features/viewer3d/viewer3d-types";

export type EpisodePlaybackOptions = {
  autoplay?: boolean;
  startFrame?: number;
};

type ViewerPlaybackHandlers = {
  playAnimation?: (forceState?: boolean) => void;
  uploadMotionData?: (fileOrEvent: ChangeEvent<HTMLInputElement> | File) => void;
  playEpisode?: (frames: AnimationFrame[], options?: EpisodePlaybackOptions) => void;
  stopAnimation?: () => void;
  clearAnimation?: () => void;
  setFrame?: (frameIndex: number) => void;
};

type ViewerPlaybackStore = {
  handlers: ViewerPlaybackHandlers;
  playbackSpeed: number;
  isPlaying: boolean;
  currentFrame: number;
  totalFrames: number;
  hasFrames: boolean;
  registerHandlers: (handlers: ViewerPlaybackHandlers) => void;
  clearHandlers: () => void;
  setPlaybackSpeed: (speed: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setFrameInfo: (currentFrame: number, totalFrames?: number) => void;
  setHasFrames: (hasFrames: boolean) => void;
  playAnimation: (forceState?: boolean) => void;
  uploadMotionData: (file: File) => void;
  playEpisode: (frames: AnimationFrame[], options?: EpisodePlaybackOptions) => void;
  stopAnimation: () => void;
  clearAnimation: () => void;
  setFrame: (frameIndex: number) => void;
};

export const useViewerPlaybackStore = create<ViewerPlaybackStore>((set, get) => ({
  handlers: {},
  playbackSpeed: 1.0,
  isPlaying: false,
  currentFrame: 0,
  totalFrames: 0,
  hasFrames: false,
  registerHandlers: (handlers) => set({ handlers }),
  clearHandlers: () => set({ handlers: {} }),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setFrameInfo: (currentFrame, totalFrames) =>
    set((state) => ({
      currentFrame,
      totalFrames: totalFrames ?? state.totalFrames,
    })),
  setHasFrames: (hasFrames) => set({ hasFrames }),
  playAnimation: (forceState) => {
    get().handlers.playAnimation?.(forceState);
  },
  uploadMotionData: (file) => {
    get().handlers.uploadMotionData?.(file);
  },
  playEpisode: (frames, options) => {
    get().handlers.playEpisode?.(frames, options);
  },
  stopAnimation: () => {
    get().handlers.stopAnimation?.();
  },
  clearAnimation: () => {
    get().handlers.clearAnimation?.();
  },
  setFrame: (frameIndex) => {
    get().handlers.setFrame?.(frameIndex);
  },
}));
