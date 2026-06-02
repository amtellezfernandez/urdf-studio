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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const resolvePositiveFiniteOrNull = (value: number | null | undefined): number | null =>
  Number.isFinite(value ?? NaN) && (value as number) >= 0 ? (value as number) : null;

export const resolveRoverApproachStopDistance = (armReachRadiusM: number | null): number => {
  if (!Number.isFinite(armReachRadiusM ?? NaN) || (armReachRadiusM ?? 0) <= 0) {
    return ROVER_APPROACH_CONFIG.fallbackStopDistanceM;
  }
  const maxReachBoundedStopDistanceM = Math.max(
    0,
    Math.min(
      ROVER_APPROACH_CONFIG.maxStopDistanceM,
      (armReachRadiusM as number) - ROVER_APPROACH_CONFIG.reachGapTriggerM
    )
  );
  if (maxReachBoundedStopDistanceM <= 0) {
    return 0;
  }
  const minBoundedStopDistanceM = Math.min(
    ROVER_APPROACH_CONFIG.minStopDistanceM,
    maxReachBoundedStopDistanceM
  );
  const nominalStopDistanceM =
    (armReachRadiusM as number) * ROVER_APPROACH_CONFIG.stopDistanceReachRatio +
    ROVER_APPROACH_CONFIG.stopDistanceStandOffM;
  return clamp(
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
  const reachStopDistanceM = resolveRoverApproachStopDistance(armReachRadiusM);
  const preferredStopDistance = resolvePositiveFiniteOrNull(preferredStopDistanceM);
  const desiredStopDistanceM =
    preferredStopDistance === null
      ? reachStopDistanceM
      : Math.min(reachStopDistanceM, preferredStopDistance);
  const preferredDistanceTolerance = resolvePositiveFiniteOrNull(preferredDistanceToleranceM);
  const distanceToleranceM =
    preferredDistanceTolerance === null
      ? ROVER_APPROACH_CONFIG.distanceToleranceM
      : Math.min(ROVER_APPROACH_CONFIG.distanceToleranceM, preferredDistanceTolerance);
  const safeDistance = Number.isFinite(distanceToTargetM) ? Math.max(0, distanceToTargetM) : 0;
  const safeDot = Number.isFinite(forwardDotTarget) ? forwardDotTarget : 1;

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
    Number.isFinite(armReachRadiusM ?? NaN) &&
    (armReachRadiusM as number) > 0 &&
    safeDistance > (armReachRadiusM as number) - ROVER_APPROACH_CONFIG.reachGapTriggerM;

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
