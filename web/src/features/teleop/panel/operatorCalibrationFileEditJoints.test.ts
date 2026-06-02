import { describe, expect, it } from "vitest";

import { resolveOperatorCalibrationFileEditGuidedJointNames } from "@/features/teleop/panel/operatorCalibrationFileEditJoints";

describe("operator calibration file edit joints", () => {
  it("starts at the distal arm joint and checks gripper last", () => {
    expect(
      resolveOperatorCalibrationFileEditGuidedJointNames([
        "shoulder_pan",
        "shoulder_lift",
        "elbow_flex",
        "wrist_flex",
        "wrist_roll",
        "gripper",
      ]),
    ).toEqual([
      "wrist_roll",
      "wrist_flex",
      "elbow_flex",
      "shoulder_lift",
      "shoulder_pan",
      "gripper",
    ]);
  });

  it("keeps OpenArm-style eight motor arms data-driven", () => {
    expect(
      resolveOperatorCalibrationFileEditGuidedJointNames([
        "joint_1",
        "joint_2",
        "joint_3",
        "joint_4",
        "joint_5",
        "joint_6",
        "joint_7",
        "gripper",
      ]),
    ).toEqual([
      "joint_7",
      "joint_6",
      "joint_5",
      "joint_4",
      "joint_3",
      "joint_2",
      "joint_1",
      "gripper",
    ]);
  });
});
