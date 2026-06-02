import * as THREE from "three";

type MatrixScratch = {
  parentWorldInverse: THREE.Matrix4;
  targetLocal: THREE.Matrix4;
};

export const createOverlayTransformScratch = (): MatrixScratch => ({
  parentWorldInverse: new THREE.Matrix4(),
  targetLocal: new THREE.Matrix4(),
});

export const copyWorldMatrixToObjectLocal = (
  target: THREE.Object3D,
  sourceWorldMatrix: THREE.Matrix4,
  scratch: MatrixScratch
) => {
  const parent = target.parent;
  if (!parent) {
    target.matrix.copy(sourceWorldMatrix);
    target.matrixWorldNeedsUpdate = true;
    return;
  }

  parent.updateMatrixWorld(true);
  scratch.parentWorldInverse.copy(parent.matrixWorld).invert();
  scratch.targetLocal
    .copy(scratch.parentWorldInverse)
    .multiply(sourceWorldMatrix);
  target.matrix.copy(scratch.targetLocal);
  target.matrixWorldNeedsUpdate = true;
};
