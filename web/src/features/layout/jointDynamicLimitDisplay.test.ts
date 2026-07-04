/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { resolveJointDynamicLimitDisplayState } from "@/features/layout/jointDynamicLimitDisplay";
import type { JointLimitInfo } from "@/shared/lib/urdfBrowser";

const JOINT_DYNAMIC_LIMIT_FIXTURES = {
  urdfWithLimits: `
  <robot name="limits">
    <link name="base" />
    <link name="tool" />
    <joint name="arm_joint" type="revolute">
      <parent link="base" />
      <child link="tool" />
      <limit lower="-1" upper="1" velocity="1.5" effort="2.25" />
    </joint>
  </robot>
  `,
  urdfWithInvalidLimits: `
  <robot name="limits">
    <link name="base" />
    <link name="tool" />
    <joint name="arm_joint" type="revolute">
      <parent link="base" />
      <child link="tool" />
      <limit velocity="fast" effort="-2" />
    </joint>
  </robot>
  `,
} as const;

const createJointInfo = (
  overrides: Partial<JointLimitInfo & { effort?: number | null; velocity?: number | null }> = {}
): JointLimitInfo & { effort?: number | null; velocity?: number | null } => ({
  lower: -1,
  type: "revolute",
  upper: 1,
  ...overrides,
});

describe("resolveJointDynamicLimitDisplayState", () => {
  it("prefers URDF limit attributes over metadata", () => {
    const state = resolveJointDynamicLimitDisplayState({
      angleUnit: "rad",
      jointInfo: createJointInfo({ effort: 9, velocity: 9 }),
      jointName: "arm_joint",
      jointType: "revolute",
      urdfContent: JOINT_DYNAMIC_LIMIT_FIXTURES.urdfWithLimits,
    });

    expect(state.velocityLimit).toBe(1.5);
    expect(state.velocityDisplay).toBe(1.5);
    expect(state.effortLimit).toBe(2.25);
    expect(state.effortDisplay).toBe(2.25);
    expect(state.velocityUnit).toBe("rad/s");
    expect(state.effortUnit).toBe("N*m");
  });

  it("falls back to joint metadata when URDF content is unavailable", () => {
    const state = resolveJointDynamicLimitDisplayState({
      angleUnit: "deg",
      jointInfo: createJointInfo({ effort: 3.5, velocity: 1 }),
      jointName: "arm_joint",
      jointType: "prismatic",
    });

    expect(state.velocityLimit).toBe(1);
    expect(state.velocityDisplay).toBe(57.3);
    expect(state.velocityMin).toBeCloseTo(0.572957795);
    expect(state.velocityStep).toBe(0.5);
    expect(state.velocityUnit).toBe("°/s");
    expect(state.effortLimit).toBe(3.5);
    expect(state.effortUnit).toBe("N");
  });

  it("marks invalid URDF attributes with bad placeholders", () => {
    const state = resolveJointDynamicLimitDisplayState({
      angleUnit: "rad",
      jointInfo: createJointInfo({ effort: 4, velocity: 2 }),
      jointName: "arm_joint",
      jointType: "revolute",
      urdfContent: JOINT_DYNAMIC_LIMIT_FIXTURES.urdfWithInvalidLimits,
    });

    expect(state.velocityAttribute.status).toBe("invalid");
    expect(state.velocityLimit).toBeNull();
    expect(state.velocityPlaceholder).toBe("bad");
    expect(state.effortAttribute.status).toBe("invalid");
    expect(state.effortLimit).toBe(-2);
    expect(state.effortPlaceholder).toBe("bad");
    expect(state.hasEffortLimit).toBe(true);
  });
});
