import { create } from "zustand";
import type { AnimationFrame } from "@/features/viewer/viewer-types";

export type FramePlaybackOptions = {
  autoplay?: boolean;
  applyInitialFrame?: boolean;
  startFrame?: number;
};

type ViewerPlaybackHandlers = {
  playAnimation?: (forceState?: boolean) => void;
  playFrames?: (frames: AnimationFrame[], options?: FramePlaybackOptions) => void;
  stopAnimation?: () => void;
  clearAnimation?: () => void;
  setFrame?: (frameIndex: number) => void;
};

type PendingViewerPlaybackCommand =
  | { type: "playAnimation"; forceState?: boolean }
  | {
      type: "playFrames";
      frames: AnimationFrame[];
      options?: FramePlaybackOptions;
    }
  | { type: "stopAnimation" }
  | { type: "clearAnimation" }
  | { type: "setFrame"; frameIndex: number };

type ActiveFramePlayback = {
  frames: AnimationFrame[];
  options?: FramePlaybackOptions;
};

type ViewerPlaybackStore = {
  handlers: ViewerPlaybackHandlers;
  pendingCommands: PendingViewerPlaybackCommand[];
  activeFramePlayback: ActiveFramePlayback | null;
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
  playFrames: (frames: AnimationFrame[], options?: FramePlaybackOptions) => void;
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
    case "playFrames":
      handlers.playFrames?.(command.frames, command.options);
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
  activeFramePlayback: null,
  playbackSpeed: 1.0,
  isPlaying: false,
  currentFrame: 0,
  totalFrames: 0,
  hasFrames: false,
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
  playFrames: (frames, options) => {
    set({
      activeFramePlayback: { frames, options },
    });
    const { handlers } = get();
    if (handlers.playFrames) {
      handlers.playFrames(frames, options);
      return;
    }
    set((state) => ({
      pendingCommands: [
        ...state.pendingCommands,
        { type: "playFrames", frames, options },
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
    set({ activeFramePlayback: null, pendingCommands: [] });
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
