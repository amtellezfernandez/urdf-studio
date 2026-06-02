import * as THREE from "three";
import {
  OPERATOR_POINT_CLOUD_GRAVITY_MIN_NORM,
  OPERATOR_POINT_CLOUD_HF_GRAVITY_TARGET_Y,
  OPERATOR_POINT_CLOUD_HF_GRAVITY_YAW_AXIS,
  OPERATOR_POINT_CLOUD_HF_X_AXIS_IN_URDF_Z_UP,
  OPERATOR_POINT_CLOUD_HF_Y_AXIS_IN_URDF_Z_UP,
  OPERATOR_POINT_CLOUD_HF_Z_AXIS_IN_URDF_Z_UP,
} from "@/features/teleop/params/operatorTeleopParams";
import type { OperatorPointCloudFrame } from "@/features/teleop/transport/operatorHelperApi";

export type OperatorPointCloudPoseTransform = {
  position: [number, number, number];
  quaternion: THREE.Quaternion;
  pointScale: number;
};

const hfYUpToUrdfZUpBasis = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(...OPERATOR_POINT_CLOUD_HF_X_AXIS_IN_URDF_Z_UP),
  new THREE.Vector3(...OPERATOR_POINT_CLOUD_HF_Y_AXIS_IN_URDF_Z_UP),
  new THREE.Vector3(...OPERATOR_POINT_CLOUD_HF_Z_AXIS_IN_URDF_Z_UP),
);
const hfYUpToUrdfZUpQuaternion = new THREE.Quaternion()
  .setFromRotationMatrix(hfYUpToUrdfZUpBasis)
  .normalize();
const hfGravityTarget = new THREE.Vector3(...OPERATOR_POINT_CLOUD_HF_GRAVITY_TARGET_Y);
const hfGravityYawAxis = new THREE.Vector3(...OPERATOR_POINT_CLOUD_HF_GRAVITY_YAW_AXIS);

const buildHfCameraQuaternion = (rotationRpyDeg: [number, number, number]): THREE.Quaternion => {
  const [rollDeg, pitchDeg, yawDeg] = rotationRpyDeg;
  const rotation = new THREE.Matrix4()
    .makeRotationY(THREE.MathUtils.degToRad(yawDeg))
    .multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(rollDeg)))
    .multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(pitchDeg)));
  return new THREE.Quaternion().setFromRotationMatrix(rotation).normalize();
};

const buildUrdfCameraQuaternion = (rotationRpyDeg: [number, number, number]): THREE.Quaternion => {
  const [rollDeg, pitchDeg, yawDeg] = rotationRpyDeg;
  return new THREE.Quaternion()
    .setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(rollDeg),
        THREE.MathUtils.degToRad(pitchDeg),
        THREE.MathUtils.degToRad(yawDeg),
        "XYZ",
      ),
    )
    .normalize();
};

const buildHfGravityCameraQuaternion = (
  rotationRpyDeg: [number, number, number],
  gravity: [number, number, number] | undefined
): THREE.Quaternion | null => {
  if (!gravity) return null;
  const [x, y, z] = gravity;
  const norm = Math.sqrt(x * x + y * y + z * z);
  if (norm <= OPERATOR_POINT_CLOUD_GRAVITY_MIN_NORM) return null;
  const gravityDirection = new THREE.Vector3(x / norm, y / norm, -z / norm);
  const gravityAlignment = new THREE.Quaternion().setFromUnitVectors(
    gravityDirection,
    hfGravityTarget
  );
  const yaw = THREE.MathUtils.degToRad(rotationRpyDeg[2]);
  const yawRotation = new THREE.Quaternion().setFromAxisAngle(hfGravityYawAxis, yaw);
  return yawRotation.multiply(gravityAlignment).normalize();
};

const toUrdfZUpPosition = (position: [number, number, number]): [number, number, number] => {
  const transformed = new THREE.Vector3(...position).applyMatrix4(hfYUpToUrdfZUpBasis);
  return [transformed.x, transformed.y, transformed.z];
};

export const buildOperatorPointCloudPoseTransform = (
  cameraPose: NonNullable<OperatorPointCloudFrame["cameraPose"]>,
): OperatorPointCloudPoseTransform => {
  const baseQuaternion =
    cameraPose.worldFrame === "hf_y_up"
      ? (cameraPose.useGravityOrientation
          ? buildHfGravityCameraQuaternion(
              cameraPose.rotationRpyDeg,
              cameraPose.gravity,
            )
          : null) ??
        buildHfCameraQuaternion(cameraPose.rotationRpyDeg)
      : buildUrdfCameraQuaternion(cameraPose.rotationRpyDeg);
  const transform =
    cameraPose.worldFrame !== "hf_y_up"
      ? {
          position: cameraPose.position,
          quaternion: baseQuaternion,
          pointScale: cameraPose.scale,
        }
      : {
          position: toUrdfZUpPosition(cameraPose.position),
          quaternion: hfYUpToUrdfZUpQuaternion.clone().multiply(baseQuaternion).normalize(),
          pointScale: cameraPose.scale,
        };

  return transform;
};
