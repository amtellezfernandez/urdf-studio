import * as THREE from "three";

import {
  ROVER_APPROACH_CONFIG,
  ROVER_APPROACH_DETOUR_CONFIG,
  assessRoverApproachWorldSegmentClearance,
  buildRoverApproachWorldNavigationContext,
  type RoverApproachPlan,
  type RoverApproachRobotFootprint,
  type RoverApproachWorldRouteResult,
} from "@/features/locomotion/approach";
import { WHEEL_PLAYBACK_MOTION_PARAMS } from "@/features/viewer/playback/wheelPlaybackMotionParams";
import { resolveRoverApproachCollisionPathClearanceM } from "@/features/viewer/roverApproachCollisionClearance";
import type {
  RoverApproachRetreatWaypoint,
  RoverApproachWaypointLeg,
} from "@/features/viewer/roverApproachRouteState";

export const shouldBypassRoverApproachRoutePlanning = ({
  plan,
  retreatWaypoint,
}: {
  plan: RoverApproachPlan;
  retreatWaypoint: RoverApproachRetreatWaypoint | null;
}): boolean => !plan.requiresTranslation && retreatWaypoint === null;

export const createDirectRoverApproachWorldRoute = ({
  pathClearanceM,
}: {
  pathClearanceM: number;
}): RoverApproachWorldRouteResult => ({
  mode: "direct",
  waypointWorlds: [],
  pathClearanceM,
  minimumClearanceM: null,
  timeoutBonusMs: 0,
  usedDetourFallback: false,
  plannerSummary: {
    mode: "direct",
    plannerStage: "direct",
    blockedReason: "none",
    minimumClearanceM: null,
    waypointCount: 0,
  },
});

export const resolveBlockedRoverApproachDirectRouteFallback = ({
  navigationRoute,
  navigationWaypointLegs,
  segmentStartWorld,
  finalNavigationGoalWorld,
  navigationContext,
  targetObjectId,
  robotFootprint,
  distanceToTargetM,
  directFallbackDistanceLimitM,
}: {
  navigationRoute: RoverApproachWorldRouteResult;
  navigationWaypointLegs: readonly RoverApproachWaypointLeg[];
  segmentStartWorld: THREE.Vector3;
  finalNavigationGoalWorld: THREE.Vector3;
  navigationContext: ReturnType<typeof buildRoverApproachWorldNavigationContext>;
  targetObjectId: string;
  robotFootprint?: RoverApproachRobotFootprint;
  distanceToTargetM: number;
  directFallbackDistanceLimitM: number;
}): RoverApproachWorldRouteResult | null => {
  if (navigationRoute.mode !== "blocked" || navigationWaypointLegs.length > 0) {
    return null;
  }
  const isNearEnoughForBlockedRouteFallback =
    Number.isFinite(distanceToTargetM) &&
    distanceToTargetM <= Math.max(0, directFallbackDistanceLimitM);
  if (!isNearEnoughForBlockedRouteFallback) {
    return null;
  }
  const runtimeStopPathClearanceM = resolveRoverApproachCollisionPathClearanceM({
    useCase: "runtime-stop",
  });
  const directAssessment = assessRoverApproachWorldSegmentClearance({
    segmentStartWorld,
    segmentEndWorld: finalNavigationGoalWorld,
    navigationContext,
    excludedObstacleId: targetObjectId,
    robotFootprint,
    pathClearanceM: runtimeStopPathClearanceM,
  });
  return directAssessment.isClear
    ? createDirectRoverApproachWorldRoute({
        pathClearanceM: runtimeStopPathClearanceM,
      })
    : null;
};

export const resolveLockedRoverApproachTimeoutBudgetMs = ({
  lockedRoutePointWorlds,
  driveLinearScale,
  driveAngularScale,
}: {
  lockedRoutePointWorlds: readonly THREE.Vector3[];
  driveLinearScale: number;
  driveAngularScale: number;
}): number => {
  const safeLinearScale = Math.max(
    driveLinearScale,
    WHEEL_PLAYBACK_MOTION_PARAMS.driveAuthorityEpsilon
  );
  const safeAngularScale = Math.max(
    driveAngularScale,
    WHEEL_PLAYBACK_MOTION_PARAMS.driveAuthorityEpsilon
  );
  let totalDistanceM = 0;
  let totalTurnRad = 0;
  for (let index = 1; index < lockedRoutePointWorlds.length; index += 1) {
    totalDistanceM += lockedRoutePointWorlds[index].distanceTo(
      lockedRoutePointWorlds[index - 1]
    );
  }
  for (let index = 1; index < lockedRoutePointWorlds.length - 1; index += 1) {
    const previousVector = lockedRoutePointWorlds[index]
      .clone()
      .sub(lockedRoutePointWorlds[index - 1]);
    const nextVector = lockedRoutePointWorlds[index + 1]
      .clone()
      .sub(lockedRoutePointWorlds[index]);
    const previousLength = previousVector.length();
    const nextLength = nextVector.length();
    if (
      previousLength * previousLength <=
        ROVER_APPROACH_DETOUR_CONFIG.segmentLengthEpsilonSq ||
      nextLength * nextLength <=
        ROVER_APPROACH_DETOUR_CONFIG.segmentLengthEpsilonSq
    ) {
      continue;
    }
    previousVector.multiplyScalar(1 / previousLength);
    nextVector.multiplyScalar(1 / nextLength);
    totalTurnRad += Math.acos(
      THREE.MathUtils.clamp(previousVector.dot(nextVector), -1, 1)
    );
  }
  const effectiveLinearSpeedMps = Math.max(
    ROVER_APPROACH_DETOUR_CONFIG.timeoutMinLinearSpeedMps,
    ROVER_APPROACH_CONFIG.maxLinearSpeedMps *
      safeLinearScale *
      ROVER_APPROACH_DETOUR_CONFIG.timeoutLinearSpeedUtilization
  );
  const effectiveAngularSpeedRadps = Math.max(
    ROVER_APPROACH_DETOUR_CONFIG.timeoutMinAngularSpeedRadps,
    ROVER_APPROACH_CONFIG.maxAngularSpeedRadps *
      safeAngularScale *
      ROVER_APPROACH_DETOUR_CONFIG.timeoutAngularSpeedUtilization
  );
  const waypointCount = Math.max(0, lockedRoutePointWorlds.length - 2);
  const segmentCount = Math.max(0, lockedRoutePointWorlds.length - 1);
  return Math.ceil(
    (totalDistanceM / effectiveLinearSpeedMps) * 1000 +
      (totalTurnRad / effectiveAngularSpeedRadps) * 1000 +
      segmentCount * ROVER_APPROACH_DETOUR_CONFIG.timeoutPerSegmentMs +
      waypointCount * ROVER_APPROACH_DETOUR_CONFIG.timeoutPerWaypointMs
  );
};

export const shouldFallbackToTargetCenteredRoverRoute = ({
  isOrbitTarget,
  hasLockedContactGoal,
}: {
  isOrbitTarget: boolean;
  hasLockedContactGoal: boolean;
}): boolean => !isOrbitTarget && !hasLockedContactGoal;

export const shouldUseObjectContactRouteClearance = ({
  isOrbitTarget,
  hasLockedContactGoal,
}: {
  isOrbitTarget: boolean;
  hasLockedContactGoal: boolean;
}): boolean => !isOrbitTarget && hasLockedContactGoal;
