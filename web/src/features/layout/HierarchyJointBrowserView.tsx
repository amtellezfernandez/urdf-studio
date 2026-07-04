import {
  HierarchyTreeView,
  type HierarchyTreeViewProps,
} from "@/features/layout/HierarchyTreeView";
import { resolveHierarchyJointBrowserEmptyState } from "@/features/layout/hierarchyJointBrowserViewHelpers";

type HierarchyJointBrowserViewProps = HierarchyTreeViewProps & {
  searchQuery: string;
  typeFilter: string;
};

export const HierarchyJointBrowserView = ({
  hierarchyTree,
  searchQuery,
  typeFilter,
  ...treeViewProps
}: HierarchyJointBrowserViewProps) => {
  if (!hierarchyTree || hierarchyTree.filteredJoints.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70 p-4 text-center">
        {resolveHierarchyJointBrowserEmptyState({
          hasHierarchyTree: hierarchyTree !== null,
          hasFilteredJoints: Boolean(hierarchyTree?.filteredJoints.length),
          searchQuery,
          typeFilter,
        })}
      </div>
    );
  }

  return <HierarchyTreeView hierarchyTree={hierarchyTree} {...treeViewProps} />;
};
