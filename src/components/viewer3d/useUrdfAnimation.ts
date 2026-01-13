import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import { applyJointValues } from "@/lib/urdf-joints";
import { hasJointMapChanged } from "@/components/viewer3d/viewer3d-helpers";
import type { AnimationFrame } from "@/components/viewer3d/viewer3d-types";
import type { AnimationController } from "@/components/viewer3d/useAnimationController";

type UseUrdfAnimationParams = {
  animationFrames: AnimationFrame[] | null;
  robotRef: MutableRefObject<URDFRobot | null>;
  isPlaying: boolean;
  playbackSpeed: number;
  storeJointValues: Record<string, number>;
  setStoreJointValues: (values: Record<string, number>) => void;
  onJointChange?: (jointName: string, value: number) => void;
  onFrameChange?: (frameIndex: number) => void;
  onPlaybackEnd?: (frameIndex: number) => void;
  animationController: AnimationController;
};

export const useUrdfAnimation = ({
  animationFrames,
  robotRef,
  isPlaying,
  playbackSpeed,
  storeJointValues,
  setStoreJointValues,
  onJointChange,
  onFrameChange,
  onPlaybackEnd,
  animationController,
}: UseUrdfAnimationParams) => {
  const animationStartTime = useRef<number>(0);
  const playbackEndedRef = useRef(false);

  // Reset animation when frames change
  useEffect(() => {
    if (animationFrames) {
      animationStartTime.current = 0;
      animationController.currentFrameIndexRef.current = 0;
    }
    playbackEndedRef.current = false;
  }, [animationFrames, animationController]);

  useEffect(() => {
    if (isPlaying) {
      playbackEndedRef.current = false;
    }
  }, [isPlaying]);

  // Animation loop
  useFrame(() => {
    if (!animationFrames || !robotRef.current || animationFrames.length === 0) {
      return;
    }

    const firstTimestamp = animationFrames[0].timestamp;
    const lastTimestamp = animationFrames[animationFrames.length - 1].timestamp;
    const animationDuration = lastTimestamp - firstTimestamp;

    // Normalize timestamps to be evenly spaced for uniform playback
    // This prevents lags when frames have uneven timestamp intervals
    const normalizedFrameDuration =
      animationDuration / Math.max(1, animationFrames.length - 1);
    const normalizedLastTimestamp =
      firstTimestamp + (animationFrames.length - 1) * normalizedFrameDuration;

    let currentTime: number;
    let shouldApplyAnimation = false; // Flag to determine if we should apply animation values

    // Check for preserved frame time from stop handler (set when stopping to preserve position)
    // This MUST be checked first to prevent jumping to frame 0 when stopping
    const preservedFrameTime = animationController.preserveFrameTimeRef.current;
    if (preservedFrameTime !== null && preservedFrameTime !== undefined) {
      // Use preserved frame time and convert to normalized time
      const frameIndex = Math.round((preservedFrameTime - firstTimestamp) / normalizedFrameDuration);
      const clampedFrameIndex = Math.max(
        0,
        Math.min(frameIndex, animationFrames.length - 1)
      );
      const normalizedTime = firstTimestamp + clampedFrameIndex * normalizedFrameDuration;
      currentTime = normalizedTime;
      animationController.manualFrameTimeRef.current = normalizedTime;
      // Update frame index immediately to prevent wrong frame from being displayed
      animationController.currentFrameIndexRef.current = clampedFrameIndex;
      // Immediately update frame callback with correct frame to prevent UI flicker
      if (onFrameChange) {
        onFrameChange(clampedFrameIndex);
      }
      // Clear the preserved frame time after using it
      animationController.preserveFrameTimeRef.current = null;
      shouldApplyAnimation = true;
      // Set a flag to skip the normal frame update logic below
      animationController.skipFrameUpdateRef.current = true;
    }

    // Check for manual frame time (set by handleSetFrame or timeline scrubbing)
    const manualFrameTime = animationController.manualFrameTimeRef.current;
    if (manualFrameTime !== null && manualFrameTime !== undefined) {
      // When manually setting a frame, find the frame index from the timestamp
      // Then convert to normalized time for uniform playback
      let targetFrameIndex = animationFrames.length - 1;
      for (let i = 0; i < animationFrames.length; i++) {
        if (animationFrames[i].timestamp >= manualFrameTime) {
          targetFrameIndex = i;
          break;
        }
      }
      // Convert to normalized time
      const normalizedTime = firstTimestamp + targetFrameIndex * normalizedFrameDuration;
      currentTime = normalizedTime;
      animationController.manualFrameTimeRef.current = normalizedTime;
      // Update frame index immediately (only notify if it changed)
      const previousFrameIndex = animationController.currentFrameIndexRef.current;
      if (previousFrameIndex !== targetFrameIndex) {
        animationController.currentFrameIndexRef.current = targetFrameIndex;
        if (onFrameChange) {
          onFrameChange(targetFrameIndex);
        }
      } else {
        animationController.currentFrameIndexRef.current = targetFrameIndex;
      }
      // Update animation start time to maintain position when playing resumes
      // But only if we're going to play - if paused, don't update it
      if (isPlaying) {
        animationStartTime.current =
          Date.now() - (normalizedTime - firstTimestamp) / playbackSpeed;
        // Clear the manual frame time when resuming so playback can advance
        animationController.manualFrameTimeRef.current = null;
        animationController.isPausedRef.current = false;
      } else {
        // When paused, keep the manual frame time so the frame stays frozen
        animationController.isPausedRef.current = true;
      }
      shouldApplyAnimation = true; // Apply when manually setting frame
      // Set flag to skip normal frame update to prevent recalculation
      animationController.skipFrameUpdateRef.current = true;
    } else if (isPlaying) {
      // Normal playback - use normalized timing for uniform playback
      shouldApplyAnimation = true;
      // Clear pause flag when playing
      animationController.isPausedRef.current = false;
      // Clear manual joint changes flag when playing - allow animation to take control
      animationController.hasManualJointChangesRef.current = false;

      // Check if we need to reset animation start time (when starting from last frame)
      const shouldResetStartTime = animationController.resetAnimationStartRef.current;
      if (shouldResetStartTime) {
        animationStartTime.current = 0;
        animationController.resetAnimationStartRef.current = false;
      }

      if (animationStartTime.current === 0) {
        animationStartTime.current = Date.now();
      }

      const elapsed = Date.now() - animationStartTime.current;
      const normalizedElapsed = elapsed * playbackSpeed;
      currentTime = firstTimestamp + normalizedElapsed;

      // Reset loop if we've passed the last frame
      if (currentTime > normalizedLastTimestamp) {
        const lastFrameIndex = animationFrames.length - 1;
        animationController.currentFrameIndexRef.current = lastFrameIndex;
        animationController.manualFrameTimeRef.current = normalizedLastTimestamp;
        currentTime = normalizedLastTimestamp;
        shouldApplyAnimation = true;
        // Stop playback at the end
        animationController.resetAnimationStartRef.current = true;
        animationController.isPausedRef.current = false;
        if (!playbackEndedRef.current) {
          playbackEndedRef.current = true;
          if (onFrameChange) {
            onFrameChange(lastFrameIndex);
          }
          onPlaybackEnd?.(lastFrameIndex);
        }
        return;
      }
    } else {
      // Not playing and no manual frame time, so we're stopped
      shouldApplyAnimation = false;

      // If we were playing and just stopped, keep the current frame
      if (animationStartTime.current !== 0) {
        const elapsed = Date.now() - animationStartTime.current;
        const normalizedElapsed = elapsed * playbackSpeed;
        currentTime = firstTimestamp + normalizedElapsed;

        if (currentTime > normalizedLastTimestamp) {
          currentTime = normalizedLastTimestamp;
        }
        animationController.manualFrameTimeRef.current = currentTime;
      } else {
        currentTime = firstTimestamp;
        animationController.manualFrameTimeRef.current = currentTime;
      }
    }

    // Determine current frame index based on normalized time
    let frameIndex = Math.round((currentTime - firstTimestamp) / normalizedFrameDuration);
    frameIndex = Math.max(0, Math.min(frameIndex, animationFrames.length - 1));

    // Skip frame update if we just preserved the frame position (to prevent flicker)
    const skipUpdate = animationController.skipFrameUpdateRef.current;
    if (skipUpdate) {
      animationController.skipFrameUpdateRef.current = false;
      // Frame was already updated when preserving position
    } else if (animationController.currentFrameIndexRef.current !== frameIndex) {
      animationController.currentFrameIndexRef.current = frameIndex;
      // Use requestAnimationFrame to update state outside useFrame
      requestAnimationFrame(() => {
        if (onFrameChange) {
          onFrameChange(frameIndex);
        }
      });
    }

    // Only apply animation values if we should (playing or manual frame set)
    // But skip if user has manually changed joints (to allow manual control)
    if (!shouldApplyAnimation || (animationController.hasManualJointChangesRef.current && !isPlaying)) {
      return;
    }

    const currentFrame = animationFrames[frameIndex];
    const nextFrame = animationFrames[Math.min(frameIndex + 1, animationFrames.length - 1)];

    // Interpolate between frames using normalized timing
    // This ensures smooth interpolation even with uneven original timestamps
    // When paused, don't interpolate - use exact frame values
    const isPaused = !isPlaying && animationController.isPausedRef.current;
    let t = 0;
    if (!isPaused && normalizedFrameDuration > 0 && frameIndex < animationFrames.length - 1) {
      // Calculate interpolation factor based on normalized time position within the frame interval
      const normalizedCurrentFrameTime = firstTimestamp + frameIndex * normalizedFrameDuration;
      const normalizedNextFrameTime =
        firstTimestamp + (frameIndex + 1) * normalizedFrameDuration;
      t = (currentTime - normalizedCurrentFrameTime) / normalizedFrameDuration;
      t = Math.max(0, Math.min(1, t)); // Clamp between 0 and 1
    }

    const interpolatedJoints: Record<string, number> = {};
    for (const jointName in currentFrame.joints) {
      const current = currentFrame.joints[jointName];
      const next = nextFrame.joints[jointName] ?? current;
      interpolatedJoints[jointName] = THREE.MathUtils.lerp(current, next, t);
    }

    // When paused and manual changes have been made, don't apply animation values
    // This allows manual control to work after stopping playback
    if (isPaused && animationController.hasManualJointChangesRef.current) {
      return;
    }

    const shouldSyncJoints = hasJointMapChanged(interpolatedJoints, storeJointValues);
    if (shouldSyncJoints) {
      // Apply joint values to robot
      applyJointValues(robotRef.current, interpolatedJoints, { filter: false });

      // Update the store in batch so UI reflects the animation
      setStoreJointValues(interpolatedJoints);

      // Also call onJointChange for each joint to notify parent
      if (onJointChange) {
        for (const [jointName, value] of Object.entries(interpolatedJoints)) {
          onJointChange(jointName, value);
        }
      }
    }
  });

  // Note: We intentionally don't reset animationStartTime when stopping playback
  // This allows us to resume from where we left off
  // The animation loop will handle preserving the current position
};
