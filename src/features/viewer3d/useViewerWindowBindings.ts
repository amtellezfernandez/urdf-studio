import { useEffect, type ChangeEvent } from "react";
import type { AnimationFrame } from "@/features/viewer3d/viewer3d-types";
import type { EpisodePlaybackOptions } from "@/shared/store/useViewerPlaybackStore";
import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";

type UseViewerWindowBindingsParams = {
  handleRun: (forceState?: boolean) => void;
  handleMotionDataUpload: (fileOrEvent: ChangeEvent<HTMLInputElement> | File) => void;
  handlePlayEpisode: (frames: AnimationFrame[], options?: EpisodePlaybackOptions) => void;
  handleStopAnimation: () => void;
  handleClearAnimation: () => void;
  handleSetFrame: (frameIndex: number) => void;
};

export const useViewerWindowBindings = ({
  handleRun,
  handleMotionDataUpload,
  handlePlayEpisode,
  handleStopAnimation,
  handleClearAnimation,
  handleSetFrame,
}: UseViewerWindowBindingsParams) => {
  const registerHandlers = useViewerPlaybackStore((state) => state.registerHandlers);
  const clearHandlers = useViewerPlaybackStore((state) => state.clearHandlers);

  useEffect(() => {
    registerHandlers({
      playAnimation: handleRun,
      uploadMotionData: handleMotionDataUpload,
      playEpisode: handlePlayEpisode,
      stopAnimation: handleStopAnimation,
      clearAnimation: handleClearAnimation,
      setFrame: handleSetFrame,
    });
    return () => clearHandlers();
  }, [
    clearHandlers,
    handleRun,
    handleMotionDataUpload,
    handlePlayEpisode,
    handleStopAnimation,
    handleClearAnimation,
    handleSetFrame,
    registerHandlers,
  ]);
};
