import { describe, expect, it } from "vitest";
import * as THREE from "three";

import type { WorldObjectPrimitiveType } from "@/features/objects";
import { ROVER_APPROACH_DETOUR_CONFIG } from "./approachDetourParams";
import { resolveRoverApproachObjectContactGoal } from "./approachContactGoal";
import { resolveRoverPlanarObjectApproachDistance } from "./approachObjectDistance";
import { ROVER_APPROACH_CONFIG } from "./approachParams";
import { ROVER_APPROACH_NAVIGATION_CONFIG } from "./approachNavigationParams";
import {
  buildPlayDemoInitialBasePositionWorld,
  buildPlayDemoWorldObjects,
  buildPlayDemoWorldScenarioSnapshot,
} from "./__tests__/approachPlayDemoTestUtils";
import {
  assessRoverApproachWorldSegmentClearance,
  buildRoverApproachWorldNavigationContext,
  resolveRoverApproachWorldRoute,
  serializeWorldObjectObstacleSource,
  toRoverApproachWorldVector3Tuple,
} from "./approachWorldNavigation";
import { resolveRoverApproachWorldRouteAsync } from "./approachWorldNavigationAsync";

const WORLD_UP = new THREE.Vector3(0, 0, 1);
const SEGMENT_START_WORLD = new THREE.Vector3(0, 0, 0);
const SEGMENT_END_WORLD = new THREE.Vector3(2.4, 0, 0);
const DEFAULT_ROVER_BASE_RADIUS_M = 0.12;
const DEFAULT_ROBOT_FOOTPRINT = {
  halfLengthM: 0.18,
  halfWidthM: 0.16,
} as const;
const PLAY_DEMO_CONTACT_ROUTE_TIMEOUT_MS = 12_000;
const DEMO_START_WORLD = buildPlayDemoInitialBasePositionWorld();
const DEMO_FORWARD_WORLD = new THREE.Vector3(1, 0, 0);
const DEMO_LATERAL_WORLD = new THREE.Vector3(0, 1, 0);

const createWorldObject = ({
  id,
  type = "cube",
  position,
  rotation,
  size,
  isHidden = false,
}: {
  id: string;
  type?: WorldObjectPrimitiveType;
  position: THREE.Vector3;
  rotation?: THREE.Euler;
  size: THREE.Vector3;
  isHidden?: boolean;
}) => ({
  id,
  type,
  position,
  rotation,
  size,
  isHidden,
});

const createDemoWorldObjects = () =>
  buildPlayDemoWorldObjects().map((object) =>
    createWorldObject({
      id: object.id,
      type: object.type,
      position: object.position.clone(),
      size: object.size.clone(),
    })
  );

const resolveDemoRobotProjectedSupportRadiusM = (
  targetDirectionWorld: THREE.Vector3
): number => {
  const planarDirection = targetDirectionWorld.clone().setZ(0);
  if (planarDirection.lengthSq() <= 0) {
    return 0;
  }
  planarDirection.normalize();
  return (
    Math.abs(planarDirection.dot(DEMO_FORWARD_WORLD)) * DEFAULT_ROBOT_FOOTPRINT.halfLengthM +
    Math.abs(planarDirection.dot(DEMO_LATERAL_WORLD)) * DEFAULT_ROBOT_FOOTPRINT.halfWidthM
  );
};

const resolveDemoContactGoalWorld = (targetObject: ReturnType<typeof createWorldObject>) => {
  const targetDirectionWorld = targetObject.position.clone().sub(DEMO_START_WORLD).setZ(0);
  const approachDistance = resolveRoverPlanarObjectApproachDistance({
    object: {
      type: targetObject.type,
      size: {
        x: targetObject.size.x,
        y: targetObject.size.y,
        z: targetObject.size.z,
      },
      rotation: targetObject.rotation,
    },
    targetDirectionPlanarWorld: targetDirectionWorld,
  });
  const stopOffsetM =
    approachDistance.supportRadiusM +
    resolveDemoRobotProjectedSupportRadiusM(targetDirectionWorld) +
    ROVER_APPROACH_CONFIG.objectContactSurfaceStandoffM;
  return targetObject.position
    .clone()
    .addScaledVector(targetDirectionWorld.normalize(), -stopOffsetM);
};

const assertRouteSegmentsClear = ({
  navigationContext,
  targetObjectId,
  route,
  finalGoalWorld,
}: {
  navigationContext: ReturnType<typeof buildRoverApproachWorldNavigationContext>;
  targetObjectId: string;
  route: ReturnType<typeof resolveRoverApproachWorldRoute>;
  finalGoalWorld: THREE.Vector3;
}) => {
  let previousWaypoint = DEMO_START_WORLD;
  const segmentWaypoints = [...route.waypointWorlds, finalGoalWorld];
  segmentWaypoints.forEach((waypointWorld) => {
    const assessment = assessRoverApproachWorldSegmentClearance({
      segmentStartWorld: previousWaypoint,
      segmentEndWorld: waypointWorld,
      navigationContext,
      excludedObstacleId: targetObjectId,
      robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
      pathClearanceM: 0,
    });
    expect(assessment.isClear).toBe(true);
    previousWaypoint = waypointWorld;
  });
};

describe("approachWorldNavigation", () => {
  it("returns direct routing when projected obstacles do not block the segment", () => {
    const navigationContext = buildRoverApproachWorldNavigationContext({
      objects: [
        createWorldObject({
          id: "far-obstacle",
          position: new THREE.Vector3(0.8, 1.1, 0),
          size: new THREE.Vector3(0.4, 0.4, 0.4),
        }),
      ],
      upAxisWorld: WORLD_UP,
    });

    const route = resolveRoverApproachWorldRoute({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      upAxisWorld: WORLD_UP,
      navigationContext,
      excludedObstacleId: null,
      roverBaseRadiusM: DEFAULT_ROVER_BASE_RADIUS_M,
      isObjectContactTarget: false,
    });

    expect(route.mode).toBe("direct");
    expect(route.waypointWorlds).toHaveLength(0);
    expect(route.timeoutBonusMs).toBe(0);
    expect(route.plannerSummary.plannerStage).toBe("direct");
    expect(route.plannerSummary.blockedReason).toBe("none");
    expect(route.pathClearanceM).toBe(
      DEFAULT_ROVER_BASE_RADIUS_M + ROVER_APPROACH_DETOUR_CONFIG.pathClearancePaddingM
    );
  });

  it("reuses the cached scene and returns waypoint routing for blocked paths", () => {
    const navigationContext = buildRoverApproachWorldNavigationContext({
      objects: [
        createWorldObject({
          id: "obs-a",
          position: new THREE.Vector3(0.85, 0, 0),
          size: new THREE.Vector3(0.4, 0.4, 0.4),
        }),
        createWorldObject({
          id: "obs-b",
          position: new THREE.Vector3(1.5, 0, 0),
          size: new THREE.Vector3(0.4, 0.4, 0.4),
        }),
      ],
      upAxisWorld: WORLD_UP,
    });

    const firstRoute = resolveRoverApproachWorldRoute({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      upAxisWorld: WORLD_UP,
      navigationContext,
      excludedObstacleId: null,
      roverBaseRadiusM: 0,
      isObjectContactTarget: false,
    });
    const cacheSizeAfterFirstRoute = navigationContext.scene.blockedCellKeyCache.size;
    const secondRoute = resolveRoverApproachWorldRoute({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      upAxisWorld: WORLD_UP,
      navigationContext,
      excludedObstacleId: null,
      roverBaseRadiusM: 0,
      isObjectContactTarget: false,
    });

    expect(firstRoute.mode).toBe("path");
    expect(firstRoute.waypointWorlds.length).toBeGreaterThan(0);
    expect(firstRoute.plannerSummary.blockedReason).toBe("none");
    expect(firstRoute.timeoutBonusMs).toBe(
      Math.min(
        ROVER_APPROACH_NAVIGATION_CONFIG.maxTimeoutBonusMs,
        firstRoute.waypointWorlds.length *
          ROVER_APPROACH_NAVIGATION_CONFIG.timeoutBonusPerWaypointMs
      )
    );
    expect(secondRoute.mode).toBe("path");
    expect(navigationContext.sceneSummary.observationMode).toBe("fully-observed");
    expect(navigationContext.sceneSummary.layers.map((layer) => layer.kind)).toEqual([
      "observed-free",
      "static-obstacle",
      "inflated-obstacle",
      "unknown",
    ]);
    expect(navigationContext.scene.blockedCellKeyCache.size).toBe(cacheSizeAfterFirstRoute);
    expect(navigationContext.scene.blockedCellKeyCache.size).toBe(1);
  });

  it("excludes the active target object from obstacle blocking", () => {
    const targetObjectId = "target-object";
    const navigationContext = buildRoverApproachWorldNavigationContext({
      objects: [
        createWorldObject({
          id: targetObjectId,
          position: new THREE.Vector3(1.2, 0, 0),
          size: new THREE.Vector3(0.6, 0.6, 0.6),
        }),
      ],
      upAxisWorld: WORLD_UP,
    });

    const route = resolveRoverApproachWorldRoute({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      upAxisWorld: WORLD_UP,
      navigationContext,
      excludedObstacleId: targetObjectId,
      roverBaseRadiusM: 0,
      isObjectContactTarget: true,
    });

    expect(route.mode).toBe("direct");
    expect(route.waypointWorlds).toHaveLength(0);
    expect(route.plannerSummary.plannerStage).toBe("direct");
    expect(route.pathClearanceM).toBe(
      ROVER_APPROACH_DETOUR_CONFIG.objectContactPathClearancePaddingM
    );
  });

  it("requires excluding both the contact source and destination objects for compact hop routing", () => {
    const sourceObjectId = "source-object";
    const targetObjectId = "target-object";
    const navigationContext = buildRoverApproachWorldNavigationContext({
      objects: [
        createWorldObject({
          id: sourceObjectId,
          position: new THREE.Vector3(0.42, 0, 0),
          size: new THREE.Vector3(0.24, 0.24, 0.24),
        }),
        createWorldObject({
          id: targetObjectId,
          position: new THREE.Vector3(1.58, 0, 0),
          size: new THREE.Vector3(0.24, 0.24, 0.24),
        }),
      ],
      upAxisWorld: WORLD_UP,
    });
    const segmentStartWorld = new THREE.Vector3(0.72, 0, 0);
    const segmentEndWorld = new THREE.Vector3(1.28, 0, 0);

    const targetOnlyRoute = resolveRoverApproachWorldRoute({
      segmentStartWorld,
      segmentEndWorld,
      upAxisWorld: WORLD_UP,
      navigationContext,
      excludedObstacleId: targetObjectId,
      roverBaseRadiusM: 0,
      robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
      isObjectContactTarget: true,
    });
    const sourceAndTargetRoute = resolveRoverApproachWorldRoute({
      segmentStartWorld,
      segmentEndWorld,
      upAxisWorld: WORLD_UP,
      navigationContext,
      excludedObstacleId: targetObjectId,
      excludedObstacleIds: [sourceObjectId, targetObjectId],
      roverBaseRadiusM: 0,
      robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
      isObjectContactTarget: true,
    });

    expect(targetOnlyRoute.mode).toBe("blocked");
    expect(sourceAndTargetRoute.mode).toBe("direct");
  });

  it("does not reuse cached blocked occupancy when the excluded obstacle set changes", () => {
    const targetObjectId = "target-object";
    const navigationContext = buildRoverApproachWorldNavigationContext({
      objects: [
        createWorldObject({
          id: targetObjectId,
          position: new THREE.Vector3(1.2, 0, 0),
          size: new THREE.Vector3(0.6, 0.6, 0.6),
        }),
      ],
      upAxisWorld: WORLD_UP,
    });

    const blockedRoute = resolveRoverApproachWorldRoute({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      upAxisWorld: WORLD_UP,
      navigationContext,
      excludedObstacleId: null,
      roverBaseRadiusM: 0,
      robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
      isObjectContactTarget: false,
    });
    const directRoute = resolveRoverApproachWorldRoute({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      upAxisWorld: WORLD_UP,
      navigationContext,
      excludedObstacleId: targetObjectId,
      roverBaseRadiusM: 0,
      robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
      isObjectContactTarget: true,
    });

    expect(blockedRoute.mode).not.toBe("direct");
    expect(directRoute.mode).toBe("direct");
  });

  it("rejects purple routes when no collision-free polyline exists", () => {
    const navigationContext = buildRoverApproachWorldNavigationContext({
      objects: [
        createWorldObject({
          id: "front-blocker",
          position: new THREE.Vector3(0.32, 0, 0),
          size: new THREE.Vector3(0.32, 0.32, 0.32),
        }),
        createWorldObject({
          id: "upper-blocker",
          position: new THREE.Vector3(0, 0.32, 0),
          size: new THREE.Vector3(0.32, 0.32, 0.32),
        }),
        createWorldObject({
          id: "lower-blocker",
          position: new THREE.Vector3(0, -0.32, 0),
          size: new THREE.Vector3(0.32, 0.32, 0.32),
        }),
        createWorldObject({
          id: "rear-blocker",
          position: new THREE.Vector3(-0.32, 0, 0),
          size: new THREE.Vector3(0.32, 0.32, 0.32),
        }),
      ],
      upAxisWorld: WORLD_UP,
    });

    const route = resolveRoverApproachWorldRoute({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      upAxisWorld: WORLD_UP,
      navigationContext,
      excludedObstacleId: null,
      roverBaseRadiusM: 0,
      robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
      isObjectContactTarget: false,
    });

    expect(route.mode).toBe("blocked");
    expect(route.waypointWorlds).toEqual([]);
  });

  it("assesses runtime segment clearance against the current world context", () => {
    const targetObjectId = "target-object";
    const navigationContext = buildRoverApproachWorldNavigationContext({
      objects: [
        createWorldObject({
          id: targetObjectId,
          position: new THREE.Vector3(1.2, 0, 0),
          size: new THREE.Vector3(0.6, 0.6, 0.6),
        }),
      ],
      upAxisWorld: WORLD_UP,
    });

    const blockedAssessment = assessRoverApproachWorldSegmentClearance({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: new THREE.Vector3(1.0, 0, 0),
      navigationContext,
      excludedObstacleId: null,
      robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
      pathClearanceM: 0,
    });
    const excludedAssessment = assessRoverApproachWorldSegmentClearance({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: new THREE.Vector3(1.0, 0, 0),
      navigationContext,
      excludedObstacleId: targetObjectId,
      robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
      pathClearanceM: 0,
    });

    expect(blockedAssessment.isClear).toBe(false);
    expect(excludedAssessment.isClear).toBe(true);
  });

  it("resolves routes asynchronously with synchronous fallback for small scenes", async () => {
    const route = await resolveRoverApproachWorldRouteAsync({
      objects: [
        createWorldObject({
          id: "obs-a",
          position: new THREE.Vector3(0.85, 0, 0),
          size: new THREE.Vector3(0.4, 0.4, 0.4),
        }),
        createWorldObject({
          id: "obs-b",
          position: new THREE.Vector3(1.5, 0, 0),
          size: new THREE.Vector3(0.4, 0.4, 0.4),
        }),
      ].map(serializeWorldObjectObstacleSource),
      upAxisWorld: toRoverApproachWorldVector3Tuple(WORLD_UP),
      segmentStartWorld: toRoverApproachWorldVector3Tuple(SEGMENT_START_WORLD),
      segmentEndWorld: toRoverApproachWorldVector3Tuple(SEGMENT_END_WORLD),
      excludedObstacleId: null,
      roverBaseRadiusM: 0,
      robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
      isObjectContactTarget: false,
    });

    expect(route.mode).toBe("path");
    expect(route.waypointWorlds.length).toBeGreaterThan(0);
    expect(route.diagnostics?.workerUsed).toBe(false);
    expect(route.diagnostics?.routeMode).toBe("path");
  });

  it("returns null instead of synchronous fallback when the async request is already aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();

    const route = await resolveRoverApproachWorldRouteAsync(
      {
        objects: [
          createWorldObject({
            id: "obs-a",
            position: new THREE.Vector3(0.85, 0, 0),
            size: new THREE.Vector3(0.4, 0.4, 0.4),
          }),
        ].map(serializeWorldObjectObstacleSource),
        upAxisWorld: toRoverApproachWorldVector3Tuple(WORLD_UP),
        segmentStartWorld: toRoverApproachWorldVector3Tuple(SEGMENT_START_WORLD),
        segmentEndWorld: toRoverApproachWorldVector3Tuple(SEGMENT_END_WORLD),
        excludedObstacleId: null,
        roverBaseRadiusM: 0,
        robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
        isObjectContactTarget: false,
      },
      abortController.signal
    );

    expect(route).toBeNull();
  });

  it("uses the real play-demo setup snapshot instead of a hardcoded object list", () => {
    const scenario = buildPlayDemoWorldScenarioSnapshot();
    const typeCounts = scenario.objects.reduce<Record<string, number>>((counts, object) => {
      counts[object.type] = (counts[object.type] ?? 0) + 1;
      return counts;
    }, {});

    expect(scenario.objects).toHaveLength(scenario.objectKeys.length);
    expect((typeCounts.cube ?? 0) + (typeCounts.point ?? 0)).toBe(scenario.objects.length);
    expect(typeCounts.cube ?? 0).toBeGreaterThan(0);
    expect(typeCounts.point ?? 0).toBeGreaterThan(0);
  });

  it(
    "finds a non-blocked contact route from the play-demo start pose to every approachable demo object",
    () => {
      const demoObjects = createDemoWorldObjects();
      const navigationContext = buildRoverApproachWorldNavigationContext({
        objects: demoObjects,
        upAxisWorld: WORLD_UP,
      });

      let approachableObjectCount = 0;
      demoObjects.forEach((targetObject) => {
        const contactGoal = resolveRoverApproachObjectContactGoal({
          object: targetObject,
          worldObjects: demoObjects,
          basePositionWorld: DEMO_START_WORLD,
          targetWorld: targetObject.position.clone(),
          upAxisWorld: WORLD_UP,
          navigationContext,
          roverBaseRadiusM: DEFAULT_ROVER_BASE_RADIUS_M,
          robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
        });
        if (!contactGoal) {
          return;
        }
        approachableObjectCount += 1;
        const finalGoalWorld = contactGoal.goalWorld.clone();
        const route = resolveRoverApproachWorldRoute({
          segmentStartWorld: DEMO_START_WORLD,
          segmentEndWorld: finalGoalWorld,
          upAxisWorld: WORLD_UP,
          navigationContext,
          excludedObstacleId: targetObject.id,
          roverBaseRadiusM: DEFAULT_ROVER_BASE_RADIUS_M,
          robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
          isObjectContactTarget: true,
        });

        expect(route.mode, targetObject.id).not.toBe("blocked");
        assertRouteSegmentsClear({
          navigationContext,
          targetObjectId: targetObject.id,
          route,
          finalGoalWorld,
        });
        const nearestObject = demoObjects.reduce<{
          id: string;
          distanceSq: number;
        } | null>((nearest, object) => {
          const distanceSq = object.position.distanceToSquared(finalGoalWorld);
          if (nearest === null || distanceSq < nearest.distanceSq) {
            return { id: object.id, distanceSq };
          }
          return nearest;
        }, null);
        expect(nearestObject?.id).toBe(targetObject.id);
      });
      expect(approachableObjectCount).toBeGreaterThan(0);
    },
    PLAY_DEMO_CONTACT_ROUTE_TIMEOUT_MS
  );
});
