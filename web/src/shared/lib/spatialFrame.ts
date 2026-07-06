import * as THREE from "three";
import { toFiniteNumberOrFallback } from "@/shared/lib/numeric";

// URDF rpy follows fixed-axis roll(X)-pitch(Y)-yaw(Z), which maps to intrinsic ZYX in Three.js.
const URDF_RPY_ORDER: THREE.EulerOrder = "ZYX";
export const URDF_CYLINDER_TO_THREE_AXIS_QUATERNION = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI / 2
);

export type RigidFrame = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  inverseQuaternion: THREE.Quaternion;
};

export type UrdfPoseMatrixParams = {
  xyz: [number, number, number];
  rpy: [number, number, number];
  scale?: [number, number, number];
  extraRotation?: THREE.Quaternion | null;
  centerOffset?: THREE.Vector3 | null;
};

const DEFAULT_SCALE: [number, number, number] = [1, 1, 1];
const MATRIX_DECOMPOSE_SCALE = new THREE.Vector3();
const URDF_TEMP_POSITION = new THREE.Vector3();
const URDF_TEMP_EULER = new THREE.Euler(0, 0, 0, URDF_RPY_ORDER);
const URDF_TEMP_ROTATION = new THREE.Quaternion();
const URDF_TEMP_SCALE = new THREE.Vector3(1, 1, 1);
const URDF_TEMP_CENTER_OFFSET = new THREE.Vector3();

export const createIdentityRigidFrame = (): RigidFrame => ({
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  inverseQuaternion: new THREE.Quaternion(),
});

export const updateRigidFrameFromMatrixWorld = (
  matrixWorld: THREE.Matrix4,
  out: RigidFrame
): RigidFrame => {
  matrixWorld.decompose(out.position, out.quaternion, MATRIX_DECOMPOSE_SCALE);
  out.quaternion.normalize();
  out.inverseQuaternion.copy(out.quaternion).invert();
  return out;
};

export const worldToLocalPositionInFrame = (
  frame: RigidFrame,
  worldPosition: THREE.Vector3,
  out: THREE.Vector3
): THREE.Vector3 => {
  return out
    .copy(worldPosition)
    .sub(frame.position)
    .applyQuaternion(frame.inverseQuaternion);
};

export const localToWorldPositionInFrame = (
  frame: RigidFrame,
  localPosition: THREE.Vector3,
  out: THREE.Vector3
): THREE.Vector3 => {
  return out
    .copy(localPosition)
    .applyQuaternion(frame.quaternion)
    .add(frame.position);
};

export const worldToLocalQuaternionInFrame = (
  frame: RigidFrame,
  worldQuaternion: THREE.Quaternion,
  out: THREE.Quaternion
): THREE.Quaternion => {
  return out.copy(frame.inverseQuaternion).multiply(worldQuaternion).normalize();
};

export const localToWorldQuaternionInFrame = (
  frame: RigidFrame,
  localQuaternion: THREE.Quaternion,
  out: THREE.Quaternion
): THREE.Quaternion => {
  return out.copy(frame.quaternion).multiply(localQuaternion).normalize();
};

export const composeUrdfPoseMatrix = (
  params: UrdfPoseMatrixParams,
  out: THREE.Matrix4
): THREE.Matrix4 => {
  const { xyz, rpy, centerOffset } = params;
  const scaleValues = params.scale ?? DEFAULT_SCALE;

  URDF_TEMP_POSITION.set(
    toFiniteNumberOrFallback(xyz[0], 0),
    toFiniteNumberOrFallback(xyz[1], 0),
    toFiniteNumberOrFallback(xyz[2], 0)
  );

  URDF_TEMP_EULER.set(
    toFiniteNumberOrFallback(rpy[0], 0),
    toFiniteNumberOrFallback(rpy[1], 0),
    toFiniteNumberOrFallback(rpy[2], 0),
    URDF_RPY_ORDER
  );
  URDF_TEMP_ROTATION.setFromEuler(URDF_TEMP_EULER);
  if (params.extraRotation) {
    URDF_TEMP_ROTATION.multiply(params.extraRotation);
  }

  URDF_TEMP_SCALE.set(
    toFiniteNumberOrFallback(scaleValues[0], 1),
    toFiniteNumberOrFallback(scaleValues[1], 1),
    toFiniteNumberOrFallback(scaleValues[2], 1)
  );

  if (centerOffset) {
    URDF_TEMP_CENTER_OFFSET.copy(centerOffset).applyQuaternion(URDF_TEMP_ROTATION);
    URDF_TEMP_POSITION.add(URDF_TEMP_CENTER_OFFSET);
  }

  out.compose(URDF_TEMP_POSITION, URDF_TEMP_ROTATION, URDF_TEMP_SCALE);
  return out;
};

export const composeWorldMatrixFromLinkAndLocal = (
  linkMatrixWorld: THREE.Matrix4,
  localMatrix: THREE.Matrix4,
  out: THREE.Matrix4
): THREE.Matrix4 => out.multiplyMatrices(linkMatrixWorld, localMatrix);
