import { describe, expect, it } from "vitest";
import { createMotionKernel } from "./kernel";

describe("motion kernel", () => {
  it("rejects targets outside controller ownership", () => {
    const kernel = createMotionKernel({
      manipulatorByEndEffector: { ee_left: "arm:ee_left" },
      manipulatorJointOwners: {
        shoulder: "arm:ee_left",
        wheel_joint: "base:wheel-drive",
      },
      manipulators: [
        {
          id: "arm:ee_left",
          endEffectorLink: "ee_left",
          ownedJointNames: ["shoulder"],
          sharedJointNames: [],
        },
      ],
      baseJointNames: ["wheel_joint"],
      gripperJointNames: [],
      unownedJointNames: [],
    });

    const result = kernel.apply({
      currentJointValues: { shoulder: 0, wheel_joint: 0 },
      wheelDriveEnabled: true,
      commands: [
        {
          ownerId: "arm:ee_left",
          domain: "arm",
          priority: 20,
          jointTargets: { shoulder: 1, wheel_joint: 0.5 },
        },
      ],
    });

    expect(result.jointValues.shoulder).toBe(1);
    expect(result.jointValues.wheel_joint).toBe(0);
    expect(result.diagnostics.rejected).toHaveLength(1);
    expect(result.diagnostics.rejected[0]?.reason).toBe("owner-mismatch");
  });

  it("blocks wheel targets when wheel drive is disabled", () => {
    const kernel = createMotionKernel({
      manipulatorByEndEffector: {},
      manipulatorJointOwners: {
        wheel_joint: "base:wheel-drive",
      },
      manipulators: [],
      baseJointNames: ["wheel_joint"],
      gripperJointNames: [],
      unownedJointNames: [],
    });

    const result = kernel.apply({
      currentJointValues: { wheel_joint: 0 },
      wheelDriveEnabled: false,
      commands: [
        {
          ownerId: "base:wheel-drive",
          domain: "base",
          priority: 10,
          jointTargets: { wheel_joint: 2 },
        },
      ],
    });

    expect(result.jointValues.wheel_joint).toBe(0);
    expect(result.diagnostics.rejected[0]?.reason).toBe("wheel-drive-disabled");
  });

  it("resolves priority conflicts deterministically", () => {
    const kernel = createMotionKernel({
      manipulatorByEndEffector: { ee_left: "arm:ee_left", ee_right: "arm:ee_right" },
      manipulatorJointOwners: {
        left_joint: "arm:ee_left",
        right_joint: "arm:ee_right",
      },
      manipulators: [
        {
          id: "arm:ee_left",
          endEffectorLink: "ee_left",
          ownedJointNames: ["left_joint"],
          sharedJointNames: [],
        },
        {
          id: "arm:ee_right",
          endEffectorLink: "ee_right",
          ownedJointNames: ["right_joint"],
          sharedJointNames: [],
        },
      ],
      baseJointNames: [],
      gripperJointNames: [],
      unownedJointNames: [],
    });

    const result = kernel.apply({
      currentJointValues: { left_joint: 0, right_joint: 0 },
      wheelDriveEnabled: true,
      commands: [
        {
          ownerId: "arm:ee_left",
          domain: "arm",
          priority: 30,
          jointTargets: { left_joint: 1 },
        },
        {
          ownerId: "arm:ee_right",
          domain: "arm",
          priority: 10,
          jointTargets: { right_joint: -0.4 },
        },
      ],
    });

    expect(result.jointValues.left_joint).toBe(1);
    expect(result.jointValues.right_joint).toBe(-0.4);
    expect(result.diagnostics.rejected).toHaveLength(0);
  });

  it("resolves end-effector owner with decoded key fallback", () => {
    const kernel = createMotionKernel({
      manipulatorByEndEffector: { "arm ee": "arm:ee_decoded" },
      manipulatorJointOwners: {
        elbow_joint: "arm:ee_decoded",
      },
      manipulators: [
        {
          id: "arm:ee_decoded",
          endEffectorLink: "arm ee",
          ownedJointNames: ["elbow_joint"],
          sharedJointNames: [],
        },
      ],
      baseJointNames: [],
      gripperJointNames: [],
      unownedJointNames: [],
    });

    const sanitized = kernel.sanitizeManipulatorTargets(
      { elbow_joint: 0.42 },
      {
        endEffectorLink: "arm%20ee",
        wheelDriveEnabled: true,
      }
    );

    expect(sanitized).toEqual({ elbow_joint: 0.42 });
  });
});
