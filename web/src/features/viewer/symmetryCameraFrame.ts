import * as THREE from "three";

import {
  getPerpendicularDirection,
  normalizeDirection,
  projectDirectionOntoPlane,
} from "@/shared/lib/axisFrame";
import {
  SIMULATION_PREP_MIRROR_CAMERA_FRONT_SIDE_BLEND,
  SIMULATION_PREP_MIRROR_CAMERA_PLANAR_BLEND,
  SIMULATION_PREP_MIRROR_CAMERA_SCOPE_KEY_DECIMALS,
  SIMULATION_PREP_SYMMETRY_CAMERA_DIRECTION_BLEND_FORWARD,
  SIMULATION_PREP_SYMMETRY_CAMERA_DIRECTION_BLEND_UP,
  SIMULATION_PREP_SYMMETRY_CAMERA_FIT_DISTANCE_PADDING,
  SIMULATION_PREP_SYMMETRY_CAMERA_MIN_DISTANCE_METERS,
  SIMULATION_PREP_SYMMETRY_CAMERA_MIN_FOCUS_RADIUS_METERS,
  SIMULATION_PREP_SYMMETRY_CAMERA_MIN_HALF_FOV_RADIANS,
} from "@/features/viewer/symmetryVisualizationParams";

const DEFAULT_FORWARD_WORLD = new THREE.Vector3(1, 0, 0);
const DEFAULT_UP_WORLD = new THREE.Vector3(0, 0, 1);
const CAMERA_SIDE_WORLD = new THREE.Vector3();
const CAMERA_DIRECTION_WORLD = new THREE.Vector3();
const MIRROR_CAMERA_DIRECTION_WORLD = new THREE.Vector3();
const MIRROR_CAMERA_UP_FALLBACK_WORLD = new THREE.Vector3();
const MIRROR_CAMERA_UP_WORLD = new THREE.Vector3();
const MIRROR_CAMERA_PLANAR_DIRECTION_WORLD = new THREE.Vector3();
const normalizeMirrorCameraScopeKeyNames = (focusLinkNames: readonly string[]): string[] =>
  Array.from(new Set(focusLinkNames.map((linkName) => linkName.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  );
const toMirrorCameraScopeKeyNumber = (value: number): string =>
  value.toFixed(SIMULATION_PREP_MIRROR_CAMERA_SCOPE_KEY_DECIMALS);

export const buildSimulationPrepSymmetryCameraDirection = ({
  forwardWorld,
  upWorld,
}: {
  forwardWorld?: THREE.Vector3;
  upWorld?: THREE.Vector3;
}): THREE.Vector3 => {
  const normalizedForward = (forwardWorld ?? DEFAULT_FORWARD_WORLD).clone().normalize();
  const normalizedUp = (upWorld ?? DEFAULT_UP_WORLD).clone().normalize();
  CAMERA_SIDE_WORLD.crossVectors(normalizedForward, normalizedUp);
  if (CAMERA_SIDE_WORLD.lengthSq() <= Number.EPSILON) {
    CAMERA_DIRECTION_WORLD
      .copy(normalizedForward)
      .multiplyScalar(SIMULATION_PREP_SYMMETRY_CAMERA_DIRECTION_BLEND_FORWARD)
      .addScaledVector(normalizedUp, -SIMULATION_PREP_SYMMETRY_CAMERA_DIRECTION_BLEND_UP);
    return CAMERA_DIRECTION_WORLD.normalize();
  }
  CAMERA_SIDE_WORLD.normalize();
  CAMERA_DIRECTION_WORLD
    .copy(normalizedForward)
    .multiplyScalar(SIMULATION_PREP_SYMMETRY_CAMERA_DIRECTION_BLEND_FORWARD)
    .addScaledVector(normalizedUp, -SIMULATION_PREP_SYMMETRY_CAMERA_DIRECTION_BLEND_UP)
    .addScaledVector(CAMERA_SIDE_WORLD, 0);
  if (CAMERA_DIRECTION_WORLD.lengthSq() <= Number.EPSILON) {
    return normalizedUp.clone().multiplyScalar(-1);
  }
  return CAMERA_DIRECTION_WORLD.normalize();
};

export const buildSimulationPrepMirrorCameraFrame = ({
  frontWorld,
  planeNormalWorld,
  upWorld,
}: {
  frontWorld?: THREE.Vector3;
  planeNormalWorld: THREE.Vector3;
  upWorld?: THREE.Vector3;
}): {
  directionWorld: THREE.Vector3;
  upWorld: THREE.Vector3;
} => {
  const normalizedFront = normalizeDirection(frontWorld ?? DEFAULT_FORWARD_WORLD, DEFAULT_FORWARD_WORLD);
  const normalizedPlaneNormal = normalizeDirection(planeNormalWorld, DEFAULT_FORWARD_WORLD);
  const normalizedUp = normalizeDirection(upWorld ?? DEFAULT_UP_WORLD, DEFAULT_UP_WORLD);

  MIRROR_CAMERA_PLANAR_DIRECTION_WORLD.copy(
    projectDirectionOntoPlane(
      normalizedFront,
      normalizedPlaneNormal,
      getPerpendicularDirection(normalizedPlaneNormal, DEFAULT_FORWARD_WORLD)
    )
  );
  if (MIRROR_CAMERA_PLANAR_DIRECTION_WORLD.dot(normalizedFront) < 0) {
    MIRROR_CAMERA_PLANAR_DIRECTION_WORLD.multiplyScalar(-1);
  }
  MIRROR_CAMERA_DIRECTION_WORLD
    .copy(normalizedPlaneNormal)
    .multiplyScalar(SIMULATION_PREP_MIRROR_CAMERA_FRONT_SIDE_BLEND)
    .addScaledVector(
      MIRROR_CAMERA_PLANAR_DIRECTION_WORLD,
      SIMULATION_PREP_MIRROR_CAMERA_PLANAR_BLEND
    )
    .normalize();

  MIRROR_CAMERA_UP_FALLBACK_WORLD.copy(
    projectDirectionOntoPlane(
      normalizedFront,
      MIRROR_CAMERA_DIRECTION_WORLD,
      getPerpendicularDirection(MIRROR_CAMERA_DIRECTION_WORLD, DEFAULT_UP_WORLD)
    )
  );
  MIRROR_CAMERA_UP_WORLD.copy(
    projectDirectionOntoPlane(
      normalizedUp,
      MIRROR_CAMERA_DIRECTION_WORLD,
      MIRROR_CAMERA_UP_FALLBACK_WORLD
    )
  );

  return {
    directionWorld: MIRROR_CAMERA_DIRECTION_WORLD.clone(),
    upWorld: MIRROR_CAMERA_UP_WORLD.clone(),
  };
};

export const buildSimulationPrepMirrorCameraFrameKey = ({
  focusLinkNames,
  focusRadiusMeters,
  frontWorld,
  originMeters,
  planeLabel,
  planeNormalWorld,
}: {
  focusLinkNames: readonly string[];
  focusRadiusMeters: number;
  frontWorld: THREE.Vector3;
  originMeters: readonly number[];
  planeLabel: string;
  planeNormalWorld: readonly number[];
}): string =>
  [
    planeLabel,
    ...originMeters.map((value) => toMirrorCameraScopeKeyNumber(value)),
    ...planeNormalWorld.map((value) => toMirrorCameraScopeKeyNumber(value)),
    toMirrorCameraScopeKeyNumber(focusRadiusMeters),
    ...[
      frontWorld.x,
      frontWorld.y,
      frontWorld.z,
    ].map((value) => toMirrorCameraScopeKeyNumber(value)),
    normalizeMirrorCameraScopeKeyNames(focusLinkNames).join(","),
  ].join("|");

export const resolveSimulationPrepSymmetryCameraDistance = ({
  aspect,
  fovDegrees,
  focusRadiusMeters,
}: {
  aspect: number;
  fovDegrees: number;
  focusRadiusMeters: number;
}): number => {
  const radius = Math.max(
    focusRadiusMeters,
    SIMULATION_PREP_SYMMETRY_CAMERA_MIN_FOCUS_RADIUS_METERS
  );
  const verticalFovRadians = THREE.MathUtils.degToRad(fovDegrees);
  const horizontalFovRadians =
    2 * Math.atan(Math.tan(verticalFovRadians * 0.5) * Math.max(aspect, Number.EPSILON));
  const minHalfFovRadians = Math.max(
    SIMULATION_PREP_SYMMETRY_CAMERA_MIN_HALF_FOV_RADIANS,
    Math.min(verticalFovRadians, horizontalFovRadians) * 0.5
  );
  return Math.max(
    (radius / Math.sin(minHalfFovRadians)) * SIMULATION_PREP_SYMMETRY_CAMERA_FIT_DISTANCE_PADDING,
    SIMULATION_PREP_SYMMETRY_CAMERA_MIN_DISTANCE_METERS
  );
};
