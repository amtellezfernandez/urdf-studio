import { describe, expect, it } from "vitest";

import {
  buildViewerEndEffectorSummaryModel,
  formatViewerVector3,
} from "@/features/viewer/components/viewerEndEffectorSummaryState";

describe("viewerEndEffectorSummaryState", () => {
  it("formats vector values with a configurable precision", () => {
    expect(formatViewerVector3([1.2345, -2, 0.00001], 2)).toBe("1.23, -2.00, 0.00");
  });

  it("builds summary text for a single end effector", () => {
    expect(
      buildViewerEndEffectorSummaryModel({
        centerOfMassPosition: [0.25, 0.5, 0.75],
        endEffectorLinks: ["tool0"],
        endEffectorPosition: [1, 2, 3],
        primaryEndEffectorLink: "tool0",
        totalMassKg: 4.567,
      })
    ).toEqual({
      centerOfMassText: "0.25, 0.50, 0.75",
      handleCount: 1,
      handlesText: "1:tool0",
      headerText: "EE",
      massText: "4.57 kg",
      primaryEndEffectorLinkText: "tool0",
      primaryEndEffectorPositionText: "1.00, 2.00, 3.00",
    });
  });

  it("uses placeholders when summary values are missing", () => {
    expect(
      buildViewerEndEffectorSummaryModel({
        centerOfMassPosition: null,
        endEffectorLinks: [],
        endEffectorPosition: null,
        primaryEndEffectorLink: null,
        totalMassKg: 0,
      })
    ).toMatchObject({
      centerOfMassText: "--",
      handleCount: 0,
      handlesText: "None",
      headerText: "EEs",
      massText: "--",
      primaryEndEffectorLinkText: "--",
      primaryEndEffectorPositionText: "--",
    });
  });
});
