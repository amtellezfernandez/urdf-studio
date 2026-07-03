import { useEffect } from "react";
import type { AnimationFrame } from "@/features/viewer/viewer-types";
import type { FramePlaybackOptions } from "@/shared/store/useViewerPlaybackStore";
import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";

type UseViewerWindowBindingsParams = {
  handleRun: (forceState?: boolean) => void;
  handlePlayFrames: (frames: AnimationFrame[], options?: FramePlaybackOptions) => void;
  handleStopAnimation: () => void;
  handleClearAnimation: () => void;
  handleSetFrame: (frameIndex: number) => void;
};

export const useViewerWindowBindings = ({
  handleRun,
  handlePlayFrames,
  handleStopAnimation,
  handleClearAnimation,
  handleSetFrame,
}: UseViewerWindowBindingsParams) => {
  const registerHandlers = useViewerPlaybackStore((state) => state.registerHandlers);
  const clearHandlers = useViewerPlaybackStore((state) => state.clearHandlers);

  useEffect(() => {
    registerHandlers({
      playAnimation: handleRun,
      playFrames: handlePlayFrames,
      stopAnimation: handleStopAnimation,
      clearAnimation: handleClearAnimation,
      setFrame: handleSetFrame,
    });
    return () => clearHandlers();
  }, [
    clearHandlers,
    handleRun,
    handlePlayFrames,
    handleStopAnimation,
    handleClearAnimation,
    handleSetFrame,
    registerHandlers,
  ]);
};
