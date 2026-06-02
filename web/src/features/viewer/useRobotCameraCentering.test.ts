import { describe, expect, it } from "vitest";

import { shouldSkipContinuousCameraFollowForBaseMotion } from "@/features/viewer/useRobotCameraCentering";
import type { RobotBasePose } from "@/shared/types/feature";

const BASE_POSE_A: RobotBasePose = {
  position: { x: 0, y: 0, z: 0 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
};

const BASE_POSE_B: RobotBasePose = {
  position: { x: 0.2, y: 0, z: 0 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
};

const BASE_POSE_C: RobotBasePose = {
  position: { x: 0, y: 0, z: 0 },
  quaternion: { x: 0, y: 0, z: Math.sin(Math.PI / 8), w: Math.cos(Math.PI / 8) },
};

describe("shouldSkipContinuousCameraFollowForBaseMotion", () => {
  it("does not skip centering when a base pose is unavailable", () => {
    expect(shouldSkipContinuousCameraFollowForBaseMotion(null, BASE_POSE_A)).toBe(false);
    expect(shouldSkipContinuousCameraFollowForBaseMotion(BASE_POSE_A, null)).toBe(false);
  });

  it("skips continuous camera follow when the robot base translates", () => {
    expect(shouldSkipContinuousCameraFollowForBaseMotion(BASE_POSE_A, BASE_POSE_B)).toBe(true);
  });

  it("skips continuous camera follow when the robot base rotates", () => {
    expect(shouldSkipContinuousCameraFollowForBaseMotion(BASE_POSE_A, BASE_POSE_C)).toBe(true);
  });
});
