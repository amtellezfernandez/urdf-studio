import {
  buildRobotStructureLabels as buildBaseRobotStructureLabels,
  type RobotStructureLabels as BaseRobotStructureLabels,
  type UrdfAnalysis,
} from "@/shared/lib/urdfCore";
import { hasUrdfStructureCommentHints } from "@/features/layout/urdfStructureCommentHints";
import {
  applyCommentLabelOverrides,
  buildParentToJointsMap,
} from "@/features/layout/robotStructureLabelOverrides";

export type RobotStructureLabels = BaseRobotStructureLabels;

export const createEmptyRobotStructureLabels = (): RobotStructureLabels => ({
  linkByName: {},
  jointByName: {},
});

export const shouldPreferCommentStructureLabels = (
  urdfContent?: string | null
): boolean => hasUrdfStructureCommentHints(urdfContent);

export const buildCommentOverrideStructureLabels = ({
  analysis,
  urdfContent,
}: {
  analysis: UrdfAnalysis;
  urdfContent?: string | null;
}): RobotStructureLabels => {
  const labels = createEmptyRobotStructureLabels();
  const orderedJoints = analysis.jointHierarchy.orderedJoints ?? [];
  const parentToJoints = buildParentToJointsMap(orderedJoints);

  applyCommentLabelOverrides({
    labels,
    orderedJoints,
    parentToJoints,
    linkNames: analysis.linkNames,
    urdfContent,
  });

  return labels;
};

export const buildRobotStructureLabels = (
  analysis: UrdfAnalysis | null | undefined,
  urdfContent?: string | null
): RobotStructureLabels => {
  if (!analysis?.isValid) {
    return createEmptyRobotStructureLabels();
  }

  if (!shouldPreferCommentStructureLabels(urdfContent)) {
    return buildBaseRobotStructureLabels(analysis);
  }

  return buildCommentOverrideStructureLabels({
    analysis,
    urdfContent,
  });
};
