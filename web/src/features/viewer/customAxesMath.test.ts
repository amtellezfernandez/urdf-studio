import { describe, expect, it } from "vitest";
import { buildNegativeAxisMarkerDistances } from "@/features/viewer/customAxesMath";

describe("buildNegativeAxisMarkerDistances", () => {
  it("starts at origin and reaches the exact negative axis length", () => {
    const distances = buildNegativeAxisMarkerDistances(1, 0.25);
    expect(distances).toEqual([-0, -0.25, -0.5, -0.75, -1]);
  });

  it("clamps the last marker to the axis length when spacing does not divide evenly", () => {
    const distances = buildNegativeAxisMarkerDistances(1, 0.3);
    const expected = [-0, -0.3, -0.6, -0.9, -1];
    expect(distances).toHaveLength(expected.length);
    expected.forEach((distance, index) => {
      expect(distances[index]).toBeCloseTo(distance, 6);
    });
  });

  it("returns an empty list for invalid lengths or spacing", () => {
    expect(buildNegativeAxisMarkerDistances(0, 0.25)).toEqual([]);
    expect(buildNegativeAxisMarkerDistances(1, 0)).toEqual([]);
  });
});
