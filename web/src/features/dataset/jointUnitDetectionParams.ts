import { DATASET_SIGNAL_PROFILE_PARAMS } from "@/features/dataset/profiles/profileParams";

export const JOINT_UNIT_DETECTION_PARAMS = {
  radiansLikelyAbsMax:
    DATASET_SIGNAL_PROFILE_PARAMS.angularUnitDetection.radiansLikelyAbsMax,
  minJointCountForFractionRule: 3,
  minJointFractionOverThreshold: 0.5,
} as const;
