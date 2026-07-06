import * as THREE from "three";

import { WORLD_OBJECT_EDIT_PARAMS } from "@/features/objects/worldObjectEditParams";

const DEFAULT_OBJECT_FRAME_DIRECTION = new THREE.Vector3(1, 1, 0.65).normalize();

export type WorldObjectFocusFrame = {
  cameraPosition: THREE.Vector3;
  target: THREE.Vector3;
  minDistance: number;
  maxDistance: number;
  radius: number;
  distance: number;
};

export const buildWorldObjectFocusFrame = ({
  objectPosition,
  objectSize,
  cameraPosition,
  controlsTarget,
  cameraFovDegrees,
  cameraAspect,
}: {
  objectPosition: THREE.Vector3;
  objectSize: THREE.Vector3;
  cameraPosition: THREE.Vector3;
  controlsTarget: THREE.Vector3;
  cameraFovDegrees: number;
  cameraAspect: number;
}): WorldObjectFocusFrame => {
  const target = objectPosition.clone();
  const radius = Math.max(
    objectSize.length() * 0.5,
    WORLD_OBJECT_EDIT_PARAMS.frameFocusMinRadiusM
  );
  const verticalFovRad = THREE.MathUtils.degToRad(cameraFovDegrees);
  const horizontalFovRad =
    2 * Math.atan(Math.tan(verticalFovRad * 0.5) * cameraAspect);
  const minHalfFovRad = Math.max(
    WORLD_OBJECT_EDIT_PARAMS.frameFocusMinHalfFovRad,
    Math.min(verticalFovRad, horizontalFovRad) * 0.5
  );
  const distance =
    Math.max(
      radius / Math.sin(minHalfFovRad),
      radius * WORLD_OBJECT_EDIT_PARAMS.frameFocusDistanceScale,
      WORLD_OBJECT_EDIT_PARAMS.frameFocusMinDistanceM
    ) * WORLD_OBJECT_EDIT_PARAMS.frameFocusPaddingScale;
  const direction = new THREE.Vector3()
    .subVectors(cameraPosition, controlsTarget)
    .normalize();
  if (direction.lengthSq() < WORLD_OBJECT_EDIT_PARAMS.frameFocusDirectionEpsilon) {
    direction.copy(DEFAULT_OBJECT_FRAME_DIRECTION);
  }
  const minDistance = Math.max(
    radius * WORLD_OBJECT_EDIT_PARAMS.frameFocusMinDistanceScale,
    WORLD_OBJECT_EDIT_PARAMS.frameFocusMinDistanceFallbackM
  );

  return {
    cameraPosition: target.clone().addScaledVector(direction, distance),
    target,
    minDistance,
    maxDistance: Math.max(
      radius * WORLD_OBJECT_EDIT_PARAMS.frameFocusMaxDistanceScale,
      minDistance * WORLD_OBJECT_EDIT_PARAMS.frameFocusMaxToMinDistanceRatio,
      WORLD_OBJECT_EDIT_PARAMS.frameFocusMaxDistanceFallbackM
    ),
    radius,
    distance,
  };
};
