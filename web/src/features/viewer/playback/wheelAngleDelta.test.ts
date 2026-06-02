import { describe, expect, it } from "vitest";
import { resolveShortestWheelAngleDeltaRad } from "@/features/viewer/playback/wheelAngleDelta";

const DEG_TO_RAD = Math.PI / 180;

describe("wheelAngleDelta", () => {
  it("returns direct deltas for non-wrapping angles", () => {
    const previousAngleRad = 0.25;
    const currentAngleRad = 0.75;

    expect(
      resolveShortestWheelAngleDeltaRad(previousAngleRad, currentAngleRad)
    ).toBeCloseTo(0.5, 8);
  });

  it("unwraps positive wrap-around to the shortest delta", () => {
    const previousAngleRad = 170 * DEG_TO_RAD;
    const currentAngleRad = -170 * DEG_TO_RAD;

    expect(
      resolveShortestWheelAngleDeltaRad(previousAngleRad, currentAngleRad)
    ).toBeCloseTo(20 * DEG_TO_RAD, 8);
  });

  it("unwraps negative wrap-around to the shortest delta", () => {
    const previousAngleRad = -170 * DEG_TO_RAD;
    const currentAngleRad = 170 * DEG_TO_RAD;

    expect(
      resolveShortestWheelAngleDeltaRad(previousAngleRad, currentAngleRad)
    ).toBeCloseTo(-20 * DEG_TO_RAD, 8);
  });
});

