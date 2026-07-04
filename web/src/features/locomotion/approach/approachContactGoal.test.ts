import { describe, expect, it } from "vitest";
import * as THREE from "three";

import type { WorldObjectPrimitiveType } from "@/features/objects";
import {
  assessRoverApproachWorldSegmentClearance,
  buildRoverApproachWorldNavigationContext,
} from "./approachWorldNavigation";
import { resolveRoverApproachFootprintSupportRadiusM } from "./approachNavigation";
import {
  resolveApproachObjectPrimitiveType,
  resolveRoverPlanarObjectApproachDistance,
} from "./approachObjectDistance";
import {
  buildPlayDemoInitialBasePositionWorld,
  buildPlayDemoWorldObjects,
  buildPlayDemoWorldObjectsAtTime,
  buildPlayDemoWorldScenarioSnapshot,
  buildPlayDemoWorldScenarioTimeline,
} from "./__tests__/approachPlayDemoTestUtils";
import {
  resolveRoverApproachObjectContactGoal,
  resolveRoverApproachObjectContactGoalAsync,
} from "./approachContactGoal";
import { ROVER_APPROACH_CONTACT_GOAL_PARAMS } from "./approachContactGoalParams";

const WORLD_UP = new THREE.Vector3(0, 0, 1);
const DEFAULT_ROVER_BASE_RADIUS_M = 0.12;
const DEFAULT_ROBOT_FOOTPRINT = {
  halfLengthM: 0.18,
  halfWidthM: 0.16,
} as const;
const BASE_POSITION_WORLD = buildPlayDemoInitialBasePositionWorld();
const createWorldObject = ({
  id,
  type,
  position,
  size,
}: {
  id: string;
  type: WorldObjectPrimitiveType;
  position: THREE.Vector3;
  size: THREE.Vector3;
}) => ({
  id,
  type,
  position,
  size,
  rotation: new THREE.Euler(0, 0, 0, "XYZ"),
  isHidden: false,
});

const CONTACT_GOAL_ROUTE_PATH_CLEARANCE_M = 0;
const PAIRWISE_PLAY_DEMO_ROUTE_TIMEOUT_MS = 20_000;
const PLAY_DEMO_EVENT_PHASE_ROUTE_TIMEOUT_MS = 60_000;

type ScenarioWorldObject = ReturnType<typeof buildPlayDemoWorldObjects>[number];
type ContactGoalResult = NonNullable<ReturnType<typeof resolveRoverApproachObjectContactGoal>>;
type CompactApproachEntry = {
  object: ScenarioWorldObject;
  result: ContactGoalResult;
};

const resolveExpectedContactCorridorTargetWorld = ({
  object,
  result,
}: {
  object: ScenarioWorldObject;
  result: ContactGoalResult;
}) => {
  if (!isCompactDemoTarget(object)) {
    return object.position.clone();
  }
  const approachDistance = resolveRoverPlanarObjectApproachDistance({
    object: {
      type: resolveApproachObjectPrimitiveType(object.type),
      size: object.size,
      rotation: object.rotation,
    },
    targetDirectionPlanarWorld: result.directionWorld,
  });
  return object.position
    .clone()
    .addScaledVector(result.directionWorld, approachDistance.supportRadiusM);
};

const isCompactDemoTarget = (object: ScenarioWorldObject) => {
  if (object.type === "point") {
    return true;
  }
  const planarExtents = [object.size.x, object.size.y].sort((left, right) => left - right);
  const planarMinExtent = planarExtents[0] ?? 0;
  const planarMaxExtent = planarExtents[1] ?? 0;
  if (planarMinExtent <= ROVER_APPROACH_CONTACT_GOAL_PARAMS.directionLengthEpsilonSq) {
    return false;
  }
  return (
    planarMaxExtent <=
      ROVER_APPROACH_CONTACT_GOAL_PARAMS.compactTargetSurfaceCorridorMaxPlanarExtentM &&
    planarMaxExtent / planarMinExtent <=
      ROVER_APPROACH_CONTACT_GOAL_PARAMS.compactTargetSurfaceCorridorMaxPlanarAspectRatio
  );
};

const assertContactGoalRouteSegmentsStayClear = ({
  result,
  navigationContext,
  basePositionWorld = BASE_POSITION_WORLD,
  excludedObstacleIds = [],
}: {
  result: ContactGoalResult;
  navigationContext: ReturnType<typeof buildRoverApproachWorldNavigationContext>;
  basePositionWorld?: THREE.Vector3;
  excludedObstacleIds?: string[];
}) => {
  let segmentStartWorld = basePositionWorld;
  [...result.route.waypointWorlds, result.goalWorld].forEach((segmentEndWorld) => {
    expect(
      assessRoverApproachWorldSegmentClearance({
        segmentStartWorld,
        segmentEndWorld,
        navigationContext,
        excludedObstacleId: null,
        excludedObstacleIds,
        robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
        pathClearanceM: CONTACT_GOAL_ROUTE_PATH_CLEARANCE_M,
      }).isClear
    ).toBe(true);
    segmentStartWorld = segmentEndWorld;
  });
};

const assertContactGoalTargetsNearestObject = ({
  result,
  worldObjects,
  targetObjectId,
}: {
  result: ContactGoalResult;
  worldObjects: ScenarioWorldObject[];
  targetObjectId: string;
}) => {
  const nearestObject = worldObjects.reduce<{
    id: string;
    distanceSq: number;
  } | null>((nearest, object) => {
    const distanceSq = object.position.distanceToSquared(result.goalWorld);
    if (nearest === null || distanceSq < nearest.distanceSq) {
      return { id: object.id, distanceSq };
    }
    return nearest;
  }, null);
  expect(nearestObject?.id).toBe(targetObjectId);
};

const resolveApproachableCompactTargets = ({
  worldObjects,
  navigationContext,
  basePositionWorld,
}: {
  worldObjects: ScenarioWorldObject[];
  navigationContext: ReturnType<typeof buildRoverApproachWorldNavigationContext>;
  basePositionWorld: THREE.Vector3;
}): CompactApproachEntry[] =>
  worldObjects
    .filter((object) => isCompactDemoTarget(object))
    .map((targetObject) => ({
      object: targetObject,
      result: resolveRoverApproachObjectContactGoal({
        object: targetObject,
        worldObjects,
        basePositionWorld,
        targetWorld: targetObject.position.clone(),
        upAxisWorld: WORLD_UP,
        navigationContext,
        roverBaseRadiusM: DEFAULT_ROVER_BASE_RADIUS_M,
        robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
      }),
    }))
    .filter((entry): entry is CompactApproachEntry => entry.result !== null);

const assertCompactPairRoutesRemainReachable = ({
  worldObjects,
  navigationContext,
  basePositionWorld,
  labelPrefix,
}: {
  worldObjects: ScenarioWorldObject[];
  navigationContext: ReturnType<typeof buildRoverApproachWorldNavigationContext>;
  basePositionWorld: THREE.Vector3;
  labelPrefix: string;
}) => {
  const approachableTargets = resolveApproachableCompactTargets({
    worldObjects,
    navigationContext,
    basePositionWorld,
  });

  approachableTargets.forEach(({ object: sourceObject, result: sourceResult }) => {
    approachableTargets.forEach(({ object: targetObject }) => {
      if (sourceObject.id === targetObject.id) {
        return;
      }
      const routeLabel = `${labelPrefix}: ${sourceObject.id} -> ${targetObject.id}`;
      const nextResult = resolveRoverApproachObjectContactGoal({
        object: targetObject,
        worldObjects,
        basePositionWorld: sourceResult.goalWorld.clone(),
        targetWorld: targetObject.position.clone(),
        upAxisWorld: WORLD_UP,
        navigationContext,
        roverBaseRadiusM: DEFAULT_ROVER_BASE_RADIUS_M,
        robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
      });

      expect(nextResult, routeLabel).not.toBeNull();
      if (!nextResult) {
        return;
      }
      expect(nextResult.route.mode, routeLabel).not.toBe("blocked");
      assertContactGoalRouteSegmentsStayClear({
        result: nextResult,
        navigationContext,
        basePositionWorld: sourceResult.goalWorld,
        excludedObstacleIds: [sourceObject.id, targetObject.id],
      });
    });
  });
};

describe("resolveRoverApproachObjectContactGoal", () => {
  const buildScenarioWorldObjects = () =>
    buildPlayDemoWorldObjects().map((object) =>
      createWorldObject({
        id: object.id,
        type: object.type,
        position: object.position.clone(),
        size: object.size.clone(),
      })
    );

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

  it("rejects the forward pedestal when no clear final contact corridor exists", () => {
    const worldObjects = buildScenarioWorldObjects();
    const pedestal = worldObjects.find((object) => object.id === "pedestal");
    expect(pedestal).toBeDefined();
    if (!pedestal) {
      return;
    }
    const navigationContext = buildRoverApproachWorldNavigationContext({
      objects: worldObjects,
      upAxisWorld: WORLD_UP,
    });

    const result = resolveRoverApproachObjectContactGoal({
      object: pedestal,
      worldObjects,
      basePositionWorld: BASE_POSITION_WORLD,
      targetWorld: pedestal.position.clone(),
      upAxisWorld: WORLD_UP,
      navigationContext,
      roverBaseRadiusM: DEFAULT_ROVER_BASE_RADIUS_M,
      robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
    });

    expect(result).toBeNull();
  });

  it("keeps the resolved contact goal nearest to each approachable play-demo object", () => {
    const worldObjects = buildScenarioWorldObjects();
    const navigationContext = buildRoverApproachWorldNavigationContext({
      objects: worldObjects,
      upAxisWorld: WORLD_UP,
    });
    let approachableObjectCount = 0;

    worldObjects.forEach((targetObject) => {
      const result = resolveRoverApproachObjectContactGoal({
        object: targetObject,
        worldObjects,
        basePositionWorld: BASE_POSITION_WORLD,
        targetWorld: targetObject.position.clone(),
        upAxisWorld: WORLD_UP,
        navigationContext,
        roverBaseRadiusM: DEFAULT_ROVER_BASE_RADIUS_M,
        robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
      });

      if (!result) {
        return;
      }
      approachableObjectCount += 1;
      expect(result.route.mode, targetObject.id).not.toBe("blocked");
      expect(result.targetMarginSq, targetObject.id).toBeGreaterThan(0);
      assertContactGoalRouteSegmentsStayClear({
        result,
        navigationContext,
        excludedObstacleIds: [targetObject.id],
      });
      expect(
        assessRoverApproachWorldSegmentClearance({
          segmentStartWorld: result.goalWorld,
          segmentEndWorld: resolveExpectedContactCorridorTargetWorld({
            object: targetObject,
            result,
          }),
          navigationContext,
          excludedObstacleId: targetObject.id,
          robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
          pathClearanceM: CONTACT_GOAL_ROUTE_PATH_CLEARANCE_M,
        }).isClear,
        targetObject.id
      ).toBe(true);
      assertContactGoalTargetsNearestObject({
        result,
        worldObjects,
        targetObjectId: targetObject.id,
      });
    });

    expect(approachableObjectCount).toBeGreaterThan(0);
  });



  it(
    "finds a non-blocked contact route between approachable play-demo object pairs",
    () => {
      const worldObjects = buildScenarioWorldObjects();
      const navigationContext = buildRoverApproachWorldNavigationContext({
        objects: worldObjects,
        upAxisWorld: WORLD_UP,
      });

      assertCompactPairRoutesRemainReachable({
        worldObjects,
        navigationContext,
        basePositionWorld: BASE_POSITION_WORLD,
        labelPrefix: "initial frame",
      });
    },
    PAIRWISE_PLAY_DEMO_ROUTE_TIMEOUT_MS
  );

  it(
    "keeps compact demo hop routes reachable through key scenario event phases",
    () => {
      const timeline = buildPlayDemoWorldScenarioTimeline();
      const sampleTimesMs = timeline.events.map((event) =>
        Math.round((event.startMs + event.endMs) / 2)
      );

      sampleTimesMs.forEach((sampleTimeMs) => {
        const worldObjects = buildPlayDemoWorldObjectsAtTime(sampleTimeMs);
        const navigationContext = buildRoverApproachWorldNavigationContext({
          objects: worldObjects,
          upAxisWorld: WORLD_UP,
        });

        assertCompactPairRoutesRemainReachable({
          worldObjects,
          navigationContext,
          basePositionWorld: BASE_POSITION_WORLD,
          labelPrefix: `t=${sampleTimeMs}ms`,
        });
      });
    },
    PLAY_DEMO_EVENT_PHASE_ROUTE_TIMEOUT_MS
  );

  it("uses a direct front-approach goal for an isolated target", () => {
    const targetObject = createWorldObject({
      id: "target",
      type: "cube",
      position: new THREE.Vector3(1, 0, 0),
      size: new THREE.Vector3(0.4, 0.3, 0.2),
    });
    const worldObjects = [targetObject];
    const navigationContext = buildRoverApproachWorldNavigationContext({
      objects: worldObjects,
      upAxisWorld: WORLD_UP,
    });

    const result = resolveRoverApproachObjectContactGoal({
      object: targetObject,
      worldObjects,
      basePositionWorld: BASE_POSITION_WORLD,
      targetWorld: targetObject.position.clone(),
      upAxisWorld: WORLD_UP,
      navigationContext,
      roverBaseRadiusM: DEFAULT_ROVER_BASE_RADIUS_M,
      robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
    });

    expect(result).not.toBeNull();
    expect(result?.route.mode).toBe("direct");
    expect(result?.goalWorld.x ?? Number.NaN).toBeLessThan(targetObject.position.x);
    expect(Math.abs(result?.goalWorld.y ?? Number.NaN)).toBeLessThan(1e-6);
    if (!result) {
      return;
    }
    assertContactGoalRouteSegmentsStayClear({
      result,
      navigationContext,
      excludedObstacleIds: [targetObject.id],
    });
  });

  it("uses the projected footprint support radius for diagonal contact offsets", () => {
    const diagonalDirectionWorld = new THREE.Vector3(1, 1, 0).normalize();
    const supportRadiusM = resolveRoverApproachFootprintSupportRadiusM({
      robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
      forwardWorld: new THREE.Vector3(1, 0, 0),
      upAxisWorld: WORLD_UP,
      targetDirectionWorld: diagonalDirectionWorld,
    });

    expect(supportRadiusM).toBeGreaterThan(DEFAULT_ROBOT_FOOTPRINT.halfLengthM);
    expect(supportRadiusM).toBeCloseTo(
      (DEFAULT_ROBOT_FOOTPRINT.halfLengthM + DEFAULT_ROBOT_FOOTPRINT.halfWidthM) /
        Math.sqrt(2)
    );
  });

  it("avoids the cluttered side of the target while keeping a valid contact goal", () => {
    const targetObject = createWorldObject({
      id: "target",
      type: "cube",
      position: new THREE.Vector3(1.2, 0, 0),
      size: new THREE.Vector3(0.4, 0.4, 0.4),
    });
    const nearSideObstacle = createWorldObject({
      id: "near-side-obstacle",
      type: "cube",
      position: new THREE.Vector3(1.2, 0.55, 0),
      size: new THREE.Vector3(0.36, 0.36, 0.36),
    });
    const worldObjects = [targetObject, nearSideObstacle];
    const navigationContext = buildRoverApproachWorldNavigationContext({
      objects: worldObjects,
      upAxisWorld: WORLD_UP,
    });

    const result = resolveRoverApproachObjectContactGoal({
      object: targetObject,
      worldObjects,
      basePositionWorld: BASE_POSITION_WORLD,
      targetWorld: targetObject.position.clone(),
      upAxisWorld: WORLD_UP,
      navigationContext,
      roverBaseRadiusM: DEFAULT_ROVER_BASE_RADIUS_M,
      robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
    });

    expect(result).not.toBeNull();
    expect(result?.targetMarginSq ?? Number.NEGATIVE_INFINITY).toBeGreaterThan(0);
    // With reduced clearances, direct frontal approach (y≈0) may now be viable
    expect(result?.goalWorld.y ?? Number.NaN).toBeLessThanOrEqual(0);
  });

  it("keeps surface-point sync and async contact-goal resolution consistent", async () => {
    const targetObject = createWorldObject({
      id: "target",
      type: "cube",
      position: new THREE.Vector3(1, 0, 0),
      size: new THREE.Vector3(0.4, 0.4, 0.4),
    });
    const worldObjects = [targetObject];
    const navigationContext = buildRoverApproachWorldNavigationContext({
      objects: worldObjects,
      upAxisWorld: WORLD_UP,
    });
    const clickedSurfaceTargetWorld = new THREE.Vector3(0.79, 0.08, 0);

    const syncResult = resolveRoverApproachObjectContactGoal({
      object: targetObject,
      worldObjects,
      basePositionWorld: BASE_POSITION_WORLD,
      targetWorld: clickedSurfaceTargetWorld,
      upAxisWorld: WORLD_UP,
      navigationContext,
      roverBaseRadiusM: DEFAULT_ROVER_BASE_RADIUS_M,
      robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
      targetKind: "surface-point",
    });

    const asyncResult = await resolveRoverApproachObjectContactGoalAsync({
      object: targetObject,
      worldObjects,
      basePositionWorld: BASE_POSITION_WORLD,
      targetWorld: clickedSurfaceTargetWorld,
      upAxisWorld: WORLD_UP,
      navigationContext,
      roverBaseRadiusM: DEFAULT_ROVER_BASE_RADIUS_M,
      robotFootprint: DEFAULT_ROBOT_FOOTPRINT,
      targetKind: "surface-point",
    });

    expect(Boolean(syncResult)).toBe(Boolean(asyncResult));
    if (syncResult && asyncResult) {
      expect(syncResult.targetWorld.toArray()).toEqual(clickedSurfaceTargetWorld.toArray());
      expect(asyncResult.targetWorld.toArray()).toEqual(clickedSurfaceTargetWorld.toArray());
    }
  });
});
