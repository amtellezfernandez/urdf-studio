import {
  buildRobotStructureLabels as buildBaseRobotStructureLabels,
  type JointHierarchyNode,
  type RobotStructureLabels as BaseRobotStructureLabels,
  type UrdfAnalysis,
} from "@/shared/lib/urdfCore";
import {
  hasUrdfStructureCommentHints,
  parseUrdfStructureCommentHints,
} from "@/features/layout/urdfStructureCommentHints";

export type RobotStructureLabels = BaseRobotStructureLabels;

const createEmptyLabels = (): RobotStructureLabels => ({
  linkByName: {},
  jointByName: {},
});

const applyLabelToBranchFromJoint = (
  rootJoint: JointHierarchyNode,
  label: string,
  parentToJoints: Map<string, JointHierarchyNode[]>,
  labels: RobotStructureLabels
): void => {
  const queue: JointHierarchyNode[] = [rootJoint];
  const visitedJointNames = new Set<string>();

  while (queue.length > 0) {
    const joint = queue.shift();
    if (!joint || visitedJointNames.has(joint.jointName)) continue;
    visitedJointNames.add(joint.jointName);
    labels.jointByName[joint.jointName] = label;
    labels.linkByName[joint.childLink] = label;

    const childJoints = parentToJoints.get(joint.childLink) ?? [];
    childJoints.forEach((childJoint) => queue.push(childJoint));
  }
};

const applyCommentLabelOverrides = (
  labels: RobotStructureLabels,
  orderedJoints: JointHierarchyNode[],
  parentToJoints: Map<string, JointHierarchyNode[]>,
  linkNames: string[],
  urdfContent: string | null | undefined
): void => {
  const commentHints = parseUrdfStructureCommentHints(urdfContent);
  const jointByName = new Map(orderedJoints.map((joint) => [joint.jointName, joint] as const));
  const linkNameSet = new Set(linkNames);

  Object.entries(commentHints.linkLabelByName).forEach(([linkName, label]) => {
    if (linkNameSet.has(linkName)) {
      labels.linkByName[linkName] = label;
    }
  });

  Object.entries(commentHints.jointLabelByName).forEach(([jointName, label]) => {
    const rootJoint = jointByName.get(jointName);
    if (!rootJoint) return;
    applyLabelToBranchFromJoint(rootJoint, label, parentToJoints, labels);
  });
};

export const buildRobotStructureLabels = (
  analysis: UrdfAnalysis | null | undefined,
  urdfContent?: string | null
): RobotStructureLabels => {
  if (!analysis?.isValid) {
    return createEmptyLabels();
  }

  const preferCommentLabels = hasUrdfStructureCommentHints(urdfContent);
  if (!preferCommentLabels) {
    return buildBaseRobotStructureLabels(analysis);
  }

  const labels = createEmptyLabels();
  const orderedJoints = analysis.jointHierarchy.orderedJoints ?? [];
  const parentToJoints = new Map<string, JointHierarchyNode[]>();
  orderedJoints.forEach((joint) => {
    const byParent = parentToJoints.get(joint.parentLink);
    if (byParent) {
      byParent.push(joint);
    } else {
      parentToJoints.set(joint.parentLink, [joint]);
    }
  });

  applyCommentLabelOverrides(
    labels,
    orderedJoints,
    parentToJoints,
    analysis.linkNames,
    urdfContent
  );

  return labels;
};
