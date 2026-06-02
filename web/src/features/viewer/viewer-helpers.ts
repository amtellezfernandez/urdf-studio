import * as THREE from "three";
import type { URDFJoint, URDFRobot } from "urdf-loader";
import type { RobotBasePose } from "@/shared/types/feature";
import {
  createIdentityRigidFrame,
  updateRigidFrameFromMatrixWorld,
  worldToLocalPositionInFrame,
  worldToLocalQuaternionInFrame,
} from "@/shared/lib/spatialFrame";

const BASE_POSE_APPLY_EPSILON = 1e-9;
const tempRobotBaseFrame = createIdentityRigidFrame();

export type DragMode = "move-joints" | "drag-handle" | "hardware-teleop";

export type LinkPose = {
  position: [number, number, number];
  quaternion: [number, number, number, number]; // w, x, y, z
};
export type IkTargetPose = {
  position: [number, number, number];
  quaternion: [number, number, number, number];
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
    case "drag-handle":
      return "Drag Handle";
    case "hardware-teleop":
      return "Leader Teleop";
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

export const normalizeIkTargetPoseForRobotBase = (
  robot: URDFRobot | null,
  pose: IkTargetPose
): IkTargetPose => {
  if (!robot) {
    return pose;
  }

  robot.updateMatrixWorld?.(true);
  updateRigidFrameFromMatrixWorld(robot.matrixWorld, tempRobotBaseFrame);

  const worldTargetPosition = new THREE.Vector3(
    pose.position[0],
    pose.position[1],
    pose.position[2]
  );
  const normalizedPosition = worldToLocalPositionInFrame(
    tempRobotBaseFrame,
    worldTargetPosition,
    new THREE.Vector3()
  );

  const worldTargetQuaternion = new THREE.Quaternion(
    pose.quaternion[1],
    pose.quaternion[2],
    pose.quaternion[3],
    pose.quaternion[0]
  );
  const normalizedQuaternion = worldToLocalQuaternionInFrame(
    tempRobotBaseFrame,
    worldTargetQuaternion,
    new THREE.Quaternion()
  );

  return {
    position: [normalizedPosition.x, normalizedPosition.y, normalizedPosition.z],
    quaternion: [
      normalizedQuaternion.w,
      normalizedQuaternion.x,
      normalizedQuaternion.y,
      normalizedQuaternion.z,
    ],
  };
};

const normalizeIkQuaternion = (quat: THREE.Quaternion) => {
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

export const extractRobotBasePose = (robot: URDFRobot | null): RobotBasePose | null => {
  if (!robot) return null;
  const { position, quaternion } = robot;
  if (
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(position.z) ||
    !Number.isFinite(quaternion.x) ||
    !Number.isFinite(quaternion.y) ||
    !Number.isFinite(quaternion.z) ||
    !Number.isFinite(quaternion.w)
  ) {
    return null;
  }
  return {
    position: {
      x: position.x,
      y: position.y,
      z: position.z,
    },
    quaternion: {
      x: quaternion.x,
      y: quaternion.y,
      z: quaternion.z,
      w: quaternion.w,
    },
  };
};

export const applyRobotBasePose = (
  robot: URDFRobot | null,
  basePose: RobotBasePose | null | undefined
) => {
  if (!robot || !basePose) return false;
  const { position, quaternion } = basePose;
  const values = [
    position.x,
    position.y,
    position.z,
    quaternion.x,
    quaternion.y,
    quaternion.z,
    quaternion.w,
  ];
  if (!values.every(Number.isFinite)) return false;

  let changed = false;
  if (Math.abs(robot.position.x - position.x) > BASE_POSE_APPLY_EPSILON) {
    robot.position.x = position.x;
    changed = true;
  }
  if (Math.abs(robot.position.y - position.y) > BASE_POSE_APPLY_EPSILON) {
    robot.position.y = position.y;
    changed = true;
  }
  if (Math.abs(robot.position.z - position.z) > BASE_POSE_APPLY_EPSILON) {
    robot.position.z = position.z;
    changed = true;
  }
  if (Math.abs(robot.quaternion.x - quaternion.x) > BASE_POSE_APPLY_EPSILON) {
    robot.quaternion.x = quaternion.x;
    changed = true;
  }
  if (Math.abs(robot.quaternion.y - quaternion.y) > BASE_POSE_APPLY_EPSILON) {
    robot.quaternion.y = quaternion.y;
    changed = true;
  }
  if (Math.abs(robot.quaternion.z - quaternion.z) > BASE_POSE_APPLY_EPSILON) {
    robot.quaternion.z = quaternion.z;
    changed = true;
  }
  if (Math.abs(robot.quaternion.w - quaternion.w) > BASE_POSE_APPLY_EPSILON) {
    robot.quaternion.w = quaternion.w;
    changed = true;
  }

  if (changed) {
    robot.updateMatrixWorld?.(true);
  }
  return changed;
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
