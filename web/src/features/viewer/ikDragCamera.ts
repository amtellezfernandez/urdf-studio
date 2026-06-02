import * as THREE from "three";

const copyCommonCameraState = <T extends THREE.Camera>(target: T, source: THREE.Camera): T => {
  target.position.copy(source.position);
  target.quaternion.copy(source.quaternion);
  target.scale.copy(source.scale);
  target.up.copy(source.up);
  target.matrix.copy(source.matrix);
  target.matrixWorld.copy(source.matrixWorld);
  target.matrixWorldInverse.copy(source.matrixWorldInverse);
  target.projectionMatrix.copy(source.projectionMatrix);
  target.projectionMatrixInverse.copy(source.projectionMatrixInverse);
  target.matrixAutoUpdate = false;
  target.matrixWorldAutoUpdate = false;
  return target;
};

export const cloneIkDragReferenceCamera = (camera: THREE.Camera): THREE.Camera => {
  if (camera instanceof THREE.OrthographicCamera) {
    return copyCommonCameraState(
      new THREE.OrthographicCamera(
        camera.left,
        camera.right,
        camera.top,
        camera.bottom,
        camera.near,
        camera.far
      ),
      camera
    );
  }

  if (camera instanceof THREE.PerspectiveCamera) {
    const clone = new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
    clone.zoom = camera.zoom;
    clone.focus = camera.focus;
    clone.filmGauge = camera.filmGauge;
    clone.filmOffset = camera.filmOffset;
    clone.view = camera.view ? { ...camera.view } : null;
    return copyCommonCameraState(clone, camera);
  }

  return copyCommonCameraState(new THREE.Camera(), camera);
};
