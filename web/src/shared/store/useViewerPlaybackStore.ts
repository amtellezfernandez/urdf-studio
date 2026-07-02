import { create } from "zustand";
import type { AnimationFrame } from "@/features/viewer/viewer-types";
import type { ViewerEpisode } from "@/shared/types/feature";

export type EpisodePlaybackOptions = {
  autoplay?: boolean;
  applyInitialFrame?: boolean;
  startFrame?: number;
  playbackEpisode?: ViewerEpisode | null;
};

type ViewerPlaybackHandlers = {
  playAnimation?: (forceState?: boolean) => void;
  playEpisode?: (frames: AnimationFrame[], options?: EpisodePlaybackOptions) => void;
  stopAnimation?: () => void;
  clearAnimation?: () => void;
  setFrame?: (frameIndex: number) => void;
};

type PendingViewerPlaybackCommand =
  | { type: "playAnimation"; forceState?: boolean }
  | {
      type: "playEpisode";
      frames: AnimationFrame[];
      options?: EpisodePlaybackOptions;
    }
  | { type: "stopAnimation" }
  | { type: "clearAnimation" }
  | { type: "setFrame"; frameIndex: number };

type ActiveEpisodePlayback = {
  frames: AnimationFrame[];
  options?: EpisodePlaybackOptions;
};

type ViewerPlaybackStore = {
  handlers: ViewerPlaybackHandlers;
  pendingCommands: PendingViewerPlaybackCommand[];
  activeEpisodePlayback: ActiveEpisodePlayback | null;
  playbackSpeed: number;
  isPlaying: boolean;
  currentFrame: number;
  totalFrames: number;
  hasFrames: boolean;
  playbackEpisode: ViewerEpisode | null;
  registerHandlers: (handlers: ViewerPlaybackHandlers) => void;
  clearHandlers: () => void;
  setPlaybackSpeed: (speed: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setFrameInfo: (currentFrame: number, totalFrames?: number) => void;
  setHasFrames: (hasFrames: boolean) => void;
  playAnimation: (forceState?: boolean) => void;
  playEpisode: (frames: AnimationFrame[], options?: EpisodePlaybackOptions) => void;
  stopAnimation: () => void;
  clearAnimation: () => void;
  setFrame: (frameIndex: number) => void;
};

const executePendingViewerPlaybackCommand = (
  handlers: ViewerPlaybackHandlers,
  command: PendingViewerPlaybackCommand
) => {
  switch (command.type) {
    case "playAnimation":
      handlers.playAnimation?.(command.forceState);
      return;
    case "playEpisode":
      handlers.playEpisode?.(command.frames, command.options);
      return;
    case "stopAnimation":
      handlers.stopAnimation?.();
      return;
    case "clearAnimation":
      handlers.clearAnimation?.();
      return;
    case "setFrame":
      handlers.setFrame?.(command.frameIndex);
      return;
  }
};

export const useViewerPlaybackStore = create<ViewerPlaybackStore>((set, get) => ({
  handlers: {},
  pendingCommands: [],
  activeEpisodePlayback: null,
  playbackSpeed: 1.0,
  isPlaying: false,
  currentFrame: 0,
  totalFrames: 0,
  hasFrames: false,
  playbackEpisode: null,
  registerHandlers: (handlers) =>
    set((state) => {
      const pendingCommands = state.pendingCommands;
      pendingCommands.forEach((command) => {
        executePendingViewerPlaybackCommand(handlers, command);
      });
      return {
        handlers,
        pendingCommands: [],
      };
    }),
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
    const { handlers } = get();
    if (handlers.playAnimation) {
      handlers.playAnimation(forceState);
      return;
    }
    set((state) => ({
      pendingCommands: [...state.pendingCommands, { type: "playAnimation", forceState }],
    }));
  },
  playEpisode: (frames, options) => {
    set({
      activeEpisodePlayback: { frames, options },
      playbackEpisode: options?.playbackEpisode ?? null,
    });
    const { handlers } = get();
    if (handlers.playEpisode) {
      handlers.playEpisode(frames, options);
      return;
    }
    set((state) => ({
      pendingCommands: [
        ...state.pendingCommands,
        { type: "playEpisode", frames, options },
      ],
    }));
  },
  stopAnimation: () => {
    const { handlers } = get();
    if (handlers.stopAnimation) {
      handlers.stopAnimation();
      return;
    }
    set((state) => ({
      pendingCommands: [...state.pendingCommands, { type: "stopAnimation" }],
    }));
  },
  clearAnimation: () => {
    set({ activeEpisodePlayback: null, pendingCommands: [], playbackEpisode: null });
    const { handlers } = get();
    if (handlers.clearAnimation) {
      handlers.clearAnimation();
      return;
    }
    set((state) => ({
      pendingCommands: [...state.pendingCommands, { type: "clearAnimation" }],
    }));
  },
  setFrame: (frameIndex) => {
    const { handlers } = get();
    if (handlers.setFrame) {
      handlers.setFrame(frameIndex);
      return;
    }
    set((state) => ({
      pendingCommands: [...state.pendingCommands, { type: "setFrame", frameIndex }],
    }));
  },
}));
