import { useCallback } from "react";
import { toast } from "sonner";
import type { URDFRobot } from "urdf-loader";
import type { AnimationFrame } from "@/components/viewer3d/viewer3d-types";
import type { AnimationController } from "@/components/viewer3d/useAnimationController";

type UsePlaybackHandlersParams = {
  animationFrames: AnimationFrame[] | null;
  robot: URDFRobot | null;
  isPlaying: boolean;
  setIsPlaying: (isPlaying: boolean) => void;
  setAnimationFrames: (frames: AnimationFrame[] | null) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  onFrameChange?: (frameIndex: number) => void;
  animationController: AnimationController;
};

export const usePlaybackHandlers = ({
  animationFrames,
  robot,
  isPlaying,
  setIsPlaying,
  setAnimationFrames,
  onPlayingChange,
  onFrameChange,
  animationController,
}: UsePlaybackHandlersParams) => {
  const handleRun = useCallback(
    (forceState?: boolean) => {
      if (!animationFrames || animationFrames.length === 0) {
        toast.error("Please upload a motion data file first");
        return;
      }
      if (!robot) {
        toast.error("Please upload a URDF file first");
        return;
      }
      const newPlayingState = forceState !== undefined ? forceState : !isPlaying;

      if (newPlayingState && !isPlaying) {
        const currentFrameIdx = animationController.currentFrameIndexRef.current;
        const lastFrameIdx = animationFrames.length - 1;

        if (
          currentFrameIdx !== undefined &&
          currentFrameIdx !== null &&
          currentFrameIdx >= lastFrameIdx
        ) {
          const firstTimestamp = animationFrames[0].timestamp;
          const lastTimestamp = animationFrames[lastFrameIdx].timestamp;
          const animationDuration = lastTimestamp - firstTimestamp;
          const normalizedFrameDuration =
            animationDuration / Math.max(1, animationFrames.length - 1);

          const normalizedFirstTime = firstTimestamp;
          animationController.setManualFrameTime(normalizedFirstTime);
          animationController.setCurrentFrameIndex(0);
          animationController.setResetAnimationStart(true);
          animationController.setPreserveFrameTime(null);

          if (onFrameChange) {
            onFrameChange(0);
          }
        }
      }

      setIsPlaying(newPlayingState);
      onPlayingChange?.(newPlayingState);
      if (newPlayingState) {
        animationController.setPaused(false);
        animationController.clearManualJointChange();
      } else {
        animationController.setPaused(true);
      }
    },
    [
      animationFrames,
      animationController,
      robot,
      isPlaying,
      onFrameChange,
      onPlayingChange,
      setIsPlaying,
    ]
  );

  const handlePlayEpisode = useCallback(
    (frames: AnimationFrame[]) => {
      if (!frames || frames.length === 0) {
        toast.error("No frames to play");
        return;
      }

      setIsPlaying(false);
      setAnimationFrames(frames);

      setTimeout(() => {
        setIsPlaying(true);
        onPlayingChange?.(true);
        animationController.setPaused(false);
        animationController.clearManualJointChange();
      }, 10);
    },
    [animationController, onPlayingChange, setAnimationFrames, setIsPlaying]
  );

  const handleStopAnimation = useCallback(() => {
    if (animationFrames && animationFrames.length > 0) {
      const firstTimestamp = animationFrames[0].timestamp;
      const lastTimestamp = animationFrames[animationFrames.length - 1].timestamp;
      const animationDuration = lastTimestamp - firstTimestamp;
      const normalizedFrameDuration =
        animationDuration / Math.max(1, animationFrames.length - 1);

      const currentFrameIdx = animationController.currentFrameIndexRef.current ?? 0;
      const normalizedTime = firstTimestamp + currentFrameIdx * normalizedFrameDuration;

      animationController.setPreserveFrameTime(normalizedTime);

      if (onFrameChange && currentFrameIdx >= 0) {
        onFrameChange(currentFrameIdx);
      }
    }

    setIsPlaying(false);
    onPlayingChange?.(false);
    animationController.setPaused(true);
  }, [animationController, onPlayingChange, animationFrames, onFrameChange, setIsPlaying]);

  const handleClearAnimation = useCallback(() => {
    setIsPlaying(false);
    onPlayingChange?.(false);
    setAnimationFrames(null);
    animationController.setPaused(true);
    animationController.setPreserveFrameTime(null);
    animationController.setManualFrameTime(null);
    animationController.setCurrentFrameIndex(0);
  }, [animationController, onPlayingChange, setAnimationFrames, setIsPlaying]);

  const handleSetFrame = useCallback(
    (frameIndex: number) => {
      if (!animationFrames || animationFrames.length === 0) {
        return;
      }

      setIsPlaying(false);
      onPlayingChange?.(false);
      animationController.setPaused(true);

      const clampedIndex = Math.max(0, Math.min(frameIndex, animationFrames.length - 1));
      const targetFrame = animationFrames[clampedIndex];

      if (targetFrame) {
        animationController.setManualFrameTime(targetFrame.timestamp);
        animationController.setCurrentFrameIndex(clampedIndex);
        if (onFrameChange) {
          onFrameChange(clampedIndex);
        }
      }
    },
    [animationFrames, animationController, onPlayingChange, onFrameChange, setIsPlaying]
  );

  return {
    handleRun,
    handlePlayEpisode,
    handleStopAnimation,
    handleClearAnimation,
    handleSetFrame,
  };
};
