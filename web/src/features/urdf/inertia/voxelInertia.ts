import * as THREE from "three";
import {
  VOXEL_INERTIA_CELL_CENTER_JITTER_RATIO,
  VOXEL_INERTIA_GRID_RESOLUTION,
  VOXEL_INERTIA_RAY_EPSILON,
} from "./voxelInertiaParams";
import { collectWorldMeshTriangles } from "./meshTriangleCollector";

export type VoxelMassProperties = {
  mass: number;
  volume: number;
  centerOfMass: THREE.Vector3;
  inertiaAtCenter: THREE.Matrix3;
};

type TriangleRecord = {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  min: THREE.Vector3;
  max: THREE.Vector3;
};

const createSymmetricMatrix3 = (
  xx: number,
  xy: number,
  xz: number,
  yy: number,
  yz: number,
  zz: number
): THREE.Matrix3 =>
  new THREE.Matrix3().set(
    xx, xy, xz,
    xy, yy, yz,
    xz, yz, zz
  );

const cloneMatrix3 = (matrix: THREE.Matrix3): THREE.Matrix3 =>
  new THREE.Matrix3().fromArray(matrix.toArray());

const addMatrix3 = (lhs: THREE.Matrix3, rhs: THREE.Matrix3): THREE.Matrix3 => {
  const lhsElements = lhs.elements;
  const rhsElements = rhs.elements;
  const result = new THREE.Matrix3();
  const resultElements = result.elements;
  for (let index = 0; index < resultElements.length; index += 1) {
    resultElements[index] = lhsElements[index] + rhsElements[index];
  }
  return result;
};

const scaleMatrix3 = (matrix: THREE.Matrix3, scale: number): THREE.Matrix3 => {
  const result = cloneMatrix3(matrix);
  const elements = result.elements;
  for (let index = 0; index < elements.length; index += 1) {
    elements[index] *= scale;
  }
  return result;
};

const buildParallelAxisMatrix = (mass: number, offset: THREE.Vector3): THREE.Matrix3 => {
  const dx = offset.x;
  const dy = offset.y;
  const dz = offset.z;
  const distanceSquared = dx * dx + dy * dy + dz * dz;
  return createSymmetricMatrix3(
    mass * (distanceSquared - dx * dx),
    -mass * dx * dy,
    -mass * dx * dz,
    mass * (distanceSquared - dy * dy),
    -mass * dy * dz,
    mass * (distanceSquared - dz * dz)
  );
};

const shiftInertiaFromPoint = (
  inertiaAtPoint: THREE.Matrix3,
  mass: number,
  offset: THREE.Vector3
): THREE.Matrix3 => addMatrix3(inertiaAtPoint, scaleMatrix3(buildParallelAxisMatrix(mass, offset), -1));

const collectTriangles = (object: THREE.Object3D): { triangles: TriangleRecord[]; bounds: THREE.Box3 | null } => {
  const collection = collectWorldMeshTriangles(object);
  return {
    bounds: collection.bounds,
    triangles: collection.triangles.map(({ a, b, c }) => ({
      a,
      b,
      c,
      max: new THREE.Vector3(
        Math.max(a.x, b.x, c.x),
        Math.max(a.y, b.y, c.y),
        Math.max(a.z, b.z, c.z)
      ),
      min: new THREE.Vector3(
        Math.min(a.x, b.x, c.x),
        Math.min(a.y, b.y, c.y),
        Math.min(a.z, b.z, c.z)
      ),
    })),
  };
};

const clampIndex = (value: number, size: number): number =>
  Math.max(0, Math.min(size - 1, value));

const rayIntersectsTriangle = (
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  triangle: TriangleRecord
): boolean => {
  const edge1 = triangle.b.clone().sub(triangle.a);
  const edge2 = triangle.c.clone().sub(triangle.a);
  const pvec = direction.clone().cross(edge2);
  const determinant = edge1.dot(pvec);
  if (Math.abs(determinant) <= VOXEL_INERTIA_RAY_EPSILON) {
    return false;
  }
  const inverseDeterminant = 1 / determinant;
  const tvec = origin.clone().sub(triangle.a);
  const u = tvec.dot(pvec) * inverseDeterminant;
  if (u < -VOXEL_INERTIA_RAY_EPSILON || u > 1 + VOXEL_INERTIA_RAY_EPSILON) {
    return false;
  }
  const qvec = tvec.clone().cross(edge1);
  const v = direction.dot(qvec) * inverseDeterminant;
  if (v < -VOXEL_INERTIA_RAY_EPSILON || u + v > 1 + VOXEL_INERTIA_RAY_EPSILON) {
    return false;
  }
  const t = edge2.dot(qvec) * inverseDeterminant;
  return t > VOXEL_INERTIA_RAY_EPSILON;
};

export const computeVoxelMassPropertiesFromObject = (
  object: THREE.Object3D,
  densityKgPerM3: number,
  gridResolution = VOXEL_INERTIA_GRID_RESOLUTION
): VoxelMassProperties | null => {
  const { triangles, bounds } = collectTriangles(object);
  if (!bounds || triangles.length === 0) {
    return null;
  }

  const size = bounds.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDimension) || maxDimension <= VOXEL_INERTIA_RAY_EPSILON) {
    return null;
  }

  const cellSize = maxDimension / gridResolution;
  const counts = {
    x: Math.max(1, Math.ceil(size.x / cellSize)),
    y: Math.max(1, Math.ceil(size.y / cellSize)),
    z: Math.max(1, Math.ceil(size.z / cellSize)),
  };
  const yzBins = Array.from({ length: counts.y * counts.z }, () => new Set<number>());
  const yzIndex = (yIndex: number, zIndex: number) => yIndex * counts.z + zIndex;

  triangles.forEach((triangle, triangleIndex) => {
    const minY = clampIndex(Math.floor((triangle.min.y - bounds.min.y) / cellSize), counts.y);
    const maxY = clampIndex(Math.floor((triangle.max.y - bounds.min.y) / cellSize), counts.y);
    const minZ = clampIndex(Math.floor((triangle.min.z - bounds.min.z) / cellSize), counts.z);
    const maxZ = clampIndex(Math.floor((triangle.max.z - bounds.min.z) / cellSize), counts.z);
    for (let yIndex = minY; yIndex <= maxY; yIndex += 1) {
      for (let zIndex = minZ; zIndex <= maxZ; zIndex += 1) {
        yzBins[yzIndex(yIndex, zIndex)].add(triangleIndex);
      }
    }
  });

  const direction = new THREE.Vector3(1, 0, 0);
  const jitter = cellSize * VOXEL_INERTIA_CELL_CENTER_JITTER_RATIO;
  const center = new THREE.Vector3();
  const solidCenters: THREE.Vector3[] = [];

  for (let xIndex = 0; xIndex < counts.x; xIndex += 1) {
    center.x = bounds.min.x + (xIndex + 0.5) * cellSize;
    for (let yIndex = 0; yIndex < counts.y; yIndex += 1) {
      center.y = bounds.min.y + (yIndex + 0.5) * cellSize + jitter;
      for (let zIndex = 0; zIndex < counts.z; zIndex += 1) {
        center.z = bounds.min.z + (zIndex + 0.5) * cellSize + jitter * 0.5;
        const candidates = yzBins[yzIndex(yIndex, zIndex)];
        if (!candidates || candidates.size === 0) {
          continue;
        }
        let hitCount = 0;
        for (const triangleIndex of candidates) {
          const triangle = triangles[triangleIndex];
          if (triangle.max.x <= center.x) {
            continue;
          }
          if (
            center.y < triangle.min.y - VOXEL_INERTIA_RAY_EPSILON ||
            center.y > triangle.max.y + VOXEL_INERTIA_RAY_EPSILON ||
            center.z < triangle.min.z - VOXEL_INERTIA_RAY_EPSILON ||
            center.z > triangle.max.z + VOXEL_INERTIA_RAY_EPSILON
          ) {
            continue;
          }
          if (rayIntersectsTriangle(center, direction, triangle)) {
            hitCount += 1;
          }
        }
        if (hitCount % 2 === 1) {
          solidCenters.push(center.clone());
        }
      }
    }
  }

  if (solidCenters.length === 0) {
    return null;
  }

  const voxelVolume = cellSize ** 3;
  const voxelMass = densityKgPerM3 * voxelVolume;
  const totalMass = voxelMass * solidCenters.length;
  const volume = voxelVolume * solidCenters.length;
  const centerOfMass = solidCenters
    .reduce((sum, voxelCenter) => sum.add(voxelCenter), new THREE.Vector3())
    .multiplyScalar(1 / solidCenters.length);

  const inertiaAtOrigin = solidCenters.reduce((sum, voxelCenter) => {
    const dx = voxelCenter.x;
    const dy = voxelCenter.y;
    const dz = voxelCenter.z;
    return addMatrix3(
      sum,
      createSymmetricMatrix3(
        voxelMass * (dy * dy + dz * dz),
        -voxelMass * dx * dy,
        -voxelMass * dx * dz,
        voxelMass * (dx * dx + dz * dz),
        -voxelMass * dy * dz,
        voxelMass * (dx * dx + dy * dy)
      )
    );
  }, new THREE.Matrix3().identity().multiplyScalar(0));

  return {
    mass: totalMass,
    volume,
    centerOfMass,
    inertiaAtCenter: shiftInertiaFromPoint(inertiaAtOrigin, totalMass, centerOfMass),
  };
};
