import { useCallback } from "react";
import { toast } from "sonner";
import type { URDFRobot } from "urdf-loader";
import type { AnimationFrame } from "@/features/viewer3d/viewer3d-types";
import type { EpisodePlaybackOptions } from "@/shared/store/useViewerPlaybackStore";
import type { AnimationController } from "@/features/viewer3d/useAnimationController";

type UsePlaybackHandlersParams = {
  animationFrames: AnimationFrame[] | null;
  robot: URDFRobot | null;
  isPlaying: boolean;
  setIsPlaying: (isPlaying: boolean) => void;
  setAnimationFrames: (frames: AnimationFrame[] | null) => void;
  setCurrentFrame?: (frameIndex: number) => void;
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
  setCurrentFrame,
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
          const firstTimestamp = animationFrames[0]?.timestamp ?? 0;
          animationController.setCurrentFrameIndex(0);
          animationController.setManualFrameTime(firstTimestamp);
          animationController.setPreserveFrameTime(null);
          animationController.setResetAnimationStart(true);
          setCurrentFrame?.(0);
          if (onFrameChange && !setCurrentFrame) {
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
      setCurrentFrame,
      setIsPlaying,
    ]
  );

  const handlePlayEpisode = useCallback(
    (frames: AnimationFrame[], options?: EpisodePlaybackOptions) => {
      if (!frames || frames.length === 0) {
        toast.error("No frames to play");
        return;
      }

      const autoplay = options?.autoplay ?? true;
      const startFrame = options?.startFrame ?? 0;
      const clampedIndex = Math.max(0, Math.min(startFrame, frames.length - 1));
      const targetFrame = frames[clampedIndex];

      setAnimationFrames(frames);
      animationController.setManualFrameTime(
        targetFrame ? targetFrame.timestamp : null
      );
      animationController.setPreserveFrameTime(null);
      animationController.setCurrentFrameIndex(clampedIndex);
      setCurrentFrame?.(clampedIndex);
      animationController.setResetAnimationStart(true);
      animationController.setPaused(!autoplay);
      animationController.clearManualJointChange();
      setIsPlaying(autoplay);
      onPlayingChange?.(autoplay);
      if (!setCurrentFrame) {
        onFrameChange?.(clampedIndex);
      }
    },
    [
      animationController,
      onFrameChange,
      onPlayingChange,
      setAnimationFrames,
      setCurrentFrame,
      setIsPlaying,
    ]
  );

  const handleStopAnimation = useCallback(() => {
    if (animationFrames && animationFrames.length > 0) {
      const currentFrameIdx = animationController.currentFrameIndexRef.current ?? 0;
      const clampedIndex = Math.max(0, Math.min(currentFrameIdx, animationFrames.length - 1));
      const targetFrame = animationFrames[clampedIndex];
      const targetTimestamp = targetFrame?.timestamp ?? animationFrames[0].timestamp;

      animationController.setCurrentFrameIndex(clampedIndex);
      animationController.setManualFrameTime(targetTimestamp);
      animationController.setPreserveFrameTime(targetTimestamp);
      setCurrentFrame?.(clampedIndex);

      if (onFrameChange && !setCurrentFrame) {
        onFrameChange(clampedIndex);
      }
    }

    setIsPlaying(false);
    onPlayingChange?.(false);
    animationController.setPaused(true);
  }, [
    animationController,
    onPlayingChange,
    animationFrames,
    onFrameChange,
    setCurrentFrame,
    setIsPlaying,
  ]);

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
        setCurrentFrame?.(clampedIndex);
        if (onFrameChange && !setCurrentFrame) {
          onFrameChange(clampedIndex);
        }
      }
    },
    [
      animationFrames,
      animationController,
      onFrameChange,
      onPlayingChange,
      setCurrentFrame,
      setIsPlaying,
    ]
  );

  return {
    handleRun,
    handlePlayEpisode,
    handleStopAnimation,
    handleClearAnimation,
    handleSetFrame,
  };
};
