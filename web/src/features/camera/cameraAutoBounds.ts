import * as THREE from "three";
import {
  CAMERA_AUTO_CENTROID_MIN_TOTAL_SIGNED_VOLUME,
  CAMERA_AUTO_CENTROID_MIN_TOTAL_WEIGHT,
  CAMERA_AUTO_CENTROID_MIN_TRIANGLE_AREA,
  CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH,
  CAMERA_AUTO_FRAME_CUE_CONFIDENCE_MIN,
  CAMERA_AUTO_FRAME_CUE_EPSILON,
  CAMERA_AUTO_FRAME_CUE_MIN_PLANAR_VARIANCE,
  CAMERA_AUTO_FRAME_CUE_MIN_POINT_COUNT,
  CAMERA_AUTO_MESH_FRAME_FORWARD_WEIGHT,
  CAMERA_AUTO_MESH_FRAME_MIN_ALIGNMENT,
  CAMERA_AUTO_MESH_FRAME_UP_WEIGHT,
} from "./cameraAutoGenerationParams";
import type { LocalDirectionSample } from "./cameraAutoDirectionSolver";
import {
  resolveDirectionCueFromDirectionSamples,
  resolvePrincipalAxisFromDirectionSamples,
  resolveUpCueFromDirectionSamples,
} from "./cameraAutoDirectionSolver";

type CentroidAccumulator = {
  weightedVolumeCenterSum: THREE.Vector3;
  totalSignedVolume: number;
  weightedCenterSum: THREE.Vector3;
  totalWeight: number;
};

type LocalSurfaceNormalSample = {
  normal: THREE.Vector3;
  area: number;
};

type MeshAxisCandidate = {
  axis: THREE.Vector3;
  weight: number;
};

type MeshBasisCandidate = {
  axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  weight: number;
};

export type LocalCameraFrameCue = {
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  confidence: number;
};

const WORLD_UP_REFERENCE = new THREE.Vector3(0, 0, 1);
const LINK_LOCAL_UP_REFERENCE_FALLBACK = new THREE.Vector3(0, 0, 1);
const FRAME_CUE_BASIS_SEEDS = [
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(1, 0, 0),
] as const;

export const computeLinkLocalWorldUpReference = (linkObject: THREE.Object3D) => {
  linkObject.updateMatrixWorld(true);
  const worldQuaternion = new THREE.Quaternion();
  linkObject.matrixWorld.decompose(
    new THREE.Vector3(),
    worldQuaternion,
    new THREE.Vector3()
  );
  const linkLocalUpReference = WORLD_UP_REFERENCE
    .clone()
    .applyQuaternion(worldQuaternion.invert());
  if (linkLocalUpReference.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) {
    return LINK_LOCAL_UP_REFERENCE_FALLBACK.clone();
  }
  return linkLocalUpReference.normalize();
};

const traverseOwnedLinkNodes = (
  linkObject: THREE.Object3D,
  visitor: (node: THREE.Object3D) => void
) => {
  const traverse = (node: THREE.Object3D) => {
    node.children.forEach((child) => {
      if (child !== linkObject && (child as { isURDFLink?: boolean }).isURDFLink) return;
      visitor(child);
      traverse(child);
    });
  };
  traverse(linkObject);
};

const addMeshBoundsInLinkFrame = (
  meshNode: THREE.Object3D,
  worldToLink: THREE.Matrix4,
  aggregateBounds: THREE.Box3
) => {
  const mesh = meshNode as THREE.Mesh;
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  if (!mesh.isMesh || !geometry) return;
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox();
  }
  if (!geometry.boundingBox) return;

  const nodeToLink = new THREE.Matrix4().copy(worldToLink).multiply(meshNode.matrixWorld);
  const localBounds = geometry.boundingBox.clone().applyMatrix4(nodeToLink);
  if (aggregateBounds.isEmpty()) {
    aggregateBounds.copy(localBounds);
  } else {
    aggregateBounds.union(localBounds);
  }
};

const addMeshSurfaceCentroidInLinkFrame = (
  meshNode: THREE.Object3D,
  worldToLink: THREE.Matrix4,
  accumulator: CentroidAccumulator
) => {
  const mesh = meshNode as THREE.Mesh;
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  const position = geometry?.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!mesh.isMesh || !geometry || !position || position.itemSize < 3) return;

  const nodeToLink = new THREE.Matrix4().copy(worldToLink).multiply(meshNode.matrixWorld);
  const index = geometry.getIndex();
  const vertexA = new THREE.Vector3();
  const vertexB = new THREE.Vector3();
  const vertexC = new THREE.Vector3();
  const edgeAB = new THREE.Vector3();
  const edgeAC = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const triangleCentroid = new THREE.Vector3();
  const tetraCentroid = new THREE.Vector3();
  const volumeCross = new THREE.Vector3();

  const addTriangle = (indexA: number, indexB: number, indexC: number) => {
    vertexA.fromBufferAttribute(position, indexA).applyMatrix4(nodeToLink);
    vertexB.fromBufferAttribute(position, indexB).applyMatrix4(nodeToLink);
    vertexC.fromBufferAttribute(position, indexC).applyMatrix4(nodeToLink);
    edgeAB.subVectors(vertexB, vertexA);
    edgeAC.subVectors(vertexC, vertexA);
    const area = cross.crossVectors(edgeAB, edgeAC).length() * 0.5;
    if (area < CAMERA_AUTO_CENTROID_MIN_TRIANGLE_AREA) return;

    triangleCentroid.copy(vertexA).add(vertexB).add(vertexC).multiplyScalar(1 / 3);
    accumulator.weightedCenterSum.addScaledVector(triangleCentroid, area);
    accumulator.totalWeight += area;

    const signedVolume = vertexA.dot(volumeCross.crossVectors(vertexB, vertexC)) / 6;
    if (!Number.isFinite(signedVolume)) return;
    tetraCentroid.copy(vertexA).add(vertexB).add(vertexC).multiplyScalar(0.25);
    accumulator.weightedVolumeCenterSum.addScaledVector(tetraCentroid, signedVolume);
    accumulator.totalSignedVolume += signedVolume;
  };

  if (index) {
    const indexArray = index.array;
    for (let i = 0; i + 2 < indexArray.length; i += 3) {
      addTriangle(
        indexArray[i] as number,
        indexArray[i + 1] as number,
        indexArray[i + 2] as number
      );
    }
    return;
  }

  for (let i = 0; i + 2 < position.count; i += 3) {
    addTriangle(i, i + 1, i + 2);
  }
};

const traverseMeshVerticesInLinkFrame = (
  meshNode: THREE.Object3D,
  worldToLink: THREE.Matrix4,
  visitor: (vertexInLinkFrame: THREE.Vector3) => void
) => {
  const mesh = meshNode as THREE.Mesh;
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  const position = geometry?.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!mesh.isMesh || !geometry || !position || position.itemSize < 3) return;

  const nodeToLink = new THREE.Matrix4().copy(worldToLink).multiply(meshNode.matrixWorld);
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i).applyMatrix4(nodeToLink);
    visitor(vertex);
  }
};

const collectOwnedLinkDirectionSamples = (
  linkObject: THREE.Object3D,
  localCenter: THREE.Vector3
): LocalDirectionSample[] => {
  linkObject.updateMatrixWorld(true);
  const worldToLink = new THREE.Matrix4().copy(linkObject.matrixWorld).invert();
  const samples: LocalDirectionSample[] = [];
  const relative = new THREE.Vector3();

  traverseOwnedLinkNodes(linkObject, (node) => {
    traverseMeshVerticesInLinkFrame(node, worldToLink, (vertexInLinkFrame) => {
      relative.subVectors(vertexInLinkFrame, localCenter);
      const distance = relative.length();
      if (distance < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) return;
      samples.push({
        offset: relative.clone(),
        distance,
      });
    });
  });

  return samples;
};

const addMeshSurfaceNormalsInLinkFrame = (
  meshNode: THREE.Object3D,
  worldToLink: THREE.Matrix4,
  samples: LocalSurfaceNormalSample[]
) => {
  const mesh = meshNode as THREE.Mesh;
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  const position = geometry?.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!mesh.isMesh || !geometry || !position || position.itemSize < 3) return;

  const nodeToLink = new THREE.Matrix4().copy(worldToLink).multiply(meshNode.matrixWorld);
  const index = geometry.getIndex();
  const vertexA = new THREE.Vector3();
  const vertexB = new THREE.Vector3();
  const vertexC = new THREE.Vector3();
  const edgeAB = new THREE.Vector3();
  const edgeAC = new THREE.Vector3();
  const normal = new THREE.Vector3();

  const addTriangle = (indexA: number, indexB: number, indexC: number) => {
    vertexA.fromBufferAttribute(position, indexA).applyMatrix4(nodeToLink);
    vertexB.fromBufferAttribute(position, indexB).applyMatrix4(nodeToLink);
    vertexC.fromBufferAttribute(position, indexC).applyMatrix4(nodeToLink);
    edgeAB.subVectors(vertexB, vertexA);
    edgeAC.subVectors(vertexC, vertexA);
    normal.crossVectors(edgeAB, edgeAC);
    const area = normal.length() * 0.5;
    if (area < CAMERA_AUTO_CENTROID_MIN_TRIANGLE_AREA) return;
    samples.push({
      normal: normal.normalize().clone(),
      area,
    });
  };

  if (index) {
    const indexArray = index.array;
    for (let i = 0; i + 2 < indexArray.length; i += 3) {
      addTriangle(
        indexArray[i] as number,
        indexArray[i + 1] as number,
        indexArray[i + 2] as number
      );
    }
    return;
  }

  for (let i = 0; i + 2 < position.count; i += 3) {
    addTriangle(i, i + 1, i + 2);
  }
};

const collectOwnedLinkSurfaceNormalSamples = (linkObject: THREE.Object3D) => {
  linkObject.updateMatrixWorld(true);
  const worldToLink = new THREE.Matrix4().copy(linkObject.matrixWorld).invert();
  const samples: LocalSurfaceNormalSample[] = [];
  traverseOwnedLinkNodes(linkObject, (node) => {
    addMeshSurfaceNormalsInLinkFrame(node, worldToLink, samples);
  });
  return samples;
};

const collectOwnedLinkMeshAxisCandidates = (linkObject: THREE.Object3D) => {
  linkObject.updateMatrixWorld(true);
  const worldToLink = new THREE.Matrix4().copy(linkObject.matrixWorld).invert();
  const candidates: MeshAxisCandidate[] = [];
  const xAxis = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();

  traverseOwnedLinkNodes(linkObject, (node) => {
    const mesh = node as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    if (!mesh.isMesh || !geometry) return;
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }

    const nodeToLink = new THREE.Matrix4().copy(worldToLink).multiply(mesh.matrixWorld);
    nodeToLink.extractBasis(xAxis, yAxis, zAxis);
    const normalizedAxes = [
      xAxis.clone().normalize(),
      yAxis.clone().normalize(),
      zAxis.clone().normalize(),
    ];

    const weight = geometry.boundingBox
      ? geometry.boundingBox.getSize(new THREE.Vector3()).lengthSq()
      : 1;
    normalizedAxes.forEach((axis) => {
      if (axis.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) return;
      candidates.push({ axis, weight });
    });
  });
  return candidates;
};

const collectOwnedLinkMeshBasisCandidates = (linkObject: THREE.Object3D) => {
  linkObject.updateMatrixWorld(true);
  const worldToLink = new THREE.Matrix4().copy(linkObject.matrixWorld).invert();
  const candidates: MeshBasisCandidate[] = [];
  const xAxis = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();

  traverseOwnedLinkNodes(linkObject, (node) => {
    const mesh = node as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    if (!mesh.isMesh || !geometry) return;
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }

    const nodeToLink = new THREE.Matrix4().copy(worldToLink).multiply(mesh.matrixWorld);
    nodeToLink.extractBasis(xAxis, yAxis, zAxis);
    const normalizedAxes: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
      xAxis.clone().normalize(),
      yAxis.clone().normalize(),
      zAxis.clone().normalize(),
    ];
    if (
      normalizedAxes.some(
        (axis) => axis.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH
      )
    ) {
      return;
    }

    const weight = geometry.boundingBox
      ? geometry.boundingBox.getSize(new THREE.Vector3()).lengthSq()
      : 1;
    candidates.push({
      axes: normalizedAxes,
      weight,
    });
  });
  return candidates;
};

const resolveMeshAxisAlignedUpCue = (
  candidates: MeshAxisCandidate[],
  forwardDirection: THREE.Vector3,
  localUpReference: THREE.Vector3
) => {
  if (candidates.length === 0) return null;
  if (forwardDirection.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) return null;
  const forward = forwardDirection.clone().normalize();
  const projectedReference = localUpReference
    .clone()
    .addScaledVector(forward, -localUpReference.dot(forward));
  if (projectedReference.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) return null;
  projectedReference.normalize();

  let bestAxis: THREE.Vector3 | null = null;
  let bestScore = -Infinity;
  candidates.forEach(({ axis, weight }) => {
    const projected = axis
      .clone()
      .addScaledVector(forward, -axis.dot(forward));
    if (projected.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) return;
    projected.normalize();
    const alignment = Math.abs(projected.dot(projectedReference));
    const score = alignment * Math.max(weight, CAMERA_AUTO_FRAME_CUE_EPSILON);
    if (score > bestScore) {
      bestAxis = projected.clone();
      bestScore = score;
    }
  });
  if (!bestAxis) return null;
  if (bestAxis.dot(projectedReference) < 0) {
    bestAxis.multiplyScalar(-1);
  }
  return bestAxis.normalize();
};

const resolveMeshAxisAlignedForwardCue = (
  candidates: MeshAxisCandidate[],
  desiredForwardDirection: THREE.Vector3
) => {
  if (candidates.length === 0) return null;
  if (desiredForwardDirection.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) {
    return null;
  }
  const desiredForward = desiredForwardDirection.clone().normalize();

  let bestAxis: THREE.Vector3 | null = null;
  let bestScore = -Infinity;
  candidates.forEach(({ axis, weight }) => {
    const alignment = Math.abs(axis.dot(desiredForward));
    const score = alignment * Math.max(weight, CAMERA_AUTO_FRAME_CUE_EPSILON);
    if (score > bestScore) {
      bestAxis = axis.clone().normalize();
      bestScore = score;
    }
  });
  if (!bestAxis) return null;
  if (bestAxis.dot(desiredForward) < 0) {
    bestAxis.multiplyScalar(-1);
  }
  return bestAxis.normalize();
};

const resolveMeshAxisAlignedFrameCue = (
  candidates: MeshBasisCandidate[],
  desiredForwardDirection: THREE.Vector3,
  localUpReference: THREE.Vector3
): LocalCameraFrameCue | null => {
  if (candidates.length === 0) return null;
  if (desiredForwardDirection.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) {
    return null;
  }

  const desiredForward = desiredForwardDirection.clone().normalize();
  const projectedUpReference = localUpReference
    .clone()
    .addScaledVector(desiredForward, -localUpReference.dot(desiredForward));
  if (projectedUpReference.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) {
    return null;
  }
  projectedUpReference.normalize();

  let bestFrame: LocalCameraFrameCue | null = null;
  let bestScore = -Infinity;
  candidates.forEach(({ axes, weight }) => {
    axes.forEach((basisForward) => {
      const forwardSign = basisForward.dot(desiredForward) >= 0 ? 1 : -1;
      const forward = basisForward.clone().multiplyScalar(forwardSign).normalize();
      const forwardAlignment = Math.max(0, forward.dot(desiredForward));
      if (forwardAlignment < CAMERA_AUTO_MESH_FRAME_MIN_ALIGNMENT) {
        return;
      }

      let bestUp: THREE.Vector3 | null = null;
      let bestUpAlignment = -Infinity;
      axes.forEach((basisUp) => {
        if (Math.abs(basisUp.dot(basisForward)) > CAMERA_AUTO_FRAME_CUE_EPSILON) return;
        const projectedUp = basisUp
          .clone()
          .addScaledVector(forward, -basisUp.dot(forward));
        if (projectedUp.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) return;
        projectedUp.normalize();
        if (projectedUp.dot(projectedUpReference) < 0) {
          projectedUp.multiplyScalar(-1);
        }
        const upAlignment = Math.max(0, projectedUp.dot(projectedUpReference));
        if (upAlignment > bestUpAlignment) {
          bestUpAlignment = upAlignment;
          bestUp = projectedUp;
        }
      });

      if (!bestUp || bestUpAlignment < CAMERA_AUTO_MESH_FRAME_MIN_ALIGNMENT) return;
      const right = new THREE.Vector3().crossVectors(bestUp, forward).normalize();
      if (right.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) return;
      const up = new THREE.Vector3().crossVectors(forward, right).normalize();
      if (up.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) return;

      const weightedAlignment =
        CAMERA_AUTO_MESH_FRAME_FORWARD_WEIGHT * forwardAlignment +
        CAMERA_AUTO_MESH_FRAME_UP_WEIGHT * bestUpAlignment;
      const score = Math.max(weight, CAMERA_AUTO_FRAME_CUE_EPSILON) * weightedAlignment;
      if (score > bestScore) {
        bestScore = score;
        bestFrame = {
          forward,
          right,
          up,
          confidence: Math.min(forwardAlignment, bestUpAlignment),
        };
      }
    });
  });
  return bestFrame;
};

const resolvePlaneBasisFromForward = (forwardDirection: THREE.Vector3) => {
  const forward = forwardDirection.clone().normalize();
  if (forward.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) return null;
  for (const seed of FRAME_CUE_BASIS_SEEDS) {
    const projected = seed
      .clone()
      .addScaledVector(forward, -seed.dot(forward));
    if (projected.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) continue;
    const uAxis = projected.normalize();
    const vAxis = new THREE.Vector3().crossVectors(forward, uAxis).normalize();
    if (vAxis.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) continue;
    return { uAxis, vAxis };
  }
  return null;
};

const resolveFrameCueFromDirectionSamples = (
  samples: LocalDirectionSample[],
  forwardDirection: THREE.Vector3,
  localUpReference: THREE.Vector3
): LocalCameraFrameCue | null => {
  if (samples.length < CAMERA_AUTO_FRAME_CUE_MIN_POINT_COUNT) return null;
  if (forwardDirection.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) return null;

  const forward = forwardDirection.clone().normalize();
  const basis = resolvePlaneBasisFromForward(forward);
  if (!basis) return null;

  let meanU = 0;
  let meanV = 0;
  samples.forEach((sample) => {
    meanU += sample.offset.dot(basis.uAxis);
    meanV += sample.offset.dot(basis.vAxis);
  });
  meanU /= samples.length;
  meanV /= samples.length;

  let covarianceUU = 0;
  let covarianceUV = 0;
  let covarianceVV = 0;
  samples.forEach((sample) => {
    const centeredU = sample.offset.dot(basis.uAxis) - meanU;
    const centeredV = sample.offset.dot(basis.vAxis) - meanV;
    covarianceUU += centeredU * centeredU;
    covarianceUV += centeredU * centeredV;
    covarianceVV += centeredV * centeredV;
  });
  covarianceUU /= samples.length;
  covarianceUV /= samples.length;
  covarianceVV /= samples.length;

  const trace = covarianceUU + covarianceVV;
  if (trace < CAMERA_AUTO_FRAME_CUE_MIN_PLANAR_VARIANCE) return null;
  const eigenDelta = Math.sqrt(
    Math.max(
      0,
      (covarianceUU - covarianceVV) * (covarianceUU - covarianceVV) +
        4 * covarianceUV * covarianceUV
    )
  );
  const majorEigenvalue = 0.5 * (trace + eigenDelta);
  const minorEigenvalue = 0.5 * (trace - eigenDelta);
  if (majorEigenvalue < CAMERA_AUTO_FRAME_CUE_MIN_PLANAR_VARIANCE) return null;

  let majorAxisU = 1;
  let majorAxisV = 0;
  if (Math.abs(covarianceUV) > CAMERA_AUTO_FRAME_CUE_EPSILON) {
    majorAxisU = majorEigenvalue - covarianceVV;
    majorAxisV = covarianceUV;
  } else if (covarianceVV > covarianceUU) {
    majorAxisU = 0;
    majorAxisV = 1;
  }
  const majorAxisNorm = Math.hypot(majorAxisU, majorAxisV);
  if (majorAxisNorm < CAMERA_AUTO_FRAME_CUE_EPSILON) return null;
  majorAxisU /= majorAxisNorm;
  majorAxisV /= majorAxisNorm;

  const right = basis.uAxis
    .clone()
    .multiplyScalar(majorAxisU)
    .addScaledVector(basis.vAxis, majorAxisV)
    .normalize();
  if (right.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) return null;

  const up = new THREE.Vector3().crossVectors(forward, right).normalize();
  if (up.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) return null;
  right.copy(new THREE.Vector3().crossVectors(up, forward).normalize());

  let positiveSupport = 0;
  let negativeSupport = 0;
  samples.forEach((sample) => {
    const projection = sample.offset.dot(right);
    if (projection >= 0) {
      positiveSupport += projection * projection * sample.distance;
      return;
    }
    const magnitude = -projection;
    negativeSupport += magnitude * magnitude * sample.distance;
  });
  if (negativeSupport > positiveSupport + CAMERA_AUTO_FRAME_CUE_EPSILON) {
    right.multiplyScalar(-1);
    up.multiplyScalar(-1);
  }

  const projectedReference = localUpReference
    .clone()
    .addScaledVector(forward, -localUpReference.dot(forward));
  if (projectedReference.lengthSq() >= CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) {
    projectedReference.normalize();
    if (up.dot(projectedReference) < 0) {
      up.multiplyScalar(-1);
      right.multiplyScalar(-1);
    }
  }

  const confidence = Math.max(
    0,
    (majorEigenvalue - Math.max(0, minorEigenvalue)) /
      (majorEigenvalue + CAMERA_AUTO_FRAME_CUE_EPSILON)
  );
  if (confidence < CAMERA_AUTO_FRAME_CUE_CONFIDENCE_MIN) return null;

  return {
    forward,
    right,
    up,
    confidence,
  };
};

const resolveFrameCueFromSurfaceNormals = (
  samples: LocalSurfaceNormalSample[],
  forwardDirection: THREE.Vector3,
  localUpReference: THREE.Vector3
): LocalCameraFrameCue | null => {
  if (samples.length < CAMERA_AUTO_FRAME_CUE_MIN_POINT_COUNT) return null;
  if (forwardDirection.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) return null;

  const forward = forwardDirection.clone().normalize();
  const basis = resolvePlaneBasisFromForward(forward);
  if (!basis) return null;

  let covarianceUU = 0;
  let covarianceUV = 0;
  let covarianceVV = 0;
  let totalArea = 0;
  samples.forEach((sample) => {
    const projected = sample.normal
      .clone()
      .addScaledVector(forward, -sample.normal.dot(forward));
    if (projected.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) return;
    projected.normalize();
    const u = projected.dot(basis.uAxis);
    const v = projected.dot(basis.vAxis);
    covarianceUU += sample.area * u * u;
    covarianceUV += sample.area * u * v;
    covarianceVV += sample.area * v * v;
    totalArea += sample.area;
  });
  if (totalArea < CAMERA_AUTO_FRAME_CUE_EPSILON) return null;
  covarianceUU /= totalArea;
  covarianceUV /= totalArea;
  covarianceVV /= totalArea;

  const trace = covarianceUU + covarianceVV;
  if (trace < CAMERA_AUTO_FRAME_CUE_MIN_PLANAR_VARIANCE) return null;
  const eigenDelta = Math.sqrt(
    Math.max(
      0,
      (covarianceUU - covarianceVV) * (covarianceUU - covarianceVV) +
        4 * covarianceUV * covarianceUV
    )
  );
  const majorEigenvalue = 0.5 * (trace + eigenDelta);
  const minorEigenvalue = 0.5 * (trace - eigenDelta);
  if (majorEigenvalue < CAMERA_AUTO_FRAME_CUE_MIN_PLANAR_VARIANCE) return null;

  let majorAxisU = 1;
  let majorAxisV = 0;
  if (Math.abs(covarianceUV) > CAMERA_AUTO_FRAME_CUE_EPSILON) {
    majorAxisU = majorEigenvalue - covarianceVV;
    majorAxisV = covarianceUV;
  } else if (covarianceVV > covarianceUU) {
    majorAxisU = 0;
    majorAxisV = 1;
  }
  const majorAxisNorm = Math.hypot(majorAxisU, majorAxisV);
  if (majorAxisNorm < CAMERA_AUTO_FRAME_CUE_EPSILON) return null;
  majorAxisU /= majorAxisNorm;
  majorAxisV /= majorAxisNorm;

  const majorAxis = basis.uAxis
    .clone()
    .multiplyScalar(majorAxisU)
    .addScaledVector(basis.vAxis, majorAxisV)
    .normalize();
  const minorAxis = new THREE.Vector3().crossVectors(forward, majorAxis).normalize();
  if (
    majorAxis.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH ||
    minorAxis.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH
  ) {
    return null;
  }

  const projectedReference = localUpReference
    .clone()
    .addScaledVector(forward, -localUpReference.dot(forward));
  if (projectedReference.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) return null;
  projectedReference.normalize();

  const chooseMajorAsUp =
    Math.abs(majorAxis.dot(projectedReference)) >=
    Math.abs(minorAxis.dot(projectedReference));
  const up = (chooseMajorAsUp ? majorAxis.clone() : minorAxis.clone()).normalize();
  if (up.dot(projectedReference) < 0) up.multiplyScalar(-1);

  const right = new THREE.Vector3().crossVectors(up, forward).normalize();
  if (right.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) return null;

  const confidence = Math.max(
    0,
    (majorEigenvalue - Math.max(0, minorEigenvalue)) /
      (majorEigenvalue + CAMERA_AUTO_FRAME_CUE_EPSILON)
  );
  if (confidence < CAMERA_AUTO_FRAME_CUE_CONFIDENCE_MIN) return null;

  return {
    forward,
    right,
    up,
    confidence,
  };
};

export const computeOwnedLinkLocalVisualBounds = (
  linkObject: THREE.Object3D
): THREE.Box3 | null => {
  linkObject.updateMatrixWorld(true);
  const worldToLink = new THREE.Matrix4().copy(linkObject.matrixWorld).invert();
  const localVisualBounds = new THREE.Box3().makeEmpty();
  traverseOwnedLinkNodes(linkObject, (node) => {
    addMeshBoundsInLinkFrame(node, worldToLink, localVisualBounds);
  });
  if (localVisualBounds.isEmpty()) return null;
  return localVisualBounds;
};

export const computeOwnedLinkLocalVisualBoundsCenter = (
  linkObject: THREE.Object3D
): THREE.Vector3 | null => {
  const localVisualBounds = computeOwnedLinkLocalVisualBounds(linkObject);
  return localVisualBounds?.getCenter(new THREE.Vector3()) ?? null;
};

export const computeOwnedLinkLocalVisualCentroid = (
  linkObject: THREE.Object3D
): THREE.Vector3 | null => {
  linkObject.updateMatrixWorld(true);
  const worldToLink = new THREE.Matrix4().copy(linkObject.matrixWorld).invert();
  const accumulator: CentroidAccumulator = {
    weightedVolumeCenterSum: new THREE.Vector3(0, 0, 0),
    totalSignedVolume: 0,
    weightedCenterSum: new THREE.Vector3(0, 0, 0),
    totalWeight: 0,
  };

  traverseOwnedLinkNodes(linkObject, (node) => {
    addMeshSurfaceCentroidInLinkFrame(node, worldToLink, accumulator);
  });

  if (
    Math.abs(accumulator.totalSignedVolume) >= CAMERA_AUTO_CENTROID_MIN_TOTAL_SIGNED_VOLUME
  ) {
    return accumulator.weightedVolumeCenterSum.divideScalar(accumulator.totalSignedVolume);
  }
  if (accumulator.totalWeight < CAMERA_AUTO_CENTROID_MIN_TOTAL_WEIGHT) return null;
  return accumulator.weightedCenterSum.divideScalar(accumulator.totalWeight);
};

export const computeOwnedLinkLocalVisualPrincipalAxis = (
  linkObject: THREE.Object3D,
  localCenter: THREE.Vector3
): THREE.Vector3 | null =>
  resolvePrincipalAxisFromDirectionSamples(
    collectOwnedLinkDirectionSamples(linkObject, localCenter)
  );

export const computeOwnedLinkLocalVisualDirectionCue = (
  linkObject: THREE.Object3D,
  localCenter: THREE.Vector3
): THREE.Vector3 | null =>
  resolveDirectionCueFromDirectionSamples(
    collectOwnedLinkDirectionSamples(linkObject, localCenter)
  );

export const computeOwnedLinkLocalVisualUpCue = (
  linkObject: THREE.Object3D,
  localCenter: THREE.Vector3,
  forwardDirection: THREE.Vector3
): THREE.Vector3 | null =>
  resolveUpCueFromDirectionSamples(
    collectOwnedLinkDirectionSamples(linkObject, localCenter),
    forwardDirection,
    computeLinkLocalWorldUpReference(linkObject)
  );

export const computeOwnedLinkLocalVisualFrameCue = (
  linkObject: THREE.Object3D,
  localCenter: THREE.Vector3,
  forwardDirection: THREE.Vector3
): LocalCameraFrameCue | null =>
  resolveFrameCueFromSurfaceNormals(
    collectOwnedLinkSurfaceNormalSamples(linkObject),
    forwardDirection,
    computeLinkLocalWorldUpReference(linkObject)
  ) ??
  resolveFrameCueFromDirectionSamples(
    collectOwnedLinkDirectionSamples(linkObject, localCenter),
    forwardDirection,
    computeLinkLocalWorldUpReference(linkObject)
  );

export const computeOwnedLinkLocalVisualMeshAlignedUpCue = (
  linkObject: THREE.Object3D,
  forwardDirection: THREE.Vector3
) =>
  resolveMeshAxisAlignedUpCue(
    collectOwnedLinkMeshAxisCandidates(linkObject),
    forwardDirection,
    computeLinkLocalWorldUpReference(linkObject)
  );

export const computeOwnedLinkLocalVisualMeshAlignedForwardCue = (
  linkObject: THREE.Object3D,
  desiredForwardDirection: THREE.Vector3
) =>
  resolveMeshAxisAlignedForwardCue(
    collectOwnedLinkMeshAxisCandidates(linkObject),
    desiredForwardDirection
  );

export const computeOwnedLinkLocalVisualMeshAlignedFrameCue = (
  linkObject: THREE.Object3D,
  desiredForwardDirection: THREE.Vector3
) =>
  resolveMeshAxisAlignedFrameCue(
    collectOwnedLinkMeshBasisCandidates(linkObject),
    desiredForwardDirection,
    computeLinkLocalWorldUpReference(linkObject)
  );
