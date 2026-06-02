import { describe, expect, it } from "vitest";
import {
  filterLinksForSidebar,
  resolveLinkSidebarInteractionState,
  resolveVoxelOnlySelectedLink,
} from "./linkSidebarFilters";

describe("filterLinksForSidebar", () => {
  it("filters to voxel-derived links after applying the search query", () => {
    const allLinks = ["base_link", "wheel_left", "wheel_right", "arm_link"];
    const voxelDerivedInertialLinkSet = new Set(["wheel_left", "arm_link"]);

    expect(
      filterLinksForSidebar({
        allLinks,
        searchQuery: "wheel",
        voxelDerivedInertialLinkSet,
        voxelOnly: true,
      })
    ).toEqual(["wheel_left"]);
  });

  it("returns the normal search-filtered link list when voxel-only is disabled", () => {
    const allLinks = ["base_link", "wheel_left", "wheel_right", "arm_link"];
    const voxelDerivedInertialLinkSet = new Set(["wheel_left"]);

    expect(
      filterLinksForSidebar({
        allLinks,
        searchQuery: "wheel",
        voxelDerivedInertialLinkSet,
        voxelOnly: false,
      })
    ).toEqual(["wheel_left", "wheel_right"]);
  });

  it("auto-selects the first voxel-derived link when the current selection is outside the voxel-only filter", () => {
    expect(
      resolveVoxelOnlySelectedLink({
        currentSelectedLink: "base_link",
        filteredLinks: ["wheel_left", "arm_link"],
        voxelOnly: true,
      })
    ).toBe("wheel_left");
  });

  it("preserves the current selection when it remains inside the voxel-only filter", () => {
    expect(
      resolveVoxelOnlySelectedLink({
        currentSelectedLink: "arm_link",
        filteredLinks: ["wheel_left", "arm_link"],
        voxelOnly: true,
      })
    ).toBe("arm_link");
  });

  it("switches to the links list and highlights the touched link during simulation prep", () => {
    expect(
      resolveLinkSidebarInteractionState({
        currentViewMode: "flat",
        simulationPrepPanelOpen: true,
        selectedLink: null,
        hoveredLink: "wheel_left",
      })
    ).toEqual({
      highlightedLinkName: "wheel_left",
      viewMode: "links",
    });
  });

  it("preserves the current sidebar mode outside simulation prep", () => {
    expect(
      resolveLinkSidebarInteractionState({
        currentViewMode: "hierarchy",
        simulationPrepPanelOpen: false,
        selectedLink: "base_link",
        hoveredLink: null,
      })
    ).toEqual({
      highlightedLinkName: "base_link",
      viewMode: "hierarchy",
    });
  });

  it("prefers the active selected link over stale hover state", () => {
    expect(
      resolveLinkSidebarInteractionState({
        currentViewMode: "flat",
        simulationPrepPanelOpen: true,
        selectedLink: "arm_link",
        hoveredLink: "wheel_left",
      })
    ).toEqual({
      highlightedLinkName: "arm_link",
      viewMode: "links",
    });
  });
});
