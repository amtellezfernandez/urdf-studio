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

type WorldObjectGeometry = ReturnType<typeof resolveWorldObjectGeometry>;

type ContactGoalRequest = {
  object: WorldObjectObstacleSource;
  worldObjects: WorldObjectObstacleSource[];
  basePositionWorld: THREE.Vector3;
  targetWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
  navigationContext: RoverApproachWorldNavigationContext;
  roverBaseRadiusM: number;
  robotFootprint?: RoverApproachRobotFootprint;
  targetKind?: RoverApproachContactTargetKind;
};

type ResolvedContactGoalRequest = Required<
  Pick<ContactGoalRequest, "targetKind">
> &
  Omit<ContactGoalRequest, "targetKind"> & {
    objectGeometry: WorldObjectGeometry;
    preferredDirectionCount: number;
    excludedObstacleIds: string[];
  };

type ContactGoalCandidateSelection = {
  bestCandidate: RoverApproachObjectContactGoalCandidate | null;
  bestPreferredCandidate: RoverApproachObjectContactGoalCandidate | null;
};

type ContactOriginResolutionParams = {
  object: WorldObjectObstacleSource;
  worldObjects: WorldObjectObstacleSource[];
  basePositionWorld: THREE.Vector3;
  roverBaseRadiusM: number;
  robotFootprint?: RoverApproachRobotFootprint;
  upAxisWorld: THREE.Vector3;
};

type ContactRouteCandidateParams = {
  request: ResolvedContactGoalRequest;
  directionWorld: THREE.Vector3;
  directionIndex: number;
  goalWorld: THREE.Vector3;
  route: RoverApproachWorldRouteResult;
};

type ContactGoalOffsetParams = {
  object: WorldObjectObstacleSource;
  objectGeometry: WorldObjectGeometry;
  targetWorld: THREE.Vector3;
  directionWorld: THREE.Vector3;
  targetKind: RoverApproachContactTargetKind;
  roverBaseRadiusM: number;
  robotFootprint?: RoverApproachRobotFootprint;
  upAxisWorld: THREE.Vector3;
};

const resolvePreferredDirectionCount = (
  targetKind: RoverApproachContactTargetKind,
): number =>
  targetKind === "surface-point"
    ? ROVER_APPROACH_CONTACT_GOAL_PARAMS.surfacePointPreferredDirectionCount
    : ROVER_APPROACH_CONTACT_GOAL_PARAMS.preferredDirectionCount;

const CONTACT_GOAL_ROUTE_EXCLUDED_OBSTACLE_ID: string | null = null;
const CONTACT_GOAL_ROUTE_PATH_CLEARANCE_M =
  ROVER_APPROACH_CONTACT_GOAL_PARAMS.routePathClearanceM;

const projectVectorOntoPlane = (
  vector: THREE.Vector3,
  planeNormal: THREE.Vector3,
) => {
  const normalizedPlaneNormal = planeNormal.clone().normalize();
  return vector.sub(
    normalizedPlaneNormal.multiplyScalar(vector.dot(normalizedPlaneNormal)),
  );
};

const normalizePlanarDirection = (
  value: THREE.Vector3,
  upAxisWorld: THREE.Vector3,
): THREE.Vector3 | null => {
  const planar = projectVectorOntoPlane(value.clone(), upAxisWorld);
  if (
    planar.lengthSq() <=
    ROVER_APPROACH_CONTACT_GOAL_PARAMS.directionLengthEpsilonSq
  ) {
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
      ROVER_APPROACH_CONTACT_GOAL_PARAMS.directionDuplicateDotThreshold,
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
        upAxisWorld,
      ),
    });
    pushUniqueDirection({
      directions,
      candidate: normalizePlanarDirection(
        targetWorld.clone().sub(basePositionWorld),
        upAxisWorld,
      ),
    });
    return directions;
  }
  pushUniqueDirection({
    directions,
    candidate: normalizePlanarDirection(
      basePositionWorld.clone().sub(targetWorld),
      upAxisWorld,
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
        upAxisWorld,
      ),
    });
  });
  for (
    let sampleIndex = 0;
    sampleIndex < ROVER_APPROACH_CONTACT_GOAL_PARAMS.sampledDirectionCount;
    sampleIndex += 1
  ) {
    const theta =
      (sampleIndex / ROVER_APPROACH_CONTACT_GOAL_PARAMS.sampledDirectionCount) *
      Math.PI *
      2;
    pushUniqueDirection({
      directions,
      candidate: normalizePlanarDirection(
        new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0),
        upAxisWorld,
      ),
    });
  }
  return directions;
};

const resolvePlanarDistanceSq = (
  first: THREE.Vector3,
  second: THREE.Vector3,
  upAxisWorld: THREE.Vector3,
) => projectVectorOntoPlane(first.clone().sub(second), upAxisWorld).lengthSq();

const shouldUseCompactTargetSurfaceCorridor = ({
  object,
  objectGeometry,
}: {
  object: WorldObjectObstacleSource;
  objectGeometry: WorldObjectGeometry;
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
  if (
    planarMinExtent <=
    ROVER_APPROACH_CONTACT_GOAL_PARAMS.directionLengthEpsilonSq
  ) {
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
  objectGeometry: WorldObjectGeometry;
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
  return targetWorld
    .clone()
    .addScaledVector(directionWorld, approachDistance.supportRadiusM);
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
}: ContactGoalOffsetParams) => {
  const robotSupportRadiusM = Math.max(
    roverBaseRadiusM,
    resolveRoverApproachFootprintSupportRadiusM({
      robotFootprint,
      forwardWorld: directionWorld,
      upAxisWorld,
      targetDirectionWorld: directionWorld,
    }),
  );
  if (targetKind === "surface-point") {
    return (
      robotSupportRadiusM + ROVER_APPROACH_CONFIG.objectContactSurfaceStandoffM
    );
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

const resolveContactGoalWorld = ({
  object,
  objectGeometry,
  targetWorld,
  directionWorld,
  targetKind,
  roverBaseRadiusM,
  robotFootprint,
  upAxisWorld,
}: ContactGoalOffsetParams) =>
  targetWorld.clone().addScaledVector(
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
    }),
  );

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
}: ContactOriginResolutionParams): string | null => {
  let bestMatch: { id: string; deltaM: number } | null = null;
  worldObjects.forEach((candidateObject) => {
    if (candidateObject.id === object.id || candidateObject.isHidden === true) {
      return;
    }
    const candidateGeometry = resolveWorldObjectGeometry(candidateObject);
    const candidateDirectionWorld = normalizePlanarDirection(
      basePositionWorld.clone().sub(candidateObject.position),
      upAxisWorld,
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
      resolvePlanarDistanceSq(
        basePositionWorld,
        candidateObject.position,
        upAxisWorld,
      ),
    );
    const deltaM = Math.abs(actualContactDistanceM - expectedContactDistanceM);
    if (
      deltaM >
      ROVER_APPROACH_CONTACT_GOAL_PARAMS.contactSourceDetectionToleranceM
    ) {
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
}: ContactOriginResolutionParams): string[] => {
  const contactOriginObstacleId = resolveContactOriginObstacleId({
    object,
    worldObjects,
    basePositionWorld,
    roverBaseRadiusM,
    robotFootprint,
    upAxisWorld,
  });
  return [object.id, contactOriginObstacleId].filter((id): id is string =>
    Boolean(id),
  );
};

const resolveNearestOtherPlanarDistanceSq = ({
  goalWorld,
  object,
  worldObjects,
  upAxisWorld,
}: {
  goalWorld: THREE.Vector3;
  object: WorldObjectObstacleSource;
  worldObjects: WorldObjectObstacleSource[];
  upAxisWorld: THREE.Vector3;
}) => {
  let nearestOtherDistanceSq = Number.POSITIVE_INFINITY;
  worldObjects.forEach((otherObject) => {
    if (otherObject.id === object.id || otherObject.isHidden === true) {
      return;
    }
    nearestOtherDistanceSq = Math.min(
      nearestOtherDistanceSq,
      resolvePlanarDistanceSq(goalWorld, otherObject.position, upAxisWorld),
    );
  });
  return nearestOtherDistanceSq;
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
      candidate.route.waypointWorlds.length - best.route.waypointWorlds.length,
    ) > ROVER_APPROACH_CONTACT_GOAL_PARAMS.routeWaypointCountTieBias
  ) {
    return (
      candidate.route.waypointWorlds.length < best.route.waypointWorlds.length
    );
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

const resolveContactGoalRequest = ({
  object,
  worldObjects,
  basePositionWorld,
  targetWorld,
  upAxisWorld,
  navigationContext,
  roverBaseRadiusM,
  robotFootprint,
  targetKind = "object-center",
}: ContactGoalRequest): ResolvedContactGoalRequest => {
  const objectGeometry = resolveWorldObjectGeometry(object);
  return {
    object,
    worldObjects,
    basePositionWorld,
    targetWorld,
    upAxisWorld,
    navigationContext,
    roverBaseRadiusM,
    robotFootprint,
    targetKind,
    objectGeometry,
    preferredDirectionCount: resolvePreferredDirectionCount(targetKind),
    excludedObstacleIds: resolveContactGoalExcludedObstacleIds({
      object,
      worldObjects,
      basePositionWorld,
      roverBaseRadiusM,
      robotFootprint,
      upAxisWorld,
    }),
  };
};

const resolveContactCandidateFromRoute = ({
  request,
  directionWorld,
  directionIndex,
  goalWorld,
  route,
}: ContactRouteCandidateParams): RoverApproachObjectContactGoalCandidate | null => {
  const {
    object,
    objectGeometry,
    worldObjects,
    basePositionWorld,
    targetWorld,
    upAxisWorld,
    navigationContext,
    robotFootprint,
    targetKind,
    excludedObstacleIds,
  } = request;
  if (route.mode === "blocked") {
    return null;
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
    return null;
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
    return null;
  }
  const targetDistanceSq = resolvePlanarDistanceSq(
    goalWorld,
    targetWorld,
    upAxisWorld,
  );
  const nearestOtherDistanceSq = resolveNearestOtherPlanarDistanceSq({
    goalWorld,
    object,
    worldObjects,
    upAxisWorld,
  });
  return {
    directionIndex,
    directionWorld: directionWorld.clone(),
    goalWorld,
    targetWorld: targetWorld.clone(),
    route,
    targetDistanceSq,
    nearestOtherDistanceSq,
    targetMarginSq: nearestOtherDistanceSq - targetDistanceSq,
  };
};

const applyContactCandidateSelection = ({
  candidate,
  selection,
  preferredDirectionCount,
  basePositionWorld,
}: {
  candidate: RoverApproachObjectContactGoalCandidate;
  selection: ContactGoalCandidateSelection;
  preferredDirectionCount: number;
  basePositionWorld: THREE.Vector3;
}): ContactGoalCandidateSelection => ({
  bestCandidate: isCandidateBetter({
    candidate,
    best: selection.bestCandidate,
    basePositionWorld,
  })
    ? candidate
    : selection.bestCandidate,
  bestPreferredCandidate:
    candidate.directionIndex < preferredDirectionCount &&
    isCandidateBetter({
      candidate,
      best: selection.bestPreferredCandidate,
      basePositionWorld,
    })
      ? candidate
      : selection.bestPreferredCandidate,
});

const selectedContactGoalCandidate = ({
  bestPreferredCandidate,
  bestCandidate,
}: ContactGoalCandidateSelection) => bestPreferredCandidate ?? bestCandidate;

const applyResolvedRouteCandidateSelection = ({
  selection,
  ...candidateParams
}: ContactRouteCandidateParams & {
  selection: ContactGoalCandidateSelection;
}): ContactGoalCandidateSelection => {
  const candidate = resolveContactCandidateFromRoute(candidateParams);
  if (!candidate) return selection;
  return applyContactCandidateSelection({
    candidate,
    selection,
    preferredDirectionCount: candidateParams.request.preferredDirectionCount,
    basePositionWorld: candidateParams.request.basePositionWorld,
  });
};

export const resolveRoverApproachObjectContactGoal = (
  params: ContactGoalRequest,
): RoverApproachObjectContactGoalCandidate | null => {
  const request = resolveContactGoalRequest(params);
  const candidateDirections = resolveCandidateDirectionsWorld(request);
  let selection: ContactGoalCandidateSelection = {
    bestCandidate: null,
    bestPreferredCandidate: null,
  };

  for (const [
    directionIndex,
    directionWorld,
  ] of candidateDirections.entries()) {
    const goalWorld = resolveContactGoalWorld({
      ...request,
      directionWorld,
    });
    const route = resolveRoverApproachWorldRoute({
      segmentStartWorld: request.basePositionWorld,
      segmentEndWorld: goalWorld,
      upAxisWorld: request.upAxisWorld,
      navigationContext: request.navigationContext,
      excludedObstacleId: request.object.id,
      excludedObstacleIds: request.excludedObstacleIds,
      roverBaseRadiusM: request.roverBaseRadiusM,
      robotFootprint: request.robotFootprint,
      isObjectContactTarget: true,
    });
    selection = applyResolvedRouteCandidateSelection({
      selection,
      request,
      directionWorld,
      directionIndex,
      goalWorld,
      route,
    });
  }

  return selectedContactGoalCandidate(selection);
};

export const resolveRoverApproachObjectContactGoalAsync = async ({
  signal,
  ...params
}: ContactGoalRequest & {
  signal?: AbortSignal;
}): Promise<RoverApproachObjectContactGoalCandidate | null> => {
  const request = resolveContactGoalRequest(params);
  const candidateDirections = resolveCandidateDirectionsWorld(request);
  const serializedWorldObjects = request.worldObjects.map(
    serializeWorldObjectObstacleSource,
  );
  let selection: ContactGoalCandidateSelection = {
    bestCandidate: null,
    bestPreferredCandidate: null,
  };

  for (const [
    directionIndex,
    directionWorld,
  ] of candidateDirections.entries()) {
    if (signal?.aborted) {
      return null;
    }
    const goalWorld = resolveContactGoalWorld({
      ...request,
      directionWorld,
    });
    const route = await resolveRoverApproachWorldRouteAsync(
      {
        objects: serializedWorldObjects,
        upAxisWorld: toRoverApproachWorldVector3Tuple(request.upAxisWorld),
        segmentStartWorld: toRoverApproachWorldVector3Tuple(
          request.basePositionWorld,
        ),
        segmentEndWorld: toRoverApproachWorldVector3Tuple(goalWorld),
        excludedObstacleId: request.object.id,
        excludedObstacleIds: request.excludedObstacleIds,
        roverBaseRadiusM: request.roverBaseRadiusM,
        robotFootprint: request.robotFootprint,
        isObjectContactTarget: true,
      },
      signal,
    );
    if (route === null) {
      return null;
    }
    selection = applyResolvedRouteCandidateSelection({
      selection,
      request,
      directionWorld,
      directionIndex,
      goalWorld,
      route,
    });
  }

  return selectedContactGoalCandidate(selection);
};
