import { describe, expect, it } from "vitest";

import {
  buildInertiaVisualizationMetricGroups,
  buildInertiaVisualizationVisibleLinkIndices,
} from "@/features/viewer/inertialVisualizationGroups";

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

describe("buildInertiaVisualizationVisibleLinkIndices", () => {
  const inertials = [
    { linkName: "base" },
    { linkName: "shoulder" },
    { linkName: "wrist" },
    { linkName: "gripper" },
  ];

  it("scopes visible inertia links by name", () => {
    expect(
      buildInertiaVisualizationVisibleLinkIndices({
        inertiaIndices: [0, 1, 2, 3],
        inertials,
        scopedLinkNames: ["shoulder", "gripper"],
      })
    ).toEqual({
      visibleLinkIndices: [1, 3],
      activeVisibleLinkIndices: [1, 3],
      deemphasizedVisibleLinkIndices: [],
    });
  });

  it("splits deemphasized indices out of the visible set", () => {
    expect(
      buildInertiaVisualizationVisibleLinkIndices({
        inertiaIndices: [0, 1, 2, 3],
        inertials,
        scopedLinkNames: ["base", "shoulder", "wrist"],
        deemphasizedOutlineLinkNames: ["base", "gripper"],
      })
    ).toEqual({
      visibleLinkIndices: [0, 1, 2],
      activeVisibleLinkIndices: [1, 2],
      deemphasizedVisibleLinkIndices: [0],
    });
  });

  it("keeps all provided indices visible when no scope is active", () => {
    expect(
      buildInertiaVisualizationVisibleLinkIndices({
        inertiaIndices: [0, 2],
        inertials,
      })
    ).toEqual({
      visibleLinkIndices: [0, 2],
      activeVisibleLinkIndices: [0, 2],
      deemphasizedVisibleLinkIndices: [],
    });
  });
});
