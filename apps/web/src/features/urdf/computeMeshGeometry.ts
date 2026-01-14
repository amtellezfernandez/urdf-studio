/**
 * Utilities for computing collision geometry from mesh files
 */

import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { createLruCache, hashArrayBuffer } from "@/shared/lib/cache";

export interface MeshBounds {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  center: [number, number, number];
  vertices: Float32Array;
}

const meshBoundsCache = createLruCache<MeshBounds>(16);

export interface PCAResult {
  axis: [number, number, number];
  eigenvalues: [number, number, number];
  eigenvectors: [[number, number, number], [number, number, number], [number, number, number]];
  centroid: [number, number, number];
}

/**
 * Loads and computes bounds from a mesh file
 */
export async function computeMeshBounds(
  meshFile: Blob,
  scale: string = "1 1 1"
): Promise<MeshBounds | null> {
  try {
    const arrayBuffer = await meshFile.arrayBuffer();
    return computeMeshBoundsFromArrayBuffer(arrayBuffer, scale);
  } catch (error) {
    console.error("Error computing mesh bounds:", error);
    return null;
  }
}

export function computeMeshBoundsFromArrayBuffer(
  arrayBuffer: ArrayBuffer,
  scale: string = "1 1 1"
): MeshBounds | null {
  try {
    const cacheKey = `${hashArrayBuffer(arrayBuffer)}:${scale}`;
    const cached = meshBoundsCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const scaleParts = scale.split(" ").map(parseFloat);
    const scaleVec = new THREE.Vector3(
      scaleParts[0] || 1,
      scaleParts[1] || 1,
      scaleParts[2] || 1
    );

    const loader = new STLLoader();
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

    const result: MeshBounds = {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      size: [maxX - minX, maxY - minY, maxZ - minZ],
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
      vertices,
    };
    meshBoundsCache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error("Error computing mesh bounds:", error);
    return null;
  }
}


/**
 * Combines multiple mesh bounds into a single bounding box
 * This handles links with multiple visual meshes
 */
export function combineMeshBounds(boundsArray: MeshBounds[]): MeshBounds | null {
  if (boundsArray.length === 0) return null;
  if (boundsArray.length === 1) return boundsArray[0];

  // Find overall min/max across all meshes
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const allVertices: number[] = [];

  for (const bounds of boundsArray) {
    minX = Math.min(minX, bounds.min[0]);
    minY = Math.min(minY, bounds.min[1]);
    minZ = Math.min(minZ, bounds.min[2]);
    maxX = Math.max(maxX, bounds.max[0]);
    maxY = Math.max(maxY, bounds.max[1]);
    maxZ = Math.max(maxZ, bounds.max[2]);
    
    // Collect all vertices for PCA calculation
    for (let i = 0; i < bounds.vertices.length; i++) {
      allVertices.push(bounds.vertices[i]);
    }
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    vertices: new Float32Array(allVertices),
  };
}

/**
 * Compute cylinder diagnostics from mesh vertices
 */
export interface CylinderDiagnostics {
  elongation: number;      // λ₁ / λ₂
  roundness: number;        // λ₂ / λ₃
  outlierRatio: number;     // r_max / r_p95
  radialP50: number;        // median radial distance
  radialP95: number;        // 95th percentile radial distance
  radialMax: number;        // max radial distance
  crossSectionVariation: number; // r_p95 / r_p50
  eigenvalues: [number, number, number];
}

/**
 * Compute sphere diagnostics from mesh vertices
 */
export interface SphereDiagnostics {
  elongation: number;      // λ₁ / λ₂
  flatness: number;        // λ₂ / λ₃
  isIsotropic: boolean;     // elongation < 2 and flatness < 2
  isElongated: boolean;    // elongation >> 1
  isFlat: boolean;         // flatness >> 1
  radialP50: number;       // median radial distance
  radialP95: number;       // 95th percentile radial distance
  radialMax: number;       // max radial distance
  outlierRatio: number;    // r_max / r_p95
  eigenvalues: [number, number, number];
}

/**
 * Compute cylinder diagnostics for automatic method selection
 */
export function computeCylinderDiagnostics(
  vertices: Float32Array,
  pca: PCAResult
): CylinderDiagnostics {
  const vertexCount = vertices.length / 3;
  const axis = pca.axis;
  const centroid = pca.centroid;
  const eigenvalues = pca.eigenvalues;
  
  // Compute elongation and roundness
  const lambda1 = eigenvalues[0];
  const lambda2 = eigenvalues[1];
  const lambda3 = eigenvalues[2];
  const elongation = lambda1 / Math.max(lambda2, 1e-10);
  const roundness = lambda2 / Math.max(lambda3, 1e-10);
  
  // Compute radial distances to PCA axis
  const radialDistances: number[] = [];
  
  for (let i = 0; i < vertexCount; i++) {
    const x = vertices[i * 3] - centroid[0];
    const y = vertices[i * 3 + 1] - centroid[1];
    const z = vertices[i * 3 + 2] - centroid[2];
    
    // Project onto axis
    const t = x * axis[0] + y * axis[1] + z * axis[2];
    const projX = t * axis[0];
    const projY = t * axis[1];
    const projZ = t * axis[2];
    
    // Orthogonal distance
    const orthoX = x - projX;
    const orthoY = y - projY;
    const orthoZ = z - projZ;
    const radius = Math.sqrt(orthoX * orthoX + orthoY * orthoY + orthoZ * orthoZ);
    radialDistances.push(radius);
  }
  
  // Sort for percentiles
  radialDistances.sort((a, b) => a - b);
  const radialP50 = radialDistances[Math.floor(vertexCount * 0.5)];
  const radialP95 = radialDistances[Math.floor(vertexCount * 0.95)];
  const radialMax = radialDistances[vertexCount - 1];
  const outlierRatio = radialMax / Math.max(radialP95, 1e-10);
  const crossSectionVariation = radialP95 / Math.max(radialP50, 1e-10);
  
  return {
    elongation,
    roundness,
    outlierRatio,
    radialP50,
    radialP95,
    radialMax,
    crossSectionVariation,
    eigenvalues: [lambda1, lambda2, lambda3],
  };
}

/**
 * Compute sphere diagnostics for automatic method selection
 */
export function computeSphereDiagnostics(
  vertices: Float32Array,
  pca: PCAResult
): SphereDiagnostics {
  const vertexCount = vertices.length / 3;
  const centroid = pca.centroid;
  const eigenvalues = pca.eigenvalues;
  
  // Compute elongation and flatness
  const lambda1 = eigenvalues[0];
  const lambda2 = eigenvalues[1];
  const lambda3 = eigenvalues[2];
  const elongation = lambda1 / Math.max(lambda2, 1e-10);
  const flatness = lambda2 / Math.max(lambda3, 1e-10);
  
  // Decision rules
  const isIsotropic = elongation < 2 && flatness < 2;
  const isElongated = elongation > 3; // Significantly elongated
  const isFlat = flatness > 3; // Significantly flat/slab-like
  
  // Compute radial distances from centroid
  const radialDistances: number[] = [];
  
  for (let i = 0; i < vertexCount; i++) {
    const x = vertices[i * 3] - centroid[0];
    const y = vertices[i * 3 + 1] - centroid[1];
    const z = vertices[i * 3 + 2] - centroid[2];
    const radius = Math.sqrt(x * x + y * y + z * z);
    radialDistances.push(radius);
  }
  
  // Sort for percentiles
  radialDistances.sort((a, b) => a - b);
  const radialP50 = radialDistances[Math.floor(vertexCount * 0.5)];
  const radialP95 = radialDistances[Math.floor(vertexCount * 0.95)];
  const radialMax = radialDistances[vertexCount - 1];
  const outlierRatio = radialMax / Math.max(radialP95, 1e-10);
  
  return {
    elongation,
    flatness,
    isIsotropic,
    isElongated,
    isFlat,
    radialP50,
    radialP95,
    radialMax,
    outlierRatio,
    eigenvalues: [lambda1, lambda2, lambda3],
  };
}

/**
 * Fit cylinder using percentile-based PCA (for clean cylinders)
 */
export function fitCylinderPercentilePCA(
  vertices: Float32Array,
  pca: PCAResult,
  diagnostics: CylinderDiagnostics
): { radius: number; height: number; center: [number, number, number]; axis: [number, number, number] } {
  const vertexCount = vertices.length / 3;
  const axis = pca.axis;
  const centroid = pca.centroid;
  
  // Project vertices onto axis
  const tValues: number[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const x = vertices[i * 3] - centroid[0];
    const y = vertices[i * 3 + 1] - centroid[1];
    const z = vertices[i * 3 + 2] - centroid[2];
    const t = x * axis[0] + y * axis[1] + z * axis[2];
    tValues.push(t);
  }
  
  tValues.sort((a, b) => a - b);
  const minT = tValues[0];
  const maxT = tValues[vertexCount - 1];
  const height = maxT - minT;
  
  // Use 95th percentile for radius (robust to outliers)
  const radius = diagnostics.radialP95;
  
  // Center at midpoint along axis
  const centerX = centroid[0] + (minT + maxT) / 2 * axis[0];
  const centerY = centroid[1] + (minT + maxT) / 2 * axis[1];
  const centerZ = centroid[2] + (minT + maxT) / 2 * axis[2];
  
  return {
    radius,
    height,
    center: [centerX, centerY, centerZ],
    axis,
  };
}

/**
 * Fit cylinder using constrained axis (for non-circular cross-sections)
 * Uses longest AABB dimension as axis
 */
export function fitCylinderConstrainedAxis(
  vertices: Float32Array,
  minX: number, maxX: number,
  minY: number, maxY: number,
  minZ: number, maxZ: number
): { radius: number; height: number; center: [number, number, number]; axis: [number, number, number] } {
  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;
  
  let axis: [number, number, number];
  let height: number;
  let centerX: number, centerY: number, centerZ: number;
  
  if (sizeX >= sizeY && sizeX >= sizeZ) {
    axis = [1, 0, 0];
    height = sizeX;
    centerX = (minX + maxX) / 2;
    centerY = (minY + maxY) / 2;
    centerZ = (minZ + maxZ) / 2;
  } else if (sizeY >= sizeX && sizeY >= sizeZ) {
    axis = [0, 1, 0];
    height = sizeY;
    centerX = (minX + maxX) / 2;
    centerY = (minY + maxY) / 2;
    centerZ = (minZ + maxZ) / 2;
  } else {
    axis = [0, 0, 1];
    height = sizeZ;
    centerX = (minX + maxX) / 2;
    centerY = (minY + maxY) / 2;
    centerZ = (minZ + maxZ) / 2;
  }
  
  // Compute radius using 95th percentile
  const vertexCount = vertices.length / 3;
  const radialDistances: number[] = [];
  
  for (let i = 0; i < vertexCount; i++) {
    const x = vertices[i * 3] - centerX;
    const y = vertices[i * 3 + 1] - centerY;
    const z = vertices[i * 3 + 2] - centerZ;
    
    const t = x * axis[0] + y * axis[1] + z * axis[2];
    const projX = t * axis[0];
    const projY = t * axis[1];
    const projZ = t * axis[2];
    
    const orthoX = x - projX;
    const orthoY = y - projY;
    const orthoZ = z - projZ;
    const radius = Math.sqrt(orthoX * orthoX + orthoY * orthoY + orthoZ * orthoZ);
    radialDistances.push(radius);
  }
  
  radialDistances.sort((a, b) => a - b);
  const radius = radialDistances[Math.floor(vertexCount * 0.95)];
  
  return { radius, height, center: [centerX, centerY, centerZ], axis };
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
  const A = matrix.map(row => [...row]);
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

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
