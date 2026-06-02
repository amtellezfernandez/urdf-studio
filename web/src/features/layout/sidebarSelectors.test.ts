import { describe, expect, it } from "vitest";

import { buildFilteredJointNames } from "@/features/layout/sidebarSelectors";

describe("buildFilteredJointNames", () => {
  it("keeps URDF limit names when includeJointLimitNames is true", () => {
    const result = buildFilteredJointNames({
      availableJoints: ["shoulder_pan_joint"],
      jointLimits: {
        shoulder_pan_joint: { type: "revolute", lower: -1, upper: 1 },
        elbow_joint: { type: "revolute", lower: -1, upper: 1 },
      },
      typeFilter: "all",
      searchQuery: "",
      includeJointLimitNames: true,
    });

    expect(result).toContain("shoulder_pan_joint");
    expect(result).toContain("elbow_joint");
  });

  it("limits results to provided names when includeJointLimitNames is false", () => {
    const result = buildFilteredJointNames({
      availableJoints: ["x_mm", "theta"],
      jointLimits: {
        shoulder_pan_joint: { type: "revolute", lower: -1, upper: 1 },
      },
      typeFilter: "all",
      searchQuery: "",
      includeJointLimitNames: false,
    });

    expect(result).toEqual(["x_mm", "theta"]);
  });
});
