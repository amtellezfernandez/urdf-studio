/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { analyzeUrdf } from "@/shared/lib/urdfCore";
import {
  findCommentsToRemoveForTarget,
  normalizeStructureGroupLabel,
  resolveDirectiveNextSiblingElement,
  resolveMoveTargets,
  toGroupDirectiveCommentBody,
} from "@/features/layout/structureGroupAssignmentHelpers";

const SAMPLE_URDF = `<?xml version="1.0"?>
<robot name="group_move">
  <link name="base_link" />
  <link name="shoulder_link" />
  <joint name="shoulder_joint" type="revolute">
    <parent link="base_link" />
    <child link="shoulder_link" />
  </joint>
</robot>`;

describe("structureGroupAssignmentHelpers", () => {
  it("normalizes structure group labels", () => {
    expect(normalizeStructureGroupLabel(" Arm 7 ")).toBe("arm7");
  });

  it("builds group directive comment bodies", () => {
    expect(toGroupDirectiveCommentBody("arm7", "joint", "shoulder_joint")).toBe(
      " urdf-studio:group label=arm7 joint=shoulder_joint "
    );
  });

  it("resolves move targets through inbound joints for links", () => {
    const analysis = analyzeUrdf(SAMPLE_URDF);
    expect(
      resolveMoveTargets(
        {
          sourceType: "link",
          sourceName: "shoulder_link",
        },
        analysis
      )
    ).toEqual([{ type: "joint", name: "shoulder_joint" }]);
  });

  it("resolves the next sibling directive target element", () => {
    const xml = new DOMParser().parseFromString(
      `<robot><link name="base"/><!-- urdf-studio:group arm1 --><joint name="joint_a"/></robot>`,
      "application/xml"
    );
    const commentNode = xml.querySelector("robot")?.childNodes[1] as Comment;
    expect(resolveDirectiveNextSiblingElement(commentNode)?.getAttribute("name")).toBe("joint_a");
  });

  it("finds both explicit and implicit comments to remove for a target", () => {
    const xml = new DOMParser().parseFromString(
      `<robot>
        <!-- urdf-studio:group label=arm1 joint=joint_a -->
        <joint name="joint_a"/>
        <!-- urdf-studio:group arm2 -->
        <joint name="joint_a"/>
      </robot>`,
      "application/xml"
    );
    const comments = findCommentsToRemoveForTarget(
      xml.documentElement,
      "joint",
      "joint_a"
    );
    expect(comments).toHaveLength(2);
  });
});
