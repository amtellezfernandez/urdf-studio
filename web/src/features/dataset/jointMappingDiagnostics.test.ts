import { describe, expect, it } from "vitest";

import { computeJointMappingDiagnostics } from "@/features/dataset/jointMappingDiagnostics";

describe("computeJointMappingDiagnostics", () => {
  it("reports mapped, skipped, duplicate target, and wheel-like mappings", () => {
    const diagnostics = computeJointMappingDiagnostics({
      datasetJoints: ["shoulder_pan", "wheel_left", "wheel_right", "gripper"],
      urdfJoints: ["arm_1", "wheel_joint", "gripper_joint", "unused_joint"],
      mappings: [
        { datasetJoint: "shoulder_pan", urdfJoint: "arm_1" },
        { datasetJoint: "wheel_left", urdfJoint: "wheel_joint" },
        { datasetJoint: "wheel_right", urdfJoint: "wheel_joint" },
        { datasetJoint: "gripper", urdfJoint: "?" },
      ],
    });

    expect(diagnostics.mappedDatasetJoints).toEqual([
      "shoulder_pan",
      "wheel_left",
      "wheel_right",
    ]);
    expect(diagnostics.skippedDatasetJoints).toEqual(["gripper"]);
    expect(diagnostics.unusedUrdfJoints).toEqual(["gripper_joint", "unused_joint"]);
    expect(diagnostics.duplicateUrdfTargets).toEqual([
      { urdfJoint: "wheel_joint", datasetJoints: ["wheel_left", "wheel_right"] },
    ]);
    expect(diagnostics.wheelLikeDatasetJoints).toEqual(["wheel_left", "wheel_right"]);
    expect(diagnostics.mappedWheelLikeDatasetJoints).toEqual([
      "wheel_left",
      "wheel_right",
    ]);
    expect(diagnostics.skippedWheelLikeDatasetJoints).toEqual([]);
  });

  it("reports invalid URDF targets and categorizes excluded channels", () => {
    const diagnostics = computeJointMappingDiagnostics({
      datasetJoints: ["shoulder_pan", "x_axis"],
      urdfJoints: ["joint_a"],
      mappings: [
        { datasetJoint: "shoulder_pan", urdfJoint: "joint_a" },
        { datasetJoint: "x_axis", urdfJoint: "missing_joint" },
      ],
      excludedChannels: [
        { name: "x_mm", semantic: "base_pose_planar_x_mm" },
        { name: "camera_front", semantic: "unknown" },
      ],
    });

    expect(diagnostics.invalidMappedDatasetJoints).toEqual(["x_axis"]);
    expect(diagnostics.excludedBaseChannels).toEqual([
      { name: "x_mm", semantic: "base_pose_planar_x_mm" },
    ]);
    expect(diagnostics.excludedOtherChannels).toEqual([
      { name: "camera_front", semantic: "unknown" },
    ]);
  });
});

