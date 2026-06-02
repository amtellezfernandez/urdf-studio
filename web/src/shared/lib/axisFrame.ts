import * as THREE from "three";

const AXIS_FRAME_EPSILON = 1e-10;

export type AxisFrameBasis = {
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
};

type BuildAxisFrameBasisOptions = {
  forwardHint: THREE.Vector3;
  upHint: THREE.Vector3 | null;
  fallbackForward?: THREE.Vector3;
  fallbackUp?: THREE.Vector3;
};

const DEFAULT_FORWARD = new THREE.Vector3(1, 0, 0);
const DEFAULT_UP = new THREE.Vector3(0, 0, 1);
const FALLBACK_UP_REFERENCE = new THREE.Vector3(0, 1, 0);

export const normalizeDirection = (
  candidate: THREE.Vector3,
  fallback: THREE.Vector3
): THREE.Vector3 => {
  const normalizedCandidate = candidate.clone();
  if (
    !Number.isFinite(normalizedCandidate.x) ||
    !Number.isFinite(normalizedCandidate.y) ||
    !Number.isFinite(normalizedCandidate.z) ||
    normalizedCandidate.lengthSq() < AXIS_FRAME_EPSILON
  ) {
    return fallback.clone().normalize();
  }
  return normalizedCandidate.normalize();
};

export const projectDirectionOntoPlane = (
  direction: THREE.Vector3,
  planeNormal: THREE.Vector3,
  fallbackDirection: THREE.Vector3
): THREE.Vector3 => {
  const projected = projectVectorOntoPlane(direction, planeNormal);
  return normalizeDirection(projected, fallbackDirection);
};

export const projectVectorOntoPlane = (
  vector: THREE.Vector3,
  planeNormal: THREE.Vector3
): THREE.Vector3 => {
  const normalizedPlaneNormal = normalizeDirection(planeNormal, DEFAULT_UP);
  return vector
    .clone()
    .addScaledVector(normalizedPlaneNormal, -vector.dot(normalizedPlaneNormal));
};

export const getPerpendicularDirection = (
  upAxis: THREE.Vector3,
  fallbackDirection = DEFAULT_FORWARD
): THREE.Vector3 => {
  const normalizedUpAxis = normalizeDirection(upAxis, DEFAULT_UP);
  const preferredReference =
    Math.abs(normalizedUpAxis.z) < 0.9
      ? new THREE.Vector3(0, 0, 1)
      : fallbackDirection.clone().normalize();
  const candidate = new THREE.Vector3().crossVectors(preferredReference, normalizedUpAxis);
  return normalizeDirection(candidate, fallbackDirection);
};

export const worldDirectionFromLocal = (
  localDirection: THREE.Vector3,
  worldQuaternion: THREE.Quaternion
): THREE.Vector3 => localDirection.clone().applyQuaternion(worldQuaternion).normalize();

export const localDirectionFromWorld = (
  worldDirection: THREE.Vector3,
  worldQuaternion: THREE.Quaternion
): THREE.Vector3 =>
  worldDirection
    .clone()
    .applyQuaternion(worldQuaternion.clone().invert())
    .normalize();

export const resolveForwardWorldFromWheelAxes = (
  averageWheelAxisWorld: THREE.Vector3,
  worldUp: THREE.Vector3,
  robotForwardFallback: THREE.Vector3
): THREE.Vector3 => {
  const upAxis = normalizeDirection(worldUp, DEFAULT_UP);
  const wheelAxis = normalizeDirection(averageWheelAxisWorld, FALLBACK_UP_REFERENCE);
  const derivedForward = new THREE.Vector3().crossVectors(wheelAxis, upAxis);
  const planarForward = projectDirectionOntoPlane(
    derivedForward,
    upAxis,
    projectDirectionOntoPlane(robotForwardFallback, upAxis, DEFAULT_FORWARD)
  );
  return normalizeDirection(planarForward, getPerpendicularDirection(upAxis));
};

export const buildAxisFrameBasis = ({
  forwardHint,
  upHint,
  fallbackForward = DEFAULT_FORWARD,
  fallbackUp = DEFAULT_UP,
}: BuildAxisFrameBasisOptions): AxisFrameBasis => {
  const forward = normalizeDirection(forwardHint, fallbackForward);
  const upReference = upHint ?? fallbackUp;
  const projectedUp = upReference
    .clone()
    .addScaledVector(forward, -upReference.dot(forward));
  const upBase = normalizeDirection(projectedUp, fallbackUp);

  // Keep a right-handed basis that remains deterministic across functions.
  let right = new THREE.Vector3().crossVectors(upBase, forward);
  right = normalizeDirection(right, FALLBACK_UP_REFERENCE);
  let up = new THREE.Vector3().crossVectors(forward, right);
  up = normalizeDirection(up, fallbackUp);

  const projectedFallbackUp = fallbackUp
    .clone()
    .addScaledVector(forward, -fallbackUp.dot(forward));
  if (projectedFallbackUp.lengthSq() >= AXIS_FRAME_EPSILON) {
    projectedFallbackUp.normalize();
    if (up.dot(projectedFallbackUp) < 0) {
      up.multiplyScalar(-1);
      right.multiplyScalar(-1);
    }
  }

  return {
    forward,
    right,
    up,
  };
};
