import { describe, expect, it } from "vitest";
import jointColors from "@/shared/joint_colors.json";
import { RAD_TO_DEG } from "@/shared/lib/angleConversions";
import {
  formatJointMetricValue,
  resolveJointListItemDisplayState,
} from "@/features/layout/jointListItemDisplayState";

describe("jointListItemDisplayState", () => {
  it("formats missing and finite metric values consistently", () => {
    expect(formatJointMetricValue(undefined)).toBe("--");
    expect(formatJointMetricValue(null)).toBe("--");
    expect(formatJointMetricValue(Number.NaN)).toBe("--");
    expect(formatJointMetricValue(1.234)).toBe("1.23");
  });

  it("resolves degree displays and colorized joint squares for movable joints", () => {
    const state = resolveJointListItemDisplayState({
      angleUnit: "deg",
      availableJoints: ["joint_a", "joint_b", "joint_c"],
      effortLimit: 2,
      jointInfo: {
        type: "revolute",
        lower: -1,
        upper: 1,
        velocity: 0.5,
      },
      jointName: "joint_b",
      resolvedValue: 0.5,
    });

    expect(state.angleDisplayValue).toBeCloseTo(0.5 * RAD_TO_DEG);
    expect(state.angleDisplay).toBe((0.5 * RAD_TO_DEG).toFixed(2));
    expect(state.velocityDisplay).toBe("0.50");
    expect(state.effortDisplay).toBe("2.00");
    expect(state.isFixedJoint).toBe(false);
    expect(state.jointTypeColor).toBe(jointColors.revolute);
    expect(state.squareColor).not.toBe("#52525b");
  });

  it("keeps fixed joints neutral regardless of reference colors", () => {
    const state = resolveJointListItemDisplayState({
      angleUnit: "rad",
      availableJoints: ["joint_a"],
      colorJointNames: ["joint_a", "joint_b"],
      effortLimit: null,
      jointInfo: {
        type: "fixed",
        lower: 0,
        upper: 0,
      },
      jointName: "joint_a",
      resolvedValue: 1,
    });

    expect(state.isFixedJoint).toBe(true);
    expect(state.jointTypeColor).toBe(jointColors.light_gray);
    expect(state.squareColor).toBe("#52525b");
    expect(state.effortDisplay).toBe("--");
  });
});
