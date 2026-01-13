import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import { applyJointValues } from "@/lib/urdf-joints";
import type { WindowWithViewerHandlers } from "@/features/types";
import { hasJointMapChanged } from "@/components/viewer3d/viewer3d-helpers";
import type { AnimationFrame } from "@/components/viewer3d/viewer3d-types";

type UseUrdfAnimationParams = {
  animationFrames: AnimationFrame[] | null;
  robotRef: MutableRefObject<URDFRobot | null>;
  isPlaying: boolean;
  playbackSpeed: number;
  storeJointValues: Record<string, number>;
  setStoreJointValues: (values: Record<string, number>) => void;
  onJointChange?: (jointName: string, value: number) => void;
  onFrameChange?: (frameIndex: number) => void;
  hasManualJointChangesRef: MutableRefObject<boolean>;
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
  hasManualJointChangesRef,
}: UseUrdfAnimationParams) => {
  const animationStartTime = useRef<number>(0);
  const manualFrameTimeRef = useRef<number | null>(null); // For manual frame navigation
  const currentFrameIndexRef = useRef<number>(0);

  // Reset animation when frames change
  useEffect(() => {
    if (animationFrames) {
      animationStartTime.current = 0;
      currentFrameIndexRef.current = 0;
    }
  }, [animationFrames]);

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
    const preservedFrameTime = (window as WindowWithViewerHandlers).__viewer3dPreserveFrameTime;
    if (preservedFrameTime !== undefined && preservedFrameTime !== null) {
      // Use preserved frame time and convert to normalized time
      const frameIndex = Math.round((preservedFrameTime - firstTimestamp) / normalizedFrameDuration);
      const clampedFrameIndex = Math.max(
        0,
        Math.min(frameIndex, animationFrames.length - 1)
      );
      const normalizedTime = firstTimestamp + clampedFrameIndex * normalizedFrameDuration;
      currentTime = normalizedTime;
      manualFrameTimeRef.current = normalizedTime;
      // Update frame index immediately to prevent wrong frame from being displayed
      (window as WindowWithViewerHandlers).__viewer3dCurrentFrameIndex = clampedFrameIndex;
      currentFrameIndexRef.current = clampedFrameIndex;
      // Immediately update frame callback with correct frame to prevent UI flicker
      if (onFrameChange) {
        onFrameChange(clampedFrameIndex);
      }
      // Clear the window property after using it
      delete (window as WindowWithViewerHandlers).__viewer3dPreserveFrameTime;
      shouldApplyAnimation = true;
      // Set a flag to skip the normal frame update logic below
      (window as WindowWithViewerHandlers).__viewer3dSkipFrameUpdate = true;
    }

    // Check for manual frame time from window (set by handleSetFrame or timeline scrubbing)
    const manualFrameTime = (window as WindowWithViewerHandlers).__viewer3dManualFrameTime;
    if (manualFrameTime !== undefined && manualFrameTime !== null) {
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
      manualFrameTimeRef.current = normalizedTime;
      // Update frame index immediately
      (window as WindowWithViewerHandlers).__viewer3dCurrentFrameIndex = targetFrameIndex;
      currentFrameIndexRef.current = targetFrameIndex;
      // Immediately update frame callback to prevent UI from showing wrong frame
      if (onFrameChange) {
        onFrameChange(targetFrameIndex);
      }
      // Update animation start time to maintain position when playing resumes
      // But only if we're going to play - if paused, don't update it
      if (isPlaying) {
        animationStartTime.current =
          Date.now() - (normalizedTime - firstTimestamp) / playbackSpeed;
      } else {
        // When paused, don't update animationStartTime - keep it as is
        // This prevents the frame from jumping when manually set
      }
      // Clear the window property after using it
      delete (window as WindowWithViewerHandlers).__viewer3dManualFrameTime;
      shouldApplyAnimation = true; // Apply when manually setting frame
      // Set pause flag to prevent interpolation
      (window as WindowWithViewerHandlers).__viewer3dIsPaused = true;
      // Set flag to skip normal frame update
      (window as WindowWithViewerHandlers).__viewer3dSkipFrameUpdate = true;
    } else if (manualFrameTimeRef.current !== null) {
      // Use stored manual frame time (paused at a specific frame)
      currentTime = manualFrameTimeRef.current;
      // Calculate frame index from stored time to keep it consistent
      const storedFrameIndex = Math.round((currentTime - firstTimestamp) / normalizedFrameDuration);
      const clampedStoredIndex = Math.max(
        0,
        Math.min(storedFrameIndex, animationFrames.length - 1)
      );
      (window as WindowWithViewerHandlers).__viewer3dCurrentFrameIndex = clampedStoredIndex;
      // If we start playing from a paused state, update start time and clear manual frame
      if (isPlaying) {
        // The stored time is already normalized, so use it directly
        animationStartTime.current =
          Date.now() - (currentTime - firstTimestamp) / playbackSpeed;
        manualFrameTimeRef.current = null;
        shouldApplyAnimation = true;
        // Clear pause flag when starting to play
        delete (window as WindowWithViewerHandlers).__viewer3dIsPaused;
      } else {
        // Paused with manual frame time - stay at this exact frame (no interpolation)
        shouldApplyAnimation = true;
        // Store a flag to indicate we're paused so we don't interpolate
        (window as WindowWithViewerHandlers).__viewer3dIsPaused = true;
        // Set flag to skip normal frame update to prevent recalculation
        (window as WindowWithViewerHandlers).__viewer3dSkipFrameUpdate = true;
      }
    } else if (isPlaying) {
      // Normal playback - use normalized timing for uniform playback
      shouldApplyAnimation = true;
      // Clear pause flag when playing
      delete (window as WindowWithViewerHandlers).__viewer3dIsPaused;
      // Clear manual joint changes flag when playing - allow animation to take control
      hasManualJointChangesRef.current = false;
      delete (window as WindowWithViewerHandlers).__viewer3dHasManualJointChanges;

      // Check if we need to reset animation start time (when starting from last frame)
      const shouldResetStartTime =
        (window as WindowWithViewerHandlers).__viewer3dResetAnimationStartTime;
      if (shouldResetStartTime) {
        animationStartTime.current = 0;
        delete (window as WindowWithViewerHandlers).__viewer3dResetAnimationStartTime;
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
        currentFrameIndexRef.current = lastFrameIndex;
        manualFrameTimeRef.current = normalizedLastTimestamp;
        currentTime = normalizedLastTimestamp;
        shouldApplyAnimation = true;
        // Stop playback at the end
        (window as WindowWithViewerHandlers).__viewer3dResetAnimationStartTime = true;
        delete (window as WindowWithViewerHandlers).__viewer3dIsPaused;
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
        manualFrameTimeRef.current = currentTime;
      } else {
        currentTime = firstTimestamp;
        manualFrameTimeRef.current = currentTime;
      }
    }

    // Determine current frame index based on normalized time
    let frameIndex = Math.round((currentTime - firstTimestamp) / normalizedFrameDuration);
    frameIndex = Math.max(0, Math.min(frameIndex, animationFrames.length - 1));

    // Skip frame update if we just preserved the frame position (to prevent flicker)
    const skipUpdate = (window as WindowWithViewerHandlers).__viewer3dSkipFrameUpdate;
    if (skipUpdate) {
      delete (window as WindowWithViewerHandlers).__viewer3dSkipFrameUpdate;
      // Frame was already updated when preserving position
    } else if (currentFrameIndexRef.current !== frameIndex) {
      currentFrameIndexRef.current = frameIndex;
      // Use requestAnimationFrame to update state outside useFrame
      requestAnimationFrame(() => {
        if (onFrameChange) {
          onFrameChange(frameIndex);
        }
      });
    }

    // Only apply animation values if we should (playing or manual frame set)
    // But skip if user has manually changed joints (to allow manual control)
    if (!shouldApplyAnimation || (hasManualJointChangesRef.current && !isPlaying)) {
      return;
    }

    const currentFrame = animationFrames[frameIndex];
    const nextFrame = animationFrames[Math.min(frameIndex + 1, animationFrames.length - 1)];

    // Interpolate between frames using normalized timing
    // This ensures smooth interpolation even with uneven original timestamps
    // When paused, don't interpolate - use exact frame values
    const isPaused = !isPlaying && (window as WindowWithViewerHandlers).__viewer3dIsPaused;
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

    // Check for manual joint changes flag from window (set by slider changes or dragging)
    if ((window as WindowWithViewerHandlers).__viewer3dHasManualJointChanges) {
      hasManualJointChangesRef.current = true;
      // Clear the window property after reading it
      delete (window as WindowWithViewerHandlers).__viewer3dHasManualJointChanges;
    }

    // When paused and manual changes have been made, don't apply animation values
    // This allows manual control to work after stopping playback
    if (isPaused && hasManualJointChangesRef.current) {
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
