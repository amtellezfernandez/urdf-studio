/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import type { JointHierarchyNode, RobotStructureLabels } from "@/shared/lib/urdfCore";
import {
  applyCommentLabelOverrides,
  applyLabelToBranchFromJoint,
  buildParentToJointsMap,
} from "@/features/layout/robotStructureLabelOverrides";

const orderedJoints: JointHierarchyNode[] = [
  {
    childLink: "shoulder_link",
    children: [],
    depth: 0,
    jointName: "shoulder_joint",
    order: 0,
    parentLink: "base_link",
    type: "revolute",
  },
  {
    childLink: "tool_link",
    children: [],
    depth: 1,
    jointName: "wrist_joint",
    order: 1,
    parentLink: "shoulder_link",
    type: "revolute",
  },
];

const createEmptyLabels = (): RobotStructureLabels => ({
  jointByName: {},
  linkByName: {},
});

describe("robotStructureLabelOverrides", () => {
  it("builds the parent-to-joints map", () => {
    const parentToJoints = buildParentToJointsMap(orderedJoints);
    expect(parentToJoints.get("base_link")?.map((joint) => joint.jointName)).toEqual([
      "shoulder_joint",
    ]);
    expect(parentToJoints.get("shoulder_link")?.map((joint) => joint.jointName)).toEqual([
      "wrist_joint",
    ]);
  });

  it("applies a label to an entire joint branch", () => {
    const labels = createEmptyLabels();
    applyLabelToBranchFromJoint({
      labels,
      parentToJoints: buildParentToJointsMap(orderedJoints),
      rootJoint: orderedJoints[0]!,
      label: "arm7",
    });

    expect(labels.jointByName.shoulder_joint).toBe("arm7");
    expect(labels.jointByName.wrist_joint).toBe("arm7");
    expect(labels.linkByName.shoulder_link).toBe("arm7");
    expect(labels.linkByName.tool_link).toBe("arm7");
  });

  it("applies comment-based overrides with branch labels taking precedence on descendants", () => {
    const labels = createEmptyLabels();
    applyCommentLabelOverrides({
      labels,
      orderedJoints,
      parentToJoints: buildParentToJointsMap(orderedJoints),
      linkNames: ["base_link", "shoulder_link", "tool_link"],
      urdfContent: `<?xml version="1.0"?>
<robot name="override">
  <link name="base_link" />
  <!-- urdf-studio:group arm9 -->
  <joint name="shoulder_joint" type="revolute">
    <parent link="base_link" />
    <child link="shoulder_link" />
  </joint>
  <!-- urdf-studio:group label=tooling link=tool_link -->
  <joint name="wrist_joint" type="revolute">
    <parent link="shoulder_link" />
    <child link="tool_link" />
  </joint>
</robot>`,
    });

    expect(labels.jointByName.shoulder_joint).toBe("arm9");
    expect(labels.jointByName.wrist_joint).toBe("arm9");
    expect(labels.linkByName.shoulder_link).toBe("arm9");
    expect(labels.linkByName.tool_link).toBe("arm9");
  });
});
