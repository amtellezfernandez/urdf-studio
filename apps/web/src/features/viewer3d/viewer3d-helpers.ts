import * as THREE from "three";
import type { URDFJoint, URDFRobot } from "urdf-loader";

export type DragMode = "move-joints" | "click-to-place" | "drag-handle";

export type LinkPose = {
  position: [number, number, number];
  quaternion: [number, number, number, number]; // w, x, y, z
};

export const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const getDragModeDisplayName = (mode: DragMode) => {
  switch (mode) {
    case "move-joints":
      return "Move Joints";
    case "click-to-place":
      return "Click-to-place";
    case "drag-handle":
      return "Drag Handle";
    default:
      return "Move Joints";
  }
};

export const setEmissiveColor = (material: THREE.Material, color: number) => {
  const emissiveMaterial = material as
    | THREE.MeshStandardMaterial
    | THREE.MeshLambertMaterial
    | THREE.MeshPhongMaterial;
  if (emissiveMaterial.emissive) {
    emissiveMaterial.emissive.setHex(color);
  }
};

export const resolveJointScalarValue = (joint?: URDFJoint | null) => {
  if (!joint) return undefined;
  if (typeof joint.angle === "number") {
    return joint.angle;
  }
  const value = joint.jointValue;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "number" ? first : undefined;
  }
  return typeof value === "number" ? value : undefined;
};

export const extractLinkPose = (robot: URDFRobot | null, linkName: string): LinkPose | null => {
  if (!robot) return null;
  const robotAny = robot;
  const link =
    robotAny?.links?.[linkName] ??
    robotAny?.getObjectByName?.(linkName) ??
    robotAny?.getObjectByName?.(safeDecode(linkName));

  if (!link || !link.matrixWorld) return null;
  if (typeof link.updateMatrixWorld === "function") {
    link.updateMatrixWorld(true);
  }

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  link.matrixWorld.decompose(pos, quat, scale);

  return {
    position: [pos.x, pos.y, pos.z],
    quaternion: [quat.w, quat.x, quat.y, quat.z],
  };
};

export const normalizeIkQuaternion = (quat: THREE.Quaternion) => {
  const normalized = quat.clone().normalize();
  if (normalized.w < 0) {
    normalized.w *= -1;
    normalized.x *= -1;
    normalized.y *= -1;
    normalized.z *= -1;
  }
  return normalized;
};

export const buildIkOrientationPayload = (quat: THREE.Quaternion) => {
  const normalized = normalizeIkQuaternion(quat);
  const { w, x, y, z } = normalized;
  if (![w, x, y, z].every(Number.isFinite)) {
    return null;
  }

  const rotation = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];

  return {
    wxyz: [w, x, y, z] as [number, number, number, number],
    rotation,
  };
};

export const positionDistance = (
  a: [number, number, number],
  b: [number, number, number]
) => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

export const quaternionAngularErrorDeg = (
  pyrokiWxyz: [number, number, number, number],
  threeWxyz: [number, number, number, number]
) => {
  const qPy = new THREE.Quaternion(
    pyrokiWxyz[1],
    pyrokiWxyz[2],
    pyrokiWxyz[3],
    pyrokiWxyz[0]
  );
  const qThree = new THREE.Quaternion(
    threeWxyz[1],
    threeWxyz[2],
    threeWxyz[3],
    threeWxyz[0]
  );
  const delta = qPy.clone().invert().multiply(qThree);
  const angle = 2 * Math.acos(Math.min(1, Math.max(-1, delta.w)));
  return (angle * 180) / Math.PI;
};

export const toZeroIfTiny = (value: number | null, epsilon: number) => {
  if (value === null) return null;
  return Math.abs(value) <= epsilon ? 0 : value;
};

export const getLiveRobotJoints = (
  robot: URDFRobot | null,
  fallback: Record<string, number>
) => {
  if (!robot) return fallback;
  const joints = robot.joints || {};
  const result: Record<string, number> = {};
  for (const name of Object.keys(joints)) {
    const j = joints[name];
    const val = resolveJointScalarValue(j);
    if (typeof val === "number" && !Number.isNaN(val)) {
      result[name] = val;
    }
  }
  // Fallback to provided map if we missed anything
  return Object.keys(result).length > 0 ? result : fallback;
};

export const hasJointMapChanged = (
  next: Record<string, number>,
  prev: Record<string, number> | null
) => {
  if (!prev) return true;
  const nextKeys = Object.keys(next);
  const prevKeys = Object.keys(prev);
  if (nextKeys.length !== prevKeys.length) return true;
  for (const key of nextKeys) {
    if (prev[key] !== next[key]) return true;
  }
  return false;
};
