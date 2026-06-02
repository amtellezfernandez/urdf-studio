import { describe, expect, it } from "vitest";

import {
  buildRoverApproachWorldNavigationContext,
  planRoverApproach,
  ROVER_APPROACH_CONFIG,
} from "@/features/locomotion/approach";
import {
  resolveLockedRoverApproachTimeoutBudgetMs,
  resolveRoverApproachCollisionPathClearanceM,
  resolveRoverApproachRuntimeCollisionAssessment,
  resolveLockedRoverApproachRoutePreviewPoints,
  resolveLockedRoverApproachWaypointLegs,
  resolveLockedRoverApproachWaypointWorlds,
  resolveRoverApproachNavigationRouteState,
  resolveRoverApproachRetreatWaypoint,
  resolveWaypointLegApproachPlan,
  shouldUseLockedPurpleRoute,
  shouldBypassRoverApproachRoutePlanning,
  createDirectRoverApproachWorldRoute,
  resolveBlockedRoverApproachDirectRouteFallback,
  resolveRoverApproachAsyncAbortReason,
  shouldFallbackToTargetCenteredRoverRoute,
  shouldUseObjectContactRouteClearance,
  shouldAdvanceRoverApproachWaypointLeg,
  shouldTreatRuntimeCollisionAsReachedTarget,
  resolveRoverApproachRuntimeCollisionAppliedMotionFraction,
  shouldFallbackToTurnInPlaceAfterRuntimeCollision,
  formatRoverApproachRuntimeCollisionDiagnostic,
} from "@/features/viewer/roverApproachBeforeIkSolve";
import * as THREE from "three";
import { ROVER_APPROACH_DETOUR_CONFIG } from "@/features/locomotion/approach";
import type { CreatedObject } from "@/features/objects";
import { ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS } from "@/features/viewer/roverApproachBeforeIkSolveParams";

const createWorldObject = (
  overrides: Partial<CreatedObject> & Pick<CreatedObject, "id" | "position" | "size">
): CreatedObject => ({
  id: overrides.id,
  type: overrides.type ?? "cube",
  position: overrides.position,
  rotation: overrides.rotation ?? new THREE.Euler(0, 0, 0, "XYZ"),
  size: overrides.size,
  color: "#ffffff",
  trackedJointName: null,
  isIkTarget: true,
  ...overrides,
});

const WORLD_UP = new THREE.Vector3(0, 0, 1);

describe("resolveRoverApproachAsyncAbortReason", () => {
  it("prioritizes wheel-disabled over other async abort conditions", () => {
    expect(
      resolveRoverApproachAsyncAbortReason({
        manualApproachInterrupted: true,
        wheelDriveEnabled: false,
        isStaleSolve: true,
      })
    ).toBe("wheel-disabled");
  });

  it("returns manual-base-drag when wheel drive remains enabled", () => {
    expect(
      resolveRoverApproachAsyncAbortReason({
        manualApproachInterrupted: true,
        wheelDriveEnabled: true,
        isStaleSolve: true,
      })
    ).toBe("manual-base-drag");
  });

  it("returns null when no async abort condition is active", () => {
    expect(
      resolveRoverApproachAsyncAbortReason({
        manualApproachInterrupted: false,
        wheelDriveEnabled: true,
        isStaleSolve: false,
      })
    ).toBeNull();
  });

  it("does not advance a waypoint leg early just because the rover is close", () => {
    expect(
      shouldAdvanceRoverApproachWaypointLeg({
        settledFrameCount: ROVER_APPROACH_CONFIG.settleFrames - 1,
      })
    ).toBe(false);
  });

  it("advances a waypoint leg only after the segment has settled", () => {
    expect(
      shouldAdvanceRoverApproachWaypointLeg({
        settledFrameCount: ROVER_APPROACH_CONFIG.settleFrames,
      })
    ).toBe(true);
  });

  it("keeps the preview route locked to planned segment points until a leg transition", () => {
    const segmentStartWorld = new THREE.Vector3(0, 0, 0);
    const waypointWorlds = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(2, 1, 0)];
    const finalNavigationGoalWorld = new THREE.Vector3(3, 1, 0);

    const previewPoints = resolveLockedRoverApproachRoutePreviewPoints({
      segmentStartWorld,
      waypointWorlds,
      finalNavigationGoalWorld,
    });

    expect(previewPoints).toEqual([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 1, 0),
      new THREE.Vector3(3, 1, 0),
    ]);
    expect(previewPoints[0]).not.toBe(segmentStartWorld);
    expect(previewPoints[1]).not.toBe(waypointWorlds[0]);
    expect(previewPoints[2]).not.toBe(waypointWorlds[1]);
    expect(previewPoints[3]).not.toBe(finalNavigationGoalWorld);
  });

  it("keeps waypoint legs locked to the already defined purple route", () => {
    const waypointWorlds = resolveLockedRoverApproachWaypointWorlds({
      lockedRoutePointWorlds: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(2, 1, 0),
        new THREE.Vector3(3, 1, 0),
      ],
    });

    expect(waypointWorlds).toEqual([
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 1, 0),
    ]);
  });

  it("bypasses route planning for turn-in-place plans without a retreat leg", () => {
    const plan = planRoverApproach({
      wheelDriveEnabled: true,
      hasWheelDriveModel: true,
      distanceToTargetM: 0.2,
      forwardDotTarget: 0,
      armReachRadiusM: 1.1,
    });

    expect(plan.requiresRotation).toBe(true);
    expect(plan.requiresTranslation).toBe(false);
    expect(
      shouldBypassRoverApproachRoutePlanning({
        plan,
        retreatWaypoint: null,
      })
    ).toBe(true);
  });

  it("still requires route planning when a retreat leg exists", () => {
    const plan = planRoverApproach({
      wheelDriveEnabled: true,
      hasWheelDriveModel: true,
      distanceToTargetM: 0.2,
      forwardDotTarget: 0,
      armReachRadiusM: 1.1,
    });

    expect(
      shouldBypassRoverApproachRoutePlanning({
        plan,
        retreatWaypoint: {
          waypointWorld: new THREE.Vector3(0.5, 0, 0),
          excludedObstacleId: "obstacle",
          retreatDistanceM: 0.5,
        },
      })
    ).toBe(false);
  });

  it("creates a direct stationary route for rotation-only execution", () => {
    expect(createDirectRoverApproachWorldRoute({ pathClearanceM: 0 })).toEqual({
      mode: "direct",
      waypointWorlds: [],
      pathClearanceM: 0,
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
  });

  it("falls back to a direct route when the planner blocks but runtime straight motion is clear", () => {
    const navigationContext = buildRoverApproachWorldNavigationContext({
      objects: [
        createWorldObject({
          id: "far-obstacle",
          position: new THREE.Vector3(0.5, 0.8, 0),
          size: new THREE.Vector3(0.2, 0.2, 0.2),
        }),
      ],
      upAxisWorld: WORLD_UP,
    });

    expect(
      resolveBlockedRoverApproachDirectRouteFallback({
        navigationRoute: {
          mode: "blocked",
          waypointWorlds: [],
          pathClearanceM: 0.1,
          minimumClearanceM: null,
          timeoutBonusMs: 0,
          usedDetourFallback: false,
          plannerSummary: {
            mode: "blocked",
            plannerStage: "blocked",
            blockedReason: "goal-in-collision",
            minimumClearanceM: null,
            waypointCount: 0,
          },
        },
        navigationWaypointLegs: [],
        segmentStartWorld: new THREE.Vector3(0, 0, 0),
        finalNavigationGoalWorld: new THREE.Vector3(1, 0, 0),
        navigationContext,
        targetObjectId: "target",
        robotFootprint: {
          halfLengthM: 0.18,
          halfWidthM: 0.16,
        },
        distanceToTargetM: 0.05,
        directFallbackDistanceLimitM: 0.1,
      })
    ).toEqual(
      createDirectRoverApproachWorldRoute({
        pathClearanceM: 0,
      })
    );
  });

  it("does not bypass a blocked route when the straight runtime motion is actually obstructed", () => {
    const navigationContext = buildRoverApproachWorldNavigationContext({
      objects: [
        createWorldObject({
          id: "blocking-object",
          position: new THREE.Vector3(0.5, 0, 0),
          size: new THREE.Vector3(0.2, 0.2, 0.2),
        }),
      ],
      upAxisWorld: WORLD_UP,
    });

    expect(
      resolveBlockedRoverApproachDirectRouteFallback({
        navigationRoute: {
          mode: "blocked",
          waypointWorlds: [],
          pathClearanceM: 0.1,
          minimumClearanceM: null,
          timeoutBonusMs: 0,
          usedDetourFallback: false,
          plannerSummary: {
            mode: "blocked",
            plannerStage: "blocked",
            blockedReason: "no-traversable-corridor",
            minimumClearanceM: null,
            waypointCount: 0,
          },
        },
        navigationWaypointLegs: [],
        segmentStartWorld: new THREE.Vector3(0, 0, 0),
        finalNavigationGoalWorld: new THREE.Vector3(1, 0, 0),
        navigationContext,
        targetObjectId: "target",
        robotFootprint: {
          halfLengthM: 0.18,
          halfWidthM: 0.16,
        },
        distanceToTargetM: 0.05,
        directFallbackDistanceLimitM: 0.1,
      })
    ).toBeNull();
  });

  it("does not use the blocked-route direct fallback when the rover is still too far away", () => {
    const navigationContext = buildRoverApproachWorldNavigationContext({
      objects: [],
      upAxisWorld: WORLD_UP,
    });

    expect(
      resolveBlockedRoverApproachDirectRouteFallback({
        navigationRoute: {
          mode: "blocked",
          waypointWorlds: [],
          pathClearanceM: 0.1,
          minimumClearanceM: null,
          timeoutBonusMs: 0,
          usedDetourFallback: false,
          plannerSummary: {
            mode: "blocked",
            plannerStage: "blocked",
            blockedReason: "route-validation-failed",
            minimumClearanceM: null,
            waypointCount: 0,
          },
        },
        navigationWaypointLegs: [],
        segmentStartWorld: new THREE.Vector3(0, 0, 0),
        finalNavigationGoalWorld: new THREE.Vector3(1, 0, 0),
        navigationContext,
        targetObjectId: "target",
        robotFootprint: {
          halfLengthM: 0.18,
          halfWidthM: 0.16,
        },
        distanceToTargetM: 0.25,
        directFallbackDistanceLimitM: 0.1,
      })
    ).toBeNull();
  });

  it("scales the locked-route timeout budget with route length", () => {
    const shortBudgetMs = resolveLockedRoverApproachTimeoutBudgetMs({
      lockedRoutePointWorlds: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 0, 0),
      ],
      driveLinearScale: 1,
      driveAngularScale: 1,
    });
    const longBudgetMs = resolveLockedRoverApproachTimeoutBudgetMs({
      lockedRoutePointWorlds: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(1, 1, 0),
        new THREE.Vector3(3, 1, 0),
      ],
      driveLinearScale: 1,
      driveAngularScale: 1,
    });

    expect(longBudgetMs).toBeGreaterThan(shortBudgetMs);
  });

  it("extends the locked-route timeout budget when drive authority is limited", () => {
    const fullAuthorityBudgetMs = resolveLockedRoverApproachTimeoutBudgetMs({
      lockedRoutePointWorlds: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(1, 1, 0),
      ],
      driveLinearScale: 1,
      driveAngularScale: 1,
    });
    const reducedAuthorityBudgetMs = resolveLockedRoverApproachTimeoutBudgetMs({
      lockedRoutePointWorlds: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(1, 1, 0),
      ],
      driveLinearScale: 0.5,
      driveAngularScale: 0.5,
    });

    expect(reducedAuthorityBudgetMs).toBeGreaterThan(fullAuthorityBudgetMs);
  });

  it("uses zero extra clearance when deciding whether live motion must stop", () => {
    expect(
      resolveRoverApproachCollisionPathClearanceM({ useCase: "runtime-stop" })
    ).toBe(0);
  });

  it("keeps retreat overlap detection more conservative than live collision stops", () => {
    expect(
      resolveRoverApproachCollisionPathClearanceM({ useCase: "retreat-overlap" })
    ).toBeGreaterThan(
      resolveRoverApproachCollisionPathClearanceM({ useCase: "runtime-stop" })
    );
  });

  it("samples runtime motion so thin obstacles between frames still count as real collisions", () => {
    const navigationContext = buildRoverApproachWorldNavigationContext({
      objects: [
        createWorldObject({
          id: "thin-blocker",
          position: new THREE.Vector3(0.5, 0, 0),
          size: new THREE.Vector3(0.04, 0.04, 0.04),
        }),
      ],
      upAxisWorld: WORLD_UP,
    });

    const assessment = resolveRoverApproachRuntimeCollisionAssessment({
      basePositionWorld: new THREE.Vector3(0, 0, 0),
      nextBasePositionWorld: new THREE.Vector3(1, 0, 0),
      forwardWorld: new THREE.Vector3(1, 0, 0),
      nextForwardWorld: new THREE.Vector3(1, 0, 0),
      navigationContext,
    });

    expect(assessment.isClear).toBe(false);
    expect(assessment.sampleCount).toBeGreaterThan(1);
    expect(assessment.safeMotionFraction).toBeGreaterThanOrEqual(0);
    expect(assessment.safeMotionFraction).toBeLessThan(
      assessment.collisionMotionFraction
    );
    expect(assessment.collisionMotionFraction).toBeLessThan(1);
    expect(assessment.blockingObstacleId).toBe("thin-blocker");
  });

  it("stops at the last confirmed-safe pose when runtime collision sampling finds a blocker", () => {
    expect(
      resolveRoverApproachRuntimeCollisionAppliedMotionFraction({
        collisionAssessment: {
          isClear: false,
          sampleCount: 5,
          safeMotionFraction: 0.6,
          collisionMotionFraction: 0.8,
          blockingObstacleId: "thin-blocker",
        },
      })
    ).toBe(0.6);
  });

  it("falls back to an exact turn when a translate step only fails because the drive arc sweeps too wide", () => {
    expect(
      shouldFallbackToTurnInPlaceAfterRuntimeCollision({
        allowTranslationYawAssist: true,
        phase: "translate",
        linearTravelM: ROVER_APPROACH_CONFIG.appliedTravelEpsilon * 2,
        angularTravelRad:
          ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS.straightThroughTurnMaxRad * 2,
      })
    ).toBe(true);
    expect(
      shouldFallbackToTurnInPlaceAfterRuntimeCollision({
        allowTranslationYawAssist: false,
        phase: "translate",
        linearTravelM: ROVER_APPROACH_CONFIG.appliedTravelEpsilon * 2,
        angularTravelRad:
          ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS.straightThroughTurnMaxRad * 2,
      })
    ).toBe(false);
    expect(
      shouldFallbackToTurnInPlaceAfterRuntimeCollision({
        allowTranslationYawAssist: true,
        phase: "rotate",
        linearTravelM: ROVER_APPROACH_CONFIG.appliedTravelEpsilon * 2,
        angularTravelRad:
          ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS.straightThroughTurnMaxRad * 2,
      })
    ).toBe(false);
  });

  it("formats runtime collision diagnostics with the blocking object label when available", () => {
    expect(
      formatRoverApproachRuntimeCollisionDiagnostic({
        worldObjects: [
          createWorldObject({
            id: "blocking-object",
            label: "Shelf",
            position: new THREE.Vector3(0, 0, 0),
            size: new THREE.Vector3(1, 1, 1),
          }),
        ],
        blockingObstacleId: "blocking-object",
      })
    ).toBe("Rover approach blocked by Shelf");
    expect(
      formatRoverApproachRuntimeCollisionDiagnostic({
        worldObjects: [],
        blockingObstacleId: null,
      })
    ).toBe("Rover approach blocked by live collision");
  });

  it("treats final-leg target contact as reaching the object", () => {
    expect(
      shouldTreatRuntimeCollisionAsReachedTarget({
        activeWaypointLeg: null,
        blockingObstacleId: "target-object",
        isOrbitTarget: false,
        targetObjectId: "target-object",
      })
    ).toBe(true);
  });

  it("does not treat waypoint-leg or non-target collisions as reaching the object", () => {
    expect(
      shouldTreatRuntimeCollisionAsReachedTarget({
        activeWaypointLeg: {
          waypointWorld: new THREE.Vector3(1, 0, 0),
          excludedObstacleId: null,
        },
        blockingObstacleId: "target-object",
        isOrbitTarget: false,
        targetObjectId: "target-object",
      })
    ).toBe(false);
    expect(
      shouldTreatRuntimeCollisionAsReachedTarget({
        activeWaypointLeg: null,
        blockingObstacleId: "other-object",
        isOrbitTarget: false,
        targetObjectId: "target-object",
      })
    ).toBe(false);
    expect(
      shouldTreatRuntimeCollisionAsReachedTarget({
        activeWaypointLeg: null,
        blockingObstacleId: "target-object",
        isOrbitTarget: true,
        targetObjectId: "target-object",
      })
    ).toBe(false);
  });

  it("uses the purple route only when a retreat or routed waypoint is actually needed", () => {
    expect(
      shouldUseLockedPurpleRoute({
        retreatWaypoint: null,
        routeWaypointCount: 0,
      })
    ).toBe(false);
    expect(
      shouldUseLockedPurpleRoute({
        retreatWaypoint: {
          waypointWorld: new THREE.Vector3(1, 0, 0),
          excludedObstacleId: "blocker",
          retreatDistanceM: 0.2,
        },
        routeWaypointCount: 0,
      })
    ).toBe(true);
    expect(
      shouldUseLockedPurpleRoute({
        retreatWaypoint: null,
        routeWaypointCount: 1,
      })
    ).toBe(true);
  });

  it("falls back to a target-centered rover route when contact corridor locking is unavailable", () => {
    expect(
      shouldFallbackToTargetCenteredRoverRoute({
        isOrbitTarget: false,
        hasLockedContactGoal: false,
      })
    ).toBe(true);
    expect(
      shouldFallbackToTargetCenteredRoverRoute({
        isOrbitTarget: false,
        hasLockedContactGoal: true,
      })
    ).toBe(false);
    expect(
      shouldFallbackToTargetCenteredRoverRoute({
        isOrbitTarget: true,
        hasLockedContactGoal: false,
      })
    ).toBe(false);
  });

  it("uses object-contact route clearance only when the final contact goal is actually locked", () => {
    expect(
      shouldUseObjectContactRouteClearance({
        isOrbitTarget: false,
        hasLockedContactGoal: false,
      })
    ).toBe(false);
    expect(
      shouldUseObjectContactRouteClearance({
        isOrbitTarget: false,
        hasLockedContactGoal: true,
      })
    ).toBe(true);
    expect(
      shouldUseObjectContactRouteClearance({
        isOrbitTarget: true,
        hasLockedContactGoal: false,
      })
    ).toBe(false);
  });

  it("rebuilds a rerouted purple path from the current rover pose", () => {
    const finalFacingTarget = {
      navigationGoalWorld: new THREE.Vector3(3, 0, 0),
      applyObjectSupportRadius: false,
      facingTargetWorld: new THREE.Vector3(3, 0, 0),
      facingDirectionWorld: null,
    };

    const routeState = resolveRoverApproachNavigationRouteState({
      basePositionWorld: new THREE.Vector3(1, 0, 0),
      segmentStartWorld: new THREE.Vector3(1, 0, 0),
      retreatWaypoint: null,
      navigationRoute: {
        mode: "path",
        waypointWorlds: [new THREE.Vector3(1, 1, 0), new THREE.Vector3(2, 1, 0)],
        pathClearanceM: 0.1,
        minimumClearanceM: 0.2,
        timeoutBonusMs: 1000,
        usedDetourFallback: false,
        plannerSummary: {
          mode: "path",
          plannerStage: "visibility",
          blockedReason: "none",
          minimumClearanceM: 0.2,
          waypointCount: 2,
        },
      },
      finalFacingTarget,
      lockedNavigationGoalWorld: null,
      targetObjectId: "target",
    });

    expect(routeState.hasLockedPurpleRoute).toBe(true);
    expect(routeState.lockedRoutePointWorlds).toEqual([
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(1, 1, 0),
      new THREE.Vector3(2, 1, 0),
      new THREE.Vector3(3, 0, 0),
    ]);
    expect(routeState.navigationWaypointLegs).toEqual([
      {
        waypointWorld: new THREE.Vector3(1, 1, 0),
        excludedObstacleId: "target",
      },
      {
        waypointWorld: new THREE.Vector3(2, 1, 0),
        excludedObstacleId: "target",
      },
    ]);
  });

  it("adds a retreat waypoint when the rover starts inside another object's contact clearance", () => {
    const retreatWaypoint = resolveRoverApproachRetreatWaypoint({
      basePositionWorld: new THREE.Vector3(0.6, 0, 0),
      targetObjectId: "target-object",
      worldObjects: [
        createWorldObject({
          id: "blocking-object",
          position: new THREE.Vector3(0, 0, 0),
          size: new THREE.Vector3(1, 1, 1),
        }),
        createWorldObject({
          id: "target-object",
          position: new THREE.Vector3(2, 0, 0),
          size: new THREE.Vector3(0.5, 0.5, 0.5),
        }),
      ],
      upAxisWorld: new THREE.Vector3(0, 0, 1),
      forwardWorld: new THREE.Vector3(1, 0, 0),
      roverBaseRadiusM: 0.2,
    });

    expect(retreatWaypoint).not.toBeNull();
    expect(retreatWaypoint?.excludedObstacleId).toBe("blocking-object");
    expect(retreatWaypoint?.waypointWorld.x ?? 0).toBeGreaterThan(0.6);
    expect(retreatWaypoint?.retreatDistanceM ?? 0).toBeGreaterThan(0);
  });

  it("does not retreat from the current target object's own contact envelope", () => {
    const retreatWaypoint = resolveRoverApproachRetreatWaypoint({
      basePositionWorld: new THREE.Vector3(0.6, 0, 0),
      targetObjectId: "target-object",
      worldObjects: [
        createWorldObject({
          id: "target-object",
          position: new THREE.Vector3(0, 0, 0),
          size: new THREE.Vector3(1, 1, 1),
        }),
      ],
      upAxisWorld: new THREE.Vector3(0, 0, 1),
      forwardWorld: new THREE.Vector3(1, 0, 0),
      roverBaseRadiusM: 0.2,
    });

    expect(retreatWaypoint).toBeNull();
  });

  it("preserves every stored purple waypoint even on a straight segment", () => {
    const waypointLegs = resolveLockedRoverApproachWaypointLegs({
      waypointLegs: [
        {
          waypointWorld: new THREE.Vector3(1, 0, 0),
          excludedObstacleId: "target",
        },
        {
          waypointWorld: new THREE.Vector3(2, 0, 0),
          excludedObstacleId: "target",
        },
      ],
    });

    expect(waypointLegs).toEqual([
      {
        waypointWorld: new THREE.Vector3(1, 0, 0),
        excludedObstacleId: "target",
      },
      {
        waypointWorld: new THREE.Vector3(2, 0, 0),
        excludedObstacleId: "target",
      },
    ]);
  });

  it("preserves waypoint legs when the locked route turns", () => {
    const waypointLegs = resolveLockedRoverApproachWaypointLegs({
      waypointLegs: [
        {
          waypointWorld: new THREE.Vector3(1, 0, 0),
          excludedObstacleId: "target",
        },
        {
          waypointWorld: new THREE.Vector3(1, 1, 0),
          excludedObstacleId: "target",
        },
      ],
    });

    expect(waypointLegs).toEqual([
      {
        waypointWorld: new THREE.Vector3(1, 0, 0),
        excludedObstacleId: "target",
      },
      {
        waypointWorld: new THREE.Vector3(1, 1, 0),
        excludedObstacleId: "target",
      },
    ]);
  });

  it("preserves straight waypoint legs when obstacle exclusions change", () => {
    const waypointLegs = resolveLockedRoverApproachWaypointLegs({
      waypointLegs: [
        {
          waypointWorld: new THREE.Vector3(1, 0, 0),
          excludedObstacleId: "retreat-obstacle",
        },
      ],
    });

    expect(waypointLegs).toEqual([
      {
        waypointWorld: new THREE.Vector3(1, 0, 0),
        excludedObstacleId: "retreat-obstacle",
      },
    ]);
  });

  it("derives waypoint legs from the same direct-target planner as blue motion", () => {
    const waypointPlan = resolveWaypointLegApproachPlan({
      wheelDriveEnabled: true,
      hasWheelDriveModel: true,
      distanceToTargetM: 1,
      forwardDotTarget: 0.5,
    });

    expect(waypointPlan).toEqual(
      planRoverApproach({
        wheelDriveEnabled: true,
        hasWheelDriveModel: true,
        distanceToTargetM: 1,
        forwardDotTarget: 0.5,
        armReachRadiusM: null,
        preferredStopDistanceM: ROVER_APPROACH_DETOUR_CONFIG.waypointPlanStopDistanceM,
      })
    );
  });

  it("keeps the default blue distance tolerance for waypoint legs", () => {
    const waypointPlan = resolveWaypointLegApproachPlan({
      wheelDriveEnabled: true,
      hasWheelDriveModel: true,
      distanceToTargetM: 1,
      forwardDotTarget: 1,
    });

    expect(waypointPlan.allowTranslationYawAssist).toBe(true);
    expect(waypointPlan.requiresTranslation).toBe(true);
    expect(waypointPlan.distanceToleranceM).toBe(ROVER_APPROACH_CONFIG.distanceToleranceM);
  });
});
