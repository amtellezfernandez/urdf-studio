import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { CreatedObject } from "@/features/objects";
import {
  isGraspableWorldObject,
  resolveGripperGraspState,
  resolveGripperJointName,
} from "@/features/viewer/eeObjectGrasp";

const SO101_GRIPPER_LIMITS = {
  gripper: {
    type: "revolute",
    lower: -0.174533,
    upper: 1.74533,
    velocity: 10,
    effort: 10,
  },
} as unknown as JointLimits;

const createObject = (overrides: Partial<CreatedObject> = {}): CreatedObject => ({
  id: "object",
  type: "sphere",
  position: new THREE.Vector3(),
  size: new THREE.Vector3(0.05, 0.05, 0.05),
  color: "#ffffff",
  trackedJointName: null,
  isIkTarget: true,
  ...overrides,
});

describe("eeObjectGrasp", () => {
  it("selects the named gripper joint from available joint state", () => {
    expect(
      resolveGripperJointName({
        jointValues: { shoulder_pan: 0, gripper: 0.4 },
        jointLimits: SO101_GRIPPER_LIMITS,
      })
    ).toBe("gripper");
  });

  it("engages the SO-101 gripper in the closing band and releases after opening", () => {
    expect(
      resolveGripperGraspState({
        jointValues: { gripper: 0.4 },
        jointLimits: SO101_GRIPPER_LIMITS,
        holding: false,
      })
    ).toBe("engaged");

    expect(
      resolveGripperGraspState({
        jointValues: { gripper: 0.48 },
        jointLimits: SO101_GRIPPER_LIMITS,
        holding: true,
      })
    ).toBe("engaged");

    expect(
      resolveGripperGraspState({
        jointValues: { gripper: 0.75 },
        jointLimits: SO101_GRIPPER_LIMITS,
        holding: true,
      })
    ).toBe("released");
  });

  it("does not treat point targets or restricted zones as graspable objects", () => {
    expect(isGraspableWorldObject(createObject({ type: "point" }))).toBe(false);
    expect(
      isGraspableWorldObject(
        createObject({ source: "runtime-restricted-area" })
      )
    ).toBe(false);
    expect(isGraspableWorldObject(createObject({ type: "sphere" }))).toBe(true);
  });
});
