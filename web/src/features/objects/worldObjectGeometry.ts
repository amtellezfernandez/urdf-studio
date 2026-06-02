import * as THREE from "three";
import { WORLD_OBJECT_GEOMETRY_PARAMS } from "./worldObjectGeometryParams";

export type WorldObjectPrimitiveType = "cube" | "point" | "sphere" | "cylinder";

type WorldObjectVectorLike = {
  x: number;
  y: number;
  z: number;
};

type WorldObjectRotationLike = {
  x: number;
  y: number;
  z: number;
  order?: THREE.EulerOrder;
};

type WorldObjectGeometryLike = {
  type: WorldObjectPrimitiveType;
  position: WorldObjectVectorLike;
  size: WorldObjectVectorLike;
};

const toFiniteOrFallback = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;
const toUniformVector3 = (value: number): THREE.Vector3 =>
  new THREE.Vector3(value, value, value);

const hasFinitePositiveSize = (size: WorldObjectVectorLike): boolean =>
  Number.isFinite(size.x) &&
  Number.isFinite(size.y) &&
  Number.isFinite(size.z) &&
  size.x > 0 &&
  size.y > 0 &&
  size.z > 0;

export const normalizeWorldObjectPositionVector = (
  position: WorldObjectVectorLike
): THREE.Vector3 =>
  new THREE.Vector3(
    toFiniteOrFallback(position.x, WORLD_OBJECT_GEOMETRY_PARAMS.fallbackPositionM),
    toFiniteOrFallback(position.y, WORLD_OBJECT_GEOMETRY_PARAMS.fallbackPositionM),
    toFiniteOrFallback(position.z, WORLD_OBJECT_GEOMETRY_PARAMS.fallbackPositionM)
  );

export const normalizeWorldObjectRotationEuler = (
  rotation?: WorldObjectRotationLike | null
): THREE.Euler =>
  new THREE.Euler(
    toFiniteOrFallback(rotation?.x ?? 0, 0),
    toFiniteOrFallback(rotation?.y ?? 0, 0),
    toFiniteOrFallback(rotation?.z ?? 0, 0),
    rotation?.order ?? "XYZ"
  );

const isAxisAlignedWorldObjectRotation = (
  rotation?: WorldObjectRotationLike | null
): boolean => {
  const normalizedRotation = normalizeWorldObjectRotationEuler(rotation);
  return (
    Math.abs(normalizedRotation.x) < WORLD_OBJECT_GEOMETRY_PARAMS.axisAlignmentToleranceRad &&
    Math.abs(normalizedRotation.y) < WORLD_OBJECT_GEOMETRY_PARAMS.axisAlignmentToleranceRad &&
    Math.abs(normalizedRotation.z) < WORLD_OBJECT_GEOMETRY_PARAMS.axisAlignmentToleranceRad
  );
};

const normalizeCubeSizeComponent = (value: number): number =>
  Math.max(
    WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM,
    toFiniteOrFallback(value, WORLD_OBJECT_GEOMETRY_PARAMS.cubeFallbackSizeM)
  );

const normalizeCubeSizeVector = (size: WorldObjectVectorLike): THREE.Vector3 =>
  new THREE.Vector3(
    normalizeCubeSizeComponent(size.x),
    normalizeCubeSizeComponent(size.y),
    normalizeCubeSizeComponent(size.z)
  );

const normalizeSphereDiameter = (size: WorldObjectVectorLike): number =>
  Math.max(
    WORLD_OBJECT_GEOMETRY_PARAMS.sphereMinDiameterM,
    toFiniteOrFallback(
      Math.max(size.x, size.y, size.z),
      WORLD_OBJECT_GEOMETRY_PARAMS.sphereFallbackDiameterM
    )
  );

const normalizeSphereSizeVector = (size: WorldObjectVectorLike): THREE.Vector3 => {
  const diameter = normalizeSphereDiameter(size);
  return new THREE.Vector3(diameter, diameter, diameter);
};

const normalizeCylinderRadiusDiameter = (size: WorldObjectVectorLike): number =>
  Math.max(
    WORLD_OBJECT_GEOMETRY_PARAMS.cylinderMinDiameterM,
    toFiniteOrFallback(
      Math.max(size.x, size.y),
      WORLD_OBJECT_GEOMETRY_PARAMS.cylinderFallbackDiameterM
    )
  );

const normalizeCylinderHeight = (value: number): number =>
  Math.max(
    WORLD_OBJECT_GEOMETRY_PARAMS.cylinderMinHeightM,
    toFiniteOrFallback(value, WORLD_OBJECT_GEOMETRY_PARAMS.cylinderFallbackHeightM)
  );

const normalizeCylinderSizeVector = (size: WorldObjectVectorLike): THREE.Vector3 => {
  const diameter = normalizeCylinderRadiusDiameter(size);
  const height = normalizeCylinderHeight(size.z);
  return new THREE.Vector3(diameter, diameter, height);
};

const normalizePointSizeVector = (size: WorldObjectVectorLike): THREE.Vector3 => {
  if (hasFinitePositiveSize(size)) {
    return new THREE.Vector3(size.x, size.y, size.z);
  }
  return toUniformVector3(WORLD_OBJECT_GEOMETRY_PARAMS.pointFallbackSizeM);
};

export const normalizeWorldObjectSizeVector = ({
  type,
  size,
}: Pick<WorldObjectGeometryLike, "type" | "size">): THREE.Vector3 =>
  type === "point"
    ? normalizePointSizeVector(size)
    : type === "sphere"
      ? normalizeSphereSizeVector(size)
      : type === "cylinder"
        ? normalizeCylinderSizeVector(size)
        : normalizeCubeSizeVector(size);

export const resolveWorldObjectGeometry = ({
  type,
  position,
  size,
}: WorldObjectGeometryLike): {
  position: THREE.Vector3;
  size: THREE.Vector3;
} => ({
  position: normalizeWorldObjectPositionVector(position),
  size: normalizeWorldObjectSizeVector({ type, size }),
});
