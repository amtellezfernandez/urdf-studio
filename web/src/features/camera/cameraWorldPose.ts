import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import {
  CAMERA_TRANSFORM_ANGLE_TOLERANCE_DEG,
  CAMERA_TRANSFORM_OUTPUT_PRECISION,
  CAMERA_TRANSFORM_POSITION_TOLERANCE_M,
} from "./cameraTransformParams";

type CameraPose = {
  xyz: [number, number, number];
  rpy: [number, number, number];
};

type CameraPoseConfig = {
  parent_joint: string;
  pose: CameraPose;
};

type CameraWorldPoseOptions = {
  updateRobotWorld?: boolean;
};

const RPY_ORDER = "ZYX" as const;
const DEG_PER_RAD = 180 / Math.PI;

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const resolveNamedParentLinkObject = (
  robot: URDFRobot | null,
  parentLinkName: string
): THREE.Object3D | null => {
  if (!robot || !parentLinkName.trim()) return null;
  const decodedName = safeDecode(parentLinkName);
  return (
    robot.links?.[parentLinkName] ??
    robot.links?.[decodedName] ??
    robot.getObjectByName?.(parentLinkName) ??
    (decodedName !== parentLinkName ? robot.getObjectByName?.(decodedName) : null) ??
    null
  );
};

const toFiniteNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const toSafePose = (value: unknown): CameraPose | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { xyz?: unknown; rpy?: unknown };
  const xyz = candidate.xyz;
  const rpy = candidate.rpy;
  if (!Array.isArray(xyz) || !Array.isArray(rpy) || xyz.length < 3 || rpy.length < 3) {
    return null;
  }
  return {
    xyz: [
      toFiniteNumber(xyz[0], 0),
      toFiniteNumber(xyz[1], 0),
      toFiniteNumber(xyz[2], 0),
    ],
    rpy: [
      toFiniteNumber(rpy[0], 0),
      toFiniteNumber(rpy[1], 0),
      toFiniteNumber(rpy[2], 0),
    ],
  };
};

const matrixToPose = (matrix: THREE.Matrix4): CameraPose => {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  matrix.decompose(position, quaternion, new THREE.Vector3());
  const euler = new THREE.Euler().setFromQuaternion(quaternion, RPY_ORDER);
  return {
    xyz: [position.x, position.y, position.z],
    rpy: [euler.x, euler.y, euler.z],
  };
};

const remapPoseBetweenFrames = (
  fromFrame: THREE.Object3D | null,
  toFrame: THREE.Object3D | null,
  pose: CameraPose
): CameraPose => {
  if (!fromFrame || !toFrame || fromFrame === toFrame) return pose;

  try {
    fromFrame.updateMatrixWorld(true);
    toFrame.updateMatrixWorld(true);

    const localMatrix = new THREE.Matrix4()
      .makeRotationFromEuler(new THREE.Euler(...pose.rpy, RPY_ORDER))
      .setPosition(new THREE.Vector3(...pose.xyz));
    const sourceWorld = new THREE.Matrix4().copy(fromFrame.matrixWorld).multiply(localMatrix);
    const targetWorldInverse = new THREE.Matrix4().copy(toFrame.matrixWorld).invert();
    const remappedLocal = targetWorldInverse.multiply(sourceWorld);
    return matrixToPose(remappedLocal);
  } catch {
    return pose;
  }
};

export const resolveCameraParentJointObject = (
  robot: URDFRobot | null,
  parentJointName: string
): THREE.Object3D | null => {
  if (!robot) return null;
  const decodedName = safeDecode(parentJointName);
  const jointMap = (robot as URDFRobot & { joints?: Record<string, THREE.Object3D> }).joints ?? {};

  // Prefer explicit URDF joint map for deterministic resolution.
  const fromMaps = jointMap[parentJointName] ?? jointMap[decodedName] ?? null;
  if (fromMaps) return fromMaps;

  // Fallback: search by object name and prefer URDF joints over generic children.
  const matches: THREE.Object3D[] = [];
  const collectByName = (name: string) => {
    robot.traverse?.((node) => {
      if (node.name === name) matches.push(node);
    });
  };
  collectByName(parentJointName);
  if (decodedName !== parentJointName) collectByName(decodedName);
  const preferred =
    matches.find((node) => (node as THREE.Object3D & { isURDFJoint?: boolean }).isURDFJoint) ??
    matches[0] ??
    null;

  if (preferred) return preferred;

  return (
    robot.getObjectByName?.(parentJointName) ??
    (decodedName !== parentJointName ? robot.getObjectByName?.(decodedName) : null) ??
    null
  );
};

export const resolveCameraParentLinkNameFromJoint = (
  robot: URDFRobot | null,
  parentJointName: string
): string | null => {
  const jointObject = resolveCameraParentJointObject(robot, parentJointName) as
    | (THREE.Object3D & { childLink?: string })
    | null;
  if (!jointObject) return null;

  if (typeof jointObject.childLink === "string" && jointObject.childLink.trim()) {
    return jointObject.childLink;
  }

  const linkChild =
    jointObject.children?.find(
      (child) => (child as THREE.Object3D & { isURDFLink?: boolean }).isURDFLink
    ) ?? null;
  if (linkChild?.name) return linkChild.name;

  return null;
};

export const resolveCameraParentJointNameFromLink = (
  robot: URDFRobot | null,
  parentLinkName: string
): string | null => {
  if (!robot || !parentLinkName.trim()) return null;

  const decodedLinkName = safeDecode(parentLinkName);
  const jointMap = (robot as URDFRobot & { joints?: Record<string, THREE.Object3D> }).joints ?? {};

  const matchesLinkName = (candidate?: string | null) => {
    if (!candidate) return false;
    const decodedCandidate = safeDecode(candidate);
    return (
      candidate === parentLinkName ||
      candidate === decodedLinkName ||
      decodedCandidate === parentLinkName ||
      decodedCandidate === decodedLinkName
    );
  };

  for (const [jointName, jointObject] of Object.entries(jointMap)) {
    if (matchesLinkName(jointName)) {
      return jointName;
    }
    const childLinkName =
      (jointObject as THREE.Object3D & { childLink?: string }).childLink ?? null;
    if (matchesLinkName(childLinkName)) {
      return jointName;
    }
    const childLinkObject = jointObject.children?.find(
      (child) => (child as THREE.Object3D & { isURDFLink?: boolean }).isURDFLink
    );
    if (matchesLinkName(childLinkObject?.name)) {
      return jointName;
    }
  }

  return null;
};

export const remapCameraPoseBetweenParentLinks = (
  robot: URDFRobot | null,
  fromParentLinkName: string,
  toParentLinkName: string,
  pose: { xyz: [number, number, number]; rpy: [number, number, number] }
) => {
  if (!robot || fromParentLinkName === toParentLinkName) return pose;
  return remapPoseBetweenFrames(
    resolveNamedParentLinkObject(robot, fromParentLinkName),
    resolveNamedParentLinkObject(robot, toParentLinkName),
    pose
  );
};

export const remapCameraPoseBetweenParentJoints = (
  robot: URDFRobot | null,
  fromParentJointName: string,
  toParentJointName: string,
  pose: CameraPose
) => {
  if (!robot || fromParentJointName === toParentJointName) return pose;
  return remapPoseBetweenFrames(
    resolveCameraParentJointObject(robot, fromParentJointName),
    resolveCameraParentJointObject(robot, toParentJointName),
    pose
  );
};

export const remapCameraPoseToParentJointFrame = (
  robot: URDFRobot | null,
  parentJointName: string,
  fromParentLinkName: string,
  pose: { xyz: [number, number, number]; rpy: [number, number, number] }
) => {
  if (!robot || !parentJointName.trim() || !fromParentLinkName.trim()) return pose;
  return remapPoseBetweenFrames(
    resolveNamedParentLinkObject(robot, fromParentLinkName),
    resolveCameraParentJointObject(robot, parentJointName),
    pose
  );
};

export const getCameraWorldPose = (
  robot: URDFRobot | null,
  cameraConfig: CameraPoseConfig,
  options: CameraWorldPoseOptions = {}
) => {
  if (options.updateRobotWorld) {
    robot?.updateMatrixWorld?.(true);
  }

  const localPosition = new THREE.Vector3(...cameraConfig.pose.xyz);
  const localQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(...cameraConfig.pose.rpy, RPY_ORDER)
  );
  const parentJoint = resolveCameraParentJointObject(robot, cameraConfig.parent_joint);
  if (!parentJoint) {
    return { position: localPosition, quaternion: localQuaternion };
  }

  const parentPosition = new THREE.Vector3();
  const parentQuaternion = new THREE.Quaternion();
  parentJoint.matrixWorld.decompose(parentPosition, parentQuaternion, new THREE.Vector3());

  // Camera pose should follow rigid parent transforms; ignore parent scale/shear.
  const position = localPosition.clone().applyQuaternion(parentQuaternion).add(parentPosition);
  const quaternion = parentQuaternion.clone().multiply(localQuaternion);

  return { position, quaternion };
};

type PoseSnapshot = {
  xyz: [number, number, number];
  rpy: [number, number, number];
};

type WorldPoseSnapshot = PoseSnapshot & {
  quaternion_xyzw: [number, number, number, number];
};

type TransformToleranceSnapshot = {
  position_m: number;
  angle_deg: number;
};

type SensorLike = {
  name?: unknown;
  type?: unknown;
  linkName?: unknown;
  origin?: unknown;
};

type NormalizedSensor = {
  name: string;
  type: string;
  linkName: string;
  origin: CameraPose | null;
};

const toRounded = (value: number): number =>
  Number(value.toFixed(CAMERA_TRANSFORM_OUTPUT_PRECISION));

const toPoseSnapshot = (pose: CameraPose): PoseSnapshot => ({
  xyz: [toRounded(pose.xyz[0]), toRounded(pose.xyz[1]), toRounded(pose.xyz[2])],
  rpy: [toRounded(pose.rpy[0]), toRounded(pose.rpy[1]), toRounded(pose.rpy[2])],
});

const toWorldPoseSnapshot = (
  position: THREE.Vector3,
  quaternion: THREE.Quaternion
): WorldPoseSnapshot => {
  const euler = new THREE.Euler().setFromQuaternion(quaternion, RPY_ORDER);
  return {
    xyz: [toRounded(position.x), toRounded(position.y), toRounded(position.z)],
    rpy: [toRounded(euler.x), toRounded(euler.y), toRounded(euler.z)],
    quaternion_xyzw: [
      toRounded(quaternion.x),
      toRounded(quaternion.y),
      toRounded(quaternion.z),
      toRounded(quaternion.w),
    ],
  };
};

const normalizeSensor = (value: unknown): NormalizedSensor | null => {
  if (!value || typeof value !== "object") return null;
  const sensor = value as SensorLike;
  const linkName =
    typeof sensor.linkName === "string" && sensor.linkName.trim() ? sensor.linkName.trim() : "";
  if (!linkName) return null;
  return {
    name: typeof sensor.name === "string" ? sensor.name.trim() : "",
    type: typeof sensor.type === "string" ? sensor.type.trim() : "",
    linkName,
    origin: toSafePose(sensor.origin),
  };
};

const isCameraSensorType = (sensorType: string) => /camera/i.test(sensorType);

const sameName = (lhs: string | null, rhs: string | null) => {
  if (!lhs || !rhs) return false;
  const lhsDecoded = safeDecode(lhs);
  const rhsDecoded = safeDecode(rhs);
  return (
    lhs === rhs ||
    lhs === rhsDecoded ||
    lhsDecoded === rhs ||
    lhsDecoded === rhsDecoded
  );
};

const resolveMatchingSensor = (
  sensors: readonly unknown[],
  cameraLinkName: string | null
): NormalizedSensor | null => {
  if (!cameraLinkName) return null;
  const normalizedSensors = sensors
    .map((entry) => normalizeSensor(entry))
    .filter((entry): entry is NormalizedSensor => Boolean(entry));
  const exactCameraSensor =
    normalizedSensors.find(
      (entry) => sameName(entry.linkName, cameraLinkName) && isCameraSensorType(entry.type)
    ) ?? null;
  if (exactCameraSensor) return exactCameraSensor;
  return normalizedSensors.find((entry) => sameName(entry.linkName, cameraLinkName)) ?? null;
};

export type CameraTransformDebugReport = {
  camera_id: string | null;
  camera_name: string | null;
  parent_joint: string;
  parent_joint_found: boolean;
  parent_link: string | null;
  sensor_name: string | null;
  sensor_type: string | null;
  sensor_link: string | null;
  camera_pose_joint_frame: PoseSnapshot;
  sensor_pose_link_frame: PoseSnapshot | null;
  sensor_pose_joint_frame: PoseSnapshot | null;
  camera_world_pose: WorldPoseSnapshot;
  sensor_world_pose: WorldPoseSnapshot | null;
  position_delta_m: number | null;
  angle_delta_deg: number | null;
  within_tolerance: boolean | null;
  tolerance: TransformToleranceSnapshot;
  issues: string[];
};

type CameraDebugConfig = CameraPoseConfig & {
  id?: string;
  name?: string;
};

export const buildCameraTransformDebugReport = (
  robot: URDFRobot | null,
  cameraConfig: CameraDebugConfig,
  sensors: readonly unknown[] = []
): CameraTransformDebugReport => {
  const issues: string[] = [];
  const tolerance = {
    position_m: CAMERA_TRANSFORM_POSITION_TOLERANCE_M,
    angle_deg: CAMERA_TRANSFORM_ANGLE_TOLERANCE_DEG,
  };

  const parentJoint = resolveCameraParentJointObject(robot, cameraConfig.parent_joint);
  if (!parentJoint) {
    issues.push(`Parent joint not found: ${cameraConfig.parent_joint}`);
  }
  const parentLinkName = resolveCameraParentLinkNameFromJoint(robot, cameraConfig.parent_joint);
  if (!parentLinkName) {
    issues.push(`Parent link not resolved for joint: ${cameraConfig.parent_joint}`);
  }

  const matchingSensor = resolveMatchingSensor(sensors, parentLinkName);
  if (!matchingSensor) {
    issues.push("No sensor matched parent link.");
  } else if (!matchingSensor.origin) {
    issues.push(`Matched sensor has no origin pose: ${matchingSensor.name || matchingSensor.linkName}`);
  }

  const cameraWorld = getCameraWorldPose(robot, cameraConfig, { updateRobotWorld: true });
  const report: CameraTransformDebugReport = {
    camera_id: cameraConfig.id ?? null,
    camera_name: cameraConfig.name ?? null,
    parent_joint: cameraConfig.parent_joint,
    parent_joint_found: Boolean(parentJoint),
    parent_link: parentLinkName,
    sensor_name: matchingSensor?.name || null,
    sensor_type: matchingSensor?.type || null,
    sensor_link: matchingSensor?.linkName || null,
    camera_pose_joint_frame: toPoseSnapshot(cameraConfig.pose),
    sensor_pose_link_frame: matchingSensor?.origin ? toPoseSnapshot(matchingSensor.origin) : null,
    sensor_pose_joint_frame: null,
    camera_world_pose: toWorldPoseSnapshot(cameraWorld.position, cameraWorld.quaternion),
    sensor_world_pose: null,
    position_delta_m: null,
    angle_delta_deg: null,
    within_tolerance: null,
    tolerance,
    issues,
  };

  if (matchingSensor?.origin && matchingSensor.linkName) {
    const sensorJointPose = remapCameraPoseToParentJointFrame(
      robot,
      cameraConfig.parent_joint,
      matchingSensor.linkName,
      matchingSensor.origin
    );
    report.sensor_pose_joint_frame = toPoseSnapshot(sensorJointPose);

    const sensorWorld = getCameraWorldPose(
      robot,
      {
        parent_joint: cameraConfig.parent_joint,
        pose: sensorJointPose,
      },
      { updateRobotWorld: false }
    );
    report.sensor_world_pose = toWorldPoseSnapshot(sensorWorld.position, sensorWorld.quaternion);
    const positionDelta = cameraWorld.position.distanceTo(sensorWorld.position);
    const angleDeltaDeg = cameraWorld.quaternion.angleTo(sensorWorld.quaternion) * DEG_PER_RAD;
    report.position_delta_m = toRounded(positionDelta);
    report.angle_delta_deg = toRounded(angleDeltaDeg);
    report.within_tolerance =
      positionDelta <= CAMERA_TRANSFORM_POSITION_TOLERANCE_M &&
      angleDeltaDeg <= CAMERA_TRANSFORM_ANGLE_TOLERANCE_DEG;
  }

  return report;
};
