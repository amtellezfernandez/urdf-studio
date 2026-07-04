import type { JointHierarchyNode, JointLimits } from "@/shared/lib/urdfBrowser";
import {
  buildCombinedJointNameSet,
  buildHierarchyLinkToJointsMap,
  filterHierarchyJoints,
  normalizeSidebarQuery,
  resolveHierarchyRootLinks,
} from "@/features/layout/sidebarSelectorHelpers";

export const buildJointTypes = (jointLimits: JointLimits): string[] => {
  const types = new Set<string>();
  Object.values(jointLimits).forEach((joint) => {
    if (joint?.type) types.add(joint.type);
  });
  return Array.from(types).sort();
};

export const buildFilteredJointNames = ({
  availableJoints,
  jointLimits,
  typeFilter,
  searchQuery,
  includeJointLimitNames = true,
}: {
  availableJoints: string[];
  jointLimits: JointLimits;
  typeFilter: string;
  searchQuery: string;
  includeJointLimitNames?: boolean;
}): string[] => {
  const allJoints = buildCombinedJointNameSet({
    availableJoints,
    includeJointLimitNames,
    jointLimits,
  });
  const query = normalizeSidebarQuery(searchQuery);

  return Array.from(allJoints).filter((jointName) => {
    const matchesType =
      typeFilter === "all" || jointLimits[jointName]?.type === typeFilter;
    const matchesSearch = query.length === 0 || jointName.toLowerCase().includes(query);
    return matchesType && matchesSearch;
  });
};

export const buildFilteredLinks = (allLinks: string[], searchQuery: string): string[] => {
  const query = normalizeSidebarQuery(searchQuery);
  if (!query) return allLinks;
  return allLinks.filter((linkName) => linkName.toLowerCase().includes(query));
};

type JointHierarchyLike = {
  orderedJoints: JointHierarchyNode[];
};

export type JointHierarchyTreeModel = {
  linkToJoints: Map<string, JointHierarchyNode[]>;
  rootLinks: string[];
  filteredJoints: JointHierarchyNode[];
};

export const buildHierarchyTree = ({
  jointHierarchy,
  jointLimits,
  typeFilter,
  searchQuery,
}: {
  jointHierarchy: JointHierarchyLike | null;
  jointLimits: JointLimits;
  typeFilter: string;
  searchQuery: string;
}): JointHierarchyTreeModel | null => {
  if (!jointHierarchy) return null;
  const filteredJoints = filterHierarchyJoints({
    jointHierarchy,
    jointLimits,
    typeFilter,
    searchQuery,
  });
  const linkToJoints = buildHierarchyLinkToJointsMap(filteredJoints);

  return {
    linkToJoints,
    rootLinks: resolveHierarchyRootLinks(filteredJoints),
    filteredJoints,
  };
};
