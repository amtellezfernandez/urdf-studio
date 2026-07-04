import { describe, expect, it } from "vitest";
import { DEG_TO_RAD } from "@/shared/lib/angleConversions";
import {
  clampJointValue,
  getJointDragSensitivityRad,
  getJointStepRad,
  snapJointValue,
} from "@/features/layout/jointValueInteraction";

describe("joint value interaction helpers", () => {
  it("clamps only against finite bounds", () => {
    expect(clampJointValue(2, -1, 1)).toBe(1);
    expect(clampJointValue(-2, -1, 1)).toBe(-1);
    expect(clampJointValue(2, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(2);
  });

  it("snaps values to five degree increments", () => {
    expect(snapJointValue(12 * DEG_TO_RAD, true)).toBeCloseTo(10 * DEG_TO_RAD);
    expect(snapJointValue(13 * DEG_TO_RAD, true)).toBeCloseTo(15 * DEG_TO_RAD);
    expect(snapJointValue(13 * DEG_TO_RAD, false)).toBeCloseTo(13 * DEG_TO_RAD);
  });

  it("uses the joint range for drag sensitivity with a finite fallback", () => {
    expect(getJointDragSensitivityRad(-1, 1, false)).toBeCloseTo(2 / 800);
    expect(getJointDragSensitivityRad(-1, 1, true)).toBeCloseTo((2 / 800) * 0.2);
    expect(getJointDragSensitivityRad(0, Number.POSITIVE_INFINITY, false)).toBe(0.005);
  });

  it("returns keyboard and wheel steps in radians", () => {
    expect(getJointStepRad(false, false)).toBeCloseTo(1 * DEG_TO_RAD);
    expect(getJointStepRad(true, false)).toBeCloseTo(0.1 * DEG_TO_RAD);
    expect(getJointStepRad(false, true)).toBeCloseTo(10 * DEG_TO_RAD);
    expect(getJointStepRad(true, true)).toBeCloseTo(10 * DEG_TO_RAD);
  });
});
