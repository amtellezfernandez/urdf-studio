export const ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS = {
  retreatCollisionPathClearanceM: 0.02,
  runtimeCollisionStopClearanceM: 0,
  runtimeCollisionRouteRetryMaxAttempts: 2,
  runtimeCollisionRouteRetryTimeoutBudgetMs: 3000,
  runtimeCollisionSampleLinearStepM: 0.02,
  runtimeCollisionSampleAngularStepRad: Math.PI / 90,
  blockedRouteDirectFallbackExtraDistanceM: 0.08,
  retreatDirectionLengthEpsilonSq: 1e-8,
  retreatOverlapEpsilonM: 1e-4,
  retreatExtraDistanceM: 0.04,
  straightThroughTurnMaxRad: Math.PI / 180,
} as const;
