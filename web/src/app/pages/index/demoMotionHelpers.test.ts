import { describe, expect, it } from "vitest";

import { resolveDemoJointNames } from "@/app/pages/index/demoMotionHelpers";

describe("resolveDemoJointNames", () => {
  it("prefers non-fixed joints across analysis, limits, and robot state without duplicates", () => {
    const names = resolveDemoJointNames({
      availableJoints: ["joint_b", "joint_c"],
      jointLimits: {
        joint_c: { type: "revolute", lower: -1, upper: 1 },
        joint_d: { type: "revolute", lower: -1, upper: 1 },
      },
      robot: {
        joints: {
          joint_d: { jointType: "revolute" },
          joint_e: { jointType: "fixed" },
        },
      } as never,
      urdfAnalysis: {
        jointHierarchy: {
          orderedJoints: [
            { jointName: "joint_a", type: "revolute" },
            { jointName: "joint_fixed", type: "fixed" },
          ],
        },
      } as never,
    });

    expect(names).toEqual(["joint_a", "joint_b", "joint_c", "joint_d"]);
  });

  it("falls back to fixed robot joints when nothing else is available", () => {
    const names = resolveDemoJointNames({
      availableJoints: [],
      jointLimits: {},
      robot: {
        joints: {
          base_fixed: { jointType: "fixed" },
        },
      } as never,
      urdfAnalysis: null,
    });

    expect(names).toEqual(["base_fixed"]);
  });
});
