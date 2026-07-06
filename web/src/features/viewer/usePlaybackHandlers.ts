import { useCallback } from "react";
import { toast } from "sonner";
import type { URDFRobot } from "urdf-loader";
import type { AnimationFrame } from "@/features/viewer/viewer-types";
import type { FramePlaybackOptions } from "@/shared/store/useViewerPlaybackStore";
import type { AnimationController } from "@/features/viewer/useAnimationController";
import { clampFrameIndexToFrameRange } from "@/features/viewer/playbackSampling";
import { validateAnimationFrames } from "@/features/viewer/validateAnimationFrames";

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

const reportPlayableAnimationFrameIssues = (
  frames: AnimationFrame[] | null | undefined,
  emptyMessage: string,
): frames is AnimationFrame[] => {
  if (!frames || frames.length === 0) {
    toast.error(emptyMessage);
    return false;
  }
  const validation = validateAnimationFrames(frames);
  if (!validation.ok) {
    toast.error(`Motion data invalid: ${validation.issues.join(", ")}`);
    return false;
  }
  if (validation.warnings.length > 0) {
    console.warn(`[Viewer3D] Motion data warnings: ${validation.warnings.join(", ")}`);
  }
  return true;
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
      if (!reportPlayableAnimationFrameIssues(animationFrames, "Please upload a motion data file first")) {
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

  const handlePlayFrames = useCallback(
    (frames: AnimationFrame[], options?: FramePlaybackOptions) => {
      if (!reportPlayableAnimationFrameIssues(frames, "No frames to play")) {
        return;
      }

      // Playback must only start from explicit user intent.
      const autoplay = options?.autoplay ?? false;
      const applyInitialFrame = options?.applyInitialFrame ?? true;
      const startFrame = options?.startFrame ?? 0;
      const clampedIndex = clampFrameIndexToFrameRange(frames, startFrame);
      const targetFrame = frames[clampedIndex];

      setAnimationFrames(frames);
      animationController.setPreserveFrameTime(null);
      animationController.setCurrentFrameIndex(clampedIndex);
      setCurrentFrame?.(clampedIndex);
      animationController.setResetAnimationStart(true);
      animationController.setManualFrameTime(
        applyInitialFrame || autoplay ? (targetFrame ? targetFrame.timestamp : null) : null
      );
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
      const clampedIndex = clampFrameIndexToFrameRange(animationFrames, currentFrameIdx);
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

      const clampedIndex = clampFrameIndexToFrameRange(animationFrames, frameIndex);
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
    handlePlayFrames,
    handleStopAnimation,
    handleClearAnimation,
    handleSetFrame,
  };
};
