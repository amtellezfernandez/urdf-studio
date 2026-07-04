import { describe, expect, it } from "vitest";
import type { JointHierarchyNode } from "@/shared/lib/urdfBrowser";
import {
  buildCombinedJointNameSet,
  buildHierarchyLinkToJointsMap,
  filterHierarchyJoints,
  normalizeSidebarQuery,
  resolveHierarchyRootLinks,
} from "@/features/layout/sidebarSelectorHelpers";

const ORDERED_JOINTS: JointHierarchyNode[] = [
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
    type: "continuous",
  },
];

describe("sidebarSelectorHelpers", () => {
  it("normalizes sidebar search queries", () => {
    expect(normalizeSidebarQuery("  Wrist ")).toBe("wrist");
  });

  it("builds the combined joint-name set", () => {
    expect(
      buildCombinedJointNameSet({
        availableJoints: ["joint_a"],
        includeJointLimitNames: true,
        jointLimits: { joint_b: { type: "revolute", lower: -1, upper: 1 } },
      })
    ).toEqual(new Set(["joint_a", "joint_b"]));
  });

  it("filters hierarchy joints by type and search", () => {
    const filtered = filterHierarchyJoints({
      jointHierarchy: { orderedJoints: ORDERED_JOINTS },
      jointLimits: {
        shoulder_joint: { type: "revolute", lower: -1, upper: 1 },
        wrist_joint: { type: "continuous", lower: null, upper: null },
      },
      searchQuery: "wri",
      typeFilter: "continuous",
    });

    expect(filtered.map((joint) => joint.jointName)).toEqual(["wrist_joint"]);
  });

  it("builds hierarchy maps and root links from filtered joints", () => {
    const linkToJoints = buildHierarchyLinkToJointsMap(ORDERED_JOINTS);
    expect(linkToJoints.get("base_link")?.map((joint) => joint.jointName)).toEqual([
      "shoulder_joint",
    ]);
    expect(resolveHierarchyRootLinks(ORDERED_JOINTS)).toEqual(["base_link"]);
  });
});
