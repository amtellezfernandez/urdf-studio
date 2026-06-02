import { describe, expect, it, vi } from "vitest";
import type { URDFRobot } from "urdf-loader";
import {
  areApproachArmResetTargetsSettled,
  resolveApproachArmResetJointNames,
  resolveApproachArmResetTargetValues,
} from "@/features/viewer/approachArmReset";

const createRobot = (jointNames: string[]): URDFRobot =>
  ({
    joints: Object.fromEntries(
      jointNames.map((jointName) => [jointName, { jointValue: [0] }])
    ),
  }) as URDFRobot;

describe("resolveApproachArmResetJointNames", () => {
  it("uses the configured arm joints for the selected end effector", () => {
    const result = resolveApproachArmResetJointNames({
      primaryIkEndEffectorLink: "gripper_tip",
      ikAllowedJointNamesByEe: new Map([["gripper_tip", ["shoulder", "elbow"]]]),
      robot: createRobot(["shoulder", "elbow", "wheel_left"]),
      wheelJointNames: new Set(["wheel_left"]),
    });

    expect(result).toEqual(["shoulder", "elbow"]);
  });

  it("matches encoded end-effector names and excludes wheel joints", () => {
    const result = resolveApproachArmResetJointNames({
      primaryIkEndEffectorLink: "tool%2Ftip",
      ikAllowedJointNamesByEe: new Map([["tool/tip", ["shoulder", "wheel_left"]]]),
      robot: createRobot(["shoulder", "wheel_left"]),
      wheelJointNames: new Set(["wheel_left"]),
    });

    expect(result).toEqual(["shoulder"]);
  });

  it("falls back to all non-wheel joints when no arm ownership map is available", () => {
    const result = resolveApproachArmResetJointNames({
      primaryIkEndEffectorLink: "tool_tip",
      ikAllowedJointNamesByEe: new Map(),
      robot: createRobot(["shoulder", "elbow", "wheel_left", "wheel_right"]),
      wheelJointNames: new Set(["wheel_left", "wheel_right"]),
    });

    expect(result).toEqual(["shoulder", "elbow"]);
  });

  it("returns no joints when no end effector is selected", () => {
    const decodeSpy = vi.spyOn(globalThis, "decodeURIComponent");

    const result = resolveApproachArmResetJointNames({
      primaryIkEndEffectorLink: "",
      ikAllowedJointNamesByEe: new Map(),
      robot: createRobot(["shoulder"]),
      wheelJointNames: new Set(),
    });

    expect(result).toEqual([]);
    expect(decodeSpy).not.toHaveBeenCalled();
    decodeSpy.mockRestore();
  });

  it("builds initial-pose target values only for finite joints", () => {
    expect(
      resolveApproachArmResetTargetValues({
        jointNames: ["shoulder", "missing", "elbow"],
        initialJointTargets: {
          shoulder: 0.2,
          elbow: -0.1,
          missing: Number.NaN,
        },
      })
    ).toEqual({
      shoulder: 0.2,
      elbow: -0.1,
    });
  });

  it("detects when arm-reset targets have settled on the robot", () => {
    const robot = createRobot(["shoulder", "elbow"]);
    (robot.joints?.shoulder as { jointValue: number[] }).jointValue = [0.2];
    (robot.joints?.elbow as { jointValue: number[] }).jointValue = [-0.1];

    expect(
      areApproachArmResetTargetsSettled({
        robot,
        targetJointValues: {
          shoulder: 0.2,
          elbow: -0.1,
        },
        jointToleranceRad: 0.03,
      })
    ).toBe(true);
  });

  it("reports unsettled when any joint remains outside tolerance", () => {
    const robot = createRobot(["shoulder", "elbow"]);
    (robot.joints?.shoulder as { jointValue: number[] }).jointValue = [0.2];
    (robot.joints?.elbow as { jointValue: number[] }).jointValue = [-0.2];

    expect(
      areApproachArmResetTargetsSettled({
        robot,
        targetJointValues: {
          shoulder: 0.2,
          elbow: -0.1,
        },
        jointToleranceRad: 0.03,
      })
    ).toBe(false);
  });
});
