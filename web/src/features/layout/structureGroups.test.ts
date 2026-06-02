import { describe, expect, it } from "vitest";
import {
  buildStructureGroupSections,
  expandStructureSectionsContainingItem,
  mergeStructureGroupSections,
  sortStructureGroupLabels,
  toGroupDisplayLabel,
} from "./structureGroups";

const TEST_NAMES = [
  "base_joint",
  "arm_a_joint",
  "arm_b_joint",
  "wheel_joint",
  "misc_joint",
];

const TEST_LABELS: Record<string, string | undefined> = {
  base_joint: "base",
  arm_a_joint: "arm2",
  arm_b_joint: "arm1",
  wheel_joint: "wheel1",
};

describe("structureGroups", () => {
  it("orders known labels by category and index", () => {
    const labels = ["other", "wheel2", "arm3", "arm1", "base", "leg1"];
    const sorted = [...labels].sort(sortStructureGroupLabels);
    expect(sorted).toEqual(["base", "arm1", "arm3", "leg1", "wheel2", "other"]);
  });

  it("builds grouped sections with unknown labels in other", () => {
    const sections = buildStructureGroupSections(TEST_NAMES, TEST_LABELS);
    expect(sections.map((section) => section.label)).toEqual(["base", "arm1", "arm2", "wheel1", "other"]);
    expect(sections[0]?.items).toEqual(["base_joint"]);
    expect(sections[1]?.items).toEqual(["arm_b_joint"]);
    expect(sections[2]?.items).toEqual(["arm_a_joint"]);
    expect(sections[4]?.items).toEqual(["misc_joint"]);
  });

  it("formats group labels for display", () => {
    expect(toGroupDisplayLabel("arm2")).toBe("Arm2");
    expect(toGroupDisplayLabel("")).toBe("Other");
  });

  it("merges custom empty groups while preserving sort order", () => {
    const sections = buildStructureGroupSections(TEST_NAMES, TEST_LABELS);
    const merged = mergeStructureGroupSections(sections, ["arm3", "gripper1", "arm1"]);

    expect(merged.map((section) => section.label)).toEqual([
      "base",
      "arm1",
      "arm2",
      "arm3",
      "wheel1",
      "other",
      "gripper1",
    ]);
    expect(merged.find((section) => section.label === "arm3")?.items).toEqual([]);
    expect(merged.find((section) => section.label === "gripper1")?.items).toEqual([]);
  });

  it("expands the group that contains the selected item", () => {
    const sections = buildStructureGroupSections(TEST_NAMES, TEST_LABELS);

    const expanded = expandStructureSectionsContainingItem({
      previousCollapsedSectionIds: new Set(["group:base", "group:arm1", "group:wheel1"]),
      sections,
      itemName: "arm_b_joint",
    });

    expect(Array.from(expanded).sort()).toEqual(["group:base", "group:wheel1"]);
  });
});
