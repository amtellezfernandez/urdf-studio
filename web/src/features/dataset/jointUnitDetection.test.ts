import { describe, expect, it } from "vitest";

import { JOINT_UNIT_DETECTION_PARAMS } from "@/features/dataset/jointUnitDetectionParams";
import {
  resolveJointRangeDegToRadConversion,
  shouldAutoConvertJointRangesDegToRad,
} from "@/features/dataset/jointUnitDetection";

const RANGE_WITHIN_RAD = 3.5;
const RANGE_OVER_THRESHOLD =
  JOINT_UNIT_DETECTION_PARAMS.radiansLikelyAbsMax + 0.25;

describe("shouldAutoConvertJointRangesDegToRad", () => {
  it("does not auto-convert when lekiwi-like ranges are below 2pi", () => {
    const result = shouldAutoConvertJointRangesDegToRad({
      shoulder_pan: { min: -RANGE_WITHIN_RAD, max: RANGE_WITHIN_RAD },
      shoulder_lift: { min: -RANGE_WITHIN_RAD, max: RANGE_WITHIN_RAD },
      elbow_flex: { min: -RANGE_WITHIN_RAD, max: RANGE_WITHIN_RAD },
      wrist_flex: { min: -RANGE_WITHIN_RAD, max: RANGE_WITHIN_RAD },
      wrist_roll: { min: -RANGE_WITHIN_RAD, max: RANGE_WITHIN_RAD },
    });

    expect(result).toBe(false);
  });

  it("auto-converts when a majority of joints exceed the radian threshold", () => {
    const result = shouldAutoConvertJointRangesDegToRad({
      j0: { min: -RANGE_OVER_THRESHOLD, max: RANGE_OVER_THRESHOLD },
      j1: { min: -RANGE_OVER_THRESHOLD, max: RANGE_OVER_THRESHOLD },
      j2: { min: -RANGE_OVER_THRESHOLD, max: RANGE_OVER_THRESHOLD },
      j3: { min: -RANGE_WITHIN_RAD, max: RANGE_WITHIN_RAD },
      j4: { min: -RANGE_WITHIN_RAD, max: RANGE_WITHIN_RAD },
    });

    expect(result).toBe(true);
  });

  it("uses max-abs fallback for tiny joint sets", () => {
    const result = shouldAutoConvertJointRangesDegToRad({
      j0: { min: -RANGE_OVER_THRESHOLD, max: RANGE_OVER_THRESHOLD },
      j1: { min: -RANGE_WITHIN_RAD, max: RANGE_WITHIN_RAD },
    });

    expect(result).toBe(true);
  });
});

describe("resolveJointRangeDegToRadConversion", () => {
  it("keeps a saved degree conversion when current ranges are inconclusive", () => {
    expect(
      resolveJointRangeDegToRadConversion({
        existingDegToRad: true,
        jointRanges: {
          shoulder_pan: { min: -RANGE_WITHIN_RAD, max: RANGE_WITHIN_RAD },
        },
      })
    ).toEqual({
      degToRad: true,
      autoConverted: false,
    });
  });

  it("overrides a stale radian mapping when current ranges are clearly degrees", () => {
    expect(
      resolveJointRangeDegToRadConversion({
        existingDegToRad: false,
        jointRanges: {
          shoulder_pan: { min: -RANGE_OVER_THRESHOLD, max: RANGE_OVER_THRESHOLD },
          shoulder_lift: { min: -RANGE_OVER_THRESHOLD, max: RANGE_OVER_THRESHOLD },
          elbow_flex: { min: -RANGE_OVER_THRESHOLD, max: RANGE_OVER_THRESHOLD },
          wrist_flex: { min: -RANGE_WITHIN_RAD, max: RANGE_WITHIN_RAD },
          wrist_roll: { min: -RANGE_WITHIN_RAD, max: RANGE_WITHIN_RAD },
        },
      })
    ).toEqual({
      degToRad: true,
      autoConverted: true,
    });
  });
});
