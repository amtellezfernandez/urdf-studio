import * as THREE from "three";
import type { WorldObjectPrimitiveType } from "@/features/objects";
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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const resolveMaxObjectDimensionM = (object: ApproachObjectGeometry): number =>
  Math.max(0, object.size.x, object.size.y, object.size.z);

const resolvePointSupportRadiusM = (object: ApproachObjectGeometry): number =>
  resolveMaxObjectDimensionM(object) * ROVER_APPROACH_OBJECT_DISTANCE_PARAMS.halfExtentScale;

const resolveSphereSupportRadiusM = (object: ApproachObjectGeometry): number =>
  resolveMaxObjectDimensionM(object) * ROVER_APPROACH_OBJECT_DISTANCE_PARAMS.halfExtentScale;

const resolveCylinderSupportRadiusM = (
  object: ApproachObjectGeometry,
  normalizedDirection: { x: number; y: number; z: number }
): number => {
  const radius = Math.max(0, object.size.x, object.size.y) * ROVER_APPROACH_OBJECT_DISTANCE_PARAMS.halfExtentScale;
  const halfHeight = Math.max(0, object.size.z) * ROVER_APPROACH_OBJECT_DISTANCE_PARAMS.halfExtentScale;
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
  const halfExtentX = Math.max(
    0,
    object.size.x * ROVER_APPROACH_OBJECT_DISTANCE_PARAMS.halfExtentScale
  );
  const halfExtentY = Math.max(
    0,
    object.size.y * ROVER_APPROACH_OBJECT_DISTANCE_PARAMS.halfExtentScale
  );
  const halfExtentZ = Math.max(
    0,
    object.size.z * ROVER_APPROACH_OBJECT_DISTANCE_PARAMS.halfExtentScale
  );
  const support =
    Math.abs(localDirection.x) * halfExtentX +
    Math.abs(localDirection.y) * halfExtentY +
    Math.abs(localDirection.z) * halfExtentZ;
  return Math.max(0, support);
};

export const resolveRoverPlanarObjectApproachDistance = ({
  object,
  targetDirectionPlanarWorld,
}: ResolveRoverPlanarObjectApproachDistanceParams): RoverPlanarObjectApproachDistance => {
  const centerDistanceSq = targetDirectionPlanarWorld.lengthSq();
  if (
    !Number.isFinite(centerDistanceSq) ||
    centerDistanceSq <= ROVER_APPROACH_OBJECT_DISTANCE_PARAMS.directionLengthEpsilonSq
  ) {
    return {
      centerDistanceM: 0,
      supportRadiusM: 0,
      surfaceDistanceM: 0,
    };
  }
  const centerDistanceM = targetDirectionPlanarWorld.length();
  if (!Number.isFinite(centerDistanceM) || centerDistanceM <= 0) {
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
    object.type === "point"
      ? resolvePointSupportRadiusM(object)
      : object.type === "sphere"
        ? resolveSphereSupportRadiusM(object)
        : object.type === "cylinder"
          ? resolveCylinderSupportRadiusM(object, normalizedDirection)
          : resolveCubeSupportRadiusM(object, normalizedDirection);
  const clampedSupportRadiusM = clamp(supportRadiusM, 0, centerDistanceM);
  return {
    centerDistanceM,
    supportRadiusM: clampedSupportRadiusM,
    surfaceDistanceM: Math.max(0, centerDistanceM - clampedSupportRadiusM),
  };
};
