import * as THREE from "three";
import type { CreatedObject } from "@/features/objects";
import { normalizeWorldObjectRotationEuler } from "@/features/objects/worldObjectGeometry";

const EE_OBJECT_CONTACT_PARAMS = {
  contactMarginM: 0.002,
  minimumObjectRadiusM: 0.005,
} as const;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const resolvePointObjectRadiusM = (size: THREE.Vector3): number =>
  Math.max(
    EE_OBJECT_CONTACT_PARAMS.minimumObjectRadiusM,
    Math.max(size.x, size.y, size.z) * 0.5
  );

const resolveObjectLocalPoint = (
  pointWorld: THREE.Vector3,
  object: CreatedObject
): THREE.Vector3 => {
  const inverseRotation = new THREE.Quaternion()
    .setFromEuler(normalizeWorldObjectRotationEuler(object.rotation))
    .invert();
  return pointWorld.clone().sub(object.position).applyQuaternion(inverseRotation);
};

const computePointToBoxDistanceSq = (
  pointLocal: THREE.Vector3,
  halfExtentsLocal: THREE.Vector3
): number => {
  const closestX = clamp(pointLocal.x, -halfExtentsLocal.x, halfExtentsLocal.x);
  const closestY = clamp(pointLocal.y, -halfExtentsLocal.y, halfExtentsLocal.y);
  const closestZ = clamp(pointLocal.z, -halfExtentsLocal.z, halfExtentsLocal.z);
  const dx = pointLocal.x - closestX;
  const dy = pointLocal.y - closestY;
  const dz = pointLocal.z - closestZ;
  return dx * dx + dy * dy + dz * dz;
};

const resolvePointSignedDistanceM = (
  endEffectorSphereWorld: THREE.Sphere,
  object: CreatedObject
): number => {
  const objectRadiusM = resolvePointObjectRadiusM(object.size);
  const centerDistanceM = endEffectorSphereWorld.center.distanceTo(object.position);
  const thresholdM =
    endEffectorSphereWorld.radius +
    objectRadiusM +
    EE_OBJECT_CONTACT_PARAMS.contactMarginM;
  return centerDistanceM - thresholdM;
};

const resolveCubeSignedDistanceM = (
  endEffectorSphereWorld: THREE.Sphere,
  object: CreatedObject
): number => {
  const halfExtentsLocal = object.size.clone().multiplyScalar(0.5);
  const localPoint = resolveObjectLocalPoint(endEffectorSphereWorld.center, object);
  const distanceSqToBox = computePointToBoxDistanceSq(localPoint, halfExtentsLocal);
  const thresholdM =
    Math.max(0, endEffectorSphereWorld.radius) + EE_OBJECT_CONTACT_PARAMS.contactMarginM;
  return Math.sqrt(distanceSqToBox) - thresholdM;
};

const resolveSphereSignedDistanceM = (
  endEffectorSphereWorld: THREE.Sphere,
  object: CreatedObject
): number => {
  const objectRadiusM = Math.max(object.size.x, object.size.y, object.size.z) * 0.5;
  const centerDistanceM = endEffectorSphereWorld.center.distanceTo(object.position);
  const thresholdM =
    endEffectorSphereWorld.radius + objectRadiusM + EE_OBJECT_CONTACT_PARAMS.contactMarginM;
  return centerDistanceM - thresholdM;
};

const resolveCylinderSignedDistanceM = (
  endEffectorSphereWorld: THREE.Sphere,
  object: CreatedObject
): number => {
  const localPoint = resolveObjectLocalPoint(endEffectorSphereWorld.center, object);
  const radius = Math.max(object.size.x, object.size.y) * 0.5;
  const halfHeight = object.size.z * 0.5;
  const radialDistance = Math.max(0, Math.hypot(localPoint.x, localPoint.y) - radius);
  const verticalDistance = Math.max(0, Math.abs(localPoint.z) - halfHeight);
  const thresholdM =
    Math.max(0, endEffectorSphereWorld.radius) + EE_OBJECT_CONTACT_PARAMS.contactMarginM;
  return Math.hypot(radialDistance, verticalDistance) - thresholdM;
};

export const resolveEndEffectorContactObjectId = ({
  endEffectorSphereWorld,
  objects,
}: {
  endEffectorSphereWorld: THREE.Sphere;
  objects: readonly CreatedObject[];
}): string | null => {
  if (!Number.isFinite(endEffectorSphereWorld.radius) || endEffectorSphereWorld.radius <= 0) {
    return null;
  }

  let bestObjectId: string | null = null;
  let bestSignedDistanceM = Number.POSITIVE_INFINITY;
  objects.forEach((object) => {
    if (object.isHidden === true) return;
    const signedDistanceM =
      object.type === "point"
        ? resolvePointSignedDistanceM(endEffectorSphereWorld, object)
        : object.type === "sphere"
          ? resolveSphereSignedDistanceM(endEffectorSphereWorld, object)
          : object.type === "cylinder"
            ? resolveCylinderSignedDistanceM(endEffectorSphereWorld, object)
            : resolveCubeSignedDistanceM(endEffectorSphereWorld, object);
    if (signedDistanceM > 0) return;
    if (signedDistanceM < bestSignedDistanceM) {
      bestSignedDistanceM = signedDistanceM;
      bestObjectId = object.id;
    }
  });

  return bestObjectId;
};
