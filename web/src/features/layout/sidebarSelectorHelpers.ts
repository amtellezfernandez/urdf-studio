import type { JointHierarchyNode, JointLimits } from "@/shared/lib/urdfBrowser";

type JointHierarchyLike = {
  orderedJoints: JointHierarchyNode[];
};

export const normalizeSidebarQuery = (query: string): string => query.trim().toLowerCase();

export const buildCombinedJointNameSet = ({
  availableJoints,
  includeJointLimitNames,
  jointLimits,
}: {
  availableJoints: string[];
  includeJointLimitNames: boolean;
  jointLimits: JointLimits;
}): Set<string> =>
  includeJointLimitNames
    ? new Set([...availableJoints, ...Object.keys(jointLimits)])
    : new Set([...availableJoints]);

export const filterHierarchyJoints = ({
  jointHierarchy,
  jointLimits,
  searchQuery,
  typeFilter,
}: {
  jointHierarchy: JointHierarchyLike;
  jointLimits: JointLimits;
  searchQuery: string;
  typeFilter: string;
}): JointHierarchyNode[] => {
  const query = normalizeSidebarQuery(searchQuery);

  return jointHierarchy.orderedJoints.filter((joint) => {
    const jointType = jointLimits[joint.jointName]?.type || joint.type;
    const matchesType = typeFilter === "all" || jointType === typeFilter;
    const matchesSearch = query.length === 0 || joint.jointName.toLowerCase().includes(query);
    return matchesType && matchesSearch;
  });
};

export const buildHierarchyLinkToJointsMap = (
  filteredJoints: readonly JointHierarchyNode[]
): Map<string, JointHierarchyNode[]> => {
  const linkToJoints = new Map<string, JointHierarchyNode[]>();

  filteredJoints.forEach((joint) => {
    const byParent = linkToJoints.get(joint.parentLink);
    if (byParent) {
      byParent.push(joint);
    } else {
      linkToJoints.set(joint.parentLink, [joint]);
    }
  });

  return linkToJoints;
};

export const resolveHierarchyRootLinks = (
  filteredJoints: readonly JointHierarchyNode[]
): string[] => {
  const processedLinks = new Set<string>();
  const rootLinks = new Set<string>();

  filteredJoints.forEach((joint) => {
    processedLinks.add(joint.childLink);
  });

  filteredJoints.forEach((joint) => {
    if (!processedLinks.has(joint.parentLink)) {
      rootLinks.add(joint.parentLink);
    }
  });

  return Array.from(rootLinks);
};
