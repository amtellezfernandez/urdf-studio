import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import {
  CAMERA_AUTO_OUTWARD_MIN_VECTOR_LENGTH,
  CAMERA_AUTO_OUTWARD_UP_PARALLEL_DOT,
} from "./cameraAutoGenerationParams";
import {
  buildAxisFrameBasis,
  localDirectionFromWorld,
} from "@/shared/lib/axisFrame";

export type CameraLocalPose = {
  xyz: [number, number, number];
  rpy: [number, number, number];
};

type ResolveCameraPoseAtLocalPointOptions = {
  preferredForwardLocal?: THREE.Vector3 | null;
  fallbackForwardLocal?: THREE.Vector3 | null;
  preferredUpLocal?: THREE.Vector3 | null;
};

const DEFAULT_LOCAL_CAMERA_RPY: [number, number, number] = [0, 0, 0];
const DEFAULT_LOCAL_FORWARD = new THREE.Vector3(1, 0, 0);
const DEFAULT_LOCAL_UP = new THREE.Vector3(0, 0, 1);
const WORLD_UP_FALLBACK_AXIS = new THREE.Vector3(0, 1, 0);
const RPY_ORDER = "ZYX" as const;

const toFiniteTriplet = (value: THREE.Vector3): [number, number, number] => [value.x, value.y, value.z];
const normalizePreferredForwardLocal = (value: THREE.Vector3 | null | undefined) => {
  if (!value) return null;
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) {
    return null;
  }
  if (value.lengthSq() < CAMERA_AUTO_OUTWARD_MIN_VECTOR_LENGTH) return null;
  return value.clone().normalize();
};

const normalizePreferredUpLocal = (value: THREE.Vector3 | null | undefined) => {
  if (!value) return null;
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) {
    return null;
  }
  if (value.lengthSq() < CAMERA_AUTO_OUTWARD_MIN_VECTOR_LENGTH) return null;
  return value.clone().normalize();
};

const resolveRobotWorldCenter = (robot: URDFRobot | null, fallback: THREE.Vector3) => {
  if (!robot) return fallback.clone();
  const robotBounds = new THREE.Box3().setFromObject(robot);
  if (robotBounds.isEmpty()) return fallback.clone();
  return robotBounds.getCenter(new THREE.Vector3());
};

const resolveLocalForwardFacingOutward = (
  linkObject: THREE.Object3D,
  localPosition: THREE.Vector3,
  robot: URDFRobot | null
) => {
  if (!robot) return null;
  linkObject.updateMatrixWorld(true);
  const worldPosition = localPosition.clone().applyMatrix4(linkObject.matrixWorld);
  const robotWorldCenter = resolveRobotWorldCenter(robot, worldPosition);

  const outwardWorld = worldPosition.clone().sub(robotWorldCenter);
  if (outwardWorld.lengthSq() < CAMERA_AUTO_OUTWARD_MIN_VECTOR_LENGTH) {
    const linkWorldPosition = new THREE.Vector3().setFromMatrixPosition(linkObject.matrixWorld);
    outwardWorld.copy(linkWorldPosition).sub(robotWorldCenter);
  }
  if (outwardWorld.lengthSq() < CAMERA_AUTO_OUTWARD_MIN_VECTOR_LENGTH) {
    return null;
  }

  const worldQuaternion = new THREE.Quaternion();
  linkObject.matrixWorld.decompose(new THREE.Vector3(), worldQuaternion, new THREE.Vector3());
  const localForward = localDirectionFromWorld(outwardWorld.normalize(), worldQuaternion);
  if (localForward.lengthSq() < CAMERA_AUTO_OUTWARD_MIN_VECTOR_LENGTH) {
    return null;
  }
  return localForward.normalize();
};

const resolveForwardDirection = (
  preferredForward: THREE.Vector3 | null,
  outwardForward: THREE.Vector3 | null,
  fallbackForward: THREE.Vector3 | null
) => {
  if (preferredForward) return preferredForward;
  if (outwardForward) return outwardForward;
  if (fallbackForward) return fallbackForward;
  return DEFAULT_LOCAL_FORWARD.clone();
};

const resolveLocalUpAxis = (
  xAxis: THREE.Vector3,
  preferredUpDirection: THREE.Vector3 | null,
  fallbackUpDirection: THREE.Vector3
) => {
  const projectUpAxisOrthogonalToForward = (candidateUp: THREE.Vector3 | null) => {
    if (!candidateUp) return null;
    const projected = candidateUp
      .clone()
      .addScaledVector(xAxis, -candidateUp.dot(xAxis));
    if (projected.lengthSq() < CAMERA_AUTO_OUTWARD_MIN_VECTOR_LENGTH) return null;
    return projected.normalize();
  };

  const preferredProjectedUp = projectUpAxisOrthogonalToForward(preferredUpDirection);
  if (preferredProjectedUp) {
    return preferredProjectedUp;
  }

  const projectedFallbackReference = fallbackUpDirection
    .clone()
    .addScaledVector(xAxis, -fallbackUpDirection.dot(xAxis));
  const fallbackReference =
    projectedFallbackReference.lengthSq() >= CAMERA_AUTO_OUTWARD_MIN_VECTOR_LENGTH
      ? projectedFallbackReference.normalize()
      : null;

  const tryResolveUp = (candidateUp: THREE.Vector3 | null) => {
    const normalizedProjected = projectUpAxisOrthogonalToForward(candidateUp);
    if (!normalizedProjected) return null;
    if (fallbackReference && normalizedProjected.dot(fallbackReference) < 0) {
      normalizedProjected.multiplyScalar(-1);
    }
    return normalizedProjected;
  };
  return (
    tryResolveUp(fallbackUpDirection) ??
    tryResolveUp(WORLD_UP_FALLBACK_AXIS)
  );
};

const resolveLocalRpyFromForward = (
  forwardDirection: THREE.Vector3,
  preferredUpDirection: THREE.Vector3 | null,
  fallbackUpDirection: THREE.Vector3
): [number, number, number] => {
  const xAxis = forwardDirection.clone().normalize();
  const upAxis = resolveLocalUpAxis(xAxis, preferredUpDirection, fallbackUpDirection);
  if (!upAxis) {
    return DEFAULT_LOCAL_CAMERA_RPY;
  }
  const basis = buildAxisFrameBasis({
    forwardHint: xAxis,
    upHint: upAxis,
    fallbackForward: DEFAULT_LOCAL_FORWARD,
    fallbackUp: fallbackUpDirection,
  });
  const rotation = new THREE.Matrix4().makeBasis(
    basis.forward,
    basis.right,
    basis.up
  );
  const orientation = new THREE.Quaternion().setFromRotationMatrix(rotation);
  const rpy = new THREE.Euler().setFromQuaternion(orientation, RPY_ORDER);
  return [rpy.x, rpy.y, rpy.z];
};

export const resolveCameraPoseAtLocalPointFacingOutward = (
  linkObject: THREE.Object3D,
  localPosition: THREE.Vector3,
  robot: URDFRobot | null,
  options: ResolveCameraPoseAtLocalPointOptions = {}
): CameraLocalPose => {
  const preferredForward = normalizePreferredForwardLocal(options.preferredForwardLocal);
  const outwardForward = resolveLocalForwardFacingOutward(linkObject, localPosition, robot);
  const fallbackForward = normalizePreferredForwardLocal(options.fallbackForwardLocal);
  const preferredUp = normalizePreferredUpLocal(options.preferredUpLocal);
  const forwardDirection = resolveForwardDirection(preferredForward, outwardForward, fallbackForward);
  const localFallbackUp =
    Math.abs(DEFAULT_LOCAL_FORWARD.dot(DEFAULT_LOCAL_UP)) > CAMERA_AUTO_OUTWARD_UP_PARALLEL_DOT
      ? WORLD_UP_FALLBACK_AXIS
      : DEFAULT_LOCAL_UP;
  return {
    xyz: toFiniteTriplet(localPosition),
    rpy: resolveLocalRpyFromForward(forwardDirection, preferredUp, localFallbackUp),
  };
};

export const resolveCameraPoseAtBoundsCenter = (
  localVisualBounds: THREE.Box3
): CameraLocalPose => {
  const center = localVisualBounds.getCenter(new THREE.Vector3());
  return {
    xyz: [center.x, center.y, center.z],
    rpy: DEFAULT_LOCAL_CAMERA_RPY,
  };
};
