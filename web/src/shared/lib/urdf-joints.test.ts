import { describe, expect, it, vi } from "vitest";
import type { URDFRobot } from "urdf-loader";

import {
  applyJointValues,
  resolveJointNameFromNames,
  resolveRobotJointName,
} from "@/shared/lib/urdf-joints";

const createRobotMock = (jointNames: string[]) => {
  const setJointValues = vi.fn();
  const robot = {
    joints: Object.fromEntries(jointNames.map((name) => [name, {}])),
    setJointValues,
  } as unknown as URDFRobot;
  return { robot, setJointValues };
};

describe("applyJointValues", () => {
  it("keeps exact joint names untouched", () => {
    const { robot, setJointValues } = createRobotMock([
      "shoulder_pan_joint",
      "elbow_joint",
    ]);

    applyJointValues(robot, {
      shoulder_pan_joint: 1,
      elbow_joint: -0.5,
    });

    expect(setJointValues).toHaveBeenCalledTimes(1);
    expect(setJointValues).toHaveBeenCalledWith({
      shoulder_pan_joint: 1,
      elbow_joint: -0.5,
    });
  });

  it("aliases normalized names and trailing _joint variants", () => {
    const { robot, setJointValues } = createRobotMock([
      "left_wheel_joint",
      "right_wheel_joint",
      "shoulder_pan_joint",
    ]);

    applyJointValues(robot, {
      left_wheel: 0.4,
      rightwheel: -0.6,
      shoulder_pan: 0.2,
    });

    expect(setJointValues).toHaveBeenCalledTimes(1);
    expect(setJointValues).toHaveBeenCalledWith({
      left_wheel_joint: 0.4,
      right_wheel_joint: -0.6,
      shoulder_pan_joint: 0.2,
    });
  });

  it("does not alias ambiguous normalized names", () => {
    const { robot, setJointValues } = createRobotMock([
      "front_joint",
      "front-joint",
    ]);

    applyJointValues(robot, { frontjoint: 0.7 });

    expect(setJointValues).not.toHaveBeenCalled();
  });
});

describe("resolveRobotJointName", () => {
  it("returns exact, normalized, and trailing joint matches", () => {
    const { robot } = createRobotMock([
      "left_wheel_joint",
      "right_wheel_joint",
      "shoulder_pan_joint",
    ]);

    expect(resolveRobotJointName(robot, "left_wheel_joint")).toBe("left_wheel_joint");
    expect(resolveRobotJointName(robot, "rightwheel")).toBe("right_wheel_joint");
    expect(resolveRobotJointName(robot, "shoulder_pan")).toBe("shoulder_pan_joint");
  });

  it("resolves unique prefixed URDF names from imported joint aliases", () => {
    expect(
      resolveRobotJointName(
        createRobotMock(["arm_shoulder_pan", "arm_elbow_flex"]).robot,
        "shoulder_pan",
      ),
    ).toBe("arm_shoulder_pan");
  });

  it("returns null for ambiguous aliases", () => {
    const { robot } = createRobotMock(["front_joint", "front-joint"]);
    expect(resolveRobotJointName(robot, "frontjoint")).toBeNull();
  });

  it("returns null for ambiguous prefixed names", () => {
    const { robot } = createRobotMock([
      "left_shoulder_pan",
      "right_shoulder_pan",
    ]);
    expect(resolveRobotJointName(robot, "shoulder_pan")).toBeNull();
  });

  it("returns null for unmatched names or missing robot", () => {
    const { robot } = createRobotMock(["elbow_joint"]);
    expect(resolveRobotJointName(robot, "unknown_joint")).toBeNull();
    expect(resolveRobotJointName(null, "elbow_joint")).toBeNull();
  });
});

describe("resolveJointNameFromNames", () => {
  it("resolves aliases without a URDF robot instance", () => {
    expect(
      resolveJointNameFromNames(
        ["arm_shoulder_pan", "arm_elbow_flex"],
        "elbow_flex",
      ),
    ).toBe("arm_elbow_flex");
  });
});
