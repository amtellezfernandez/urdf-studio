import { describe, expect, it } from "vitest";

import {
  createIkMotionSafetyState,
  limitIkJointTargetsToMotionSafety,
  resolveIkMotionSafetyAccelerationLimit,
  resolveIkMotionSafetyVelocityLimit,
} from "@/features/viewer/ikMotionSafety";
import type { JointLimits } from "@/shared/lib/urdfBrowser";

const TEST_IK_MOTION_SAFETY = {
  jointName: "openarm_left_joint1",
  startMs: 0,
  frameMs: 16,
  velocityLimitRadPerSec: 40,
  firstPositionRad: 0,
  unsafeFirstTargetRad: 0.16,
  safeFirstTargetRad: 0.033,
  secondTargetRad: 0,
  unsafeThirdTargetRad: 0.16,
  safeThirdTargetRad: 0.0304128,
  longGapMs: 2_000,
  longGapUnsafeTargetRad: 10,
  longGapSafeTargetRad: 0.132,
  overMjlabVelocityLimitRadPerSec: 40,
  mjlabSafeVelocityLimitRadPerSec: 11.88,
  mjlabSafeAccelerationLimitRadPerSec2: 118.8,
} as const;

const TEST_JOINT_LIMITS = {
  [TEST_IK_MOTION_SAFETY.jointName]: {
    type: "revolute",
    lower: -10,
    upper: 10,
    velocity: TEST_IK_MOTION_SAFETY.velocityLimitRadPerSec,
  },
} satisfies JointLimits;

const values = (position: number) => ({
  [TEST_IK_MOTION_SAFETY.jointName]: position,
});

describe("IK motion safety", () => {
  it("caps trajectory velocity and acceleration to the MJLab safety envelope", () => {
    expect(
      resolveIkMotionSafetyVelocityLimit(TEST_JOINT_LIMITS, TEST_IK_MOTION_SAFETY.jointName)
    ).toBeCloseTo(TEST_IK_MOTION_SAFETY.mjlabSafeVelocityLimitRadPerSec);
    expect(resolveIkMotionSafetyAccelerationLimit()).toBeCloseTo(
      TEST_IK_MOTION_SAFETY.mjlabSafeAccelerationLimitRadPerSec2
    );
  });

  it("limits the first live IK update from rest", () => {
    const state = createIkMotionSafetyState();

    const first = limitIkJointTargetsToMotionSafety({
      currentJointValues: values(TEST_IK_MOTION_SAFETY.firstPositionRad),
      jointLimits: TEST_JOINT_LIMITS,
      state,
      targetJointValues: values(TEST_IK_MOTION_SAFETY.unsafeFirstTargetRad),
      timestampMs: TEST_IK_MOTION_SAFETY.startMs,
    });

    expect(first.limited).toBe(true);
    expect(
      first.jointValues[TEST_IK_MOTION_SAFETY.jointName] ?? Number.NaN
    ).toBeCloseTo(TEST_IK_MOTION_SAFETY.safeFirstTargetRad);
  });

  it("limits live IK updates that would exceed MJLab acceleration", () => {
    const state = createIkMotionSafetyState();

    const first = limitIkJointTargetsToMotionSafety({
      currentJointValues: values(TEST_IK_MOTION_SAFETY.firstPositionRad),
      jointLimits: TEST_JOINT_LIMITS,
      state,
      targetJointValues: values(TEST_IK_MOTION_SAFETY.secondTargetRad),
      timestampMs: TEST_IK_MOTION_SAFETY.startMs,
    });
    const second = limitIkJointTargetsToMotionSafety({
      currentJointValues: first.jointValues,
      jointLimits: TEST_JOINT_LIMITS,
      state,
      targetJointValues: values(TEST_IK_MOTION_SAFETY.unsafeThirdTargetRad),
      timestampMs: TEST_IK_MOTION_SAFETY.startMs + TEST_IK_MOTION_SAFETY.frameMs,
    });

    expect(first.limited).toBe(false);
    expect(second.limited).toBe(true);
    expect(
      second.jointValues[TEST_IK_MOTION_SAFETY.jointName] ?? Number.NaN
    ).toBeCloseTo(TEST_IK_MOTION_SAFETY.safeThirdTargetRad);
  });

  it("caps long scheduler gaps to the configured control cadence", () => {
    const state = createIkMotionSafetyState();

    const first = limitIkJointTargetsToMotionSafety({
      currentJointValues: values(TEST_IK_MOTION_SAFETY.firstPositionRad),
      jointLimits: TEST_JOINT_LIMITS,
      state,
      targetJointValues: values(TEST_IK_MOTION_SAFETY.secondTargetRad),
      timestampMs: TEST_IK_MOTION_SAFETY.startMs,
    });
    const second = limitIkJointTargetsToMotionSafety({
      currentJointValues: first.jointValues,
      jointLimits: TEST_JOINT_LIMITS,
      state,
      targetJointValues: values(TEST_IK_MOTION_SAFETY.longGapUnsafeTargetRad),
      timestampMs: TEST_IK_MOTION_SAFETY.startMs + TEST_IK_MOTION_SAFETY.longGapMs,
    });

    expect(second.limited).toBe(true);
    expect(
      second.jointValues[TEST_IK_MOTION_SAFETY.jointName] ?? Number.NaN
    ).toBeCloseTo(TEST_IK_MOTION_SAFETY.longGapSafeTargetRad);
  });

  it("holds position instead of applying targets when timestamps are invalid", () => {
    const state = createIkMotionSafetyState();

    const first = limitIkJointTargetsToMotionSafety({
      currentJointValues: values(TEST_IK_MOTION_SAFETY.firstPositionRad),
      jointLimits: TEST_JOINT_LIMITS,
      state,
      targetJointValues: values(TEST_IK_MOTION_SAFETY.unsafeFirstTargetRad),
      timestampMs: TEST_IK_MOTION_SAFETY.startMs,
    });
    const second = limitIkJointTargetsToMotionSafety({
      currentJointValues: first.jointValues,
      jointLimits: TEST_JOINT_LIMITS,
      state,
      targetJointValues: values(TEST_IK_MOTION_SAFETY.longGapUnsafeTargetRad),
      timestampMs: TEST_IK_MOTION_SAFETY.startMs,
    });

    expect(second.limited).toBe(true);
    expect(second.jointValues).toEqual(first.jointValues);
  });

  it("does not move a joint away from an unchanged target because of stale velocity", () => {
    const state = createIkMotionSafetyState();

    const first = limitIkJointTargetsToMotionSafety({
      currentJointValues: values(TEST_IK_MOTION_SAFETY.firstPositionRad),
      jointLimits: TEST_JOINT_LIMITS,
      state,
      targetJointValues: values(TEST_IK_MOTION_SAFETY.unsafeFirstTargetRad),
      timestampMs: TEST_IK_MOTION_SAFETY.startMs,
    });
    const held = limitIkJointTargetsToMotionSafety({
      currentJointValues: first.jointValues,
      jointLimits: TEST_JOINT_LIMITS,
      state,
      targetJointValues: first.jointValues,
      timestampMs: TEST_IK_MOTION_SAFETY.startMs + TEST_IK_MOTION_SAFETY.frameMs,
    });

    expect(held.limited).toBe(false);
    expect(held.jointValues).toEqual(first.jointValues);
  });
});
