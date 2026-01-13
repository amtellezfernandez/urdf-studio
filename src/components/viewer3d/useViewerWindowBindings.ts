import { useEffect, type ChangeEvent } from "react";
import type { WindowWithViewerHandlers } from "@/features/types";
import type { AnimationFrame } from "@/components/viewer3d/viewer3d-types";

type UseViewerWindowBindingsParams = {
  handleRun: (forceState?: boolean) => void;
  handleMotionDataUpload: (fileOrEvent: ChangeEvent<HTMLInputElement> | File) => void;
  handlePlayEpisode: (frames: AnimationFrame[]) => void;
  handleStopAnimation: () => void;
  handleClearAnimation: () => void;
  handleSetFrame: (frameIndex: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  playbackSpeed: number;
};

export const useViewerWindowBindings = ({
  handleRun,
  handleMotionDataUpload,
  handlePlayEpisode,
  handleStopAnimation,
  handleClearAnimation,
  handleSetFrame,
  setPlaybackSpeed,
  playbackSpeed,
}: UseViewerWindowBindingsParams) => {
  useEffect(() => {
    (window as WindowWithViewerHandlers).viewer3dPlayAnimation = handleRun;
    (window as WindowWithViewerHandlers).viewer3dUploadMotionData = handleMotionDataUpload;
    (window as WindowWithViewerHandlers).viewer3dPlayEpisode = handlePlayEpisode;
    (window as WindowWithViewerHandlers).viewer3dStopAnimation = handleStopAnimation;
    (window as WindowWithViewerHandlers).viewer3dClearAnimation = handleClearAnimation;
    (window as WindowWithViewerHandlers).viewer3dSetFrame = handleSetFrame;
    (window as WindowWithViewerHandlers).viewer3dSetPlaybackSpeed = setPlaybackSpeed;
    (window as WindowWithViewerHandlers).viewer3dGetPlaybackSpeed = () => playbackSpeed;
    return () => {
      delete (window as WindowWithViewerHandlers).viewer3dPlayAnimation;
      delete (window as WindowWithViewerHandlers).viewer3dUploadMotionData;
      delete (window as WindowWithViewerHandlers).viewer3dPlayEpisode;
      delete (window as WindowWithViewerHandlers).viewer3dStopAnimation;
      delete (window as WindowWithViewerHandlers).viewer3dClearAnimation;
      delete (window as WindowWithViewerHandlers).viewer3dSetFrame;
      delete (window as WindowWithViewerHandlers).viewer3dSetPlaybackSpeed;
      delete (window as WindowWithViewerHandlers).viewer3dGetPlaybackSpeed;
    };
  }, [
    handleRun,
    handleMotionDataUpload,
    handlePlayEpisode,
    handleStopAnimation,
    handleClearAnimation,
    handleSetFrame,
    playbackSpeed,
    setPlaybackSpeed,
  ]);
};
