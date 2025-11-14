/**
 * Utilities for computing collision geometry from mesh files
 */

import * as THREE from "three";
import { STLLoader } from "three-stdlib";

export interface MeshBounds {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  center: [number, number, number];
  vertices: Float32Array;
}

export interface PCAResult {
  axis: [number, number, number];
  eigenvalues: [number, number, number];
  eigenvectors: [[number, number, number], [number, number, number], [number, number, number]];
  centroid: [number, number, number];
}

/**
 * Loads and computes bounds from a mesh file
 */
export async function computeMeshBounds(meshFile: Blob, scale: string = "1 1 1"): Promise<MeshBounds | null> {
  try {
    const scaleParts = scale.split(" ").map(parseFloat);
    const scaleVec = new THREE.Vector3(
      scaleParts[0] || 1,
      scaleParts[1] || 1,
      scaleParts[2] || 1
    );

    const loader = new STLLoader();
    const arrayBuffer = await meshFile.arrayBuffer();
    const geometry = loader.parse(arrayBuffer);

    if (!geometry.attributes.position) {
      return null;
    }

    const positions = geometry.attributes.position;
    const vertexCount = positions.count;
    const vertices = new Float32Array(vertexCount * 3);

    // Extract and scale vertices
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < vertexCount; i++) {
      const x = positions.getX(i) * scaleVec.x;
      const y = positions.getY(i) * scaleVec.y;
      const z = positions.getZ(i) * scaleVec.z;

      vertices[i * 3] = x;
      vertices[i * 3 + 1] = y;
      vertices[i * 3 + 2] = z;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }

    return {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      size: [maxX - minX, maxY - minY, maxZ - minZ],
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
      vertices,
    };
  } catch (error) {
    console.error("Error computing mesh bounds:", error);
    return null;
  }
}

/**
 * Computes PCA (Principal Component Analysis) for mesh vertices
 */
export function computePCA(vertices: Float32Array): PCAResult | null {
  if (vertices.length < 9) return null; // Need at least 3 vertices

  const vertexCount = vertices.length / 3;

  // Compute centroid
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < vertexCount; i++) {
    cx += vertices[i * 3];
    cy += vertices[i * 3 + 1];
    cz += vertices[i * 3 + 2];
  }
  cx /= vertexCount;
  cy /= vertexCount;
  cz /= vertexCount;

  const centroid: [number, number, number] = [cx, cy, cz];

  // Compute covariance matrix
  let covXX = 0, covYY = 0, covZZ = 0;
  let covXY = 0, covXZ = 0, covYZ = 0;

  for (let i = 0; i < vertexCount; i++) {
    const x = vertices[i * 3] - cx;
    const y = vertices[i * 3 + 1] - cy;
    const z = vertices[i * 3 + 2] - cz;

    covXX += x * x;
    covYY += y * y;
    covZZ += z * z;
    covXY += x * y;
    covXZ += x * z;
    covYZ += y * z;
  }

  const invN = 1 / vertexCount;
  const cov = [
    [covXX * invN, covXY * invN, covXZ * invN],
    [covXY * invN, covYY * invN, covYZ * invN],
    [covXZ * invN, covYZ * invN, covZZ * invN],
  ];

  // Simple eigenvalue decomposition for 3x3 symmetric matrix
  // Using Jacobi method approximation
  const eigenResult = jacobiEigenvalue(cov);
  
  // Find principal axis (largest eigenvalue)
  let maxEigenIdx = 0;
  let maxEigen = eigenResult.eigenvalues[0];
  for (let i = 1; i < 3; i++) {
    if (eigenResult.eigenvalues[i] > maxEigen) {
      maxEigen = eigenResult.eigenvalues[i];
      maxEigenIdx = i;
    }
  }

  const axis = eigenResult.eigenvectors[maxEigenIdx] as [number, number, number];

  return {
    axis,
    eigenvalues: eigenResult.eigenvalues as [number, number, number],
    eigenvectors: eigenResult.eigenvectors as [[number, number, number], [number, number, number], [number, number, number]],
    centroid,
  };
}

/**
 * Simple Jacobi eigenvalue decomposition for 3x3 symmetric matrix
 */
function jacobiEigenvalue(matrix: number[][]): { eigenvalues: number[]; eigenvectors: number[][] } {
  // Simplified version - for 3x3 we can use analytical solution or iterative method
  // Using a simplified iterative approach
  const n = 3;
  let A = matrix.map(row => [...row]);
  let V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  // Iterative Jacobi method (simplified)
  for (let iter = 0; iter < 10; iter++) {
    let maxOffDiag = 0;
    let p = 0, q = 0;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(A[i][j]) > maxOffDiag) {
          maxOffDiag = Math.abs(A[i][j]);
          p = i;
          q = j;
        }
      }
    }

    if (maxOffDiag < 1e-6) break;

    const theta = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]);
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    // Rotate matrix
    const Apq = A[p][q];
    const App = A[p][p];
    const Aqq = A[q][q];

    A[p][p] = c * c * App - 2 * c * s * Apq + s * s * Aqq;
    A[q][q] = s * s * App + 2 * c * s * Apq + c * c * Aqq;
    A[p][q] = A[q][p] = (c * c - s * s) * Apq + c * s * (App - Aqq);

    for (let k = 0; k < n; k++) {
      if (k !== p && k !== q) {
        const Akp = A[k][p];
        const Akq = A[k][q];
        A[k][p] = A[p][k] = c * Akp - s * Akq;
        A[k][q] = A[q][k] = s * Akp + c * Akq;
      }
    }

    // Update eigenvectors
    for (let k = 0; k < n; k++) {
      const Vkp = V[k][p];
      const Vkq = V[k][q];
      V[k][p] = c * Vkp - s * Vkq;
      V[k][q] = s * Vkp + c * Vkq;
    }
  }

  const eigenvalues = [A[0][0], A[1][1], A[2][2]];
  return { eigenvalues, eigenvectors: V };
}

/**
 * Computes rotation from Z-axis to given axis (for cylinder alignment)
 */
export function computeRotationToAxis(targetAxis: [number, number, number]): { xyz: [number, number, number]; rpy: [number, number, number] } {
  const zAxis: [number, number, number] = [0, 0, 1];
  const axis = new THREE.Vector3(...targetAxis).normalize();
  const z = new THREE.Vector3(...zAxis);

  // Compute rotation using cross product and dot product
  const cross = new THREE.Vector3().crossVectors(z, axis);
  const dot = z.dot(axis);

  // If axes are parallel, no rotation needed
  if (Math.abs(dot - 1) < 1e-6) {
    return { xyz: [0, 0, 0], rpy: [0, 0, 0] };
  }
  if (Math.abs(dot + 1) < 1e-6) {
    // 180 degree rotation around Y axis
    return { xyz: [0, 0, 0], rpy: [0, Math.PI, 0] };
  }

  // Compute rotation axis and angle
  const angle = Math.acos(dot);
  const rotAxis = cross.normalize();

  // Convert axis-angle to Euler angles (simplified - using ZYX convention)
  // This is an approximation - for exact conversion we'd use quaternions
  const rpy: [number, number, number] = [
    Math.atan2(rotAxis.y, rotAxis.z) * angle,
    Math.asin(-rotAxis.x) * angle,
    Math.atan2(rotAxis.x, rotAxis.z) * angle,
  ];

  return { xyz: [0, 0, 0], rpy };
}

/**
 * Finds mesh file from filename in meshFiles map
 */
export function findMeshFile(filename: string, meshFiles: Record<string, Blob>): Blob | null {
  // Try exact match first
  if (meshFiles[filename]) {
    return meshFiles[filename];
  }

  // Try with leading slash
  if (meshFiles[`/${filename}`]) {
    return meshFiles[`/${filename}`];
  }

  // Try without leading slash
  const noSlash = filename.replace(/^\//, '');
  if (meshFiles[noSlash]) {
    return meshFiles[noSlash];
  }

  // Try just the filename (last part of path)
  const parts = filename.split('/');
  const justName = parts[parts.length - 1];
  if (meshFiles[justName]) {
    return meshFiles[justName];
  }

  // Try with common mesh folder prefixes
  const variants = [
    `meshes/${justName}`,
    `/meshes/${justName}`,
    `mesh/${justName}`,
    `/mesh/${justName}`,
  ];

  for (const variant of variants) {
    if (meshFiles[variant]) {
      return meshFiles[variant];
    }
  }

  return null;
}

