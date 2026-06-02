export const ROVER_APPROACH_CONTACT_GOAL_PARAMS = {
  directionLengthEpsilonSq: 1e-8,
  directionDuplicateDotThreshold: 0.995,
  preferredDirectionCount: 5,
  surfacePointPreferredDirectionCount: 2,
  sampledDirectionCount: 16,
  targetMarginTieEpsilonSq: 1e-4,
  routeWaypointCountTieBias: 1,
  routePathClearanceM: 0, // Keep at 0 to avoid over-constraining goal selection
  compactTargetSurfaceCorridorMaxPlanarExtentM: 0.2,
  compactTargetSurfaceCorridorMaxPlanarAspectRatio: 1.75,
  contactSourceDetectionToleranceM: 0.08,
} as const;
