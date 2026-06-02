import * as THREE from "three";
import type { CreatedObject } from "@/features/objects";
import { IK_OBJECT_TARGET_PARAMS } from "@/features/viewer/ikObjectTargetParams";

export type WorldTargetPosition = [number, number, number];

type ResolveIkObjectSolveTargetWorldParams = {
  object: CreatedObject;
  objectTargetPositionWorld: WorldTargetPosition;
  isOrbitTarget: boolean;
  effectorWorldPosition: THREE.Vector3;
  clampTargetPositionToArmReach: (target: WorldTargetPosition) => WorldTargetPosition;
};

const resolveDirectionFromCenterToReference = (
  centerWorld: THREE.Vector3,
  referenceWorld: THREE.Vector3
): THREE.Vector3 => {
  const direction = referenceWorld.clone().sub(centerWorld);
  if (direction.lengthSq() <= IK_OBJECT_TARGET_PARAMS.directionEpsilonSq) {
    const [x, y, z] = IK_OBJECT_TARGET_PARAMS.defaultDirectionWorld;
    return new THREE.Vector3(x, y, z);
  }
  return direction.normalize();
};

const resolveCubeDirectionalSupportMeters = (
  object: CreatedObject,
  outwardDirectionWorld: THREE.Vector3
): number => {
  const halfX = Math.max(0, object.size.x * IK_OBJECT_TARGET_PARAMS.halfExtentScale);
  const halfY = Math.max(0, object.size.y * IK_OBJECT_TARGET_PARAMS.halfExtentScale);
  const halfZ = Math.max(0, object.size.z * IK_OBJECT_TARGET_PARAMS.halfExtentScale);
  return (
    Math.abs(outwardDirectionWorld.x) * halfX +
    Math.abs(outwardDirectionWorld.y) * halfY +
    Math.abs(outwardDirectionWorld.z) * halfZ
  );
};

const resolveObjectSupportRadiusMeters = (
  object: CreatedObject,
  outwardDirectionWorld: THREE.Vector3
): number => {
  if (object.type === "point") {
    return (
      Math.max(object.size.x, object.size.y, object.size.z) *
      IK_OBJECT_TARGET_PARAMS.halfExtentScale
    );
  }
  return resolveCubeDirectionalSupportMeters(object, outwardDirectionWorld);
};

const resolvePunctualObjectSurfaceTargetWorld = ({
  object,
  objectCenterWorld,
  effectorWorldPosition,
}: {
  object: CreatedObject;
  objectCenterWorld: THREE.Vector3;
  effectorWorldPosition: THREE.Vector3;
}): WorldTargetPosition => {
  const outwardDirectionWorld = resolveDirectionFromCenterToReference(
    objectCenterWorld,
    effectorWorldPosition
  );
  const supportMeters = resolveObjectSupportRadiusMeters(object, outwardDirectionWorld);
  const targetWorld = objectCenterWorld
    .clone()
    .addScaledVector(
      outwardDirectionWorld,
      supportMeters + IK_OBJECT_TARGET_PARAMS.surfacePadMeters
    );
  return [targetWorld.x, targetWorld.y, targetWorld.z];
};

export const resolveIkObjectSolveTargetWorld = ({
  object,
  objectTargetPositionWorld,
  isOrbitTarget,
  effectorWorldPosition,
  clampTargetPositionToArmReach,
}: ResolveIkObjectSolveTargetWorldParams): WorldTargetPosition => {
  if (isOrbitTarget) {
    return clampTargetPositionToArmReach(objectTargetPositionWorld);
  }
  const objectCenterWorld = new THREE.Vector3(
    objectTargetPositionWorld[0],
    objectTargetPositionWorld[1],
    objectTargetPositionWorld[2]
  );
  return resolvePunctualObjectSurfaceTargetWorld({
    object,
    objectCenterWorld,
    effectorWorldPosition,
  });
};

