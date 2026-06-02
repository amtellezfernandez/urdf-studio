/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { analyzeUrdf } from "@/shared/lib/urdfCore";
import {
  findAutoEndEffectorLinksFromAnalysis,
  findDeepestLeafLinksFromAnalysis,
} from "./utils";

const DUAL_ARM_URDF = `<?xml version="1.0"?>
<robot name="dual_arm_mobile">
  <link name="base_link" />
  <link name="wheel_left" />
  <link name="wheel_right" />
  <link name="arm_a_link_1" />
  <link name="arm_a_ee" />
  <link name="arm_b_link_1" />
  <link name="arm_b_link_2" />
  <link name="arm_b_ee" />

  <joint name="wheel_left_joint" type="continuous">
    <parent link="base_link" />
    <child link="wheel_left" />
  </joint>
  <joint name="wheel_right_joint" type="continuous">
    <parent link="base_link" />
    <child link="wheel_right" />
  </joint>

  <joint name="arm_a_joint_1" type="revolute">
    <parent link="base_link" />
    <child link="arm_a_link_1" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
  <joint name="arm_a_joint_2" type="revolute">
    <parent link="arm_a_link_1" />
    <child link="arm_a_ee" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>

  <joint name="arm_b_joint_1" type="revolute">
    <parent link="base_link" />
    <child link="arm_b_link_1" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
  <joint name="arm_b_joint_2" type="revolute">
    <parent link="arm_b_link_1" />
    <child link="arm_b_link_2" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
  <joint name="arm_b_joint_3" type="revolute">
    <parent link="arm_b_link_2" />
    <child link="arm_b_ee" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
</robot>`;

const SINGLE_ARM_MULTI_TIP_URDF = `<?xml version="1.0"?>
<robot name="single_arm_multi_tip">
  <link name="base_link" />
  <link name="arm_link_1" />
  <link name="gripper_body" />
  <link name="gripper_frame" />
  <link name="tool_tip" />

  <joint name="arm_joint_1" type="revolute">
    <parent link="base_link" />
    <child link="arm_link_1" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
  <joint name="wrist_joint" type="revolute">
    <parent link="arm_link_1" />
    <child link="gripper_body" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
  <joint name="gripper_frame_joint" type="fixed">
    <parent link="gripper_body" />
    <child link="gripper_frame" />
  </joint>
  <joint name="tool_tip_joint" type="revolute">
    <parent link="gripper_body" />
    <child link="tool_tip" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
</robot>`;

describe("end-effector utilities", () => {
  it("keeps deepest-leaf behavior but auto-detects both arm EE links", () => {
    const analysis = analyzeUrdf(DUAL_ARM_URDF);

    expect(findDeepestLeafLinksFromAnalysis(analysis)).toEqual(["arm_b_ee"]);
    expect(findAutoEndEffectorLinksFromAnalysis(analysis)).toEqual(["arm_b_ee", "arm_a_ee"]);
  });

  it("collapses multiple tip-like leaves on one arm to a single EE candidate", () => {
    const analysis = analyzeUrdf(SINGLE_ARM_MULTI_TIP_URDF);

    expect(findAutoEndEffectorLinksFromAnalysis(analysis)).toEqual(["tool_tip"]);
  });
});
