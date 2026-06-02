import type { JointMapping, JointLimitMode } from "@/shared/types/feature";

import { HF_DATASET_DEFAULT_FPS } from "@/features/layout/sidebar/hfLazyEpisodeParams";

export { HF_DATASET_TARGET_ZERO_SOURCE } from "@/features/layout/sidebar/hfLazyEpisodeParams";

export const shouldApplyHfDatasetUrdf = ({
  availableJointCount,
  hasUrdfLoadHandler,
}: {
  availableJointCount: number;
  hasUrdfLoadHandler: boolean;
}) => hasUrdfLoadHandler && availableJointCount <= 0;

export const resolveHfDatasetEpisodeFps = ({
  frameCount,
  durationMs,
  fallbackFps = HF_DATASET_DEFAULT_FPS,
}: {
  frameCount: number;
  durationMs: number;
  fallbackFps?: number;
}) => {
  if (frameCount > 1 && Number.isFinite(durationMs) && durationMs > 0) {
    return Math.round(((frameCount - 1) / durationMs) * 1000);
  }
  return fallbackFps;
};

export const buildHfDatasetMappingState = (mappings: JointMapping[]) => {
  const jointMapping: Record<string, string> = {};
  const jointOffsets: Record<string, number> = {};
  const jointInversions: Record<string, boolean> = {};
  const limitModesByJoint: Record<string, JointLimitMode | undefined> = {};

  mappings.forEach((mapping) => {
    if (!mapping.urdfJoint || mapping.urdfJoint === "?") {
      return;
    }
    jointMapping[mapping.datasetJoint] = mapping.urdfJoint;
    if (mapping.offset !== undefined) {
      jointOffsets[mapping.datasetJoint] = mapping.offset;
    }
    if (mapping.inverted) {
      jointInversions[mapping.datasetJoint] = true;
    }
    if (mapping.limitMode) {
      limitModesByJoint[mapping.urdfJoint] = mapping.limitMode;
    }
  });

  return {
    jointMapping,
    jointOffsets,
    jointInversions,
    limitModesByJoint,
  };
};
