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

const createEmptyLabels = (): RobotStructureLabels => ({
  linkByName: {},
  jointByName: {},
});

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
