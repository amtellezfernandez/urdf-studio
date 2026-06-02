import { describe, expect, it } from "vitest";
import type { URDFRobot } from "urdf-loader";

import { getJointColor } from "@/features/urdf/utils/jointColors";
import { resolveEpisodeSignalDisplayRows } from "@/features/dataset/episodeSignalDisplay";

const ROBOT_JOINT_NAMES = [
  "shoulder_pan_joint",
  "wheel_left_joint",
  "wheel_right_joint",
];

const createRobotMock = (jointNames: string[]): URDFRobot =>
  ({
    joints: Object.fromEntries(jointNames.map((jointName) => [jointName, {}])),
  }) as unknown as URDFRobot;

describe("resolveEpisodeSignalDisplayRows", () => {
  it("resolves mapped and unmapped signals with canonical color keys", () => {
    const robot = createRobotMock(ROBOT_JOINT_NAMES);
    const rows = resolveEpisodeSignalDisplayRows({
      signalNames: ["shoulder_pan", "wheel_left_joint", "x_mm", "theta"],
      robot,
      mappedColorReferenceJointNames: ROBOT_JOINT_NAMES,
    });

    expect(rows).toEqual([
      {
        signalName: "shoulder_pan",
        mappedJointName: "shoulder_pan_joint",
        mappingStatus: "mapped",
        colorKey: "shoulder_pan_joint",
        color: getJointColor("shoulder_pan_joint", ROBOT_JOINT_NAMES),
      },
      {
        signalName: "wheel_left_joint",
        mappedJointName: "wheel_left_joint",
        mappingStatus: "mapped",
        colorKey: "wheel_left_joint",
        color: getJointColor("wheel_left_joint", ROBOT_JOINT_NAMES),
      },
      {
        signalName: "x_mm",
        mappedJointName: null,
        mappingStatus: "unmapped",
        colorKey: "x_mm",
        color: getJointColor("x_mm", ["x_mm"]),
      },
      {
        signalName: "theta",
        mappedJointName: null,
        mappingStatus: "unmapped",
        colorKey: "theta",
        color: getJointColor("theta", ["theta"]),
      },
    ]);
  });

  it("keeps mapped colors stable when episode signal sets differ", () => {
    const robot = createRobotMock(ROBOT_JOINT_NAMES);
    const baseline = resolveEpisodeSignalDisplayRows({
      signalNames: ["shoulder_pan"],
      robot,
      mappedColorReferenceJointNames: ROBOT_JOINT_NAMES,
    });
    const variant = resolveEpisodeSignalDisplayRows({
      signalNames: ["x_mm", "shoulder_pan", "theta"],
      robot,
      mappedColorReferenceJointNames: ROBOT_JOINT_NAMES,
    });

    expect(baseline[0]?.color).toBe(variant[1]?.color);
    expect(baseline[0]?.mappedJointName).toBe(variant[1]?.mappedJointName);
  });

  it("keeps unmapped colors stable regardless of surrounding signals", () => {
    const baseline = resolveEpisodeSignalDisplayRows({
      signalNames: ["x_mm"],
    });
    const variant = resolveEpisodeSignalDisplayRows({
      signalNames: ["x_mm", "y_mm", "theta"],
    });

    expect(baseline[0]?.color).toBe(variant[0]?.color);
    expect(baseline[0]?.mappingStatus).toBe("unmapped");
  });

  it("can assign distinct colors for signals that map to the same URDF joint", () => {
    const robot = createRobotMock(ROBOT_JOINT_NAMES);
    const signals = ["shoulder_pan", "shoulder_pan_joint"];
    const rows = resolveEpisodeSignalDisplayRows({
      signalNames: signals,
      robot,
      colorStrategy: "by-signal",
      signalColorReferenceNames: signals,
    });

    expect(rows[0]?.mappedJointName).toBe("shoulder_pan_joint");
    expect(rows[1]?.mappedJointName).toBe("shoulder_pan_joint");
    expect(rows[0]?.colorKey).toBe("shoulder_pan");
    expect(rows[1]?.colorKey).toBe("shoulder_pan_joint");
    expect(rows[0]?.color).not.toBe(rows[1]?.color);
  });

  it("keeps by-signal colors stable with a shared signal catalog", () => {
    const robot = createRobotMock(ROBOT_JOINT_NAMES);
    const catalog = ["shoulder_pan", "shoulder_pan_joint", "x_mm"];
    const baseline = resolveEpisodeSignalDisplayRows({
      signalNames: ["shoulder_pan"],
      robot,
      colorStrategy: "by-signal",
      signalColorReferenceNames: catalog,
    });
    const variant = resolveEpisodeSignalDisplayRows({
      signalNames: ["x_mm", "shoulder_pan", "shoulder_pan_joint"],
      robot,
      colorStrategy: "by-signal",
      signalColorReferenceNames: catalog,
    });

    expect(baseline[0]?.color).toBe(variant[1]?.color);
    expect(baseline[0]?.colorKey).toBe("shoulder_pan");
  });
});
