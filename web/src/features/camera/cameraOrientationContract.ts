import * as THREE from "three";
import { applyUrdfCameraToThreeViewQuaternion } from "./cameraFrameTransform";
import { CAMERA_ORIENTATION_DOT_EPSILON_STRICT } from "./cameraAutoGenerationParams";

const URDF_CAMERA_FORWARD_LOCAL = new THREE.Vector3(1, 0, 0);
const THREE_VIEW_FORWARD_LOCAL = new THREE.Vector3(0, 0, -1);

export type CameraFrontAlignmentReport = {
  aligned: boolean;
  dot: number;
};

const getUrdfCameraForwardLocal = () => URDF_CAMERA_FORWARD_LOCAL.clone();

export const getThreeViewForwardLocal = () => THREE_VIEW_FORWARD_LOCAL.clone();

export const toThreeViewQuaternionFromUrdf = (urdfQuaternion: THREE.Quaternion) =>
  applyUrdfCameraToThreeViewQuaternion(urdfQuaternion).normalize();

export const getWorldForwardFromUrdfQuaternion = (urdfQuaternion: THREE.Quaternion) =>
  getUrdfCameraForwardLocal().applyQuaternion(urdfQuaternion).normalize();

export const getWorldForwardFromThreeViewQuaternion = (displayQuaternion: THREE.Quaternion) =>
  getThreeViewForwardLocal().applyQuaternion(displayQuaternion).normalize();

export const evaluateCameraFrontAlignment = (
  urdfQuaternion: THREE.Quaternion,
  displayQuaternion: THREE.Quaternion,
  epsilonDot = CAMERA_ORIENTATION_DOT_EPSILON_STRICT
): CameraFrontAlignmentReport => {
  const urdfForward = getWorldForwardFromUrdfQuaternion(urdfQuaternion);
  const displayForward = getWorldForwardFromThreeViewQuaternion(displayQuaternion);
  const dot = urdfForward.dot(displayForward);
  return {
    aligned: dot >= epsilonDot,
    dot,
  };
};
