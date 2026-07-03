import * as THREE from "three";
import { resolveMeshPositionGeometry } from "@/features/urdf/mesh/meshObjectGeometry";

export type WorldMeshTriangle = {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
};

export type WorldMeshTriangleCollection = {
  bounds: THREE.Box3 | null;
  triangles: WorldMeshTriangle[];
};

export const collectWorldMeshTriangles = (
  object: THREE.Object3D,
): WorldMeshTriangleCollection => {
  object.updateMatrixWorld(true);
  const triangles: WorldMeshTriangle[] = [];
  const bounds = new THREE.Box3();
  let hasBounds = false;
  const vertexA = new THREE.Vector3();
  const vertexB = new THREE.Vector3();
  const vertexC = new THREE.Vector3();

  object.traverse((child) => {
    const meshGeometry = resolveMeshPositionGeometry(child);
    if (!meshGeometry) return;

    const matrix = meshGeometry.mesh.matrixWorld.clone();
    const pushTriangle = (aIndex: number, bIndex: number, cIndex: number) => {
      const a = vertexA
        .fromBufferAttribute(meshGeometry.position, aIndex)
        .clone()
        .applyMatrix4(matrix);
      const b = vertexB
        .fromBufferAttribute(meshGeometry.position, bIndex)
        .clone()
        .applyMatrix4(matrix);
      const c = vertexC
        .fromBufferAttribute(meshGeometry.position, cIndex)
        .clone()
        .applyMatrix4(matrix);
      triangles.push({ a, b, c });
      bounds.expandByPoint(a);
      bounds.expandByPoint(b);
      bounds.expandByPoint(c);
      hasBounds = true;
    };

    const indexArray = meshGeometry.geometry.getIndex()?.array ?? null;
    const triangleIndexCount =
      indexArray?.length ?? meshGeometry.position.count;
    for (let i = 0; i + 2 < triangleIndexCount; i += 3) {
      pushTriangle(
        indexArray ? (indexArray[i] as number) : i,
        indexArray ? (indexArray[i + 1] as number) : i + 1,
        indexArray ? (indexArray[i + 2] as number) : i + 2,
      );
    }
  });

  return {
    bounds: hasBounds ? bounds : null,
    triangles,
  };
};
