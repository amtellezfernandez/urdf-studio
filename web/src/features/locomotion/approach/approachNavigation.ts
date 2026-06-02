import * as THREE from "three";

import { normalizeDirection, projectVectorOntoPlane } from "@/shared/lib/axisFrame";
import {
  type RoverApproachPlanarObstacle,
} from "./approachDetour";
import { ROVER_APPROACH_DETOUR_CONFIG } from "./approachDetourParams";
import type {
  RoverNavigationBlockedReason,
  RoverNavigationPlannerStage,
  RoverNavigationPlanSummary,
} from "./approachNavigationContracts";
import { ROVER_APPROACH_NAVIGATION_CONFIG } from "./approachNavigationParams";

const DEFAULT_UP_AXIS = new THREE.Vector3(0, 0, 1);
const DEFAULT_FORWARD_AXIS = new THREE.Vector3(1, 0, 0);
const DEFAULT_LATERAL_AXIS = new THREE.Vector3(0, 1, 0);
const DEFAULT_FORWARD_PLANAR = new THREE.Vector2(1, 0);

export type PlanarBasis = {
  originWorld: THREE.Vector3;
  forwardWorld: THREE.Vector3;
  lateralWorld: THREE.Vector3;
  upWorld: THREE.Vector3;
};

export type PlanarObstacle = {
  id: string;
  shape: "circle" | "box";
  center: THREE.Vector2;
  radiusM: number;
  axisU: THREE.Vector2;
  axisV: THREE.Vector2;
  halfExtentU: number;
  halfExtentV: number;
};

type GridCoord = {
  x: number;
  y: number;
};

type GridStep = {
  dx: number;
  dy: number;
};

type PlanarBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type VisibilityNode = {
  id: string;
  pointPlanar: THREE.Vector2;
};

export type RoverApproachNavigationResult =
  | {
      mode: "direct";
      waypointWorlds: THREE.Vector3[];
      plannerStage: RoverNavigationPlannerStage;
      blockedReason: RoverNavigationBlockedReason;
      minimumClearanceM: number | null;
    }
  | {
      mode: "path";
      waypointWorlds: THREE.Vector3[];
      plannerStage: RoverNavigationPlannerStage;
      blockedReason: RoverNavigationBlockedReason;
      minimumClearanceM: number | null;
    }
  | {
      mode: "blocked";
      waypointWorlds: THREE.Vector3[];
      plannerStage: RoverNavigationPlannerStage;
      blockedReason: RoverNavigationBlockedReason;
      minimumClearanceM: number | null;
    };

export type RoverApproachNavigationScene = {
  basis: PlanarBasis;
  obstacles: PlanarObstacle[];
  blockedCellKeyCache: Map<string, Set<string>>;
};

export type RoverApproachRobotFootprint = {
  halfLengthM: number;
  halfWidthM: number;
};

export const resolveRoverApproachFootprintSupportRadiusM = ({
  robotFootprint,
  forwardWorld,
  upAxisWorld,
  targetDirectionWorld,
}: {
  robotFootprint: RoverApproachRobotFootprint | undefined;
  forwardWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
  targetDirectionWorld: THREE.Vector3;
}): number => {
  if (!robotFootprint) {
    return 0;
  }
  const normalizedForwardWorld = normalizeDirection(
    projectVectorOntoPlane(forwardWorld.clone(), upAxisWorld),
    DEFAULT_FORWARD_AXIS.clone()
  );
  const lateralWorld = new THREE.Vector3().crossVectors(upAxisWorld, normalizedForwardWorld);
  const normalizedLateralWorld = normalizeDirection(
    projectVectorOntoPlane(lateralWorld, upAxisWorld),
    DEFAULT_LATERAL_AXIS.clone()
  );
  const normalizedTargetDirectionWorld = normalizeDirection(
    projectVectorOntoPlane(targetDirectionWorld.clone(), upAxisWorld),
    normalizedForwardWorld
  );
  return (
    Math.abs(normalizedTargetDirectionWorld.dot(normalizedForwardWorld)) *
      clampPositive(robotFootprint.halfLengthM) +
    Math.abs(normalizedTargetDirectionWorld.dot(normalizedLateralWorld)) *
      clampPositive(robotFootprint.halfWidthM)
  );
};

type OrientedRobotFootprint = {
  center: THREE.Vector2;
  axisForward: THREE.Vector2;
  axisLateral: THREE.Vector2;
  halfLengthM: number;
  halfWidthM: number;
};

const resolveFinitePositive = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback;

const toPlanarBasis = ({
  originWorld,
  segmentStartWorld,
  segmentEndWorld,
  upAxisWorld,
}: {
  originWorld: THREE.Vector3;
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
}): PlanarBasis => {
  const upWorld = normalizeDirection(upAxisWorld.clone(), DEFAULT_UP_AXIS);
  const segmentDirectionWorld = projectVectorOntoPlane(
    segmentEndWorld.clone().sub(segmentStartWorld),
    upWorld
  );
  const forwardWorld = normalizeDirection(segmentDirectionWorld, DEFAULT_FORWARD_AXIS);
  const lateralWorld = new THREE.Vector3().crossVectors(upWorld, forwardWorld).normalize();
  return {
    originWorld: originWorld.clone(),
    forwardWorld,
    lateralWorld,
    upWorld,
  };
};

const createSceneBasis = (upAxisWorld: THREE.Vector3): PlanarBasis => {
  const upWorld = normalizeDirection(upAxisWorld.clone(), DEFAULT_UP_AXIS);
  const forwardCandidateWorld = projectVectorOntoPlane(DEFAULT_FORWARD_AXIS.clone(), upWorld);
  const forwardWorld = normalizeDirection(forwardCandidateWorld, DEFAULT_LATERAL_AXIS);
  const lateralWorld = new THREE.Vector3().crossVectors(upWorld, forwardWorld).normalize();
  return {
    originWorld: new THREE.Vector3(),
    forwardWorld,
    lateralWorld,
    upWorld,
  };
};

const projectWorldToPlanar = (basis: PlanarBasis, pointWorld: THREE.Vector3): THREE.Vector2 => {
  const planarOffsetWorld = projectVectorOntoPlane(
    pointWorld.clone().sub(basis.originWorld),
    basis.upWorld
  );
  return new THREE.Vector2(
    planarOffsetWorld.dot(basis.forwardWorld),
    planarOffsetWorld.dot(basis.lateralWorld)
  );
};

const projectWorldDirectionToPlanar = (
  basis: PlanarBasis,
  directionWorld: THREE.Vector3
): THREE.Vector2 => {
  const planarDirectionWorld = projectVectorOntoPlane(directionWorld.clone(), basis.upWorld);
  return new THREE.Vector2(
    planarDirectionWorld.dot(basis.forwardWorld),
    planarDirectionWorld.dot(basis.lateralWorld)
  );
};

const projectPlanarToWorld = (basis: PlanarBasis, pointPlanar: THREE.Vector2): THREE.Vector3 =>
  basis.originWorld
    .clone()
    .addScaledVector(basis.forwardWorld, pointPlanar.x)
    .addScaledVector(basis.lateralWorld, pointPlanar.y);

const toKey = (coord: GridCoord): string => `${coord.x},${coord.y}`;
const toRoundedKeyPart = (value: number): string =>
  value.toFixed(ROVER_APPROACH_NAVIGATION_CONFIG.occupancyCacheKeyPrecisionDigits);

const DEFAULT_ROBOT_FOOTPRINT: RoverApproachRobotFootprint = {
  halfLengthM: 0,
  halfWidthM: 0,
};

const enumerateNeighbors = (
  coord: GridCoord
): Array<{ coord: GridCoord; cost: number; step: GridStep }> => {
  const diagonalCost = Math.sqrt(2);
  return [
    { coord: { x: coord.x + 1, y: coord.y }, cost: 1, step: { dx: 1, dy: 0 } },
    { coord: { x: coord.x - 1, y: coord.y }, cost: 1, step: { dx: -1, dy: 0 } },
    { coord: { x: coord.x, y: coord.y + 1 }, cost: 1, step: { dx: 0, dy: 1 } },
    { coord: { x: coord.x, y: coord.y - 1 }, cost: 1, step: { dx: 0, dy: -1 } },
    {
      coord: { x: coord.x + 1, y: coord.y + 1 },
      cost: diagonalCost,
      step: { dx: 1, dy: 1 },
    },
    {
      coord: { x: coord.x + 1, y: coord.y - 1 },
      cost: diagonalCost,
      step: { dx: 1, dy: -1 },
    },
    {
      coord: { x: coord.x - 1, y: coord.y + 1 },
      cost: diagonalCost,
      step: { dx: -1, dy: 1 },
    },
    {
      coord: { x: coord.x - 1, y: coord.y - 1 },
      cost: diagonalCost,
      step: { dx: -1, dy: -1 },
    },
  ];
};

const clampGridIndex = (value: number, upperExclusive: number): number =>
  Math.min(upperExclusive - 1, Math.max(0, value));

const resolvePlanarBounds = ({
  segmentStartPlanar,
  segmentEndPlanar,
  obstacles,
  pathClearanceM,
}: {
  segmentStartPlanar: THREE.Vector2;
  segmentEndPlanar: THREE.Vector2;
  obstacles: PlanarObstacle[];
  pathClearanceM: number;
}): PlanarBounds => {
  const clearanceRadiusM = Math.max(0, pathClearanceM);
  let minX = Math.min(segmentStartPlanar.x, segmentEndPlanar.x);
  let maxX = Math.max(segmentStartPlanar.x, segmentEndPlanar.x);
  let minY = Math.min(segmentStartPlanar.y, segmentEndPlanar.y);
  let maxY = Math.max(segmentStartPlanar.y, segmentEndPlanar.y);
  const segmentSpanM = segmentStartPlanar.distanceTo(segmentEndPlanar);
  const adaptivePaddingM = Math.max(
    ROVER_APPROACH_NAVIGATION_CONFIG.gridBoundsPaddingM,
    segmentSpanM * ROVER_APPROACH_NAVIGATION_CONFIG.gridBoundsGoalDistanceScale
  );

  obstacles.forEach((obstacle) => {
    const obstacleHalfExtents = resolveObstacleAxisAlignedHalfExtents(obstacle);
    minX = Math.min(minX, obstacle.center.x - obstacleHalfExtents.x - clearanceRadiusM);
    maxX = Math.max(maxX, obstacle.center.x + obstacleHalfExtents.x + clearanceRadiusM);
    minY = Math.min(minY, obstacle.center.y - obstacleHalfExtents.y - clearanceRadiusM);
    maxY = Math.max(maxY, obstacle.center.y + obstacleHalfExtents.y + clearanceRadiusM);
  });

  minX -= adaptivePaddingM;
  maxX += adaptivePaddingM;
  minY -= adaptivePaddingM;
  maxY += adaptivePaddingM;

  const widthM = maxX - minX;
  const heightM = maxY - minY;
  const minSpanHalfM = ROVER_APPROACH_NAVIGATION_CONFIG.gridBoundsMinSpanM * 0.5;
  if (widthM < ROVER_APPROACH_NAVIGATION_CONFIG.gridBoundsMinSpanM) {
    const centerX = (minX + maxX) * 0.5;
    minX = centerX - minSpanHalfM;
    maxX = centerX + minSpanHalfM;
  }
  if (heightM < ROVER_APPROACH_NAVIGATION_CONFIG.gridBoundsMinSpanM) {
    const centerY = (minY + maxY) * 0.5;
    minY = centerY - minSpanHalfM;
    maxY = centerY + minSpanHalfM;
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
  };
};

const resolveGridResolution = ({
  minX,
  maxX,
  minY,
  maxY,
}: {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}) => {
  const widthM = Math.max(ROVER_APPROACH_NAVIGATION_CONFIG.gridCellSizeM, maxX - minX);
  const heightM = Math.max(ROVER_APPROACH_NAVIGATION_CONFIG.gridCellSizeM, maxY - minY);
  const areaM2 = widthM * heightM;
  const minCellSizeFromAreaM = Math.sqrt(
    areaM2 / ROVER_APPROACH_NAVIGATION_CONFIG.maxGridCellCount
  );
  const minCellSizeFromWidthM =
    widthM / ROVER_APPROACH_NAVIGATION_CONFIG.maxGridCellsPerAxis;
  const minCellSizeFromHeightM =
    heightM / ROVER_APPROACH_NAVIGATION_CONFIG.maxGridCellsPerAxis;
  const cellSizeM = Math.max(
    ROVER_APPROACH_NAVIGATION_CONFIG.gridCellSizeM,
    minCellSizeFromAreaM,
    minCellSizeFromWidthM,
    minCellSizeFromHeightM
  );
  return {
    cellSizeM,
    cols: Math.max(2, Math.ceil(widthM / cellSizeM) + 1),
    rows: Math.max(2, Math.ceil(heightM / cellSizeM) + 1),
  };
};

const toGridCoord = ({
  pointPlanar,
  minX,
  minY,
  cellSizeM,
  cols,
  rows,
}: {
  pointPlanar: THREE.Vector2;
  minX: number;
  minY: number;
  cellSizeM: number;
  cols: number;
  rows: number;
}): GridCoord => ({
  x: clampGridIndex(Math.round((pointPlanar.x - minX) / cellSizeM), cols),
  y: clampGridIndex(Math.round((pointPlanar.y - minY) / cellSizeM), rows),
});

const toCellCenterPlanar = ({
  coord,
  minX,
  minY,
  cellSizeM,
}: {
  coord: GridCoord;
  minX: number;
  minY: number;
  cellSizeM: number;
}): THREE.Vector2 => new THREE.Vector2(minX + coord.x * cellSizeM, minY + coord.y * cellSizeM);

const clampPositive = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0;

const toPlanarVector = (basis: PlanarBasis, vectorWorld: THREE.Vector3): THREE.Vector2 => {
  const planarVectorWorld = projectVectorOntoPlane(vectorWorld.clone(), basis.upWorld);
  return new THREE.Vector2(
    planarVectorWorld.dot(basis.forwardWorld),
    planarVectorWorld.dot(basis.lateralWorld)
  );
};

const normalizePlanarAxis = (
  value: THREE.Vector2,
  fallback: THREE.Vector2
): THREE.Vector2 => (value.lengthSq() > 1e-10 ? value.clone().normalize() : fallback.clone());

const resolveObstacleAxisAlignedHalfExtents = (obstacle: PlanarObstacle): THREE.Vector2 => {
  if (obstacle.shape !== "box") {
    const radiusM = resolveFinitePositive(
      obstacle.radiusM,
      ROVER_APPROACH_DETOUR_CONFIG.obstacleRadiusLowerBoundM
    );
    return new THREE.Vector2(radiusM, radiusM);
  }
  return new THREE.Vector2(
    Math.abs(obstacle.axisU.x) * obstacle.halfExtentU +
      Math.abs(obstacle.axisV.x) * obstacle.halfExtentV,
    Math.abs(obstacle.axisU.y) * obstacle.halfExtentU +
      Math.abs(obstacle.axisV.y) * obstacle.halfExtentV
  );
};

const buildPlanarObstacle = (
  basis: PlanarBasis,
  obstacle: RoverApproachPlanarObstacle
): PlanarObstacle => {
  const center = projectWorldToPlanar(basis, obstacle.centerWorld);
  const radiusM = obstacle.radiusM;
  if (
    obstacle.primitiveType !== "cube" ||
    !obstacle.sizeWorld ||
    !obstacle.rotationWorld
  ) {
    return {
      id: obstacle.id,
      shape: "circle",
      center,
      radiusM,
      axisU: new THREE.Vector2(1, 0),
      axisV: new THREE.Vector2(0, 1),
      halfExtentU: radiusM,
      halfExtentV: radiusM,
    };
  }

  const quaternion = new THREE.Quaternion().setFromEuler(obstacle.rotationWorld);
  const localAxisX = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  const localAxisY = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
  const planarAxisX = toPlanarVector(basis, localAxisX);
  const planarAxisY = toPlanarVector(basis, localAxisY);
  const axisU = normalizePlanarAxis(planarAxisX, new THREE.Vector2(1, 0));
  const axisVCandidate =
    planarAxisY.lengthSq() > 1e-10
      ? planarAxisY
      : new THREE.Vector2(-axisU.y, axisU.x);
  const axisV = normalizePlanarAxis(axisVCandidate, new THREE.Vector2(0, 1));
  return {
    id: obstacle.id,
    shape: "box",
    center,
    radiusM,
    axisU,
    axisV,
    halfExtentU: clampPositive(obstacle.sizeWorld.x * 0.5),
    halfExtentV: clampPositive(obstacle.sizeWorld.y * 0.5),
  };
};

const computePointToOrientedBoxDistance = ({
  point,
  obstacle,
}: {
  point: THREE.Vector2;
  obstacle: PlanarObstacle;
}): number => {
  const localOffset = point.clone().sub(obstacle.center);
  const localU = localOffset.dot(obstacle.axisU);
  const localV = localOffset.dot(obstacle.axisV);
  const deltaU = Math.max(0, Math.abs(localU) - obstacle.halfExtentU);
  const deltaV = Math.max(0, Math.abs(localV) - obstacle.halfExtentV);
  return Math.hypot(deltaU, deltaV);
};

const resolvePointClearanceToObstacle = ({
  pointPlanar,
  obstacle,
}: {
  pointPlanar: THREE.Vector2;
  obstacle: PlanarObstacle;
}): number => {
  if (obstacle.shape === "box") {
    return computePointToOrientedBoxDistance({
      point: pointPlanar,
      obstacle,
    });
  }
  const obstacleRadiusM = resolveFinitePositive(
    obstacle.radiusM,
    ROVER_APPROACH_DETOUR_CONFIG.obstacleRadiusLowerBoundM
  );
  return pointPlanar.distanceTo(obstacle.center) - obstacleRadiusM;
};

const doAxisAlignedAndOrientedBoxesOverlap = ({
  robotFootprint,
  obstacle,
}: {
  robotFootprint: OrientedRobotFootprint;
  obstacle: PlanarObstacle;
}): boolean => {
  const testAxes = [
    robotFootprint.axisForward,
    robotFootprint.axisLateral,
    obstacle.axisU,
    obstacle.axisV,
  ];
  return testAxes.every((axis) => {
    const obstacleProjectionRadius =
      Math.abs(obstacle.axisU.dot(axis)) * obstacle.halfExtentU +
      Math.abs(obstacle.axisV.dot(axis)) * obstacle.halfExtentV;
    const robotProjectionRadius =
      Math.abs(robotFootprint.axisForward.dot(axis)) * robotFootprint.halfLengthM +
      Math.abs(robotFootprint.axisLateral.dot(axis)) * robotFootprint.halfWidthM;
    const centerDelta = Math.abs(
      obstacle.center.clone().sub(robotFootprint.center).dot(axis)
    );
    return centerDelta <= obstacleProjectionRadius + robotProjectionRadius;
  });
};

const resolveOrientedRobotFootprint = ({
  center,
  robotFootprint,
  forwardPlanar = DEFAULT_FORWARD_PLANAR,
}: {
  center: THREE.Vector2;
  robotFootprint: RoverApproachRobotFootprint;
  forwardPlanar?: THREE.Vector2;
}): OrientedRobotFootprint => {
  const halfLengthM = clampPositive(robotFootprint.halfLengthM);
  const halfWidthM = clampPositive(robotFootprint.halfWidthM);
  const axisForward =
    forwardPlanar.lengthSq() > ROVER_APPROACH_DETOUR_CONFIG.segmentLengthEpsilonSq
      ? forwardPlanar.clone().normalize()
      : DEFAULT_FORWARD_PLANAR.clone();
  return {
    center,
    axisForward,
    axisLateral: new THREE.Vector2(-axisForward.y, axisForward.x),
    halfLengthM,
    halfWidthM,
  };
};

const doesRobotFootprintOverlapObstacle = ({
  center,
  robotFootprint,
  obstacle,
  pathClearanceM,
  forwardPlanar = DEFAULT_FORWARD_PLANAR,
}: {
  center: THREE.Vector2;
  robotFootprint: RoverApproachRobotFootprint;
  obstacle: PlanarObstacle;
  pathClearanceM: number;
  forwardPlanar?: THREE.Vector2;
}): boolean => {
  const orientedRobotFootprint = resolveOrientedRobotFootprint({
    center,
    robotFootprint,
    forwardPlanar,
  });
  if (obstacle.shape === "box") {
    const expandedObstacle: PlanarObstacle = {
      ...obstacle,
      halfExtentU: obstacle.halfExtentU + Math.max(0, pathClearanceM),
      halfExtentV: obstacle.halfExtentV + Math.max(0, pathClearanceM),
    };
    return doAxisAlignedAndOrientedBoxesOverlap({
      robotFootprint: orientedRobotFootprint,
      obstacle: expandedObstacle,
    });
  }
  const localDelta = obstacle.center.clone().sub(center);
  const localForward = localDelta.dot(orientedRobotFootprint.axisForward);
  const localLateral = localDelta.dot(orientedRobotFootprint.axisLateral);
  const closestDistanceM = Math.max(0, Math.hypot(
    Math.max(0, Math.abs(localForward) - orientedRobotFootprint.halfLengthM),
    Math.max(0, Math.abs(localLateral) - orientedRobotFootprint.halfWidthM)
  ));
  return closestDistanceM <= obstacle.radiusM + Math.max(0, pathClearanceM);
};

const hasRobotFootprintArea = (robotFootprint: RoverApproachRobotFootprint): boolean =>
  clampPositive(robotFootprint.halfLengthM) > 0 || clampPositive(robotFootprint.halfWidthM) > 0;

const resolveRobotFootprintInflationRadiusM = (
  robotFootprint: RoverApproachRobotFootprint
): number =>
  Math.max(
    clampPositive(robotFootprint.halfLengthM),
    clampPositive(robotFootprint.halfWidthM)
  );

const resolveVisibilityGraphQueryKey = ({
  segmentStartWorld,
  segmentEndWorld,
  pathClearanceM,
  robotFootprint,
}: {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  pathClearanceM: number;
  robotFootprint: RoverApproachRobotFootprint;
}): string =>
  [
    "vg",
    toRoundedKeyPart(segmentStartWorld.x),
    toRoundedKeyPart(segmentStartWorld.y),
    toRoundedKeyPart(segmentStartWorld.z),
    toRoundedKeyPart(segmentEndWorld.x),
    toRoundedKeyPart(segmentEndWorld.y),
    toRoundedKeyPart(segmentEndWorld.z),
    toRoundedKeyPart(pathClearanceM),
    toRoundedKeyPart(robotFootprint.halfLengthM),
    toRoundedKeyPart(robotFootprint.halfWidthM),
  ].join(":");

const resolveVisibilityPenaltyForClearanceM = (minClearanceM: number): number => {
  if (!Number.isFinite(minClearanceM)) {
    return 0;
  }
  const penaltyDistanceM = ROVER_APPROACH_NAVIGATION_CONFIG.nearObstaclePenaltyDistanceM;
  if (minClearanceM >= penaltyDistanceM) {
    return 0;
  }
  return (
    ((penaltyDistanceM - Math.max(0, minClearanceM)) / penaltyDistanceM) *
    ROVER_APPROACH_NAVIGATION_CONFIG.visibilityClearancePreferenceWeight
  );
};

const resolveNarrowPassagePenaltyForClearanceM = (minClearanceM: number): number => {
  if (!Number.isFinite(minClearanceM)) {
    return 0;
  }
  const penaltyDistanceM = ROVER_APPROACH_NAVIGATION_CONFIG.narrowPassagePenaltyDistanceM;
  if (minClearanceM >= penaltyDistanceM) {
    return 0;
  }
  return (
    ((penaltyDistanceM - Math.max(0, minClearanceM)) / penaltyDistanceM) *
    ROVER_APPROACH_NAVIGATION_CONFIG.narrowPassagePenaltyWeight
  );
};

const resolveVisibilityPointMinClearanceM = ({
  pointPlanar,
  obstacles,
}: {
  pointPlanar: THREE.Vector2;
  obstacles: PlanarObstacle[];
}): number => {
  let minClearanceM = Number.POSITIVE_INFINITY;
  obstacles.forEach((obstacle) => {
    minClearanceM = Math.min(
      minClearanceM,
      resolvePointClearanceToObstacle({
        pointPlanar,
        obstacle,
      })
    );
  });
  return minClearanceM;
};

const resolveVisibilityEdgeMinClearanceM = ({
  startPlanar,
  endPlanar,
  obstacles,
}: {
  startPlanar: THREE.Vector2;
  endPlanar: THREE.Vector2;
  obstacles: PlanarObstacle[];
}): number => {
  if (obstacles.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const segment = endPlanar.clone().sub(startPlanar);
  const segmentLengthM = segment.length();
  const sampleStepM = ROVER_APPROACH_NAVIGATION_CONFIG.lineOfSightSampleStepMinM;
  const sampleCount = Math.max(2, Math.ceil(segmentLengthM / sampleStepM) + 1);
  let minClearanceM = Number.POSITIVE_INFINITY;
  for (let index = 0; index < sampleCount; index += 1) {
    const t = sampleCount <= 1 ? 0 : index / (sampleCount - 1);
    const samplePointPlanar = startPlanar.clone().lerp(endPlanar, t);
    minClearanceM = Math.min(
      minClearanceM,
      resolveVisibilityPointMinClearanceM({
        pointPlanar: samplePointPlanar,
        obstacles,
      })
    );
  }
  return minClearanceM;
};

const hasVisibilityEdgePreferredClearance = ({
  minClearanceM,
  pathClearanceM,
}: {
  minClearanceM: number;
  pathClearanceM: number;
}): boolean =>
  minClearanceM >=
  Math.max(
    0,
    pathClearanceM +
      ROVER_APPROACH_NAVIGATION_CONFIG.visibilityEdgeRejectClearancePaddingM
  );

const hasSceneSegmentPreferredClearance = ({
  segmentStartWorld,
  segmentEndWorld,
  scene,
  pathClearanceM,
}: {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  scene: RoverApproachNavigationScene;
  pathClearanceM: number;
}): boolean => {
  const startPlanar = projectWorldToPlanar(scene.basis, segmentStartWorld);
  const endPlanar = projectWorldToPlanar(scene.basis, segmentEndWorld);
  return hasVisibilityEdgePreferredClearance({
    minClearanceM: resolveVisibilityEdgeMinClearanceM({
      startPlanar,
      endPlanar,
      obstacles: scene.obstacles,
    }),
    pathClearanceM,
  });
};

const resolveVisibilityEdgeClearancePenalty = ({
  startPlanar,
  endPlanar,
  obstacles,
}: {
  startPlanar: THREE.Vector2;
  endPlanar: THREE.Vector2;
  obstacles: PlanarObstacle[];
}): number =>
  resolveVisibilityPenaltyForClearanceM(
    resolveVisibilityEdgeMinClearanceM({
      startPlanar,
      endPlanar,
      obstacles,
    })
  );

const resolveWaypointComplexityPenalty = (): number =>
  ROVER_APPROACH_NAVIGATION_CONFIG.waypointPenaltyWeight;

const resolveVisibilityEdgeTraversalCost = ({
  edgeLengthM,
  minEdgeClearanceM,
  headingPenalty,
}: {
  edgeLengthM: number;
  minEdgeClearanceM: number;
  headingPenalty: number;
}): number =>
  edgeLengthM *
    (1 +
      resolveVisibilityPenaltyForClearanceM(minEdgeClearanceM) +
      resolveNarrowPassagePenaltyForClearanceM(minEdgeClearanceM)) +
  headingPenalty +
  resolveWaypointComplexityPenalty();

const resolveSceneSegmentMinimumClearanceM = ({
  segmentStartWorld,
  segmentEndWorld,
  scene,
}: {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  scene: RoverApproachNavigationScene;
}): number => {
  const startPlanar = projectWorldToPlanar(scene.basis, segmentStartWorld);
  const endPlanar = projectWorldToPlanar(scene.basis, segmentEndWorld);
  return resolveVisibilityEdgeMinClearanceM({
    startPlanar,
    endPlanar,
    obstacles: scene.obstacles,
  });
};

const appendUniqueVisibilityNode = (
  nodes: VisibilityNode[],
  seenKeys: Set<string>,
  id: string,
  pointPlanar: THREE.Vector2
) => {
  const key = `${toRoundedKeyPart(pointPlanar.x)}:${toRoundedKeyPart(pointPlanar.y)}`;
  if (seenKeys.has(key)) {
    return;
  }
  seenKeys.add(key);
  nodes.push({
    id,
    pointPlanar: pointPlanar.clone(),
  });
};

const buildVisibilityNodes = ({
  scene,
  segmentStartWorld,
  segmentEndWorld,
  robotFootprint,
  pathClearanceM,
}: {
  scene: RoverApproachNavigationScene;
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  robotFootprint: RoverApproachRobotFootprint;
  pathClearanceM: number;
}): VisibilityNode[] => {
  const nodes: VisibilityNode[] = [];
  const seenKeys = new Set<string>();
  const startPlanar = projectWorldToPlanar(scene.basis, segmentStartWorld);
  const goalPlanar = projectWorldToPlanar(scene.basis, segmentEndWorld);
  appendUniqueVisibilityNode(nodes, seenKeys, "start", startPlanar);
  appendUniqueVisibilityNode(nodes, seenKeys, "goal", goalPlanar);

  const inflationRadiusM =
    resolveRobotFootprintInflationRadiusM(robotFootprint) +
    Math.max(0, pathClearanceM) +
    ROVER_APPROACH_NAVIGATION_CONFIG.visibilityNodePaddingM;
  const cornerBypassOffsetM = ROVER_APPROACH_NAVIGATION_CONFIG.visibilityCornerBypassOffsetM;

  scene.obstacles.forEach((obstacle, obstacleIndex) => {
    if (obstacle.shape === "box") {
      const expandedHalfExtentU = obstacle.halfExtentU + inflationRadiusM;
      const expandedHalfExtentV = obstacle.halfExtentV + inflationRadiusM;
      const cornerSigns: Array<[number, number]> = [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ];
      cornerSigns.forEach(([uSign, vSign], cornerIndex) => {
        const cornerPoint = obstacle.center
          .clone()
          .addScaledVector(obstacle.axisU, expandedHalfExtentU * uSign)
          .addScaledVector(obstacle.axisV, expandedHalfExtentV * vSign);
        const outward = obstacle.axisU
          .clone()
          .multiplyScalar(uSign)
          .addScaledVector(obstacle.axisV, vSign)
          .normalize();
        const bypassPoint = cornerPoint
          .clone()
          .addScaledVector(outward, cornerBypassOffsetM);
        appendUniqueVisibilityNode(
          nodes,
          seenKeys,
          `box-${obstacleIndex}-corner-${cornerIndex}`,
          bypassPoint
        );
      });
      return;
    }

    const radialOffsetM = obstacle.radiusM + inflationRadiusM + cornerBypassOffsetM;
    const radialDirections = [
      new THREE.Vector2(1, 0),
      new THREE.Vector2(0, 1),
      new THREE.Vector2(-1, 0),
      new THREE.Vector2(0, -1),
      new THREE.Vector2(1, 1).normalize(),
      new THREE.Vector2(1, -1).normalize(),
      new THREE.Vector2(-1, 1).normalize(),
      new THREE.Vector2(-1, -1).normalize(),
    ];
    radialDirections.forEach((direction, directionIndex) => {
      appendUniqueVisibilityNode(
        nodes,
        seenKeys,
        `circle-${obstacleIndex}-dir-${directionIndex}`,
        obstacle.center.clone().addScaledVector(direction, radialOffsetM)
      );
    });
  });

  return nodes;
};

const resolveVisibilityEdgeKey = (lhsId: string, rhsId: string): string =>
  lhsId < rhsId ? `${lhsId}|${rhsId}` : `${rhsId}|${lhsId}`;

const buildVisibilityShortestPath = ({
  nodes,
  segmentStartWorld,
  segmentEndWorld,
  scene,
  pathClearanceM,
  robotFootprint,
  blockedEdgeKeys,
}: {
  nodes: VisibilityNode[];
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  scene: RoverApproachNavigationScene;
  pathClearanceM: number;
  robotFootprint: RoverApproachRobotFootprint;
  blockedEdgeKeys: Set<string>;
}): VisibilityNode[] | null => {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const distanceById = new Map<string, number>();
  const previousById = new Map<string, string | null>();
  const visited = new Set<string>();
  const pendingIds = new Set(nodes.map((node) => node.id));
  const edgeForwardById = new Map<string, THREE.Vector3>();
  nodes.forEach((node) => {
    distanceById.set(node.id, node.id === "start" ? 0 : Number.POSITIVE_INFINITY);
    previousById.set(node.id, null);
  });

  while (pendingIds.size > 0) {
    let currentId: string | null = null;
    let currentDistance = Number.POSITIVE_INFINITY;
    pendingIds.forEach((candidateId) => {
      const candidateDistance = distanceById.get(candidateId) ?? Number.POSITIVE_INFINITY;
      if (candidateDistance < currentDistance) {
        currentDistance = candidateDistance;
        currentId = candidateId;
      }
    });
    if (currentId === null || !Number.isFinite(currentDistance)) {
      break;
    }
    pendingIds.delete(currentId);
    if (currentId === "goal") {
      break;
    }
    visited.add(currentId);
    const currentNode = nodeById.get(currentId);
    if (!currentNode) {
      continue;
    }
    const currentWorld = projectPlanarToWorld(scene.basis, currentNode.pointPlanar);

    nodes.forEach((neighborNode) => {
      if (neighborNode.id === currentId || visited.has(neighborNode.id)) {
        return;
      }
      const edgeKey = resolveVisibilityEdgeKey(currentId as string, neighborNode.id);
      if (blockedEdgeKeys.has(edgeKey)) {
        return;
      }
      const neighborWorld = projectPlanarToWorld(scene.basis, neighborNode.pointPlanar);
      const assessment = assessFootprintSegmentClearanceInScene({
        segmentStartWorld: currentWorld,
        segmentEndWorld: neighborWorld,
        scene,
        pathClearanceM,
        robotFootprint,
      });
      if (!assessment.isClear) {
        blockedEdgeKeys.add(edgeKey);
        return;
      }
      const minEdgeClearanceM = resolveVisibilityEdgeMinClearanceM({
        startPlanar: currentNode.pointPlanar,
        endPlanar: neighborNode.pointPlanar,
        obstacles: scene.obstacles,
      });
      if (
        !hasVisibilityEdgePreferredClearance({
          minClearanceM: minEdgeClearanceM,
          pathClearanceM,
        })
      ) {
        blockedEdgeKeys.add(edgeKey);
        return;
      }
      const edgeVectorWorld = neighborWorld.clone().sub(currentWorld);
      const edgeLengthM = edgeVectorWorld.length();
      if (edgeLengthM <= ROVER_APPROACH_DETOUR_CONFIG.segmentLengthEpsilonSq) {
        return;
      }
      const previousForwardWorld = edgeForwardById.get(currentId as string) ?? null;
      const headingPenalty =
        previousForwardWorld && previousForwardWorld.lengthSq() > 1e-10
          ? (1 -
              Math.max(
                -1,
                Math.min(
                  1,
                  previousForwardWorld.clone().normalize().dot(edgeVectorWorld.clone().normalize())
                )
              )) * ROVER_APPROACH_NAVIGATION_CONFIG.visibilityHeadingPenaltyWeight
          : 0;
      const candidateDistance =
        currentDistance +
        resolveVisibilityEdgeTraversalCost({
          edgeLengthM,
          minEdgeClearanceM,
          headingPenalty,
        });
      if (candidateDistance < (distanceById.get(neighborNode.id) ?? Number.POSITIVE_INFINITY)) {
        distanceById.set(neighborNode.id, candidateDistance);
        previousById.set(neighborNode.id, currentId);
        edgeForwardById.set(neighborNode.id, edgeVectorWorld.clone());
      }
    });
  }

  const goalDistance = distanceById.get("goal") ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(goalDistance)) {
    return null;
  }

  const path: VisibilityNode[] = [];
  let cursorId: string | null = "goal";
  while (cursorId) {
    const node = nodeById.get(cursorId);
    if (!node) {
      return null;
    }
    path.push(node);
    cursorId = previousById.get(cursorId) ?? null;
  }
  path.reverse();
  return path.length >= 2 ? path : null;
};

const resolveCircleObstacleSegmentClearanceM = ({
  segmentStartPlanar,
  segmentEndPlanar,
  obstacle,
}: {
  segmentStartPlanar: THREE.Vector2;
  segmentEndPlanar: THREE.Vector2;
  obstacle: PlanarObstacle;
}): number => {
  const segmentVector = segmentEndPlanar.clone().sub(segmentStartPlanar);
  const segmentLengthSq = segmentVector.lengthSq();
  if (segmentLengthSq <= ROVER_APPROACH_DETOUR_CONFIG.segmentLengthEpsilonSq) {
    return resolvePointClearanceToObstacle({
      pointPlanar: segmentStartPlanar,
      obstacle,
    });
  }
  const t = Math.min(
    1,
    Math.max(
      0,
      obstacle.center.clone().sub(segmentStartPlanar).dot(segmentVector) / segmentLengthSq
    )
  );
  const closestPointPlanar = segmentStartPlanar.clone().addScaledVector(segmentVector, t);
  return resolvePointClearanceToObstacle({
    pointPlanar: closestPointPlanar,
    obstacle,
  });
};

const assessFootprintSegmentClearanceInScene = ({
  segmentStartWorld,
  segmentEndWorld,
  scene,
  pathClearanceM,
  robotFootprint = DEFAULT_ROBOT_FOOTPRINT,
  footprintForwardWorldStart,
  footprintForwardWorldEnd,
}: {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  scene: RoverApproachNavigationScene;
  pathClearanceM: number;
  robotFootprint?: RoverApproachRobotFootprint;
  footprintForwardWorldStart?: THREE.Vector3;
  footprintForwardWorldEnd?: THREE.Vector3;
}) => {
  const startPlanar = projectWorldToPlanar(scene.basis, segmentStartWorld);
  const endPlanar = projectWorldToPlanar(scene.basis, segmentEndWorld);
  if (
    !hasRobotFootprintArea(robotFootprint) &&
    scene.obstacles.every((obstacle) => obstacle.shape === "circle")
  ) {
    let minClearanceM = Number.POSITIVE_INFINITY;
    let firstBlockingObstacleId: string | null = null;
    scene.obstacles.forEach((obstacle) => {
      const clearanceM =
        resolveCircleObstacleSegmentClearanceM({
          segmentStartPlanar: startPlanar,
          segmentEndPlanar: endPlanar,
          obstacle,
        }) - Math.max(0, pathClearanceM);
      minClearanceM = Math.min(minClearanceM, clearanceM);
      if (clearanceM < 0 && firstBlockingObstacleId === null) {
        firstBlockingObstacleId = obstacle.id;
      }
    });
    return {
      isClear: firstBlockingObstacleId === null,
      firstBlockingObstacleId,
    };
  }
  const segment = endPlanar.clone().sub(startPlanar);
  const footprintDiagonalM = Math.hypot(
    clampPositive(robotFootprint.halfLengthM),
    clampPositive(robotFootprint.halfWidthM)
  );
  const stepLengthM = Math.max(
    ROVER_APPROACH_NAVIGATION_CONFIG.gridCellSizeM * 0.5,
    footprintDiagonalM * 0.5,
    ROVER_APPROACH_NAVIGATION_CONFIG.lineOfSightSampleStepMinM
  );
  const samples = Math.max(1, Math.ceil(segment.length() / stepLengthM));
  const defaultForwardPlanar =
    segment.lengthSq() > ROVER_APPROACH_DETOUR_CONFIG.segmentLengthEpsilonSq
      ? segment.clone().normalize()
      : new THREE.Vector2(1, 0);
  const startForwardPlanar = footprintForwardWorldStart
    ? projectWorldDirectionToPlanar(scene.basis, footprintForwardWorldStart)
    : defaultForwardPlanar;
  const endForwardPlanar = footprintForwardWorldEnd
    ? projectWorldDirectionToPlanar(scene.basis, footprintForwardWorldEnd)
    : defaultForwardPlanar;
  for (let index = 0; index <= samples; index += 1) {
    const t = samples === 0 ? 0 : index / samples;
    const center = startPlanar.clone().lerp(endPlanar, t);
    const forwardPlanar = startForwardPlanar
      .clone()
      .lerp(endForwardPlanar, t);
    const blockingObstacle = scene.obstacles.find((obstacle) =>
      doesRobotFootprintOverlapObstacle({
        center,
        robotFootprint,
        obstacle,
        pathClearanceM,
        forwardPlanar,
      })
    );
    if (blockingObstacle) {
      return {
        isClear: false,
        firstBlockingObstacleId: blockingObstacle.id,
      };
    }
  }
  return {
    isClear: true,
    firstBlockingObstacleId: null,
  };
};

const buildBlockedCellKeySet = ({
  obstacles,
  pathClearanceM,
  robotFootprint,
  cellSizeM,
  minX,
  minY,
  cols,
  rows,
}: {
  obstacles: PlanarObstacle[];
  pathClearanceM: number;
  robotFootprint: RoverApproachRobotFootprint;
  cellSizeM: number;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
}): Set<string> => {
  const blockedKeys = new Set<string>();
  const cellHalfDiagonalM = Math.SQRT2 * cellSizeM * 0.5;

  obstacles.forEach((obstacle) => {
    const maxExtentM =
      obstacle.shape === "box"
        ? Math.max(obstacle.halfExtentU, obstacle.halfExtentV)
        : resolveFinitePositive(
            obstacle.radiusM,
            ROVER_APPROACH_DETOUR_CONFIG.obstacleRadiusLowerBoundM
          );
    const searchRadiusM =
      maxExtentM +
      Math.max(0, pathClearanceM) +
      cellHalfDiagonalM +
      Math.max(robotFootprint.halfLengthM, robotFootprint.halfWidthM) +
      ROVER_APPROACH_NAVIGATION_CONFIG.blockedCellRadiusPaddingM;
    const minCoord = toGridCoord({
      pointPlanar: new THREE.Vector2(
        obstacle.center.x - searchRadiusM,
        obstacle.center.y - searchRadiusM
      ),
      minX,
      minY,
      cellSizeM,
      cols,
      rows,
    });
    const maxCoord = toGridCoord({
      pointPlanar: new THREE.Vector2(
        obstacle.center.x + searchRadiusM,
        obstacle.center.y + searchRadiusM
      ),
      minX,
      minY,
      cellSizeM,
      cols,
      rows,
    });
    for (let x = minCoord.x; x <= maxCoord.x; x += 1) {
      for (let y = minCoord.y; y <= maxCoord.y; y += 1) {
        const centerPlanar = toCellCenterPlanar({ coord: { x, y }, minX, minY, cellSizeM });
        if (
          doesRobotFootprintOverlapObstacle({
            center: centerPlanar,
            robotFootprint,
            obstacle,
            pathClearanceM,
            forwardPlanar: DEFAULT_FORWARD_PLANAR,
          })
        ) {
          blockedKeys.add(toKey({ x, y }));
        }
      }
    }
  });

  return blockedKeys;
};

const resolveBlockedCellCacheKey = ({
  obstacleSignature,
  minX,
  maxX,
  minY,
  maxY,
  cellSizeM,
  pathClearanceM,
  robotFootprint,
}: {
  obstacleSignature: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cellSizeM: number;
  pathClearanceM: number;
  robotFootprint: RoverApproachRobotFootprint;
}): string =>
  [
    obstacleSignature,
    toRoundedKeyPart(minX),
    toRoundedKeyPart(maxX),
    toRoundedKeyPart(minY),
    toRoundedKeyPart(maxY),
    toRoundedKeyPart(cellSizeM),
    toRoundedKeyPart(pathClearanceM),
    toRoundedKeyPart(clampPositive(robotFootprint.halfLengthM)),
    toRoundedKeyPart(clampPositive(robotFootprint.halfWidthM)),
  ].join("|");

const resolveObstacleSignature = (obstacles: PlanarObstacle[]): string =>
  obstacles
    .map((obstacle) =>
      [
        obstacle.shape,
        toRoundedKeyPart(obstacle.center.x),
        toRoundedKeyPart(obstacle.center.y),
        toRoundedKeyPart(obstacle.radiusM),
        toRoundedKeyPart(obstacle.axisU.x),
        toRoundedKeyPart(obstacle.axisU.y),
        toRoundedKeyPart(obstacle.axisV.x),
        toRoundedKeyPart(obstacle.axisV.y),
        toRoundedKeyPart(obstacle.halfExtentU),
        toRoundedKeyPart(obstacle.halfExtentV),
      ].join(":")
    )
    .join(";");

const resolveNearestObstacleClearanceM = ({
  pointPlanar,
  obstacles,
}: {
  pointPlanar: THREE.Vector2;
  obstacles: PlanarObstacle[];
}): number => {
  let minClearanceM = Number.POSITIVE_INFINITY;
  obstacles.forEach((obstacle) => {
    minClearanceM = Math.min(
      minClearanceM,
      resolvePointClearanceToObstacle({
        pointPlanar,
        obstacle,
      })
    );
  });
  return minClearanceM;
};

const resolveStepTurnPenalty = ({
  previousStep,
  nextStep,
}: {
  previousStep: GridStep | null;
  nextStep: GridStep;
}): number => {
  if (previousStep === null) {
    return 0;
  }
  const previousLength = Math.hypot(previousStep.dx, previousStep.dy);
  const nextLength = Math.hypot(nextStep.dx, nextStep.dy);
  if (previousLength <= 0 || nextLength <= 0) {
    return 0;
  }
  const normalizedDot =
    (previousStep.dx * nextStep.dx + previousStep.dy * nextStep.dy) /
    (previousLength * nextLength);
  const clampedDot = Math.min(1, Math.max(-1, normalizedDot));
  return (
    (1 - clampedDot) * ROVER_APPROACH_NAVIGATION_CONFIG.turnPenaltyWeight
  );
};

const resolveStepObstaclePenalty = ({
  pointPlanar,
  obstacles,
}: {
  pointPlanar: THREE.Vector2;
  obstacles: PlanarObstacle[];
}): number => {
  if (obstacles.length === 0) {
    return 0;
  }
  const nearestObstacleClearanceM = resolveNearestObstacleClearanceM({
    pointPlanar,
    obstacles,
  });
  const penaltyDistanceM = ROVER_APPROACH_NAVIGATION_CONFIG.nearObstaclePenaltyDistanceM;
  if (nearestObstacleClearanceM >= penaltyDistanceM) {
    return 0;
  }
  const clampedClearanceM = Math.max(0, nearestObstacleClearanceM);
  return (
    ((penaltyDistanceM - clampedClearanceM) / penaltyDistanceM) *
    ROVER_APPROACH_NAVIGATION_CONFIG.nearObstaclePenaltyWeight
  );
};

const resolveGridStepTraversalCost = ({
  stepDistanceM,
  pointPlanar,
  obstacles,
  previousStep,
  nextStep,
}: {
  stepDistanceM: number;
  pointPlanar: THREE.Vector2;
  obstacles: PlanarObstacle[];
  previousStep: GridStep | null;
  nextStep: GridStep;
}): number => {
  const nearestObstacleClearanceM = resolveNearestObstacleClearanceM({
    pointPlanar,
    obstacles,
  });
  return (
    stepDistanceM +
    resolveStepTurnPenalty({
      previousStep,
      nextStep,
    }) +
    resolveStepObstaclePenalty({
      pointPlanar,
      obstacles,
    }) +
    resolveNarrowPassagePenaltyForClearanceM(nearestObstacleClearanceM) +
    resolveWaypointComplexityPenalty()
  );
};

const resolveSceneBlockedCellKeySet = ({
  scene,
  obstacles,
  bounds,
  cellSizeM,
  cols,
  rows,
  pathClearanceM,
  robotFootprint,
}: {
  scene: RoverApproachNavigationScene;
  obstacles: PlanarObstacle[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  cellSizeM: number;
  cols: number;
  rows: number;
  pathClearanceM: number;
  robotFootprint: RoverApproachRobotFootprint;
}): Set<string> => {
  const cacheKey = resolveBlockedCellCacheKey({
    obstacleSignature: resolveObstacleSignature(obstacles),
    minX: bounds.minX,
    maxX: bounds.maxX,
    minY: bounds.minY,
    maxY: bounds.maxY,
    cellSizeM,
    pathClearanceM,
    robotFootprint,
  });
  const cachedBlockedKeys = scene.blockedCellKeyCache.get(cacheKey);
  if (cachedBlockedKeys) {
    return cachedBlockedKeys;
  }
  const blockedKeys = buildBlockedCellKeySet({
    obstacles,
    pathClearanceM,
    robotFootprint,
    cellSizeM,
    minX: bounds.minX,
    minY: bounds.minY,
    cols,
    rows,
  });
  scene.blockedCellKeyCache.set(cacheKey, blockedKeys);
  if (
    scene.blockedCellKeyCache.size >
    ROVER_APPROACH_NAVIGATION_CONFIG.occupancyCacheMaxEntries
  ) {
    const oldestKey = scene.blockedCellKeyCache.keys().next().value;
    if (typeof oldestKey === "string") {
      scene.blockedCellKeyCache.delete(oldestKey);
    }
  }
  return blockedKeys;
};

const reconstructPath = (cameFrom: Map<string, string>, goalKey: string): GridCoord[] => {
  const pathKeys = [goalKey];
  let cursor = goalKey;
  while (cameFrom.has(cursor)) {
    cursor = cameFrom.get(cursor) as string;
    pathKeys.push(cursor);
  }
  pathKeys.reverse();
  return pathKeys.map((key) => {
    const [x, y] = key.split(",").map((value) => Number.parseInt(value, 10));
    return { x, y };
  });
};

const resolveGridGoalHeuristic = ({
  from,
  goal,
  cellSizeM,
}: {
  from: GridCoord;
  goal: GridCoord;
  cellSizeM: number;
}): number => Math.hypot(goal.x - from.x, goal.y - from.y) * cellSizeM;

const findGridPath = ({
  start,
  goal,
  blockedKeys,
  obstacles,
  minX,
  minY,
  cellSizeM,
  cols,
  rows,
}: {
  start: GridCoord;
  goal: GridCoord;
  blockedKeys: Set<string>;
  obstacles: PlanarObstacle[];
  minX: number;
  minY: number;
  cellSizeM: number;
  cols: number;
  rows: number;
}): GridCoord[] | null => {
  const startKey = toKey(start);
  const goalKey = toKey(goal);
  const openSet = new Set<string>([startKey]);
  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>([
    [
      startKey,
      resolveGridGoalHeuristic({
        from: start,
        goal,
        cellSizeM,
      }),
    ],
  ]);
  const cameFrom = new Map<string, string>();
  const stepFrom = new Map<string, GridStep>();

  while (openSet.size > 0) {
    let currentKey: string | null = null;
    let currentScore = Number.POSITIVE_INFINITY;
    openSet.forEach((candidateKey) => {
      const candidateScore = fScore.get(candidateKey) ?? Number.POSITIVE_INFINITY;
      if (candidateScore < currentScore) {
        currentScore = candidateScore;
        currentKey = candidateKey;
      }
    });
    if (currentKey === null) {
      return null;
    }
    if (currentKey === goalKey) {
      return reconstructPath(cameFrom, goalKey);
    }
    openSet.delete(currentKey);
    const [currentX, currentY] = currentKey
      .split(",")
      .map((value) => Number.parseInt(value, 10));
    const current = { x: currentX, y: currentY };
    const currentGScore = gScore.get(currentKey) ?? Number.POSITIVE_INFINITY;

    const previousStep = stepFrom.get(currentKey) ?? null;
    enumerateNeighbors(current).forEach(({ coord: neighbor, cost, step }) => {
      if (
        neighbor.x < 0 ||
        neighbor.x >= cols ||
        neighbor.y < 0 ||
        neighbor.y >= rows
      ) {
        return;
      }
      const neighborKey = toKey(neighbor);
      if (blockedKeys.has(neighborKey) && neighborKey !== goalKey) {
        return;
      }
      const pointPlanar = toCellCenterPlanar({
        coord: neighbor,
        minX,
        minY,
        cellSizeM,
      });
      const tentativeGScore =
        currentGScore +
        resolveGridStepTraversalCost({
          stepDistanceM: cost * cellSizeM,
          pointPlanar,
          obstacles,
          previousStep,
          nextStep: step,
        });
      if (tentativeGScore >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        return;
      }
      cameFrom.set(neighborKey, currentKey);
      stepFrom.set(neighborKey, step);
      gScore.set(neighborKey, tentativeGScore);
      fScore.set(
        neighborKey,
        tentativeGScore +
          resolveGridGoalHeuristic({
            from: neighbor,
            goal,
            cellSizeM,
          })
      );
      openSet.add(neighborKey);
    });
  }

  return null;
};

const resolveNavigationWaypointWorlds = ({
  segmentStartWorld,
  segmentEndWorld,
  waypointWorlds,
  scene,
  pathClearanceM,
  robotFootprint,
}: {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  waypointWorlds: THREE.Vector3[];
  scene: RoverApproachNavigationScene;
  pathClearanceM: number;
  robotFootprint: RoverApproachRobotFootprint;
}): THREE.Vector3[] => {
  const simplifiedWaypointWorlds = simplifyWaypointWorlds({
    segmentStartWorld,
    segmentEndWorld,
    waypointWorlds,
    scene,
    pathClearanceM,
    robotFootprint,
  });
  if (
    areWaypointSegmentsClearInScene({
      segmentStartWorld,
      segmentEndWorld,
      waypointWorlds: simplifiedWaypointWorlds,
      scene,
      pathClearanceM,
      robotFootprint,
    })
  ) {
    return simplifiedWaypointWorlds;
  }
  if (
    areWaypointSegmentsClearInScene({
      segmentStartWorld,
      segmentEndWorld,
      waypointWorlds,
      scene,
      pathClearanceM,
      robotFootprint,
    })
  ) {
    return waypointWorlds;
  }
  return [];
};

const resolveGridFallbackWaypointWorlds = ({
  segmentStartWorld,
  segmentEndWorld,
  scene,
  pathClearanceM,
  robotFootprint,
}: {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  scene: RoverApproachNavigationScene;
  pathClearanceM: number;
  robotFootprint: RoverApproachRobotFootprint;
}): THREE.Vector3[] => {
  const startPlanar = projectWorldToPlanar(scene.basis, segmentStartWorld);
  const endPlanar = projectWorldToPlanar(scene.basis, segmentEndWorld);
  const bounds = resolvePlanarBounds({
    segmentStartPlanar: startPlanar,
    segmentEndPlanar: endPlanar,
    obstacles: scene.obstacles,
    pathClearanceM,
  });
  const { cellSizeM, cols, rows } = resolveGridResolution(bounds);
  const blockedKeys = resolveSceneBlockedCellKeySet({
    scene,
    obstacles: scene.obstacles,
    bounds,
    cellSizeM,
    cols,
    rows,
    pathClearanceM,
    robotFootprint,
  });
  const gridPath = findGridPath({
    start: toGridCoord({
      pointPlanar: startPlanar,
      minX: bounds.minX,
      minY: bounds.minY,
      cellSizeM,
      cols,
      rows,
    }),
    goal: toGridCoord({
      pointPlanar: endPlanar,
      minX: bounds.minX,
      minY: bounds.minY,
      cellSizeM,
      cols,
      rows,
    }),
    blockedKeys,
    obstacles: scene.obstacles,
    minX: bounds.minX,
    minY: bounds.minY,
    cellSizeM,
    cols,
    rows,
  });
  if (!gridPath || gridPath.length < 2) {
    return [];
  }
  const waypointWorlds = gridPath
    .slice(1, -1)
    .map((coord) =>
      projectPlanarToWorld(
        scene.basis,
        toCellCenterPlanar({
          coord,
          minX: bounds.minX,
          minY: bounds.minY,
          cellSizeM,
        })
      )
    );
  return resolveNavigationWaypointWorlds({
    segmentStartWorld,
    segmentEndWorld,
    waypointWorlds,
    scene,
    pathClearanceM,
    robotFootprint,
  });
};

const simplifyWaypointWorlds = ({
  segmentStartWorld,
  segmentEndWorld,
  waypointWorlds,
  scene,
  pathClearanceM,
  robotFootprint,
}: {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  waypointWorlds: THREE.Vector3[];
  scene: RoverApproachNavigationScene;
  pathClearanceM: number;
  robotFootprint: RoverApproachRobotFootprint;
}): THREE.Vector3[] => {
  const pathPoints = [segmentStartWorld, ...waypointWorlds, segmentEndWorld];
  const simplifiedPathPoints: THREE.Vector3[] = [segmentStartWorld];
  let anchorIndex = 0;
  while (anchorIndex < pathPoints.length - 1) {
    let nextIndex = pathPoints.length - 1;
    while (nextIndex > anchorIndex + 1) {
      const assessment = assessFootprintSegmentClearanceInScene({
        segmentStartWorld: pathPoints[anchorIndex],
        segmentEndWorld: pathPoints[nextIndex],
        scene,
        pathClearanceM:
          pathClearanceM + ROVER_APPROACH_NAVIGATION_CONFIG.lineOfSightClearancePaddingM,
        robotFootprint,
      });
      if (
        assessment.isClear &&
        hasSceneSegmentPreferredClearance({
          segmentStartWorld: pathPoints[anchorIndex],
          segmentEndWorld: pathPoints[nextIndex],
          scene,
          pathClearanceM,
        })
      ) {
        break;
      }
      nextIndex -= 1;
    }
    simplifiedPathPoints.push(pathPoints[nextIndex]);
    anchorIndex = nextIndex;
  }

  return simplifiedPathPoints.slice(1, -1).filter((waypointWorld, index, list) => {
    const previousWorld = index === 0 ? segmentStartWorld : list[index - 1];
    return (
      previousWorld.distanceTo(waypointWorld) >=
      ROVER_APPROACH_NAVIGATION_CONFIG.minWaypointSpacingM
    );
  });
};

const areWaypointSegmentsClearInScene = ({
  segmentStartWorld,
  segmentEndWorld,
  waypointWorlds,
  scene,
  pathClearanceM,
  robotFootprint,
}: {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  waypointWorlds: THREE.Vector3[];
  scene: RoverApproachNavigationScene;
  pathClearanceM: number;
  robotFootprint: RoverApproachRobotFootprint;
}): boolean => {
  const pathPoints = [segmentStartWorld, ...waypointWorlds, segmentEndWorld];
  for (let index = 0; index < pathPoints.length - 1; index += 1) {
    const assessment = assessFootprintSegmentClearanceInScene({
      segmentStartWorld: pathPoints[index] as THREE.Vector3,
      segmentEndWorld: pathPoints[index + 1] as THREE.Vector3,
      scene,
      pathClearanceM,
      robotFootprint,
    });
    if (
      !assessment.isClear ||
      !hasSceneSegmentPreferredClearance({
        segmentStartWorld: pathPoints[index] as THREE.Vector3,
        segmentEndWorld: pathPoints[index + 1] as THREE.Vector3,
        scene,
        pathClearanceM,
      })
    ) {
      return false;
    }
  }
  return true;
};

const resolveRouteMinimumClearanceM = ({
  segmentStartWorld,
  segmentEndWorld,
  waypointWorlds,
  scene,
}: {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  waypointWorlds: readonly THREE.Vector3[];
  scene: RoverApproachNavigationScene;
}): number | null => {
  const pathPoints = [segmentStartWorld, ...waypointWorlds, segmentEndWorld];
  if (pathPoints.length < 2) {
    return null;
  }
  let minimumClearanceM = Number.POSITIVE_INFINITY;
  for (let index = 0; index < pathPoints.length - 1; index += 1) {
    minimumClearanceM = Math.min(
      minimumClearanceM,
      resolveSceneSegmentMinimumClearanceM({
        segmentStartWorld: pathPoints[index] as THREE.Vector3,
        segmentEndWorld: pathPoints[index + 1] as THREE.Vector3,
        scene,
      })
    );
  }
  return Number.isFinite(minimumClearanceM) ? minimumClearanceM : null;
};

export const toRoverNavigationPlanSummary = (
  result: RoverApproachNavigationResult
): RoverNavigationPlanSummary => ({
  mode: result.mode,
  plannerStage: result.plannerStage,
  blockedReason: result.blockedReason,
  minimumClearanceM: result.minimumClearanceM,
  waypointCount: result.waypointWorlds.length,
});

export const buildRoverApproachNavigationScene = ({
  upAxisWorld,
  obstacles,
}: {
  upAxisWorld: THREE.Vector3;
  obstacles: RoverApproachPlanarObstacle[];
}): RoverApproachNavigationScene => {
  const basis = createSceneBasis(upAxisWorld);
  return {
    basis,
    obstacles: obstacles.map((obstacle) => buildPlanarObstacle(basis, obstacle)),
    blockedCellKeyCache: new Map<string, Set<string>>(),
  };
};

export const assessRoverApproachNavigationSegmentInScene = ({
  segmentStartWorld,
  segmentEndWorld,
  scene,
  obstacles,
  pathClearanceM,
  robotFootprint = DEFAULT_ROBOT_FOOTPRINT,
  footprintForwardWorldStart,
  footprintForwardWorldEnd,
}: {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  scene: RoverApproachNavigationScene;
  obstacles: RoverApproachPlanarObstacle[];
  pathClearanceM: number;
  robotFootprint?: RoverApproachRobotFootprint;
  footprintForwardWorldStart?: THREE.Vector3;
  footprintForwardWorldEnd?: THREE.Vector3;
}) =>
  assessFootprintSegmentClearanceInScene({
    segmentStartWorld,
    segmentEndWorld,
    scene: {
      ...scene,
      obstacles: obstacles.map((obstacle) => buildPlanarObstacle(scene.basis, obstacle)),
    },
    pathClearanceM,
    robotFootprint,
    footprintForwardWorldStart,
    footprintForwardWorldEnd,
  });

export const planRoverApproachNavigationPathInScene = ({
  segmentStartWorld,
  segmentEndWorld,
  scene,
  obstacles,
  pathClearanceM,
  robotFootprint = DEFAULT_ROBOT_FOOTPRINT,
}: {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  scene: RoverApproachNavigationScene;
  obstacles: RoverApproachPlanarObstacle[];
  pathClearanceM: number;
  robotFootprint?: RoverApproachRobotFootprint;
}): RoverApproachNavigationResult => {
  const filteredScene: RoverApproachNavigationScene = {
    ...scene,
    obstacles: obstacles.map((obstacle) => buildPlanarObstacle(scene.basis, obstacle)),
  };
  const sceneProjectionInvalid =
    !Number.isFinite(segmentStartWorld.x) ||
    !Number.isFinite(segmentStartWorld.y) ||
    !Number.isFinite(segmentStartWorld.z) ||
    !Number.isFinite(segmentEndWorld.x) ||
    !Number.isFinite(segmentEndWorld.y) ||
    !Number.isFinite(segmentEndWorld.z);
  if (sceneProjectionInvalid) {
    return {
      mode: "blocked",
      waypointWorlds: [],
      plannerStage: "blocked",
      blockedReason: "scene-projection-invalid",
      minimumClearanceM: null,
    };
  }
  const startAssessment = assessFootprintSegmentClearanceInScene({
    segmentStartWorld,
    segmentEndWorld: segmentStartWorld,
    scene: filteredScene,
    pathClearanceM,
    robotFootprint,
  });
  if (!startAssessment.isClear) {
    return {
      mode: "blocked",
      waypointWorlds: [],
      plannerStage: "blocked",
      blockedReason: "start-in-collision",
      minimumClearanceM: resolveRouteMinimumClearanceM({
        segmentStartWorld,
        segmentEndWorld: segmentStartWorld,
        waypointWorlds: [],
        scene: filteredScene,
      }),
    };
  }
  const goalAssessment = assessFootprintSegmentClearanceInScene({
    segmentStartWorld: segmentEndWorld,
    segmentEndWorld,
    scene: filteredScene,
    pathClearanceM,
    robotFootprint,
  });
  if (!goalAssessment.isClear) {
    return {
      mode: "blocked",
      waypointWorlds: [],
      plannerStage: "blocked",
      blockedReason: "goal-in-collision",
      minimumClearanceM: resolveRouteMinimumClearanceM({
        segmentStartWorld: segmentEndWorld,
        segmentEndWorld,
        waypointWorlds: [],
        scene: filteredScene,
      }),
    };
  }
  const directAssessment = assessFootprintSegmentClearanceInScene({
    segmentStartWorld,
    segmentEndWorld,
    scene: filteredScene,
    pathClearanceM,
    robotFootprint,
  });
  if (directAssessment.isClear) {
    return {
      mode: "direct",
      waypointWorlds: [],
      plannerStage: "direct",
      blockedReason: "none",
      minimumClearanceM: resolveRouteMinimumClearanceM({
        segmentStartWorld,
        segmentEndWorld,
        waypointWorlds: [],
        scene: filteredScene,
      }),
    };
  }

  const queryKey = resolveVisibilityGraphQueryKey({
    segmentStartWorld,
    segmentEndWorld,
    pathClearanceM,
    robotFootprint,
  });
  const blockedEdgeKeys =
    filteredScene.blockedCellKeyCache.get(queryKey) ?? new Set<string>();
  if (!filteredScene.blockedCellKeyCache.has(queryKey)) {
    filteredScene.blockedCellKeyCache.set(queryKey, blockedEdgeKeys);
  }
  const visibilityNodes = buildVisibilityNodes({
    scene: filteredScene,
    segmentStartWorld,
    segmentEndWorld,
    robotFootprint,
    pathClearanceM,
  });
  const shortestPath = buildVisibilityShortestPath({
    nodes: visibilityNodes,
    segmentStartWorld,
    segmentEndWorld,
    scene: filteredScene,
    pathClearanceM,
    robotFootprint,
    blockedEdgeKeys,
  });
  const visibilityWaypointWorlds =
    shortestPath && shortestPath.length >= 2
      ? shortestPath
          .slice(1, -1)
          .map((node) => projectPlanarToWorld(scene.basis, node.pointPlanar))
      : [];
  const resolvedWaypointWorlds =
    resolveNavigationWaypointWorlds({
      segmentStartWorld,
      segmentEndWorld,
      waypointWorlds: visibilityWaypointWorlds,
      scene: filteredScene,
      pathClearanceM,
      robotFootprint,
    }) || [];
  if (resolvedWaypointWorlds.length > 0) {
    return {
      mode: "path",
      waypointWorlds: resolvedWaypointWorlds,
      plannerStage: "visibility",
      blockedReason: "none",
      minimumClearanceM: resolveRouteMinimumClearanceM({
        segmentStartWorld,
        segmentEndWorld,
        waypointWorlds: resolvedWaypointWorlds,
        scene: filteredScene,
      }),
    };
  }
  const gridFallbackWaypointWorlds = resolveGridFallbackWaypointWorlds({
    segmentStartWorld,
    segmentEndWorld,
    scene: filteredScene,
    pathClearanceM,
    robotFootprint,
  });
  if (gridFallbackWaypointWorlds.length > 0) {
    return {
      mode: "path",
      waypointWorlds: gridFallbackWaypointWorlds,
      plannerStage: "grid",
      blockedReason: "none",
      minimumClearanceM: resolveRouteMinimumClearanceM({
        segmentStartWorld,
        segmentEndWorld,
        waypointWorlds: gridFallbackWaypointWorlds,
        scene: filteredScene,
      }),
    };
  }
  return {
    mode: "blocked",
    waypointWorlds: [],
    plannerStage: "blocked",
    blockedReason: "no-traversable-corridor",
    minimumClearanceM: resolveRouteMinimumClearanceM({
      segmentStartWorld,
      segmentEndWorld,
      waypointWorlds: [],
      scene: filteredScene,
    }),
  };
};

export const planRoverApproachNavigationPath = ({
  segmentStartWorld,
  segmentEndWorld,
  upAxisWorld,
  obstacles,
  pathClearanceM,
  robotFootprint = DEFAULT_ROBOT_FOOTPRINT,
}: {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
  obstacles: RoverApproachPlanarObstacle[];
  pathClearanceM: number;
  robotFootprint?: RoverApproachRobotFootprint;
}): RoverApproachNavigationResult =>
  planRoverApproachNavigationPathInScene({
    segmentStartWorld,
    segmentEndWorld,
    scene: buildRoverApproachNavigationScene({
      upAxisWorld,
      obstacles,
    }),
    obstacles,
    pathClearanceM,
    robotFootprint,
  });
