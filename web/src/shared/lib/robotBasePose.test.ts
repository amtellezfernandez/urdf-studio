import { describe, expect, it } from "vitest";
import {
  cloneRobotBasePose,
  hasMeaningfulRobotBasePoseDelta,
  interpolateRobotBasePose,
  isFiniteRobotBasePose,
  quaternionAngularDistanceRad,
} from "./robotBasePose";
import type { RobotBasePose } from "@/shared/types/feature";

const BASE_POSE_A: RobotBasePose = {
  position: { x: 0, y: 0, z: 0 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
};

const BASE_POSE_B: RobotBasePose = {
  position: { x: 2, y: 0, z: -2 },
  quaternion: { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) },
};

describe("robotBasePose", () => {
  it("clones and validates base poses", () => {
    const cloned = cloneRobotBasePose(BASE_POSE_A);
    expect(cloned).toEqual(BASE_POSE_A);
    expect(cloned).not.toBe(BASE_POSE_A);
    expect(isFiniteRobotBasePose(cloned)).toBe(true);
    expect(isFiniteRobotBasePose(undefined)).toBe(false);
  });

  it("interpolates position and orientation", () => {
    const mid = interpolateRobotBasePose(BASE_POSE_A, BASE_POSE_B, 0.5);
    expect(mid).toBeDefined();
    expect(mid?.position.x).toBeCloseTo(1, 6);
    expect(mid?.position.z).toBeCloseTo(-1, 6);
    const angularDistance = quaternionAngularDistanceRad(
      BASE_POSE_A.quaternion,
      mid?.quaternion ?? BASE_POSE_A.quaternion
    );
    expect(angularDistance).toBeGreaterThan(0);
    expect(angularDistance).toBeLessThan(Math.PI / 2);
  });

  it("clamps interpolation alpha to the valid range", () => {
    expect(interpolateRobotBasePose(BASE_POSE_A, BASE_POSE_B, -1)?.position).toEqual(
      BASE_POSE_A.position
    );
    expect(interpolateRobotBasePose(BASE_POSE_A, BASE_POSE_B, 2)?.position).toEqual(
      BASE_POSE_B.position
    );
    expect(interpolateRobotBasePose(BASE_POSE_A, BASE_POSE_B, Number.NaN)?.position).toEqual(
      BASE_POSE_A.position
    );
  });

  it("detects meaningful delta based on thresholds", () => {
    expect(
      hasMeaningfulRobotBasePoseDelta(BASE_POSE_A, BASE_POSE_A, 0.001, 0.001)
    ).toBe(false);
    expect(
      hasMeaningfulRobotBasePoseDelta(BASE_POSE_A, BASE_POSE_B, 0.1, 0.1)
    ).toBe(true);
  });
});
