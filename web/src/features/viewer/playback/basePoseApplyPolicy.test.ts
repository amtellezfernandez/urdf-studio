import { describe, expect, it } from "vitest";
import type { RobotBasePose } from "@/shared/types/feature";
import { shouldApplyPlaybackBasePose } from "@/features/viewer/playback/basePoseApplyPolicy";

const BASE_POSE_A: RobotBasePose = {
  position: { x: 0, y: 0, z: 0 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
};

const BASE_POSE_B: RobotBasePose = {
  position: { x: 1, y: 0, z: 0 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
};

const TRANSLATION_THRESHOLD_METERS = 1e-6;
const ROTATION_THRESHOLD_RAD = 1e-6;

describe("shouldApplyPlaybackBasePose", () => {
  it("applies when playing and no previous playback pose exists", () => {
    expect(
      shouldApplyPlaybackBasePose({
        isPlaying: true,
        currentRobotBasePose: BASE_POSE_A,
        lastAppliedPlaybackBasePose: null,
        targetFrameBasePose: BASE_POSE_B,
        translationThresholdMeters: TRANSLATION_THRESHOLD_METERS,
        rotationThresholdRad: ROTATION_THRESHOLD_RAD,
      })
    ).toBe(true);
  });

  it("does not apply when playing and frame pose matches last applied playback pose", () => {
    expect(
      shouldApplyPlaybackBasePose({
        isPlaying: true,
        currentRobotBasePose: BASE_POSE_A,
        lastAppliedPlaybackBasePose: BASE_POSE_B,
        targetFrameBasePose: BASE_POSE_B,
        translationThresholdMeters: TRANSLATION_THRESHOLD_METERS,
        rotationThresholdRad: ROTATION_THRESHOLD_RAD,
      })
    ).toBe(false);
  });

  it("does not apply while paused when last applied playback pose already matches frame pose", () => {
    expect(
      shouldApplyPlaybackBasePose({
        isPlaying: false,
        currentRobotBasePose: BASE_POSE_A,
        lastAppliedPlaybackBasePose: BASE_POSE_B,
        targetFrameBasePose: BASE_POSE_B,
        translationThresholdMeters: TRANSLATION_THRESHOLD_METERS,
        rotationThresholdRad: ROTATION_THRESHOLD_RAD,
      })
    ).toBe(false);
  });

  it("applies while paused when last applied playback pose differs from frame pose", () => {
    expect(
      shouldApplyPlaybackBasePose({
        isPlaying: false,
        currentRobotBasePose: BASE_POSE_B,
        lastAppliedPlaybackBasePose: BASE_POSE_A,
        targetFrameBasePose: BASE_POSE_B,
        translationThresholdMeters: TRANSLATION_THRESHOLD_METERS,
        rotationThresholdRad: ROTATION_THRESHOLD_RAD,
      })
    ).toBe(true);
  });

  it("applies when playing and frame pose changes relative to last applied playback pose", () => {
    expect(
      shouldApplyPlaybackBasePose({
        isPlaying: true,
        currentRobotBasePose: BASE_POSE_A,
        lastAppliedPlaybackBasePose: BASE_POSE_A,
        targetFrameBasePose: BASE_POSE_B,
        translationThresholdMeters: TRANSLATION_THRESHOLD_METERS,
        rotationThresholdRad: ROTATION_THRESHOLD_RAD,
      })
    ).toBe(true);
  });
});
