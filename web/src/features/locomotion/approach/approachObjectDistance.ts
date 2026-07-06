import * as THREE from "three";
import type { WorldObjectPrimitiveType } from "@/features/objects";
import {
  clampNumber,
  clampNumberToMin,
  isFiniteNumber,
  isFinitePositiveNumber,
  toNonNegativeFiniteNumberOrFallback,
} from "@/shared/lib/numeric";
import { ROVER_APPROACH_OBJECT_DISTANCE_PARAMS } from "./approachObjectDistanceParams";

export type ApproachObjectPrimitiveType = Exclude<WorldObjectPrimitiveType, "mesh">;

export type ApproachObjectGeometry = {
  type: ApproachObjectPrimitiveType;
  size: {
    x: number;
    y: number;
    z: number;
  };
  rotation?: THREE.Euler | null;
};

export type RoverPlanarObjectApproachDistance = {
  centerDistanceM: number;
  supportRadiusM: number;
  surfaceDistanceM: number;
};

type ResolveRoverPlanarObjectApproachDistanceParams = {
  object: ApproachObjectGeometry;
  targetDirectionPlanarWorld: {
    x: number;
    y: number;
    z: number;
    lengthSq: () => number;
    length: () => number;
  };
};

export const resolveApproachObjectPrimitiveType = (
  type: WorldObjectPrimitiveType
): ApproachObjectPrimitiveType => (type === "mesh" ? "cube" : type);

const resolveObjectDimensionM = (dimensionM: number): number =>
  toNonNegativeFiniteNumberOrFallback(dimensionM, 0);

const resolveObjectHalfExtentM = (dimensionM: number): number =>
  resolveObjectDimensionM(dimensionM) * ROVER_APPROACH_OBJECT_DISTANCE_PARAMS.halfExtentScale;

const resolveMaxObjectDimensionM = (object: ApproachObjectGeometry): number =>
  Math.max(
    resolveObjectDimensionM(object.size.x),
    resolveObjectDimensionM(object.size.y),
    resolveObjectDimensionM(object.size.z)
  );

const resolveMaxHalfExtentSupportRadiusM = (object: ApproachObjectGeometry): number =>
  resolveMaxObjectDimensionM(object) * ROVER_APPROACH_OBJECT_DISTANCE_PARAMS.halfExtentScale;

const resolveCylinderSupportRadiusM = (
  object: ApproachObjectGeometry,
  normalizedDirection: { x: number; y: number; z: number }
): number => {
  const radius = Math.max(
    resolveObjectHalfExtentM(object.size.x),
    resolveObjectHalfExtentM(object.size.y)
  );
  const halfHeight = resolveObjectHalfExtentM(object.size.z);
  const radialWeight = Math.hypot(normalizedDirection.x, normalizedDirection.y);
  return radius * radialWeight + Math.abs(normalizedDirection.z) * halfHeight;
};

const resolveCubeSupportRadiusM = (
  object: ApproachObjectGeometry,
  normalizedDirection: { x: number; y: number; z: number }
): number => {
  const localDirection = new THREE.Vector3(
    normalizedDirection.x,
    normalizedDirection.y,
    normalizedDirection.z
  );
  if (object.rotation) {
    const inverseRotation = new THREE.Quaternion()
      .setFromEuler(object.rotation)
      .invert();
    localDirection.applyQuaternion(inverseRotation);
  }
  const halfExtentX = resolveObjectHalfExtentM(object.size.x);
  const halfExtentY = resolveObjectHalfExtentM(object.size.y);
  const halfExtentZ = resolveObjectHalfExtentM(object.size.z);
  const support =
    Math.abs(localDirection.x) * halfExtentX +
    Math.abs(localDirection.y) * halfExtentY +
    Math.abs(localDirection.z) * halfExtentZ;
  return clampNumberToMin(support, 0);
};

export const resolveRoverPlanarObjectApproachDistance = ({
  object,
  targetDirectionPlanarWorld,
}: ResolveRoverPlanarObjectApproachDistanceParams): RoverPlanarObjectApproachDistance => {
  const centerDistanceSq = targetDirectionPlanarWorld.lengthSq();
  if (
    !isFiniteNumber(centerDistanceSq) ||
    centerDistanceSq <= ROVER_APPROACH_OBJECT_DISTANCE_PARAMS.directionLengthEpsilonSq
  ) {
    return {
      centerDistanceM: 0,
      supportRadiusM: 0,
      surfaceDistanceM: 0,
    };
  }
  const centerDistanceM = targetDirectionPlanarWorld.length();
  if (!isFinitePositiveNumber(centerDistanceM)) {
    return {
      centerDistanceM: 0,
      supportRadiusM: 0,
      surfaceDistanceM: 0,
    };
  }
  const inverseDistanceM = 1 / centerDistanceM;
  const normalizedDirection = {
    x: targetDirectionPlanarWorld.x * inverseDistanceM,
    y: targetDirectionPlanarWorld.y * inverseDistanceM,
    z: targetDirectionPlanarWorld.z * inverseDistanceM,
  };
  const supportRadiusM =
    object.type === "point" || object.type === "sphere"
      ? resolveMaxHalfExtentSupportRadiusM(object)
      : object.type === "cylinder"
        ? resolveCylinderSupportRadiusM(object, normalizedDirection)
        : resolveCubeSupportRadiusM(object, normalizedDirection);
  const clampedSupportRadiusM = clampNumber(supportRadiusM, 0, centerDistanceM);
  return {
    centerDistanceM,
    supportRadiusM: clampedSupportRadiusM,
    surfaceDistanceM: clampNumberToMin(centerDistanceM - clampedSupportRadiusM, 0),
  };
};
