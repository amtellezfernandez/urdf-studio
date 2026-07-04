import type {
  JointHierarchyNode,
  RobotStructureLabels,
} from "@/shared/lib/urdfCore";
import type { StructureCommentHints } from "@/features/layout/urdfStructureCommentHints";
import { parseUrdfStructureCommentHints } from "@/features/layout/urdfStructureCommentHints";

export const buildParentToJointsMap = (
  orderedJoints: readonly JointHierarchyNode[]
): Map<string, JointHierarchyNode[]> => {
  const parentToJoints = new Map<string, JointHierarchyNode[]>();
  orderedJoints.forEach((joint) => {
    const existingChildJoints = parentToJoints.get(joint.parentLink);
    if (existingChildJoints) {
      existingChildJoints.push(joint);
    } else {
      parentToJoints.set(joint.parentLink, [joint]);
    }
  });
  return parentToJoints;
};

export const applyLabelToBranchFromJoint = ({
  labels,
  parentToJoints,
  rootJoint,
  label,
}: {
  labels: RobotStructureLabels;
  parentToJoints: Map<string, JointHierarchyNode[]>;
  rootJoint: JointHierarchyNode;
  label: string;
}): void => {
  const queue: JointHierarchyNode[] = [rootJoint];
  const visitedJointNames = new Set<string>();

  while (queue.length > 0) {
    const joint = queue.shift();
    if (!joint || visitedJointNames.has(joint.jointName)) {
      continue;
    }

    visitedJointNames.add(joint.jointName);
    labels.jointByName[joint.jointName] = label;
    labels.linkByName[joint.childLink] = label;

    const childJoints = parentToJoints.get(joint.childLink) ?? [];
    childJoints.forEach((childJoint) => queue.push(childJoint));
  }
};

const buildJointsByName = (
  orderedJoints: readonly JointHierarchyNode[]
): Map<string, JointHierarchyNode> =>
  new Map(orderedJoints.map((joint) => [joint.jointName, joint] as const));

export const applyLinkCommentLabelOverrides = ({
  labels,
  commentHints,
  linkNames,
}: {
  labels: RobotStructureLabels;
  commentHints: StructureCommentHints;
  linkNames: readonly string[];
}): void => {
  const linkNameSet = new Set(linkNames);

  Object.entries(commentHints.linkLabelByName).forEach(([linkName, label]) => {
    if (linkNameSet.has(linkName)) {
      labels.linkByName[linkName] = label;
    }
  });
};

export const applyJointCommentLabelOverrides = ({
  labels,
  commentHints,
  orderedJoints,
  parentToJoints,
}: {
  labels: RobotStructureLabels;
  commentHints: StructureCommentHints;
  orderedJoints: readonly JointHierarchyNode[];
  parentToJoints: Map<string, JointHierarchyNode[]>;
}): void => {
  const jointsByName = buildJointsByName(orderedJoints);

  Object.entries(commentHints.jointLabelByName).forEach(([jointName, label]) => {
    const rootJoint = jointsByName.get(jointName);
    if (!rootJoint) {
      return;
    }
    applyLabelToBranchFromJoint({
      labels,
      parentToJoints,
      rootJoint,
      label,
    });
  });
};

export const applyCommentLabelOverrides = ({
  labels,
  orderedJoints,
  parentToJoints,
  linkNames,
  urdfContent,
}: {
  labels: RobotStructureLabels;
  orderedJoints: readonly JointHierarchyNode[];
  parentToJoints: Map<string, JointHierarchyNode[]>;
  linkNames: readonly string[];
  urdfContent: string | null | undefined;
}): void => {
  const commentHints = parseUrdfStructureCommentHints(urdfContent);
  applyLinkCommentLabelOverrides({
    labels,
    commentHints,
    linkNames,
  });
  applyJointCommentLabelOverrides({
    labels,
    commentHints,
    orderedJoints,
    parentToJoints,
  });
};
