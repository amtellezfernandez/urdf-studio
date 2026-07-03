import * as THREE from "three";

export type MeshPositionGeometry = {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  position: THREE.BufferAttribute;
};

export const resolveMeshPositionGeometry = (
  object: THREE.Object3D,
): MeshPositionGeometry | null => {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) return null;
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  const position = geometry?.getAttribute("position") as
    THREE.BufferAttribute | undefined;
  if (!geometry || !position || position.itemSize < 3) return null;
  return { mesh, geometry, position };
};
