import * as THREE from "three";

import {
  ROVER_APPROACH_CONFIG,
  ROVER_APPROACH_DETOUR_CONFIG,
  buildRoverNavigationPreviewPoints,
  cloneRoverNavigationWaypointWorlds,
  planRoverApproach,
  type RoverApproachLegTarget,
  type RoverApproachPlan,
  type RoverApproachWorldRouteResult,
} from "@/features/locomotion/approach";

export type RoverApproachRetreatWaypoint = {
  waypointWorld: THREE.Vector3;
  excludedObstacleId: string;
  retreatDistanceM: number;
};

export type RoverApproachWaypointLeg = {
  waypointWorld: THREE.Vector3;
  excludedObstacleId: string | null;
};

export type RoverApproachNavigationRouteState = {
  lockedRoutePointWorlds: THREE.Vector3[];
  navigationWaypointLegs: RoverApproachWaypointLeg[];
  hasLockedPurpleRoute: boolean;
};

export const shouldAdvanceRoverApproachWaypointLeg = ({
  settledFrameCount,
}: {
  settledFrameCount: number;
}): boolean => settledFrameCount >= ROVER_APPROACH_CONFIG.settleFrames;

export const resolveLockedRoverApproachRoutePreviewPoints = ({
  segmentStartWorld,
  waypointWorlds,
  finalNavigationGoalWorld,
}: {
  segmentStartWorld: THREE.Vector3;
  waypointWorlds: readonly THREE.Vector3[];
  finalNavigationGoalWorld: THREE.Vector3;
}): THREE.Vector3[] =>
  buildRoverNavigationPreviewPoints({
    segmentStartWorld,
    waypointWorlds,
    finalNavigationGoalWorld,
  });

export const resolveWaypointLegApproachPlan = ({
  wheelDriveEnabled,
  hasWheelDriveModel,
  distanceToTargetM,
  forwardDotTarget,
}: {
  wheelDriveEnabled: boolean;
  hasWheelDriveModel: boolean;
  distanceToTargetM: number;
  forwardDotTarget: number;
}): RoverApproachPlan =>
  planRoverApproach({
    wheelDriveEnabled,
    hasWheelDriveModel,
    distanceToTargetM,
    forwardDotTarget,
    armReachRadiusM: null,
    preferredStopDistanceM: ROVER_APPROACH_DETOUR_CONFIG.waypointPlanStopDistanceM,
  });

export const resolveLockedRoverApproachWaypointWorlds = ({
  lockedRoutePointWorlds,
}: {
  lockedRoutePointWorlds: readonly THREE.Vector3[];
}): THREE.Vector3[] =>
  cloneRoverNavigationWaypointWorlds({
    routePointWorlds: lockedRoutePointWorlds,
  });

export const shouldUseLockedPurpleRoute = ({
  retreatWaypoint,
  routeWaypointCount,
}: {
  retreatWaypoint: RoverApproachRetreatWaypoint | null;
  routeWaypointCount: number;
}): boolean => retreatWaypoint !== null || routeWaypointCount > 0;

export const resolveLockedRoverApproachWaypointLegs = ({
  waypointLegs,
}: {
  waypointLegs: readonly RoverApproachWaypointLeg[];
}): RoverApproachWaypointLeg[] =>
  waypointLegs.map((waypointLeg) => ({
    waypointWorld: waypointLeg.waypointWorld.clone(),
    excludedObstacleId: waypointLeg.excludedObstacleId,
  }));

export const resolveRoverApproachNavigationRouteState = ({
  basePositionWorld,
  segmentStartWorld,
  retreatWaypoint,
  navigationRoute,
  finalFacingTarget,
  lockedNavigationGoalWorld,
  targetObjectId,
}: {
  basePositionWorld: THREE.Vector3;
  segmentStartWorld: THREE.Vector3;
  retreatWaypoint: RoverApproachRetreatWaypoint | null;
  navigationRoute: RoverApproachWorldRouteResult;
  finalFacingTarget: RoverApproachLegTarget;
  lockedNavigationGoalWorld: THREE.Vector3 | null;
  targetObjectId: string;
}): RoverApproachNavigationRouteState => {
  const routeWaypointWorlds =
    navigationRoute.mode === "path" ? navigationRoute.waypointWorlds : [];
  const plannedRoutePointWorlds = resolveLockedRoverApproachRoutePreviewPoints({
    segmentStartWorld,
    waypointWorlds: routeWaypointWorlds,
    finalNavigationGoalWorld: finalFacingTarget.navigationGoalWorld,
  });
  const lockedRoutePointWorlds = (
    retreatWaypoint
      ? [basePositionWorld, ...plannedRoutePointWorlds]
      : plannedRoutePointWorlds
  ).map((pointWorld) => pointWorld.clone());
  const navigationWaypointLegs = resolveLockedRoverApproachWaypointLegs({
    waypointLegs: [
      ...(retreatWaypoint
        ? [
            {
              waypointWorld: retreatWaypoint.waypointWorld.clone(),
              excludedObstacleId: retreatWaypoint.excludedObstacleId,
            },
          ]
        : []),
      ...routeWaypointWorlds.map((waypointWorld) => ({
        waypointWorld: waypointWorld.clone(),
        excludedObstacleId: lockedNavigationGoalWorld === null ? targetObjectId : null,
      })),
    ],
  });
  return {
    lockedRoutePointWorlds,
    navigationWaypointLegs,
    hasLockedPurpleRoute: shouldUseLockedPurpleRoute({
      retreatWaypoint,
      routeWaypointCount: routeWaypointWorlds.length,
    }),
  };
};
