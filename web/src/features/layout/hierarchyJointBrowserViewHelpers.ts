export const resolveHierarchyJointBrowserEmptyState = ({
  hasHierarchyTree,
  hasFilteredJoints,
  searchQuery,
  typeFilter,
}: {
  hasHierarchyTree: boolean;
  hasFilteredJoints: boolean;
  searchQuery: string;
  typeFilter: string;
}): string => {
  if (!hasHierarchyTree) {
    return "Loading hierarchy...";
  }
  if (hasFilteredJoints) {
    return "";
  }
  return searchQuery || typeFilter !== "all"
    ? "No joints match the filters"
    : "No joints available";
};
