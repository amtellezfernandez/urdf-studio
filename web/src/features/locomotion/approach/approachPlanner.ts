import {
  clampNumber,
  clampNumberToMin,
  toFiniteNumberOrFallback,
  toNonNegativeFiniteNumberOrNull,
  toPositiveFiniteNumberOrNull,
} from "@/shared/lib/numeric";
import { ROVER_APPROACH_CONFIG } from "./approachParams";
import type { RoverApproachPlan } from "./approachTypes";

type RoverApproachPlannerInput = {
  wheelDriveEnabled: boolean;
  hasWheelDriveModel: boolean;
  distanceToTargetM: number;
  forwardDotTarget: number;
  armReachRadiusM: number | null;
  preferredStopDistanceM?: number | null;
  preferredDistanceToleranceM?: number | null;
};

const resolvePositiveReachRadiusM = (armReachRadiusM: number | null): number | null =>
  toPositiveFiniteNumberOrNull(armReachRadiusM);

export const resolveRoverApproachStopDistance = (armReachRadiusM: number | null): number => {
  const reachRadiusM = resolvePositiveReachRadiusM(armReachRadiusM);
  if (reachRadiusM === null) {
    return ROVER_APPROACH_CONFIG.fallbackStopDistanceM;
  }
  const maxReachBoundedStopDistanceM = clampNumber(
    reachRadiusM - ROVER_APPROACH_CONFIG.reachGapTriggerM,
    0,
    ROVER_APPROACH_CONFIG.maxStopDistanceM
  );
  if (maxReachBoundedStopDistanceM <= 0) {
    return 0;
  }
  const minBoundedStopDistanceM = Math.min(
    ROVER_APPROACH_CONFIG.minStopDistanceM,
    maxReachBoundedStopDistanceM
  );
  const nominalStopDistanceM =
    reachRadiusM * ROVER_APPROACH_CONFIG.stopDistanceReachRatio +
    ROVER_APPROACH_CONFIG.stopDistanceStandOffM;
  return clampNumber(
    nominalStopDistanceM,
    minBoundedStopDistanceM,
    maxReachBoundedStopDistanceM
  );
};

export const planRoverApproach = ({
  wheelDriveEnabled,
  hasWheelDriveModel,
  distanceToTargetM,
  forwardDotTarget,
  armReachRadiusM,
  preferredStopDistanceM,
  preferredDistanceToleranceM,
}: RoverApproachPlannerInput): RoverApproachPlan => {
  const reachRadiusM = resolvePositiveReachRadiusM(armReachRadiusM);
  const reachStopDistanceM = resolveRoverApproachStopDistance(armReachRadiusM);
  const preferredStopDistance = toNonNegativeFiniteNumberOrNull(preferredStopDistanceM);
  const desiredStopDistanceM =
    preferredStopDistance === null
      ? reachStopDistanceM
      : Math.min(reachStopDistanceM, preferredStopDistance);
  const preferredDistanceTolerance = toNonNegativeFiniteNumberOrNull(
    preferredDistanceToleranceM
  );
  const distanceToleranceM =
    preferredDistanceTolerance === null
      ? ROVER_APPROACH_CONFIG.distanceToleranceM
      : Math.min(ROVER_APPROACH_CONFIG.distanceToleranceM, preferredDistanceTolerance);
  const safeDistance = clampNumberToMin(toFiniteNumberOrFallback(distanceToTargetM, 0), 0);
  const safeDot = toFiniteNumberOrFallback(forwardDotTarget, 1);

  if (!wheelDriveEnabled) {
    return {
      mode: "skip",
      reason: "wheel-disabled",
      desiredStopDistanceM,
      distanceToleranceM,
      allowTranslationYawAssist: true,
      requiresRotation: false,
      requiresTranslation: false,
      distanceToTargetM: safeDistance,
      forwardDotTarget: safeDot,
    };
  }
  if (!hasWheelDriveModel) {
    return {
      mode: "skip",
      reason: "wheel-unavailable",
      desiredStopDistanceM,
      distanceToleranceM,
      allowTranslationYawAssist: true,
      requiresRotation: false,
      requiresTranslation: false,
      distanceToTargetM: safeDistance,
      forwardDotTarget: safeDot,
    };
  }

  const yawTriggerDot = Math.cos(ROVER_APPROACH_CONFIG.yawTriggerRad);
  const requiresRotation = safeDot < yawTriggerDot;
  const requiresTranslation =
    safeDistance > desiredStopDistanceM + distanceToleranceM;
  const isRearTarget = safeDot < ROVER_APPROACH_CONFIG.rearTargetDotThreshold;
  const isOutsideReach =
    reachRadiusM !== null &&
    safeDistance > reachRadiusM - ROVER_APPROACH_CONFIG.reachGapTriggerM;

  if (!requiresRotation && !requiresTranslation && !isRearTarget && !isOutsideReach) {
    return {
      mode: "approach",
      reason: "within-reach",
      desiredStopDistanceM,
      distanceToleranceM,
      allowTranslationYawAssist: false,
      requiresRotation: false,
      requiresTranslation: false,
      distanceToTargetM: safeDistance,
      forwardDotTarget: safeDot,
    };
  }

  const reason = isOutsideReach
    ? "outside-reach"
    : isRearTarget
      ? "rear-target"
      : "orientation-adjust";

  return {
    mode: "approach",
    reason,
    desiredStopDistanceM,
    distanceToleranceM,
    allowTranslationYawAssist: true,
    requiresRotation,
    requiresTranslation,
    distanceToTargetM: safeDistance,
    forwardDotTarget: safeDot,
  };
};

export const shouldExecuteRoverApproachPlan = (plan: RoverApproachPlan): boolean =>
  plan.mode === "approach";
