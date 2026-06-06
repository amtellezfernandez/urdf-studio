import * as THREE from "three";

export type CameraControlsLike = {
  target?: THREE.Vector3;
  update?: () => void;
};

export const fitCameraToBounds = ({
  bounds,
  camera,
  controls,
  invalidate,
}: {
  bounds: THREE.Box3;
  camera: THREE.Camera;
  controls?: CameraControlsLike;
  invalidate: () => void;
}) => {
  if (bounds.isEmpty() || !(camera instanceof THREE.PerspectiveCamera)) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() * 0.5, 1);
  const distance = Math.max(radius * 2.2, 4);
  const direction = new THREE.Vector3(0.75, -0.9, 0.45).normalize();

  camera.near = Math.max(0.01, radius / 1000);
  camera.far = Math.max(1000, radius * 20);
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  controls?.target?.copy(center);
  controls?.update?.();
  invalidate();
};
