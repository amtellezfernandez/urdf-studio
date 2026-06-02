/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { analyzeUrdf } from "@/shared/lib/urdfCore";
import { buildRobotStructureLabels } from "@/features/layout/robotStructureLabels";
import { moveStructureItemToGroup } from "@/features/layout/structureGroupAssignments";
import { parseUrdfStructureCommentHints } from "@/features/layout/urdfStructureCommentHints";

const SAMPLE_URDF = `<?xml version="1.0"?>
<robot name="group_move">
  <link name="base_link" />
  <link name="left_shoulder_link" />
  <link name="left_tool_link" />
  <link name="right_shoulder_link" />
  <link name="right_tool_link" />

  <joint name="left_shoulder_joint" type="revolute">
    <parent link="base_link" />
    <child link="left_shoulder_link" />
  </joint>
  <joint name="left_wrist_joint" type="revolute">
    <parent link="left_shoulder_link" />
    <child link="left_tool_link" />
  </joint>
  <joint name="right_shoulder_joint" type="revolute">
    <parent link="base_link" />
    <child link="right_shoulder_link" />
  </joint>
  <joint name="right_wrist_joint" type="revolute">
    <parent link="right_shoulder_link" />
    <child link="right_tool_link" />
  </joint>
</robot>`;

describe("moveStructureItemToGroup", () => {
  it("reassigns a joint to the requested group", () => {
    const analysis = analyzeUrdf(SAMPLE_URDF);
    const updated = moveStructureItemToGroup({
      urdfContent: SAMPLE_URDF,
      sourceType: "joint",
      sourceName: "left_shoulder_joint",
      targetGroupLabel: "arm7",
      analysis,
    });

    const hints = parseUrdfStructureCommentHints(updated);
    expect(hints.jointLabelByName.left_shoulder_joint).toBe("arm7");

    const labels = buildRobotStructureLabels(analyzeUrdf(updated), updated);
    expect(labels.jointByName.left_shoulder_joint).toBe("arm7");
    expect(labels.jointByName.left_wrist_joint).toBe("arm7");
    expect(labels.linkByName.left_shoulder_link).toBe("arm7");
    expect(labels.linkByName.left_tool_link).toBe("arm7");
  });

  it("moves link reassignment through the inbound joint when available", () => {
    const analysis = analyzeUrdf(SAMPLE_URDF);
    const updated = moveStructureItemToGroup({
      urdfContent: SAMPLE_URDF,
      sourceType: "link",
      sourceName: "left_shoulder_link",
      targetGroupLabel: "arm9",
      analysis,
    });

    const hints = parseUrdfStructureCommentHints(updated);
    expect(hints.jointLabelByName.left_shoulder_joint).toBe("arm9");
    expect(hints.linkLabelByName.left_shoulder_link).toBeUndefined();
  });

  it("falls back to direct link reassignment when no inbound joint exists", () => {
    const analysis = analyzeUrdf(SAMPLE_URDF);
    const updated = moveStructureItemToGroup({
      urdfContent: SAMPLE_URDF,
      sourceType: "link",
      sourceName: "base_link",
      targetGroupLabel: "base2",
      analysis,
    });

    const hints = parseUrdfStructureCommentHints(updated);
    expect(hints.linkLabelByName.base_link).toBe("base2");
  });

  it("replaces existing directives for the same target instead of duplicating", () => {
    const withComment = `<?xml version="1.0"?>
<robot name="group_move_replace">
  <link name="base_link" />
  <!-- urdf-studio:group label=arm1 joint=left_shoulder_joint -->
  <joint name="left_shoulder_joint" type="revolute">
    <parent link="base_link" />
    <child link="base_link" />
  </joint>
</robot>`;

    const updated = moveStructureItemToGroup({
      urdfContent: withComment,
      sourceType: "joint",
      sourceName: "left_shoulder_joint",
      targetGroupLabel: "arm3",
      analysis: analyzeUrdf(withComment),
    });

    const matchCount = (updated.match(/urdf-studio:group/gi) ?? []).length;
    expect(matchCount).toBe(1);

    const hints = parseUrdfStructureCommentHints(updated);
    expect(hints.jointLabelByName.left_shoulder_joint).toBe("arm3");
  });
});
