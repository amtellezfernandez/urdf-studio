import * as THREE from "three";
import { applyStudioCameraToThreeViewQuaternion } from "./cameraFrameTransform";
import { CAMERA_ORIENTATION_DOT_EPSILON_STRICT } from "./cameraAutoGenerationParams";

const STUDIO_CAMERA_FORWARD_LOCAL = new THREE.Vector3(1, 0, 0);
const THREE_VIEW_FORWARD_LOCAL = new THREE.Vector3(0, 0, -1);

export type CameraFrontAlignmentReport = {
  aligned: boolean;
  dot: number;
};

export const getThreeViewForwardLocal = () => THREE_VIEW_FORWARD_LOCAL.clone();

export const toThreeViewQuaternionFromStudioCamera = (studioQuaternion: THREE.Quaternion) =>
  applyStudioCameraToThreeViewQuaternion(studioQuaternion).normalize();

export const getWorldForwardFromStudioCameraQuaternion = (studioQuaternion: THREE.Quaternion) =>
  STUDIO_CAMERA_FORWARD_LOCAL.clone().applyQuaternion(studioQuaternion).normalize();

export const getWorldForwardFromThreeViewQuaternion = (displayQuaternion: THREE.Quaternion) =>
  getThreeViewForwardLocal().applyQuaternion(displayQuaternion).normalize();

export const evaluateCameraFrontAlignment = (
  studioQuaternion: THREE.Quaternion,
  displayQuaternion: THREE.Quaternion,
  epsilonDot = CAMERA_ORIENTATION_DOT_EPSILON_STRICT
): CameraFrontAlignmentReport => {
  const studioForward = getWorldForwardFromStudioCameraQuaternion(studioQuaternion);
  const displayForward = getWorldForwardFromThreeViewQuaternion(displayQuaternion);
  const dot = studioForward.dot(displayForward);
  return {
    aligned: dot >= epsilonDot,
    dot,
  };
};
