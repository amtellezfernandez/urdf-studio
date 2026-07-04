import { buildFilteredLinks } from "@/features/layout/sidebarSelectors";
import type { LinkSidebarViewMode } from "@/features/layout/linkSidebarFilters";

export const resolveHighlightedLinkName = ({
  hoveredLink,
  selectedLink,
}: {
  hoveredLink: string | null;
  selectedLink: string | null;
}): string | null => selectedLink ?? hoveredLink;

export const resolveLinkSidebarViewMode = ({
  currentViewMode,
  highlightedLinkName,
  simulationPrepPanelOpen,
}: {
  currentViewMode: LinkSidebarViewMode;
  highlightedLinkName: string | null;
  simulationPrepPanelOpen: boolean;
}): LinkSidebarViewMode =>
  simulationPrepPanelOpen && highlightedLinkName ? "links" : currentViewMode;

export const filterVoxelLinks = ({
  allLinks,
  searchQuery,
  voxelDerivedInertialLinkSet,
  voxelOnly,
}: {
  allLinks: string[];
  searchQuery: string;
  voxelDerivedInertialLinkSet: Set<string>;
  voxelOnly: boolean;
}): string[] => {
  const searchFilteredLinks = buildFilteredLinks(allLinks, searchQuery);
  if (!voxelOnly) {
    return searchFilteredLinks;
  }
  return searchFilteredLinks.filter((linkName) => voxelDerivedInertialLinkSet.has(linkName));
};
