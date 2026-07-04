/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { analyzeUrdf } from "@/shared/lib/urdfCore";
import {
  buildCommentOverrideStructureLabels,
  buildRobotStructureLabels,
  createEmptyRobotStructureLabels,
  shouldPreferCommentStructureLabels,
} from "./robotStructureLabels";

const DUAL_ARM_MOBILE_URDF = `<?xml version="1.0"?>
<robot name="dual_arm_mobile">
  <link name="base_link" />
  <link name="left_shoulder_link" />
  <link name="left_tool_link" />
  <link name="right_shoulder_link" />
  <link name="right_tool_link" />
  <link name="front_left_wheel_link" />
  <link name="front_right_wheel_link" />
  <link name="rear_left_wheel_link" />
  <link name="rear_right_wheel_link" />

  <joint name="left_shoulder_joint" type="revolute">
    <parent link="base_link" />
    <child link="left_shoulder_link" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
  <joint name="left_wrist_joint" type="revolute">
    <parent link="left_shoulder_link" />
    <child link="left_tool_link" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
  <joint name="right_shoulder_joint" type="revolute">
    <parent link="base_link" />
    <child link="right_shoulder_link" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
  <joint name="right_wrist_joint" type="revolute">
    <parent link="right_shoulder_link" />
    <child link="right_tool_link" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>

  <joint name="front_left_wheel_joint" type="continuous">
    <parent link="base_link" />
    <child link="front_left_wheel_link" />
  </joint>
  <joint name="front_right_wheel_joint" type="continuous">
    <parent link="base_link" />
    <child link="front_right_wheel_link" />
  </joint>
  <joint name="rear_left_wheel_joint" type="continuous">
    <parent link="base_link" />
    <child link="rear_left_wheel_link" />
  </joint>
  <joint name="rear_right_wheel_joint" type="continuous">
    <parent link="base_link" />
    <child link="rear_right_wheel_link" />
  </joint>
</robot>`;

const QUADRUPED_URDF = `<?xml version="1.0"?>
<robot name="quadruped">
  <link name="body_link" />
  <link name="front_left_leg_link" />
  <link name="front_right_leg_link" />
  <link name="rear_left_leg_link" />
  <link name="rear_right_leg_link" />

  <joint name="front_left_hip_joint" type="revolute">
    <parent link="body_link" />
    <child link="front_left_leg_link" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
  <joint name="front_right_hip_joint" type="revolute">
    <parent link="body_link" />
    <child link="front_right_leg_link" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
  <joint name="rear_left_hip_joint" type="revolute">
    <parent link="body_link" />
    <child link="rear_left_leg_link" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
  <joint name="rear_right_hip_joint" type="revolute">
    <parent link="body_link" />
    <child link="rear_right_leg_link" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
</robot>`;

const CONTINUOUS_REVOLUTE_BRANCH_URDF = `<?xml version="1.0"?>
<robot name="continuous_chain">
  <link name="base_link" />
  <link name="rev_link_1" />
  <link name="rev_link_2" />
  <link name="rev_link_3" />

  <joint name="revolution_1" type="continuous">
    <parent link="base_link" />
    <child link="rev_link_1" />
  </joint>
  <joint name="revolution_2" type="continuous">
    <parent link="rev_link_1" />
    <child link="rev_link_2" />
  </joint>
  <joint name="revolution_3" type="continuous">
    <parent link="rev_link_2" />
    <child link="rev_link_3" />
  </joint>
</robot>`;

const COMMENT_OVERRIDE_URDF = `<?xml version="1.0"?>
<robot name="comment_override">
  <link name="base_link" />
  <link name="left_shoulder_link" />
  <link name="left_tool_link" />

  <!-- urdf-studio:group arm7 -->
  <joint name="left_shoulder_joint" type="revolute">
    <parent link="base_link" />
    <child link="left_shoulder_link" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
  <joint name="left_wrist_joint" type="revolute">
    <parent link="left_shoulder_link" />
    <child link="left_tool_link" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
</robot>`;

const PARTIAL_COMMENT_OVERRIDE_URDF = `<?xml version="1.0"?>
<robot name="partial_comment_override">
  <link name="base_link" />
  <link name="left_shoulder_link" />
  <link name="left_tool_link" />
  <link name="right_shoulder_link" />
  <link name="right_tool_link" />

  <!-- urdf-studio:group arm7 -->
  <joint name="left_shoulder_joint" type="revolute">
    <parent link="base_link" />
    <child link="left_shoulder_link" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
  <joint name="left_wrist_joint" type="revolute">
    <parent link="left_shoulder_link" />
    <child link="left_tool_link" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
  <joint name="right_shoulder_joint" type="revolute">
    <parent link="base_link" />
    <child link="right_shoulder_link" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
  <joint name="right_wrist_joint" type="revolute">
    <parent link="right_shoulder_link" />
    <child link="right_tool_link" />
    <limit lower="-3.14" upper="3.14" effort="100" velocity="1" />
  </joint>
</robot>`;

describe("buildRobotStructureLabels", () => {
  it("builds empty labels and detects when comment labels should be preferred", () => {
    expect(createEmptyRobotStructureLabels()).toEqual({
      jointByName: {},
      linkByName: {},
    });
    expect(shouldPreferCommentStructureLabels(undefined)).toBe(false);
    expect(
      shouldPreferCommentStructureLabels("<!-- urdf-studio:group arm1 --><joint name='j1' />")
    ).toBe(true);
  });

  it("labels base, arms, and wheels for a mobile manipulator", () => {
    const analysis = analyzeUrdf(DUAL_ARM_MOBILE_URDF);
    const labels = buildRobotStructureLabels(analysis);

    expect(labels.linkByName.base_link).toBe("base");

    const armLabels = new Set(
      [labels.jointByName.left_shoulder_joint, labels.jointByName.right_shoulder_joint].filter(
        (value): value is string => typeof value === "string"
      )
    );
    expect(armLabels.size).toBe(2);
    expect(Array.from(armLabels).every((label) => /^arm\d+$/.test(label))).toBe(true);

    const wheelLabels = new Set(
      [
        labels.jointByName.front_left_wheel_joint,
        labels.jointByName.front_right_wheel_joint,
        labels.jointByName.rear_left_wheel_joint,
        labels.jointByName.rear_right_wheel_joint,
      ].filter((value): value is string => typeof value === "string")
    );
    expect(wheelLabels.size).toBe(4);
    expect(Array.from(wheelLabels).every((label) => /^wheel\d+$/.test(label))).toBe(true);
  });

  it("labels four leg branches on a quadruped", () => {
    const analysis = analyzeUrdf(QUADRUPED_URDF);
    const labels = buildRobotStructureLabels(analysis);

    const legLabels = new Set(
      [
        labels.jointByName.front_left_hip_joint,
        labels.jointByName.front_right_hip_joint,
        labels.jointByName.rear_left_hip_joint,
        labels.jointByName.rear_right_hip_joint,
      ].filter((value): value is string => typeof value === "string")
    );
    expect(legLabels.size).toBe(4);
    expect(Array.from(legLabels).every((label) => /^leg\d+$/.test(label))).toBe(true);
  });

  it("does not over-classify deep continuous chains as wheel branches", () => {
    const analysis = analyzeUrdf(CONTINUOUS_REVOLUTE_BRANCH_URDF);
    const labels = buildRobotStructureLabels(analysis);

    expect(labels.jointByName.revolution_1?.startsWith("wheel")).toBe(false);
    expect(labels.jointByName.revolution_1?.startsWith("arm")).toBe(true);
  });

  it("applies comment-based articulation labels from URDF", () => {
    const analysis = analyzeUrdf(COMMENT_OVERRIDE_URDF);
    const labels = buildRobotStructureLabels(analysis, COMMENT_OVERRIDE_URDF);

    expect(labels.jointByName.left_shoulder_joint).toBe("arm7");
    expect(labels.jointByName.left_wrist_joint).toBe("arm7");
    expect(labels.linkByName.left_shoulder_link).toBe("arm7");
    expect(labels.linkByName.left_tool_link).toBe("arm7");
  });

  it("can build comment override labels directly", () => {
    const analysis = analyzeUrdf(COMMENT_OVERRIDE_URDF);
    if (!analysis.isValid) {
      throw new Error("Expected valid analysis fixture");
    }

    const labels = buildCommentOverrideStructureLabels({
      analysis,
      urdfContent: COMMENT_OVERRIDE_URDF,
    });

    expect(labels.jointByName.left_shoulder_joint).toBe("arm7");
    expect(labels.linkByName.left_tool_link).toBe("arm7");
  });

  it("treats comments as source of truth when present and does not auto-assign missing groups", () => {
    const analysis = analyzeUrdf(PARTIAL_COMMENT_OVERRIDE_URDF);
    const labels = buildRobotStructureLabels(analysis, PARTIAL_COMMENT_OVERRIDE_URDF);

    expect(labels.jointByName.left_shoulder_joint).toBe("arm7");
    expect(labels.jointByName.left_wrist_joint).toBe("arm7");
    expect(labels.jointByName.right_shoulder_joint).toBeUndefined();
    expect(labels.jointByName.right_wrist_joint).toBeUndefined();
  });
});
