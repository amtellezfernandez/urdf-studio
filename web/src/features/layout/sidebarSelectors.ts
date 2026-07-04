import type { JointHierarchyNode, JointLimits } from "@/shared/lib/urdfBrowser";

const normalizeQuery = (query: string) => query.trim().toLowerCase();

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
  const allJoints = includeJointLimitNames
    ? new Set([...availableJoints, ...Object.keys(jointLimits)])
    : new Set([...availableJoints]);
  const query = normalizeQuery(searchQuery);

  return Array.from(allJoints).filter((jointName) => {
    const matchesType =
      typeFilter === "all" || jointLimits[jointName]?.type === typeFilter;
    const matchesSearch = query.length === 0 || jointName.toLowerCase().includes(query);
    return matchesType && matchesSearch;
  });
};

export const buildFilteredLinks = (allLinks: string[], searchQuery: string): string[] => {
  const query = normalizeQuery(searchQuery);
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

const filterHierarchyJoints = ({
  jointHierarchy,
  jointLimits,
  typeFilter,
  searchQuery,
}: {
  jointHierarchy: JointHierarchyLike;
  jointLimits: JointLimits;
  typeFilter: string;
  searchQuery: string;
}): JointHierarchyNode[] => {
  const query = normalizeQuery(searchQuery);
  return jointHierarchy.orderedJoints.filter((joint) => {
    const jointType = jointLimits[joint.jointName]?.type || joint.type;
    const matchesType = typeFilter === "all" || jointType === typeFilter;
    const matchesSearch = query.length === 0 || joint.jointName.toLowerCase().includes(query);
    return matchesType && matchesSearch;
  });
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

  const linkToJoints = new Map<string, JointHierarchyNode[]>();
  const processedLinks = new Set<string>();
  const rootLinks = new Set<string>();

  filteredJoints.forEach((joint) => {
    const byParent = linkToJoints.get(joint.parentLink);
    if (byParent) {
      byParent.push(joint);
    } else {
      linkToJoints.set(joint.parentLink, [joint]);
    }
    processedLinks.add(joint.childLink);
  });

  filteredJoints.forEach((joint) => {
    if (!processedLinks.has(joint.parentLink)) {
      rootLinks.add(joint.parentLink);
    }
  });

  return {
    linkToJoints,
    rootLinks: Array.from(rootLinks),
    filteredJoints,
  };
};
