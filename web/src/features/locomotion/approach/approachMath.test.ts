import { describe, expect, it } from "vitest";
import { ROVER_APPROACH_CONFIG } from "./approachParams";
import {
  clampNumber,
  clampRoverApproachDtSec,
  normalizeSignedAngleRad,
} from "./approachMath";

describe("clampNumber", () => {
  it("bounds values to the configured range", () => {
    expect(clampNumber(-1, 0, 2)).toBe(0);
    expect(clampNumber(1, 0, 2)).toBe(1);
    expect(clampNumber(3, 0, 2)).toBe(2);
  });
});

describe("normalizeSignedAngleRad", () => {
  it("wraps angles to the signed pi range", () => {
    expect(normalizeSignedAngleRad(Math.PI * 1.5)).toBeCloseTo(-Math.PI * 0.5);
    expect(normalizeSignedAngleRad(-Math.PI * 1.5)).toBeCloseTo(Math.PI * 0.5);
  });

  it("returns zero for non-finite angles", () => {
    expect(normalizeSignedAngleRad(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeSignedAngleRad(Number.NaN)).toBe(0);
  });
});

describe("clampRoverApproachDtSec", () => {
  it("clamps dt and falls back for non-finite values", () => {
    expect(clampRoverApproachDtSec(0)).toBe(ROVER_APPROACH_CONFIG.minDtSec);
    expect(clampRoverApproachDtSec(1)).toBe(ROVER_APPROACH_CONFIG.maxDtSec);
    expect(clampRoverApproachDtSec(Number.NaN)).toBe(ROVER_APPROACH_CONFIG.minDtSec);
  });
});
