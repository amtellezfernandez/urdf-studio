import {
  HierarchyTreeView,
  type HierarchyTreeViewProps,
} from "@/features/layout/HierarchyTreeView";

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
        {!hierarchyTree
          ? "Loading hierarchy..."
          : searchQuery || typeFilter !== "all"
            ? "No joints match the filters"
            : "No joints available"}
      </div>
    );
  }

  return <HierarchyTreeView hierarchyTree={hierarchyTree} {...treeViewProps} />;
};
