import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { URDFRobot } from "urdf-loader";
import { applyJointValues } from "@/shared/lib/urdf-joints";
import { hasJointMapChanged } from "@/features/viewer/viewer-helpers";
import {
  applyRobotBasePose,
  extractRobotBasePose,
} from "@/shared/lib/urdfRobotBasePose";
import type { AnimationFrame } from "@/features/viewer/viewer-types";
import type { AnimationController } from "@/features/viewer/useAnimationController";
import {
  cloneRobotBasePose,
} from "@/shared/lib/robotBasePose";
import {
  buildFrameLockedJointValues,
  resolveInterpolatedJointValues,
} from "@/features/viewer/playbackSampling";
import { shouldApplyManualFrameLock } from "@/features/viewer/playback/frameLockPolicy";
import { shouldApplyPlaybackBasePose } from "@/features/viewer/playback/basePoseApplyPolicy";
import {
  resolveFrozenPlaybackFrameSelection,
  resolvePlaybackFrameSelection,
} from "@/features/viewer/playback/frameSelection";
import {
  advancePlaybackClockTime,
  resolvePlaybackAnchorTime,
} from "@/features/viewer/playback/playbackClock";
import {
  PLAYBACK_BASE_POSE_ROTATION_EPSILON_RAD,
  PLAYBACK_BASE_POSE_TRANSLATION_EPSILON_METERS,
  PLAYBACK_MAX_WALL_CLOCK_STEP_MS,
  URDF_ANIMATION_FRAME_PRIORITY,
} from "@/features/viewer/playback/playbackParams";
import { shouldSyncPlaybackJointStore } from "@/features/viewer/playback/jointStoreSyncPolicy";
import { shouldApplyFrameLockedJoints } from "@/features/viewer/playback/jointFrameApplyPolicy";
import { useJointStore } from "@/shared/store/useJointStore";
import {
  applyJointDataZeroOffset,
  removeJointDataZeroOffset,
} from "@/shared/lib/jointDataZero";

type UseUrdfAnimationParams = {
  animationFrames: AnimationFrame[] | null;
  robotRef: MutableRefObject<URDFRobot | null>;
  isPlaying: boolean;
  playbackSpeed: number;
  storeJointValues: Record<string, number>;
  setStoreJointValues: (values: Record<string, number>) => void;
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
  onFrameChange,
  onPlaybackEnd,
  animationController,
}: UseUrdfAnimationParams) => {
  const playbackEndedRef = useRef(false);
  const lastAppliedJointsRef = useRef<Record<string, number>>({});
  const lastAppliedDataJointsRef = useRef<Record<string, number>>({});
  const lastAppliedDisplayJointsRef = useRef<Record<string, number> | null>(null);
  const lastAppliedBasePoseRef = useRef<AnimationFrame["basePose"] | null>(null);
  const invalidValueWarnedRef = useRef(false);
  const lastPausedManualFrameTimeRef = useRef<number | null>(null);
  const playbackClockTimeRef = useRef<number | null>(null);
  const playbackWallClockRef = useRef<number | null>(null);
  const lastStoreJointSyncTimeRef = useRef<number | null>(null);
  const dataZeroOffsetChangedRef = useRef(false);
  const activeDataZeroJointValues = useJointStore((state) =>
    state.getActiveDataZeroJointValues()
  );

  // Reset animation when frames change
  useEffect(() => {
    if (animationFrames) {
      animationController.currentFrameIndexRef.current = 0;
      invalidValueWarnedRef.current = false;
      playbackClockTimeRef.current = animationFrames[0]?.timestamp ?? 0;
      playbackWallClockRef.current = null;
    } else {
      playbackClockTimeRef.current = null;
      playbackWallClockRef.current = null;
    }
    playbackEndedRef.current = false;
    lastPausedManualFrameTimeRef.current = null;
  }, [animationFrames, animationController]);

  useEffect(() => {
    if (!isPlaying) {
      lastAppliedJointsRef.current = { ...storeJointValues };
      lastAppliedDataJointsRef.current = removeJointDataZeroOffset({
        jointValues: storeJointValues,
        dataZeroJointValues: useJointStore.getState().getActiveDataZeroJointValues(),
      });
      lastAppliedDisplayJointsRef.current = null;
      lastStoreJointSyncTimeRef.current = null;
    }
  }, [isPlaying, storeJointValues]);

  useEffect(() => {
    dataZeroOffsetChangedRef.current = true;
    lastAppliedJointsRef.current = {};
    lastAppliedDisplayJointsRef.current = null;
  }, [activeDataZeroJointValues]);

  useEffect(() => {
    if (!isPlaying) {
      lastAppliedBasePoseRef.current = null;
      playbackWallClockRef.current = null;
    }
  }, [isPlaying]);

  useEffect(() => {
    if (isPlaying) {
      playbackEndedRef.current = false;
      lastPausedManualFrameTimeRef.current = null;
    }
  }, [isPlaying]);

  // Animation loop
  useFrame(() => {
    if (!animationFrames || !robotRef.current || animationFrames.length === 0) {
      return;
    }

    const firstTimestamp = animationFrames[0].timestamp;
    const lastTimestamp = animationFrames[animationFrames.length - 1].timestamp;
    if (!Number.isFinite(firstTimestamp) || !Number.isFinite(lastTimestamp)) {
      return;
    }

    let currentTime: number;
    let shouldApplyAnimation = false; // Flag to determine if we should apply animation values
    let reachedPlaybackEnd = false;
    let consumedPreservedFrameTime = false;

    // Check for preserved frame time from stop handler (set when stopping to preserve position)
    // This MUST be checked first to prevent jumping to frame 0 when stopping
    const preservedFrameTime = animationController.preserveFrameTimeRef.current;
    if (preservedFrameTime !== null && preservedFrameTime !== undefined) {
      const selection = resolvePlaybackFrameSelection(animationFrames, preservedFrameTime);
      currentTime = selection.frameTime;
      playbackClockTimeRef.current = selection.frameTime;
      playbackWallClockRef.current = null;
      animationController.manualFrameTimeRef.current =
        animationFrames[selection.frameIndex]?.timestamp ?? selection.frameTime;
      // Update frame index immediately to prevent wrong frame from being displayed
      animationController.currentFrameIndexRef.current = selection.frameIndex;
      // Immediately update frame callback with correct frame to prevent UI flicker
      if (onFrameChange) {
        onFrameChange(selection.frameIndex);
      }
      // Clear the preserved frame time after using it
      animationController.preserveFrameTimeRef.current = null;
      consumedPreservedFrameTime = true;
      shouldApplyAnimation = true;
      // Set a flag to skip the normal frame update logic below
      animationController.skipFrameUpdateRef.current = true;
    }

    // Check for manual frame time (set by handleSetFrame or timeline scrubbing)
    const manualFrameTime = animationController.manualFrameTimeRef.current;
    if (manualFrameTime !== null && manualFrameTime !== undefined) {
      // When manually setting a frame, find the frame index from the timestamp
      const selection = resolvePlaybackFrameSelection(animationFrames, manualFrameTime);
      const clampedTime = selection.frameTime;
      const targetFrameIndex = selection.frameIndex;
      currentTime = selection.frameTime;
      playbackClockTimeRef.current = selection.frameTime;
      animationController.manualFrameTimeRef.current =
        animationFrames[targetFrameIndex]?.timestamp ?? clampedTime;
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
      const pausedManualFrameTimeChanged =
        !isPlaying && lastPausedManualFrameTimeRef.current !== clampedTime;
      if (isPlaying) {
        const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
        playbackWallClockRef.current = nowMs;
        // Clear the manual frame time when resuming so playback can advance
        animationController.manualFrameTimeRef.current = null;
        animationController.isPausedRef.current = false;
        lastPausedManualFrameTimeRef.current = null;
      } else {
        // When paused, keep the manual frame time as resume anchor without reapplying it each tick.
        animationController.isPausedRef.current = true;
        playbackWallClockRef.current = null;
        if (pausedManualFrameTimeChanged) {
          lastPausedManualFrameTimeRef.current = clampedTime;
        }
      }
      shouldApplyAnimation = shouldApplyManualFrameLock({
        isPlaying,
        consumedPreservedFrameTime,
        pausedManualFrameTimeChanged,
      });
      // Set flag to skip normal frame update to prevent recalculation
      animationController.skipFrameUpdateRef.current = true;
    } else if (isPlaying) {
      // Normal playback - use recorded timestamps for precision
      shouldApplyAnimation = true;
      // Clear pause flag when playing
      animationController.isPausedRef.current = false;
      // Clear manual joint changes flag when playing - allow animation to take control
      animationController.hasManualJointChangesRef.current = false;

      // Check if we need to reset animation start time (when starting from last frame)
      const shouldResetStartTime = animationController.resetAnimationStartRef.current;
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (shouldResetStartTime || playbackClockTimeRef.current === null) {
        playbackClockTimeRef.current = resolvePlaybackAnchorTime(
          animationFrames,
          animationController.currentFrameIndexRef.current
        );
        animationController.resetAnimationStartRef.current = false;
        playbackWallClockRef.current = null;
      }

      const advancedPlaybackClock = advancePlaybackClockTime({
        currentPlaybackTime: playbackClockTimeRef.current,
        frames: animationFrames,
        maxStepMs: PLAYBACK_MAX_WALL_CLOCK_STEP_MS,
        nowMs,
        playbackSpeed,
        previousNowMs: playbackWallClockRef.current,
      });
      playbackClockTimeRef.current = advancedPlaybackClock.playbackTime;
      playbackWallClockRef.current = advancedPlaybackClock.previousNowMs;
      currentTime = advancedPlaybackClock.playbackTime;

      // Reset loop if we've passed the last frame
      if (currentTime >= lastTimestamp) {
        const lastFrameIndex = animationFrames.length - 1;
        animationController.currentFrameIndexRef.current = lastFrameIndex;
        animationController.manualFrameTimeRef.current = lastTimestamp;
        playbackClockTimeRef.current = lastTimestamp;
        currentTime = lastTimestamp;
        shouldApplyAnimation = true;
        // Stop playback at the end
        animationController.resetAnimationStartRef.current = true;
        animationController.isPausedRef.current = false;
        reachedPlaybackEnd = true;
      }
    } else {
      // Not playing and no manual frame time, so we're stopped
      shouldApplyAnimation = false;

      const frozenSelection = resolveFrozenPlaybackFrameSelection(
        animationFrames,
        animationController.currentFrameIndexRef.current
      );
      currentTime = frozenSelection.frameTime;
      playbackClockTimeRef.current = frozenSelection.frameTime;
      playbackWallClockRef.current = null;
      animationController.manualFrameTimeRef.current =
        animationFrames[frozenSelection.frameIndex]?.timestamp ?? firstTimestamp;
      animationController.isPausedRef.current = true;
    }

    const frameIndex = resolvePlaybackFrameSelection(animationFrames, currentTime).frameIndex;

    // Skip frame update if we just preserved the frame position (to prevent flicker)
    const skipUpdate = animationController.skipFrameUpdateRef.current;
    if (skipUpdate) {
      animationController.skipFrameUpdateRef.current = false;
      // Frame was already updated when preserving position
    } else if (animationController.currentFrameIndexRef.current !== frameIndex) {
      animationController.currentFrameIndexRef.current = frameIndex;
      if (onFrameChange) {
        onFrameChange(frameIndex);
      }
    }

    // Broadcast continuous playback time before joint/base-pose application so
    // timeline overlays stay smooth even when robot writes are skipped.
    if (isPlaying && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("viewer3d:playbackTime", { detail: { timeMs: currentTime } })
      );
    }

    const skipForManualDragOverride =
      isPlaying && animationController.isManualDragActiveRef.current;
    const shouldForceApplyDataZeroOffset = dataZeroOffsetChangedRef.current;
    // Only apply animation values if we should (playing or manual frame set).
    // Skip while the user is actively dragging joints so replay does not overwrite drag motion.
    if (
      !shouldApplyFrameLockedJoints({
        shouldApplyAnimation,
        shouldForceApplyDataZeroOffset,
        skipForManualDragOverride,
        hasManualJointChanges: animationController.hasManualJointChangesRef.current,
        isPlaying,
      })
    ) {
      return;
    }

    const currentFrame = animationFrames[frameIndex];
    // Playback must be frame-locked so robot pose matches the motion timeline exactly.
    const { joints: frameLockedDataJoints, hasNonFinite } = buildFrameLockedJointValues(
      lastAppliedDataJointsRef.current,
      currentFrame?.joints ?? {},
      { preservePrevious: !isPlaying }
    );
    const frameLockedJoints = applyJointDataZeroOffset({
      jointValues: frameLockedDataJoints,
      dataZeroJointValues: activeDataZeroJointValues,
    });

    if (hasNonFinite && !invalidValueWarnedRef.current) {
      invalidValueWarnedRef.current = true;
      console.warn("[Viewer3D] Non-finite joint values detected in animation frames.");
    }
    const frameBasePose = currentFrame?.basePose;
    const hasFrameJoints = Object.keys(frameLockedJoints).length > 0;
    if (!hasFrameJoints && !frameBasePose) {
      dataZeroOffsetChangedRef.current = false;
      return;
    }

    // During playback, apply time-interpolated joints to the 3D robot so motion
    // appears smooth between discrete recorded frames. The store and graph always
    // receive exact frame-locked values. Both 3D and graph derive from the same
    // `currentTime`, so they can never be out of sync — the cursor moves to the
    // precise time position while the robot pose matches it exactly.
    // When paused or scrubbing, fall back to exact frame values (no interpolation).
    const interpolatedDataJoints =
      isPlaying && animationFrames.length > 1
        ? buildFrameLockedJointValues(
            lastAppliedDataJointsRef.current,
            resolveInterpolatedJointValues(animationFrames, currentTime)
          ).joints
        : frameLockedDataJoints;
    const displayJoints =
      interpolatedDataJoints === frameLockedDataJoints
        ? frameLockedJoints
        : applyJointDataZeroOffset({
            jointValues: interpolatedDataJoints,
            dataZeroJointValues: activeDataZeroJointValues,
          });

    const previousDisplayJoints = isPlaying
      ? lastAppliedDisplayJointsRef.current
      : lastAppliedJointsRef.current;
    const shouldSyncJoints =
      hasFrameJoints && hasJointMapChanged(displayJoints, previousDisplayJoints);
    if (shouldSyncJoints) {
      applyJointValues(robotRef.current, displayJoints, { filter: false });
      robotRef.current.updateMatrixWorld?.(true);
      lastAppliedJointsRef.current = frameLockedJoints;
      lastAppliedDataJointsRef.current = frameLockedDataJoints;
      lastAppliedDisplayJointsRef.current = displayJoints;
    }

    if (hasFrameJoints) {
      const liveStoreJointValues = useJointStore.getState().jointValues;
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (
        shouldSyncPlaybackJointStore({
          frameLockedJoints,
          storeJointValues: liveStoreJointValues,
          isPlaying,
          reachedPlaybackEnd,
          nowMs,
          lastSyncTimeMs: lastStoreJointSyncTimeRef.current,
        })
      ) {
        const mergedStoreValues = {
          ...liveStoreJointValues,
          ...frameLockedJoints,
        };
        setStoreJointValues(mergedStoreValues);
        lastStoreJointSyncTimeRef.current = nowMs;
      }
    }

    dataZeroOffsetChangedRef.current = false;
    if (frameBasePose) {
      const shouldApplyBasePose = shouldApplyPlaybackBasePose({
        isPlaying,
        currentRobotBasePose: extractRobotBasePose(robotRef.current),
        lastAppliedPlaybackBasePose: lastAppliedBasePoseRef.current,
        targetFrameBasePose: frameBasePose,
        translationThresholdMeters: PLAYBACK_BASE_POSE_TRANSLATION_EPSILON_METERS,
        rotationThresholdRad: PLAYBACK_BASE_POSE_ROTATION_EPSILON_RAD,
      });
      if (shouldApplyBasePose) {
        const applied = applyRobotBasePose(robotRef.current, frameBasePose);
        if (applied) {
          lastAppliedBasePoseRef.current = cloneRobotBasePose(frameBasePose) ?? null;
        }
      }
    }

    if (reachedPlaybackEnd && !playbackEndedRef.current) {
      playbackEndedRef.current = true;
      onPlaybackEnd?.(animationFrames.length - 1);
    }
  }, URDF_ANIMATION_FRAME_PRIORITY);

  // Note: We intentionally don't reset animationStartTime when stopping playback
  // This allows us to resume from where we left off
  // The animation loop will handle preserving the current position
};
