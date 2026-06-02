import { describe, expect, it } from "vitest";

import { buildInertiaVisualizationMetricGroups } from "@/features/viewer/inertialVisualizationGroups";

describe("buildInertiaVisualizationMetricGroups", () => {
  it("splits indices by the requested metric severity", () => {
    const groups = buildInertiaVisualizationMetricGroups({
      inertiaIndices: [1, 2, 3, 4],
      metric: "shape",
      inertiaByIndex: new Map([
        [1, { mismatchBreakdown: { volume: 0.05, shape: 0.05, center: 0.02 } }],
        [2, { mismatchBreakdown: { volume: 0.25, shape: 0.25, center: 0.02 } }],
        [3, { mismatchBreakdown: { volume: 0.55, shape: 0.55, center: 0.02 } }],
        [4, { mismatchBreakdown: undefined }],
      ]),
    });

    expect(groups).toEqual([
      { key: "healthy", indices: [1] },
      { key: "warning", indices: [2] },
      { key: "problematic", indices: [3] },
      { key: "unverified", indices: [4] },
    ]);
  });

  it("keeps empty buckets so render order stays stable", () => {
    const groups = buildInertiaVisualizationMetricGroups({
      inertiaIndices: [7],
      metric: "volume",
      inertiaByIndex: new Map([
        [7, { mismatchBreakdown: { volume: 0.05, shape: 0.1, center: 0.02 } }],
      ]),
    });

    expect(groups).toEqual([
      { key: "healthy", indices: [7] },
      { key: "warning", indices: [] },
      { key: "problematic", indices: [] },
      { key: "unverified", indices: [] },
    ]);
  });
});
