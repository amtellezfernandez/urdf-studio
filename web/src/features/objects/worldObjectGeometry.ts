import * as THREE from "three";
import {
  isFinitePositiveNumber,
  toFiniteNumberOrFallback,
} from "@/shared/lib/numeric";
import { WORLD_OBJECT_GEOMETRY_PARAMS } from "./worldObjectGeometryParams";

export type WorldObjectPrimitiveType = "cube" | "point" | "sphere" | "cylinder" | "mesh";

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

const toUniformVector3 = (value: number): THREE.Vector3 =>
  new THREE.Vector3(value, value, value);

const hasFinitePositiveSize = (size: WorldObjectVectorLike): boolean =>
  isFinitePositiveNumber(size.x) &&
  isFinitePositiveNumber(size.y) &&
  isFinitePositiveNumber(size.z);

export const normalizeWorldObjectPositionVector = (
  position: WorldObjectVectorLike
): THREE.Vector3 =>
  new THREE.Vector3(
    toFiniteNumberOrFallback(position.x, WORLD_OBJECT_GEOMETRY_PARAMS.fallbackPositionM),
    toFiniteNumberOrFallback(position.y, WORLD_OBJECT_GEOMETRY_PARAMS.fallbackPositionM),
    toFiniteNumberOrFallback(position.z, WORLD_OBJECT_GEOMETRY_PARAMS.fallbackPositionM)
  );

export const normalizeWorldObjectRotationEuler = (
  rotation?: WorldObjectRotationLike | null
): THREE.Euler =>
  new THREE.Euler(
    toFiniteNumberOrFallback(rotation?.x ?? 0, 0),
    toFiniteNumberOrFallback(rotation?.y ?? 0, 0),
    toFiniteNumberOrFallback(rotation?.z ?? 0, 0),
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
    toFiniteNumberOrFallback(value, WORLD_OBJECT_GEOMETRY_PARAMS.cubeFallbackSizeM)
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
    toFiniteNumberOrFallback(
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
    toFiniteNumberOrFallback(
      Math.max(size.x, size.y),
      WORLD_OBJECT_GEOMETRY_PARAMS.cylinderFallbackDiameterM
    )
  );

const normalizeCylinderHeight = (value: number): number =>
  Math.max(
    WORLD_OBJECT_GEOMETRY_PARAMS.cylinderMinHeightM,
    toFiniteNumberOrFallback(value, WORLD_OBJECT_GEOMETRY_PARAMS.cylinderFallbackHeightM)
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
