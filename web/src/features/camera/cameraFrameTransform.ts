import * as THREE from "three";

const STUDIO_CAMERA_TO_THREE_VIEW_QUATERNION = new THREE.Quaternion()
  .setFromRotationMatrix(
    new THREE.Matrix4().set(
      0, 0, -1, 0,
      -1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 0, 1
    )
  )
  .normalize();

const STUDIO_CAMERA_TO_THREE_VIEW_EULER: [number, number, number] = (() => {
  const euler = new THREE.Euler().setFromQuaternion(
    STUDIO_CAMERA_TO_THREE_VIEW_QUATERNION,
    "XYZ"
  );
  return [euler.x, euler.y, euler.z];
})();

export function getStudioCameraToThreeViewEuler(): [number, number, number] {
  return [
    STUDIO_CAMERA_TO_THREE_VIEW_EULER[0],
    STUDIO_CAMERA_TO_THREE_VIEW_EULER[1],
    STUDIO_CAMERA_TO_THREE_VIEW_EULER[2],
  ];
}

export function applyStudioCameraToThreeViewQuaternion(
  baseQuaternion: THREE.Quaternion
): THREE.Quaternion {
  return baseQuaternion.clone().multiply(STUDIO_CAMERA_TO_THREE_VIEW_QUATERNION);
}
