import * as THREE from "three";

import { resolveWorldObjectGeometry } from "@/features/objects";
import type { WorldObjectObstacleSource } from "./approachObstacleProjection";
import { resolveRoverPlanarObjectApproachDistance } from "./approachObjectDistance";
import { ROVER_APPROACH_CONFIG } from "./approachParams";
import { ROVER_APPROACH_CONTACT_GOAL_PARAMS } from "./approachContactGoalParams";
import {
  assessRoverApproachWorldSegmentClearance,
  serializeWorldObjectObstacleSource,
  toRoverApproachWorldVector3Tuple,
  resolveRoverApproachWorldRoute,
  type RoverApproachWorldNavigationContext,
  type RoverApproachWorldRouteResult,
} from "./approachWorldNavigation";
import {
  resolveRoverApproachFootprintSupportRadiusM,
  type RoverApproachRobotFootprint,
} from "./approachNavigation";
import { resolveRoverApproachWorldRouteAsync } from "./approachWorldNavigationAsync";

export type RoverApproachContactTargetKind = "object-center" | "surface-point";

export type RoverApproachObjectContactGoalCandidate = {
  directionIndex: number;
  directionWorld: THREE.Vector3;
  goalWorld: THREE.Vector3;
  targetWorld: THREE.Vector3;
  route: RoverApproachWorldRouteResult;
  targetDistanceSq: number;
  nearestOtherDistanceSq: number;
  targetMarginSq: number;
};

const resolvePreferredDirectionCount = (targetKind: RoverApproachContactTargetKind): number =>
  targetKind === "surface-point"
    ? ROVER_APPROACH_CONTACT_GOAL_PARAMS.surfacePointPreferredDirectionCount
    : ROVER_APPROACH_CONTACT_GOAL_PARAMS.preferredDirectionCount;

const CONTACT_GOAL_ROUTE_EXCLUDED_OBSTACLE_ID: string | null = null;
const CONTACT_GOAL_ROUTE_PATH_CLEARANCE_M =
  ROVER_APPROACH_CONTACT_GOAL_PARAMS.routePathClearanceM;

const projectVectorOntoPlane = (vector: THREE.Vector3, planeNormal: THREE.Vector3) => {
  const normalizedPlaneNormal = planeNormal.clone().normalize();
  return vector.sub(
    normalizedPlaneNormal.multiplyScalar(vector.dot(normalizedPlaneNormal))
  );
};

const normalizePlanarDirection = (
  value: THREE.Vector3,
  upAxisWorld: THREE.Vector3
): THREE.Vector3 | null => {
  const planar = projectVectorOntoPlane(value.clone(), upAxisWorld);
  if (planar.lengthSq() <= ROVER_APPROACH_CONTACT_GOAL_PARAMS.directionLengthEpsilonSq) {
    return null;
  }
  return planar.normalize();
};

const pushUniqueDirection = ({
  directions,
  candidate,
}: {
  directions: THREE.Vector3[];
  candidate: THREE.Vector3 | null;
}) => {
  if (!candidate) {
    return;
  }
  const duplicate = directions.some(
    (direction) =>
      direction.dot(candidate) >=
      ROVER_APPROACH_CONTACT_GOAL_PARAMS.directionDuplicateDotThreshold
  );
  if (!duplicate) {
    directions.push(candidate);
  }
};

const resolveCandidateDirectionsWorld = ({
  object,
  basePositionWorld,
  targetWorld,
  upAxisWorld,
  targetKind,
}: {
  object: WorldObjectObstacleSource;
  basePositionWorld: THREE.Vector3;
  targetWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
  targetKind: RoverApproachContactTargetKind;
}) => {
  const directions: THREE.Vector3[] = [];
  if (targetKind === "surface-point") {
    pushUniqueDirection({
      directions,
      candidate: normalizePlanarDirection(
        targetWorld.clone().sub(object.position),
        upAxisWorld
      ),
    });
    pushUniqueDirection({
      directions,
      candidate: normalizePlanarDirection(
        targetWorld.clone().sub(basePositionWorld),
        upAxisWorld
      ),
    });
    return directions;
  }
  pushUniqueDirection({
    directions,
    candidate: normalizePlanarDirection(
      basePositionWorld.clone().sub(targetWorld),
      upAxisWorld
    ),
  });
  const rotation = object.rotation ?? new THREE.Euler(0, 0, 0, "XYZ");
  const rotationQuaternion = new THREE.Quaternion().setFromEuler(rotation);
  const faceAxesLocal = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
  ];
  faceAxesLocal.forEach((axisLocal) => {
    pushUniqueDirection({
      directions,
      candidate: normalizePlanarDirection(
        axisLocal.clone().applyQuaternion(rotationQuaternion),
        upAxisWorld
      ),
    });
  });
  for (
    let sampleIndex = 0;
    sampleIndex < ROVER_APPROACH_CONTACT_GOAL_PARAMS.sampledDirectionCount;
    sampleIndex += 1
  ) {
    const theta =
      (sampleIndex / ROVER_APPROACH_CONTACT_GOAL_PARAMS.sampledDirectionCount) * Math.PI * 2;
    pushUniqueDirection({
      directions,
      candidate: normalizePlanarDirection(
        new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0),
        upAxisWorld
      ),
    });
  }
  return directions;
};

const resolvePlanarDistanceSq = (
  first: THREE.Vector3,
  second: THREE.Vector3,
  upAxisWorld: THREE.Vector3
) =>
  projectVectorOntoPlane(first.clone().sub(second), upAxisWorld).lengthSq();

const shouldUseCompactTargetSurfaceCorridor = ({
  object,
  objectGeometry,
}: {
  object: WorldObjectObstacleSource;
  objectGeometry: ReturnType<typeof resolveWorldObjectGeometry>;
}): boolean => {
  if (object.type === "point") {
    return true;
  }
  const planarExtents = [
    Math.max(0, objectGeometry.size.x),
    Math.max(0, objectGeometry.size.y),
  ].sort((left, right) => left - right);
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

const resolveContactCorridorTargetWorld = ({
  object,
  objectGeometry,
  targetWorld,
  directionWorld,
  targetKind,
}: {
  object: WorldObjectObstacleSource;
  objectGeometry: ReturnType<typeof resolveWorldObjectGeometry>;
  targetWorld: THREE.Vector3;
  directionWorld: THREE.Vector3;
  targetKind: RoverApproachContactTargetKind;
}): THREE.Vector3 => {
  if (targetKind === "surface-point") {
    return targetWorld.clone();
  }
  if (
    !shouldUseCompactTargetSurfaceCorridor({
      object,
      objectGeometry,
    })
  ) {
    return targetWorld.clone();
  }
  const approachDistance = resolveRoverPlanarObjectApproachDistance({
    object: {
      type: object.type,
      size: objectGeometry.size,
      rotation: object.rotation,
    },
    targetDirectionPlanarWorld: directionWorld,
  });
  return targetWorld.clone().addScaledVector(directionWorld, approachDistance.supportRadiusM);
};

const resolveContactGoalOffsetM = ({
  object,
  objectGeometry,
  targetWorld,
  directionWorld,
  targetKind,
  roverBaseRadiusM,
  robotFootprint,
  upAxisWorld,
}: {
  object: WorldObjectObstacleSource;
  objectGeometry: ReturnType<typeof resolveWorldObjectGeometry>;
  targetWorld: THREE.Vector3;
  directionWorld: THREE.Vector3;
  targetKind: RoverApproachContactTargetKind;
  roverBaseRadiusM: number;
  robotFootprint?: RoverApproachRobotFootprint;
  upAxisWorld: THREE.Vector3;
}) => {
  const robotSupportRadiusM = Math.max(
    roverBaseRadiusM,
    resolveRoverApproachFootprintSupportRadiusM({
      robotFootprint,
      forwardWorld: directionWorld,
      upAxisWorld,
      targetDirectionWorld: directionWorld,
    })
  );
  if (targetKind === "surface-point") {
    return robotSupportRadiusM + ROVER_APPROACH_CONFIG.objectContactSurfaceStandoffM;
  }
  const approachDistance = resolveRoverPlanarObjectApproachDistance({
    object: {
      type: object.type,
      size: objectGeometry.size,
      rotation: object.rotation,
    },
    targetDirectionPlanarWorld: directionWorld,
  });
  return (
    approachDistance.supportRadiusM +
    robotSupportRadiusM +
    ROVER_APPROACH_CONFIG.objectContactSurfaceStandoffM
  );
};

const isRouteClearWithTargetObstaclePresent = ({
  basePositionWorld,
  goalWorld,
  route,
  navigationContext,
  excludedObstacleIds,
  robotFootprint,
}: {
  basePositionWorld: THREE.Vector3;
  goalWorld: THREE.Vector3;
  route: RoverApproachWorldRouteResult;
  navigationContext: RoverApproachWorldNavigationContext;
  excludedObstacleIds?: readonly string[];
  robotFootprint?: RoverApproachRobotFootprint;
}) => {
  let segmentStartWorld = basePositionWorld;
  const segmentEndpoints = [...route.waypointWorlds, goalWorld];
  return segmentEndpoints.every((segmentEndWorld) => {
    const assessment = assessRoverApproachWorldSegmentClearance({
      segmentStartWorld,
      segmentEndWorld,
      navigationContext,
      excludedObstacleId: CONTACT_GOAL_ROUTE_EXCLUDED_OBSTACLE_ID,
      excludedObstacleIds,
      robotFootprint,
      pathClearanceM: CONTACT_GOAL_ROUTE_PATH_CLEARANCE_M,
    });
    segmentStartWorld = segmentEndWorld;
    return assessment.isClear;
  });
};

const resolveContactOriginObstacleId = ({
  object,
  worldObjects,
  basePositionWorld,
  roverBaseRadiusM,
  robotFootprint,
  upAxisWorld,
}: {
  object: WorldObjectObstacleSource;
  worldObjects: WorldObjectObstacleSource[];
  basePositionWorld: THREE.Vector3;
  roverBaseRadiusM: number;
  robotFootprint?: RoverApproachRobotFootprint;
  upAxisWorld: THREE.Vector3;
}): string | null => {
  let bestMatch: { id: string; deltaM: number } | null = null;
  worldObjects.forEach((candidateObject) => {
    if (candidateObject.id === object.id || candidateObject.isHidden === true) {
      return;
    }
    const candidateGeometry = resolveWorldObjectGeometry(candidateObject);
    const candidateDirectionWorld = normalizePlanarDirection(
      basePositionWorld.clone().sub(candidateObject.position),
      upAxisWorld
    );
    if (!candidateDirectionWorld) {
      return;
    }
    const expectedContactDistanceM = resolveContactGoalOffsetM({
      object: candidateObject,
      objectGeometry: candidateGeometry,
      targetWorld: candidateObject.position,
      directionWorld: candidateDirectionWorld,
      targetKind: "object-center",
      roverBaseRadiusM,
      robotFootprint,
      upAxisWorld,
    });
    const actualContactDistanceM = Math.sqrt(
      resolvePlanarDistanceSq(basePositionWorld, candidateObject.position, upAxisWorld)
    );
    const deltaM = Math.abs(actualContactDistanceM - expectedContactDistanceM);
    if (deltaM > ROVER_APPROACH_CONTACT_GOAL_PARAMS.contactSourceDetectionToleranceM) {
      return;
    }
    if (bestMatch === null || deltaM < bestMatch.deltaM) {
      bestMatch = {
        id: candidateObject.id,
        deltaM,
      };
    }
  });
  return bestMatch?.id ?? null;
};

const resolveContactGoalExcludedObstacleIds = ({
  object,
  worldObjects,
  basePositionWorld,
  roverBaseRadiusM,
  robotFootprint,
  upAxisWorld,
}: {
  object: WorldObjectObstacleSource;
  worldObjects: WorldObjectObstacleSource[];
  basePositionWorld: THREE.Vector3;
  roverBaseRadiusM: number;
  robotFootprint?: RoverApproachRobotFootprint;
  upAxisWorld: THREE.Vector3;
}): string[] => {
  const contactOriginObstacleId = resolveContactOriginObstacleId({
    object,
    worldObjects,
    basePositionWorld,
    roverBaseRadiusM,
    robotFootprint,
    upAxisWorld,
  });
  return [object.id, contactOriginObstacleId].filter((id): id is string => Boolean(id));
};

const isCandidateBetter = ({
  candidate,
  best,
  basePositionWorld,
}: {
  candidate: RoverApproachObjectContactGoalCandidate;
  best: RoverApproachObjectContactGoalCandidate | null;
  basePositionWorld: THREE.Vector3;
}) => {
  if (best === null) {
    return true;
  }
  if (candidate.route.mode !== best.route.mode) {
    return candidate.route.mode === "direct";
  }
  if (
    Math.abs(
      candidate.route.waypointWorlds.length - best.route.waypointWorlds.length
    ) > ROVER_APPROACH_CONTACT_GOAL_PARAMS.routeWaypointCountTieBias
  ) {
    return candidate.route.waypointWorlds.length < best.route.waypointWorlds.length;
  }
  if (candidate.directionIndex !== best.directionIndex) {
    return candidate.directionIndex < best.directionIndex;
  }
  if (
    candidate.goalWorld.distanceToSquared(basePositionWorld) >
    best.goalWorld.distanceToSquared(basePositionWorld)
  ) {
    return false;
  }
  if (
    candidate.goalWorld.distanceToSquared(basePositionWorld) <
    best.goalWorld.distanceToSquared(basePositionWorld)
  ) {
    return true;
  }
  if (
    Math.abs(candidate.targetMarginSq - best.targetMarginSq) >
    ROVER_APPROACH_CONTACT_GOAL_PARAMS.targetMarginTieEpsilonSq
  ) {
    return candidate.targetMarginSq > best.targetMarginSq;
  }
  return false;
};

export const resolveRoverApproachObjectContactGoal = ({
  object,
  worldObjects,
  basePositionWorld,
  targetWorld,
  upAxisWorld,
  navigationContext,
  roverBaseRadiusM,
  robotFootprint,
  targetKind = "object-center",
}: {
  object: WorldObjectObstacleSource;
  worldObjects: WorldObjectObstacleSource[];
  basePositionWorld: THREE.Vector3;
  targetWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
  navigationContext: RoverApproachWorldNavigationContext;
  roverBaseRadiusM: number;
  robotFootprint?: RoverApproachRobotFootprint;
  targetKind?: RoverApproachContactTargetKind;
}): RoverApproachObjectContactGoalCandidate | null => {
  const objectGeometry = resolveWorldObjectGeometry(object);
  const candidateDirections = resolveCandidateDirectionsWorld({
    object,
    basePositionWorld,
    targetWorld,
    upAxisWorld,
    targetKind,
  });
  const preferredDirectionCount = resolvePreferredDirectionCount(targetKind);
  let bestCandidate: RoverApproachObjectContactGoalCandidate | null = null;
  let bestPreferredCandidate: RoverApproachObjectContactGoalCandidate | null = null;
  const excludedObstacleIds = resolveContactGoalExcludedObstacleIds({
    object,
    worldObjects,
    basePositionWorld,
    roverBaseRadiusM,
    robotFootprint,
    upAxisWorld,
  });

  candidateDirections.forEach((directionWorld, directionIndex) => {
    const goalWorld = targetWorld
      .clone()
      .addScaledVector(
        directionWorld,
        resolveContactGoalOffsetM({
          object,
          objectGeometry,
          targetWorld,
          directionWorld,
          targetKind,
          roverBaseRadiusM,
          robotFootprint,
          upAxisWorld,
        })
      );
    const route = resolveRoverApproachWorldRoute({
      segmentStartWorld: basePositionWorld,
      segmentEndWorld: goalWorld,
      upAxisWorld,
      navigationContext,
      excludedObstacleId: object.id,
      excludedObstacleIds,
      roverBaseRadiusM,
      robotFootprint,
      isObjectContactTarget: true,
    });
    if (route.mode === "blocked") {
      return;
    }
    if (
      !isRouteClearWithTargetObstaclePresent({
        basePositionWorld,
        goalWorld,
        route,
        navigationContext,
        excludedObstacleIds,
        robotFootprint,
      })
    ) {
      return;
    }
    const contactCorridorTargetWorld = resolveContactCorridorTargetWorld({
      object,
      objectGeometry,
      targetWorld,
      directionWorld,
      targetKind,
    });
    const finalCorridorAssessment = assessRoverApproachWorldSegmentClearance({
      segmentStartWorld: goalWorld,
      segmentEndWorld: contactCorridorTargetWorld,
      navigationContext,
      excludedObstacleId: object.id,
      excludedObstacleIds,
      robotFootprint,
      pathClearanceM: CONTACT_GOAL_ROUTE_PATH_CLEARANCE_M,
    });
    if (!finalCorridorAssessment.isClear) {
      return;
    }
    const targetDistanceSq = resolvePlanarDistanceSq(goalWorld, targetWorld, upAxisWorld);
    let nearestOtherDistanceSq = Number.POSITIVE_INFINITY;
    worldObjects.forEach((otherObject) => {
      if (otherObject.id === object.id || otherObject.isHidden === true) {
        return;
      }
      nearestOtherDistanceSq = Math.min(
        nearestOtherDistanceSq,
        resolvePlanarDistanceSq(goalWorld, otherObject.position, upAxisWorld)
      );
    });
    const candidate: RoverApproachObjectContactGoalCandidate = {
      directionIndex,
      directionWorld: directionWorld.clone(),
      goalWorld,
      targetWorld: targetWorld.clone(),
      route,
      targetDistanceSq,
      nearestOtherDistanceSq,
      targetMarginSq: nearestOtherDistanceSq - targetDistanceSq,
    };
    if (
      isCandidateBetter({
        candidate,
        best: bestCandidate,
        basePositionWorld,
      })
    ) {
      bestCandidate = candidate;
    }
    if (
      directionIndex < preferredDirectionCount &&
      isCandidateBetter({
        candidate,
        best: bestPreferredCandidate,
        basePositionWorld,
      })
    ) {
      bestPreferredCandidate = candidate;
    }
  });

  return bestPreferredCandidate ?? bestCandidate;
};

export const resolveRoverApproachObjectContactGoalAsync = async ({
  object,
  worldObjects,
  basePositionWorld,
  targetWorld,
  upAxisWorld,
  navigationContext,
  roverBaseRadiusM,
  robotFootprint,
  targetKind = "object-center",
  signal,
}: {
  object: WorldObjectObstacleSource;
  worldObjects: WorldObjectObstacleSource[];
  basePositionWorld: THREE.Vector3;
  targetWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
  navigationContext: RoverApproachWorldNavigationContext;
  roverBaseRadiusM: number;
  robotFootprint?: RoverApproachRobotFootprint;
  targetKind?: RoverApproachContactTargetKind;
  signal?: AbortSignal;
}): Promise<RoverApproachObjectContactGoalCandidate | null> => {
  const objectGeometry = resolveWorldObjectGeometry(object);
  const candidateDirections = resolveCandidateDirectionsWorld({
    object,
    basePositionWorld,
    targetWorld,
    upAxisWorld,
    targetKind,
  });
  const serializedWorldObjects = worldObjects.map(serializeWorldObjectObstacleSource);
  const preferredDirectionCount = resolvePreferredDirectionCount(targetKind);
  let bestCandidate: RoverApproachObjectContactGoalCandidate | null = null;
  let bestPreferredCandidate: RoverApproachObjectContactGoalCandidate | null = null;
  const excludedObstacleIds = resolveContactGoalExcludedObstacleIds({
    object,
    worldObjects,
    basePositionWorld,
    roverBaseRadiusM,
    robotFootprint,
    upAxisWorld,
  });

  for (const [directionIndex, directionWorld] of candidateDirections.entries()) {
    if (signal?.aborted) {
      return null;
    }
    const goalWorld = targetWorld
      .clone()
      .addScaledVector(
        directionWorld,
        resolveContactGoalOffsetM({
          object,
          objectGeometry,
          targetWorld,
          directionWorld,
          targetKind,
          roverBaseRadiusM,
          robotFootprint,
          upAxisWorld,
        })
      );
    const route = await resolveRoverApproachWorldRouteAsync(
      {
        objects: serializedWorldObjects,
        upAxisWorld: toRoverApproachWorldVector3Tuple(upAxisWorld),
        segmentStartWorld: toRoverApproachWorldVector3Tuple(basePositionWorld),
        segmentEndWorld: toRoverApproachWorldVector3Tuple(goalWorld),
        excludedObstacleId: object.id,
        excludedObstacleIds,
        roverBaseRadiusM,
        robotFootprint,
        isObjectContactTarget: true,
      },
      signal
    );
    if (route === null) {
      return null;
    }
    if (route.mode === "blocked") {
      continue;
    }
    if (
      !isRouteClearWithTargetObstaclePresent({
        basePositionWorld,
        goalWorld,
        route,
        navigationContext,
        excludedObstacleIds,
        robotFootprint,
      })
    ) {
      continue;
    }
    const contactCorridorTargetWorld = resolveContactCorridorTargetWorld({
      object,
      objectGeometry,
      targetWorld,
      directionWorld,
      targetKind,
    });
    const finalCorridorAssessment = assessRoverApproachWorldSegmentClearance({
      segmentStartWorld: goalWorld,
      segmentEndWorld: contactCorridorTargetWorld,
      navigationContext,
      excludedObstacleId: object.id,
      excludedObstacleIds,
      robotFootprint,
      pathClearanceM: CONTACT_GOAL_ROUTE_PATH_CLEARANCE_M,
    });
    if (!finalCorridorAssessment.isClear) {
      continue;
    }
    const targetDistanceSq = resolvePlanarDistanceSq(goalWorld, targetWorld, upAxisWorld);
    let nearestOtherDistanceSq = Number.POSITIVE_INFINITY;
    worldObjects.forEach((otherObject) => {
      if (otherObject.id === object.id || otherObject.isHidden === true) {
        return;
      }
      nearestOtherDistanceSq = Math.min(
        nearestOtherDistanceSq,
        resolvePlanarDistanceSq(goalWorld, otherObject.position, upAxisWorld)
      );
    });
    const candidate: RoverApproachObjectContactGoalCandidate = {
      directionIndex,
      directionWorld: directionWorld.clone(),
      goalWorld,
      targetWorld: targetWorld.clone(),
      route,
      targetDistanceSq,
      nearestOtherDistanceSq,
      targetMarginSq: nearestOtherDistanceSq - targetDistanceSq,
    };
    if (
      isCandidateBetter({
        candidate,
        best: bestCandidate,
        basePositionWorld,
      })
    ) {
      bestCandidate = candidate;
    }
    if (
      directionIndex < preferredDirectionCount &&
      isCandidateBetter({
        candidate,
        best: bestPreferredCandidate,
        basePositionWorld,
      })
    ) {
      bestPreferredCandidate = candidate;
    }
  }

  return bestPreferredCandidate ?? bestCandidate;
};
