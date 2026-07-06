import { describe, expect, it } from "vitest";

import {
  clampIkSolutionToJointLimits,
  scoreIkSolutionPostureRisk,
} from "@/features/viewer/ikJointSolution";
import type { JointLimits } from "@/shared/lib/urdfBrowser";

const JOINT_LIMITS = {
  shoulder: {
    type: "revolute",
    lower: -1,
    upper: 1,
  },
  elbow: {
    type: "revolute",
    lower: 0,
    upper: 2,
  },
  continuous_spin: {
    type: "continuous",
    lower: null,
    upper: null,
  },
} satisfies JointLimits;

describe("ikJointSolution", () => {
  it("clamps finite IK joint values to finite joint limits", () => {
    const result = clampIkSolutionToJointLimits({
      solution: {
        shoulder: -2,
        elbow: 3,
        wrist: 5,
      },
      jointLimits: JOINT_LIMITS,
    });

    expect(result).toEqual({
      solution: {
        shoulder: -1,
        elbow: 2,
        wrist: 5,
      },
      clampedJoints: ["shoulder", "elbow"],
    });
  });

  it("leaves values untouched when limits are missing or unbounded", () => {
    const solution = {
      continuous_spin: 20,
      unknown: -30,
      invalid: Number.NaN,
    };

    expect(
      clampIkSolutionToJointLimits({
        solution,
        jointLimits: JOINT_LIMITS,
      })
    ).toEqual({
      solution,
      clampedJoints: [],
    });
  });

  it("returns the original solution object when no joint limits are available", () => {
    const solution = { shoulder: 2 };
    const result = clampIkSolutionToJointLimits({ solution, jointLimits: null });

    expect(result.solution).toBe(solution);
    expect(result.clampedJoints).toEqual([]);
  });

  it("scores higher posture risk near joint-limit edges", () => {
    const centeredRisk = scoreIkSolutionPostureRisk({
      solution: {
        shoulder: 0,
        elbow: 1,
      },
      jointLimits: JOINT_LIMITS,
    });
    const edgeRisk = scoreIkSolutionPostureRisk({
      solution: {
        shoulder: 0.98,
        elbow: 1.95,
      },
      jointLimits: JOINT_LIMITS,
    });

    expect(edgeRisk).toBeGreaterThan(centeredRisk);
  });
});
