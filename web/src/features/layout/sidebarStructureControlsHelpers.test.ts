import { describe, expect, it } from "vitest";

import {
  isStructureModeOptionDisabled,
  resolveSubgroupActionDisabledReason,
  resolveStructureSearchPlaceholder,
  resolveSubgroupActionState,
  shouldShowSubgroupControls,
} from "@/features/layout/sidebarStructureControlsHelpers";

describe("sidebarStructureControlsHelpers", () => {
  it("shows subgroup controls only in links and flat views", () => {
    expect(shouldShowSubgroupControls("links")).toBe(true);
    expect(shouldShowSubgroupControls("flat")).toBe(true);
    expect(shouldShowSubgroupControls("hierarchy")).toBe(false);
  });

  it("resolves subgroup action state", () => {
    expect(
      resolveSubgroupActionDisabledReason({
        canReassignStructureGroups: false,
        effectiveStructureViewMode: "links",
        linkGroupingMode: "body",
      })
    ).toBe("Group editing is unavailable");

    expect(
      resolveSubgroupActionDisabledReason({
        canReassignStructureGroups: true,
        effectiveStructureViewMode: "links",
        linkGroupingMode: "mesh",
      })
    ).toBe("Subgroups are only available in Body grouping");

    expect(
      resolveSubgroupActionDisabledReason({
        canReassignStructureGroups: true,
        effectiveStructureViewMode: "flat",
        linkGroupingMode: "mesh",
      })
    ).toBeNull();

    expect(
      resolveSubgroupActionState({
        canReassignStructureGroups: false,
        effectiveStructureViewMode: "links",
        linkGroupingMode: "body",
      })
    ).toEqual({
      isDisabled: true,
      title: "Group editing is unavailable",
    });

    expect(
      resolveSubgroupActionState({
        canReassignStructureGroups: true,
        effectiveStructureViewMode: "links",
        linkGroupingMode: "mesh",
      })
    ).toEqual({
      isDisabled: true,
      title: "Subgroups are only available in Body grouping",
    });

    expect(
      resolveSubgroupActionState({
        canReassignStructureGroups: true,
        effectiveStructureViewMode: "flat",
        linkGroupingMode: "mesh",
      })
    ).toEqual({
      isDisabled: false,
      title: "Create an empty subgroup drop target",
    });
  });

  it("resolves the structure search placeholder", () => {
    expect(resolveStructureSearchPlaceholder("links")).toBe("Search links...");
    expect(resolveStructureSearchPlaceholder("flat")).toBe("Search joints...");
  });

  it("disables structure mode options that require a URDF when unavailable", () => {
    expect(
      isStructureModeOptionDisabled({
        option: { value: "links", label: "Links", requiresUrdf: true },
        urdfContentAvailable: false,
      })
    ).toBe(true);
    expect(
      isStructureModeOptionDisabled({
        option: { value: "flat", label: "Joints" },
        urdfContentAvailable: false,
      })
    ).toBe(false);
  });
});
