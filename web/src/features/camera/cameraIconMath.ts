import * as THREE from "three";
import type { CameraIntrinsics } from "@/shared/types/camera";
import { normalizeCameraIntrinsics } from "@/shared/lib/cameraIntrinsics";
import { toThreeViewQuaternionFromUrdf } from "@/features/camera/cameraOrientationContract";
import {
  CAMERA_ICON_FRUSTUM_FAR_M,
  CAMERA_ICON_FRUSTUM_NEAR_M,
  CAMERA_ICON_LENS_OFFSET_M,
  CAMERA_ICON_LEVELING_UP_PARALLEL_DOT,
  CAMERA_ICON_LENS_ROTATION_RAD,
} from "@/features/camera/cameraIconParams";
import { getThreeViewForwardLocal } from "@/features/camera/cameraOrientationContract";

export const toCameraIconDisplayQuaternion = (cameraQuaternion: THREE.Quaternion) =>
  toThreeViewQuaternionFromUrdf(cameraQuaternion);

const WORLD_UP_AXIS = new THREE.Vector3(0, 0, 1);
const WORLD_UP_FALLBACK_AXIS = new THREE.Vector3(0, 1, 0);
const THREE_VIEW_UP_LOCAL = new THREE.Vector3(0, 1, 0);
const THREE_VIEW_FORWARD_LOCAL = new THREE.Vector3(0, 0, -1);

export const toLeveledCameraIconDisplayQuaternion = (
  cameraQuaternion: THREE.Quaternion
) => {
  const displayQuaternion = toCameraIconDisplayQuaternion(cameraQuaternion);
  const worldForward = THREE_VIEW_FORWARD_LOCAL.clone()
    .applyQuaternion(displayQuaternion)
    .normalize();
  const worldZAxis = worldForward.clone().multiplyScalar(-1);

  const upReference =
    Math.abs(worldForward.dot(WORLD_UP_AXIS)) > CAMERA_ICON_LEVELING_UP_PARALLEL_DOT
      ? WORLD_UP_FALLBACK_AXIS
      : WORLD_UP_AXIS;
  const worldRight = new THREE.Vector3()
    .crossVectors(upReference, worldZAxis)
    .normalize();
  if (!Number.isFinite(worldRight.lengthSq()) || worldRight.lengthSq() <= 0) {
    return displayQuaternion;
  }
  const worldUp = new THREE.Vector3()
    .crossVectors(worldZAxis, worldRight)
    .normalize();
  if (!Number.isFinite(worldUp.lengthSq()) || worldUp.lengthSq() <= 0) {
    return displayQuaternion;
  }

  const leveledMatrix = new THREE.Matrix4().makeBasis(worldRight, worldUp, worldZAxis);
  return new THREE.Quaternion().setFromRotationMatrix(leveledMatrix).normalize();
};

export const toLeveledFrustumLocalQuaternion = (
  cameraQuaternion: THREE.Quaternion
) => {
  const displayQuaternion = toCameraIconDisplayQuaternion(cameraQuaternion);
  const leveledQuaternion = toLeveledCameraIconDisplayQuaternion(cameraQuaternion);
  return displayQuaternion.clone().invert().multiply(leveledQuaternion).normalize();
};

export const getCameraIconFrustumForwardLocal = () => getThreeViewForwardLocal();

export const getCameraIconLensCenterDirectionLocal = () =>
  new THREE.Vector3(...CAMERA_ICON_LENS_OFFSET_M).normalize();

export const getCameraIconLensAxisDirectionLocal = () =>
  new THREE.Vector3(0, 1, 0)
    .applyEuler(new THREE.Euler(...CAMERA_ICON_LENS_ROTATION_RAD, "XYZ"))
    .normalize();

export const createCameraIconFrustumGeometry = (
  intrinsics: CameraIntrinsics,
  near = CAMERA_ICON_FRUSTUM_NEAR_M,
  far = CAMERA_ICON_FRUSTUM_FAR_M
) => {
  const normalized = normalizeCameraIntrinsics(intrinsics);
  const fx = normalized.fx ?? 1;
  const fy = normalized.fy ?? 1;
  const cx = normalized.cx ?? normalized.width * 0.5;
  const cy = normalized.cy ?? normalized.height * 0.5;

  // Match the same pinhole model used by depth unprojection. Off-center
  // principal points shift the image bounds around the optical axis.
  const nearLeft = (-cx * near) / fx;
  const nearRight = ((normalized.width - cx) * near) / fx;
  const nearTop = (cy * near) / fy;
  const nearBottom = (-(normalized.height - cy) * near) / fy;

  const farLeft = (-cx * far) / fx;
  const farRight = ((normalized.width - cx) * far) / fx;
  const farTop = (cy * far) / fy;
  const farBottom = (-(normalized.height - cy) * far) / fy;

  const vertices = new Float32Array([
    nearLeft, nearTop, -near,
    nearRight, nearTop, -near,
    nearRight, nearBottom, -near,
    nearLeft, nearBottom, -near,
    farLeft, farTop, -far,
    farRight, farTop, -far,
    farRight, farBottom, -far,
    farLeft, farBottom, -far,
  ]);

  const indices = new Uint16Array([
    0, 1, 1, 2, 2, 3, 3, 0, // near rectangle
    4, 5, 5, 6, 6, 7, 7, 4, // far rectangle
    0, 4, 1, 5, 2, 6, 3, 7, // near to far (parallel edges)
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
};
