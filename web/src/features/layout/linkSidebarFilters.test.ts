import { describe, expect, it } from "vitest";
import {
  filterVoxelLinks,
  resolveHighlightedLinkName,
  resolveLinkSidebarViewMode,
} from "@/features/layout/linkSidebarFilterHelpers";
import { filterLinksForSidebar, resolveLinkSidebarInteractionState } from "@/features/layout/linkSidebarFilters";

describe("linkSidebarFilters", () => {
  it("filters links by search and optional voxel membership", () => {
    expect(
      filterVoxelLinks({
        allLinks: ["base_link", "camera_mount", "tool_link"],
        searchQuery: "link",
        voxelDerivedInertialLinkSet: new Set(["tool_link"]),
        voxelOnly: false,
      })
    ).toEqual(["base_link", "tool_link"]);

    expect(
      filterLinksForSidebar({
        allLinks: ["base_link", "camera_mount", "tool_link"],
        searchQuery: "link",
        voxelDerivedInertialLinkSet: new Set(["tool_link"]),
        voxelOnly: true,
      })
    ).toEqual(["tool_link"]);
  });

  it("resolves highlighted links and forced view mode for simulation prep", () => {
    expect(
      resolveHighlightedLinkName({
        hoveredLink: "hover_link",
        selectedLink: "selected_link",
      })
    ).toBe("selected_link");

    expect(
      resolveLinkSidebarViewMode({
        currentViewMode: "hierarchy",
        highlightedLinkName: "selected_link",
        simulationPrepPanelOpen: true,
      })
    ).toBe("links");

    expect(
      resolveLinkSidebarInteractionState({
        currentViewMode: "flat",
        simulationPrepPanelOpen: false,
        selectedLink: null,
        hoveredLink: "hover_link",
      })
    ).toEqual({
      highlightedLinkName: "hover_link",
      viewMode: "flat",
    });
  });
});
