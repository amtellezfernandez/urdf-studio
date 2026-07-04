import { describe, expect, it } from "vitest";
import type { StructureGroupSection } from "@/features/layout/structureGroups";
import {
  areStringSetsEqual,
  buildAvailableSectionIdSet,
  reconcileCollapsedSectionIds,
  resolveCollapsedSectionIdSet,
  resolveVisibleSectionItemNames,
  resolveSectionsContainingItem,
} from "@/features/layout/structureSectionVisibility";

const SECTIONS: StructureGroupSection[] = [
  { id: "base", label: "base", items: ["base_link"] },
  { id: "arm1", label: "arm1", items: ["arm_joint", "tool_link"] },
  { id: "other", label: "other", items: ["misc"] },
];

describe("structureSectionVisibility", () => {
  it("builds available section ids and resolves collapsed ids", () => {
    const availableSectionIds = buildAvailableSectionIdSet(SECTIONS);
    expect(areStringSetsEqual(availableSectionIds, new Set(["base", "arm1", "other"]))).toBe(true);

    const collapsedSectionIds = resolveCollapsedSectionIdSet({
      availableSectionIds,
      collapseAllSections: false,
      collapseNewSectionsByDefault: true,
      knownSectionIds: new Set(["base"]),
      previousCollapsedSectionIds: new Set(["base"]),
    });
    expect(areStringSetsEqual(collapsedSectionIds, new Set(["base", "arm1", "other"]))).toBe(true);
  });

  it("finds sections containing a specific item", () => {
    const result = resolveSectionsContainingItem(SECTIONS, "tool_link");
    expect(Array.from(result)).toEqual(["arm1"]);
  });

  it("defaults new sections to collapsed when configured", () => {
    const reconciled = reconcileCollapsedSectionIds({
      previousCollapsedSectionIds: new Set(),
      knownSectionIds: new Set(),
      sections: SECTIONS,
      collapseNewSectionsByDefault: true,
      collapseAllSections: false,
    });

    expect(areStringSetsEqual(reconciled.collapsedSectionIds, new Set(["base", "arm1", "other"]))).toBe(true);
  });

  it("keeps pinned sections expanded", () => {
    const reconciled = reconcileCollapsedSectionIds({
      previousCollapsedSectionIds: new Set(["base", "arm1", "other"]),
      knownSectionIds: new Set(["base", "arm1", "other"]),
      sections: SECTIONS,
      collapseNewSectionsByDefault: false,
      collapseAllSections: true,
      pinnedExpandedSectionIds: new Set(["arm1"]),
    });

    expect(areStringSetsEqual(reconciled.collapsedSectionIds, new Set(["base", "other"]))).toBe(true);
  });

  it("drops stale section ids from collapsed state", () => {
    const reducedSections = SECTIONS.slice(0, 2);
    const reconciled = reconcileCollapsedSectionIds({
      previousCollapsedSectionIds: new Set(["base", "arm1", "other"]),
      knownSectionIds: new Set(["base", "arm1", "other"]),
      sections: reducedSections,
      collapseNewSectionsByDefault: false,
      collapseAllSections: false,
    });

    expect(areStringSetsEqual(reconciled.collapsedSectionIds, new Set(["base", "arm1"]))).toBe(true);
    expect(areStringSetsEqual(reconciled.knownSectionIds, new Set(["base", "arm1"]))).toBe(true);
  });

  it("shows all section items when the section is expanded", () => {
    const itemNames = ["joint_1", "joint_2", "joint_3"];
    const visible = resolveVisibleSectionItemNames({
      sectionItemNames: itemNames,
      isSectionCollapsed: false,
      activeItemNamesWhenCollapsed: new Set(["joint_2"]),
    });

    expect(visible).toEqual(itemNames);
  });

  it("shows only active items when the section is collapsed", () => {
    const visible = resolveVisibleSectionItemNames({
      sectionItemNames: ["joint_1", "joint_2", "joint_3"],
      isSectionCollapsed: true,
      activeItemNamesWhenCollapsed: new Set(["joint_2"]),
    });

    expect(visible).toEqual(["joint_2"]);
  });
});
