import * as THREE from "three";

const URDF_CAMERA_TO_THREE_VIEW_QUATERNION = new THREE.Quaternion()
  .setFromRotationMatrix(
    new THREE.Matrix4().set(
      0, 0, -1, 0,
      -1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 0, 1
    )
  )
  .normalize();

const URDF_CAMERA_TO_THREE_VIEW_EULER: [number, number, number] = (() => {
  const euler = new THREE.Euler().setFromQuaternion(
    URDF_CAMERA_TO_THREE_VIEW_QUATERNION,
    "XYZ"
  );
  return [euler.x, euler.y, euler.z];
})();

export const getUrdfCameraToThreeViewEuler = (): [number, number, number] => [
  URDF_CAMERA_TO_THREE_VIEW_EULER[0],
  URDF_CAMERA_TO_THREE_VIEW_EULER[1],
  URDF_CAMERA_TO_THREE_VIEW_EULER[2],
];

export const applyUrdfCameraToThreeViewQuaternion = (
  baseQuaternion: THREE.Quaternion
): THREE.Quaternion => baseQuaternion.clone().multiply(URDF_CAMERA_TO_THREE_VIEW_QUATERNION);
