/**
 * Utilities for computing collision geometry from mesh files.
 */

import {
  computeMeshBoundsFromArrayBuffer as computeSharedMeshBoundsFromArrayBuffer,
  resolveMeshBlob,
  type MeshBounds,
} from "@/shared/lib/urdfBrowser";
import { createLruCache, hashArrayBuffer } from "@/shared/lib/cache";

const meshBoundsCache = createLruCache<MeshBounds>(16);

function computeMeshBoundsFromArrayBuffer(
  arrayBuffer: ArrayBuffer,
  scale: string = "1 1 1"
): MeshBounds | null {
  const cacheKey = `${hashArrayBuffer(arrayBuffer)}:${scale}`;
  const cached = meshBoundsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const result = computeSharedMeshBoundsFromArrayBuffer(arrayBuffer, scale);
  if (result) {
    meshBoundsCache.set(cacheKey, result);
  }
  return result;
}

export function findMeshFile(filename: string, meshFiles: Record<string, Blob>): Blob | null {
  return resolveMeshBlob(filename, meshFiles)?.blob ?? null;
}
