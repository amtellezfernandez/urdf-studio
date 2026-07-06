import { describe, expect, it } from "vitest";
import { resolveJointValueRange } from "@/features/layout/jointValueRange";
import { JOINT_RANGE_PARAMS } from "@/features/layout/jointRangeParams";

describe("resolveJointValueRange", () => {
  it("uses explicit finite limits as hard bounds", () => {
    const range = resolveJointValueRange({
      jointName: "arm_joint",
      jointInfo: { type: "revolute", lower: -1.2, upper: 1.4 },
      currentValue: 0.3,
    });

    expect(range.clampLower).toBeCloseTo(-1.2);
    expect(range.clampUpper).toBeCloseTo(1.4);
    expect(range.displayMin).toBeCloseTo(-1.2);
    expect(range.displayMax).toBeCloseTo(1.4);
    expect(range.hasFiniteHardLimits).toBe(true);
  });

  it("keeps unlimited joints unclamped and centers display around current value", () => {
    const range = resolveJointValueRange({
      jointName: "arm_joint",
      jointInfo: { type: "continuous", lower: null, upper: null },
      currentValue: 3,
      groupLabel: "arm1",
    });

    expect(range.clampLower).toBeNull();
    expect(range.clampUpper).toBeNull();
    expect(range.displayMin).toBeCloseTo(3 - JOINT_RANGE_PARAMS.defaultDisplayHalfRangeRad);
    expect(range.displayMax).toBeCloseTo(3 + JOINT_RANGE_PARAMS.defaultDisplayHalfRangeRad);
    expect(range.hasFiniteHardLimits).toBe(false);
  });

  it("falls back to zero when the current value is not finite", () => {
    const range = resolveJointValueRange({
      jointName: "arm_joint",
      jointInfo: { type: "continuous", lower: null, upper: null },
      currentValue: Number.NaN,
    });

    expect(range.displayMin).toBeCloseTo(-JOINT_RANGE_PARAMS.defaultDisplayHalfRangeRad);
    expect(range.displayMax).toBeCloseTo(JOINT_RANGE_PARAMS.defaultDisplayHalfRangeRad);
  });

  it("uses wider display window for wheel-like unlimited joints", () => {
    const range = resolveJointValueRange({
      jointName: "front_left_wheel_joint",
      jointInfo: { type: "continuous", lower: null, upper: null },
      currentValue: 0.5,
      groupLabel: "wheel1",
    });

    expect(range.displayMin).toBeCloseTo(0.5 - JOINT_RANGE_PARAMS.wheelDisplayHalfRangeRad);
    expect(range.displayMax).toBeCloseTo(0.5 + JOINT_RANGE_PARAMS.wheelDisplayHalfRangeRad);
  });

  it("keeps one-sided limits as one-sided hard clamps", () => {
    const range = resolveJointValueRange({
      jointName: "linear_slide",
      jointInfo: { type: "prismatic", lower: -0.2, upper: null },
      currentValue: 12,
    });

    expect(range.clampLower).toBeCloseTo(-0.2);
    expect(range.clampUpper).toBeNull();
    expect(range.displayMax).toBeGreaterThanOrEqual(12);
  });
});
