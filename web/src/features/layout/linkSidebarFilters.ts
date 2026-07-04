import {
  filterVoxelLinks,
  resolveHighlightedLinkName,
  resolveLinkSidebarViewMode,
} from "@/features/layout/linkSidebarFilterHelpers";

export type LinkSidebarViewMode = "links" | "flat" | "hierarchy";

export const filterLinksForSidebar = ({
  allLinks,
  searchQuery,
  voxelDerivedInertialLinkSet,
  voxelOnly,
}: {
  allLinks: string[];
  searchQuery: string;
  voxelDerivedInertialLinkSet: Set<string>;
  voxelOnly: boolean;
}) =>
  filterVoxelLinks({
    allLinks,
    searchQuery,
    voxelDerivedInertialLinkSet,
    voxelOnly,
  });

export const resolveLinkSidebarInteractionState = ({
  currentViewMode,
  simulationPrepPanelOpen,
  selectedLink,
  hoveredLink,
}: {
  currentViewMode: LinkSidebarViewMode;
  simulationPrepPanelOpen: boolean;
  selectedLink: string | null;
  hoveredLink: string | null;
}): {
  highlightedLinkName: string | null;
  viewMode: LinkSidebarViewMode;
} => {
  const highlightedLinkName = resolveHighlightedLinkName({
    hoveredLink,
    selectedLink,
  });

  return {
    highlightedLinkName,
    viewMode: resolveLinkSidebarViewMode({
      currentViewMode,
      highlightedLinkName,
      simulationPrepPanelOpen,
    }),
  };
};
