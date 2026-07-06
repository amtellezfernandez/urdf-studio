import * as THREE from "three";
import { normalizeDirection, projectVectorOntoPlane } from "@/shared/lib/axisFrame";
import {
  clampNumber,
  clampNumberToMin,
  isFiniteNumber,
  toFiniteNumberOrFallback,
  toNonNegativeFiniteNumberOrFallback,
} from "@/shared/lib/numeric";
import { ROVER_APPROACH_DETOUR_CONFIG } from "./approachDetourParams";
import type { ApproachObjectPrimitiveType } from "./approachObjectDistance";

const DEFAULT_UP_AXIS = new THREE.Vector3(0, 0, 1);

export type RoverApproachPlanarObstacle = {
  id: string;
  primitiveType?: ApproachObjectPrimitiveType;
  centerWorld: THREE.Vector3;
  radiusM: number;
  rotationWorld?: THREE.Euler | null;
  sizeWorld?: THREE.Vector3 | null;
};

export type RoverApproachDetourResult =
  | {
      mode: "direct";
      waypointWorld: null;
      blockingObstacleId: string | null;
      minClearanceM: number;
    }
  | {
      mode: "detour";
      waypointWorld: THREE.Vector3;
      blockingObstacleId: string | null;
      minClearanceM: number;
    };

export type AssessPlanarSegmentParams = {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
  obstacles: RoverApproachPlanarObstacle[];
  pathClearanceM: number;
};

export type SegmentAssessment = {
  isClear: boolean;
  minClearanceM: number;
  firstBlockingObstacleId: string | null;
};

const resolveNonNegativeDistanceM = (value: number): number =>
  toNonNegativeFiniteNumberOrFallback(value, 0);

const clampUnitInterval = (value: number): number => clampNumber(value, 0, 1);

const projectWorldPointToPlane = (
  pointWorld: THREE.Vector3,
  planeOriginWorld: THREE.Vector3,
  upAxisWorld: THREE.Vector3
): THREE.Vector3 => {
  const offset = pointWorld.clone().sub(planeOriginWorld);
  const planarOffset = projectVectorOntoPlane(offset, upAxisWorld);
  return planeOriginWorld.clone().add(planarOffset);
};

const ensureFiniteRadiusM = (value: number): number =>
  clampNumberToMin(
    toFiniteNumberOrFallback(value, ROVER_APPROACH_DETOUR_CONFIG.obstacleRadiusLowerBoundM),
    ROVER_APPROACH_DETOUR_CONFIG.obstacleRadiusLowerBoundM
  );

export const assessRoverApproachPlanarSegmentClearance = ({
  segmentStartWorld,
  segmentEndWorld,
  upAxisWorld,
  obstacles,
  pathClearanceM,
}: AssessPlanarSegmentParams): SegmentAssessment => {
  const clampedPathClearanceM = resolveNonNegativeDistanceM(pathClearanceM);
  const startPlanar = projectWorldPointToPlane(
    segmentStartWorld,
    segmentStartWorld,
    upAxisWorld
  );
  const endPlanar = projectWorldPointToPlane(
    segmentEndWorld,
    segmentStartWorld,
    upAxisWorld
  );
  const segmentVector = endPlanar.clone().sub(startPlanar);
  const segmentLengthSq = segmentVector.lengthSq();

  let minClearanceM = Number.POSITIVE_INFINITY;
  let firstBlockingT = Number.POSITIVE_INFINITY;
  let firstBlockingObstacleId: string | null = null;

  obstacles.forEach((obstacle) => {
    const centerPlanar = projectWorldPointToPlane(
      obstacle.centerWorld,
      segmentStartWorld,
      upAxisWorld
    );
    const obstacleRadiusM = ensureFiniteRadiusM(obstacle.radiusM) + clampedPathClearanceM;
    let closestPoint = startPlanar;
    let t = 0;
    if (segmentLengthSq > ROVER_APPROACH_DETOUR_CONFIG.segmentLengthEpsilonSq) {
      t = clampUnitInterval(
        centerPlanar.clone().sub(startPlanar).dot(segmentVector) / segmentLengthSq
      );
      closestPoint = startPlanar.clone().addScaledVector(segmentVector, t);
    }
    const distanceToSegmentM = centerPlanar.distanceTo(closestPoint);
    const signedClearanceM = distanceToSegmentM - obstacleRadiusM;
    minClearanceM = Math.min(minClearanceM, signedClearanceM);
    if (signedClearanceM < 0 && t < firstBlockingT) {
      firstBlockingT = t;
      firstBlockingObstacleId = obstacle.id;
    }
  });

  return {
    isClear: firstBlockingObstacleId === null,
    minClearanceM: isFiniteNumber(minClearanceM) ? minClearanceM : Number.POSITIVE_INFINITY,
    firstBlockingObstacleId,
  };
};

const resolveWaypointCandidateWorld = ({
  obstacleCenterWorld,
  segmentStartWorld,
  segmentDirectionPlanarWorld,
  upAxisWorld,
  radialOffsetM,
  sideSign,
}: {
  obstacleCenterWorld: THREE.Vector3;
  segmentStartWorld: THREE.Vector3;
  segmentDirectionPlanarWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
  radialOffsetM: number;
  sideSign: 1 | -1;
}): THREE.Vector3 | null => {
  const upAxis = normalizeDirection(upAxisWorld.clone(), DEFAULT_UP_AXIS);
  const segmentDirection = normalizeDirection(
    segmentDirectionPlanarWorld.clone(),
    new THREE.Vector3(1, 0, 0)
  );
  const sideDirection = new THREE.Vector3().crossVectors(upAxis, segmentDirection);
  if (sideDirection.lengthSq() <= ROVER_APPROACH_DETOUR_CONFIG.segmentLengthEpsilonSq) {
    return null;
  }
  sideDirection.normalize().multiplyScalar(sideSign);
  const obstacleCenterPlanar = projectWorldPointToPlane(
    obstacleCenterWorld,
    segmentStartWorld,
    upAxis
  );
  return obstacleCenterPlanar.addScaledVector(sideDirection, radialOffsetM);
};

export const resolvePlanarProjectedObstacleRadiusM = ({
  halfExtentsWorld,
  upAxisWorld,
}: {
  halfExtentsWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
}): number => {
  const hx = resolveNonNegativeDistanceM(halfExtentsWorld.x);
  const hy = resolveNonNegativeDistanceM(halfExtentsWorld.y);
  const hz = resolveNonNegativeDistanceM(halfExtentsWorld.z);
  const upAxis = normalizeDirection(upAxisWorld.clone(), DEFAULT_UP_AXIS);
  const corners = [
    new THREE.Vector3(-hx, -hy, -hz),
    new THREE.Vector3(hx, -hy, -hz),
    new THREE.Vector3(-hx, hy, -hz),
    new THREE.Vector3(hx, hy, -hz),
    new THREE.Vector3(-hx, -hy, hz),
    new THREE.Vector3(hx, -hy, hz),
    new THREE.Vector3(-hx, hy, hz),
    new THREE.Vector3(hx, hy, hz),
  ];
  let maxProjectedRadiusM = 0;
  corners.forEach((corner) => {
    const planarCorner = projectVectorOntoPlane(corner, upAxis);
    maxProjectedRadiusM = Math.max(maxProjectedRadiusM, planarCorner.length());
  });
  return ensureFiniteRadiusM(maxProjectedRadiusM);
};

export const resolveRoverApproachDetourWaypoint = ({
  segmentStartWorld,
  segmentEndWorld,
  upAxisWorld,
  obstacles,
  pathClearanceM,
}: {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
  obstacles: RoverApproachPlanarObstacle[];
  pathClearanceM: number;
}): RoverApproachDetourResult => {
  const directAssessment = assessRoverApproachPlanarSegmentClearance({
    segmentStartWorld,
    segmentEndWorld,
    upAxisWorld,
    obstacles,
    pathClearanceM,
  });
  if (directAssessment.isClear) {
    return {
      mode: "direct",
      waypointWorld: null,
      blockingObstacleId: null,
      minClearanceM: directAssessment.minClearanceM,
    };
  }

  const obstacleById = new Map(obstacles.map((obstacle) => [obstacle.id, obstacle] as const));
  const primaryObstacle =
    directAssessment.firstBlockingObstacleId !== null
      ? obstacleById.get(directAssessment.firstBlockingObstacleId) ?? null
      : null;
  if (!primaryObstacle) {
    return {
      mode: "direct",
      waypointWorld: null,
      blockingObstacleId: null,
      minClearanceM: directAssessment.minClearanceM,
    };
  }

  const segmentStartPlanar = projectWorldPointToPlane(
    segmentStartWorld,
    segmentStartWorld,
    upAxisWorld
  );
  const segmentEndPlanar = projectWorldPointToPlane(
    segmentEndWorld,
    segmentStartWorld,
    upAxisWorld
  );
  const segmentDirectionPlanar = segmentEndPlanar.clone().sub(segmentStartPlanar);
  if (segmentDirectionPlanar.lengthSq() <= ROVER_APPROACH_DETOUR_CONFIG.segmentLengthEpsilonSq) {
    return {
      mode: "direct",
      waypointWorld: null,
      blockingObstacleId: primaryObstacle.id,
      minClearanceM: directAssessment.minClearanceM,
    };
  }

  const radialOffsetM =
    ensureFiniteRadiusM(primaryObstacle.radiusM) +
    resolveNonNegativeDistanceM(pathClearanceM) +
    ROVER_APPROACH_DETOUR_CONFIG.waypointExtraOffsetM;
  const candidateWaypoints = ([1, -1] as const)
    .map((sideSign) =>
      resolveWaypointCandidateWorld({
        obstacleCenterWorld: primaryObstacle.centerWorld,
        segmentStartWorld,
        segmentDirectionPlanarWorld: segmentDirectionPlanar,
        upAxisWorld,
        radialOffsetM,
        sideSign,
      })
    )
    .filter((candidate): candidate is THREE.Vector3 => candidate !== null);

  if (candidateWaypoints.length === 0) {
    return {
      mode: "direct",
      waypointWorld: null,
      blockingObstacleId: primaryObstacle.id,
      minClearanceM: directAssessment.minClearanceM,
    };
  }

  const candidateAssessments = candidateWaypoints.map((waypointWorld) => {
    const legA = assessRoverApproachPlanarSegmentClearance({
      segmentStartWorld,
      segmentEndWorld: waypointWorld,
      upAxisWorld,
      obstacles,
      pathClearanceM,
    });
    const legB = assessRoverApproachPlanarSegmentClearance({
      segmentStartWorld: waypointWorld,
      segmentEndWorld,
      upAxisWorld,
      obstacles,
      pathClearanceM,
    });
    const minClearanceM = Math.min(legA.minClearanceM, legB.minClearanceM);
    const isClear = legA.isClear && legB.isClear;
    const pathLengthM =
      segmentStartWorld.distanceTo(waypointWorld) + waypointWorld.distanceTo(segmentEndWorld);
    return {
      waypointWorld,
      isClear,
      minClearanceM,
      pathLengthM,
    };
  });

  const clearCandidates = candidateAssessments.filter((candidate) => candidate.isClear);
  const bestClearCandidate =
    clearCandidates.length > 0
      ? clearCandidates.reduce((best, candidate) =>
          candidate.pathLengthM < best.pathLengthM ? candidate : best
        )
      : null;

  if (bestClearCandidate) {
    return {
      mode: "detour",
      waypointWorld: bestClearCandidate.waypointWorld,
      blockingObstacleId: primaryObstacle.id,
      minClearanceM: bestClearCandidate.minClearanceM,
    };
  }

  const bestFallbackCandidate = candidateAssessments.reduce((best, candidate) =>
    candidate.minClearanceM > best.minClearanceM ? candidate : best
  );
  if (
    bestFallbackCandidate.minClearanceM <=
    directAssessment.minClearanceM + ROVER_APPROACH_DETOUR_CONFIG.minDetourImprovementM
  ) {
    return {
      mode: "direct",
      waypointWorld: null,
      blockingObstacleId: primaryObstacle.id,
      minClearanceM: directAssessment.minClearanceM,
    };
  }

  return {
    mode: "direct",
    waypointWorld: null,
    blockingObstacleId: primaryObstacle.id,
    minClearanceM: bestFallbackCandidate.minClearanceM,
  };
};
