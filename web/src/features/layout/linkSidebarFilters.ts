import { buildFilteredLinks } from "@/features/layout/sidebarSelectors";

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
}) => {
  const searchFilteredLinks = buildFilteredLinks(allLinks, searchQuery);
  if (!voxelOnly) {
    return searchFilteredLinks;
  }
  return searchFilteredLinks.filter((linkName) => voxelDerivedInertialLinkSet.has(linkName));
};

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
  const highlightedLinkName = selectedLink ?? hoveredLink;
  if (simulationPrepPanelOpen && highlightedLinkName) {
    return {
      highlightedLinkName,
      viewMode: "links",
    };
  }

  return {
    highlightedLinkName,
    viewMode: currentViewMode,
  };
};
