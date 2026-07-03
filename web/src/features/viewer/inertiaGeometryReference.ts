import * as THREE from "three";

import { composeUrdfPoseMatrix } from "@/shared/lib/spatialFrame";
import { createLruCache, hashArrayBuffer } from "@/shared/lib/cache";
import { computeMeshBoundsFromArrayBuffer, resolveMeshBlobFromReference } from "@/shared/lib/urdfBrowser";
import { parseVector3Tuple } from "@/shared/lib/vector3Tuple";
import type { CollisionData, LinkData, MeshBounds } from "@/shared/lib/urdfCore";
import type { MeshFiles } from "@/shared/types/feature";
import {
  INERTIA_GEOMETRY_MESH_BOUNDS_CACHE_LIMIT,
} from "@/features/viewer/inertiaGeometryReferenceParams";

export type GeometryReferenceSource = "primitive" | "mesh-bounds" | "mixed";

export type GeometryReferencePoint = [number, number, number];

export type LinkCollisionGeometryReference = {
  points: GeometryReferencePoint[];
  source: GeometryReferenceSource;
  primitiveCount: number;
  meshCount: number;
};

const DEFAULT_VECTOR_STRING = "1 1 1";
const BOX_CORNER_SIGNS: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, -1],
  [-1, -1, 1],
  [-1, 1, -1],
  [-1, 1, 1],
  [1, -1, -1],
  [1, -1, 1],
  [1, 1, -1],
  [1, 1, 1],
];

const meshBoundsCache = createLruCache<MeshBounds | null>(INERTIA_GEOMETRY_MESH_BOUNDS_CACHE_LIMIT);
const meshArrayBufferCache = new WeakMap<Blob, Promise<ArrayBuffer>>();

const parseVectorString = (
  raw: string | undefined,
  fallback: [number, number, number]
): [number, number, number] => {
  if (!raw) {
    return fallback;
  }
  return parseVector3Tuple(raw, fallback);
};

const buildBoxCorners = (size: [number, number, number]): GeometryReferencePoint[] => {
  const halfExtents: [number, number, number] = [size[0] * 0.5, size[1] * 0.5, size[2] * 0.5];
  return BOX_CORNER_SIGNS.map(([sx, sy, sz]) => [
    sx * halfExtents[0],
    sy * halfExtents[1],
    sz * halfExtents[2],
  ]);
};

const buildSphereCorners = (radius: number): GeometryReferencePoint[] =>
  buildBoxCorners([radius * 2, radius * 2, radius * 2]);

const buildCylinderCorners = (radius: number, length: number): GeometryReferencePoint[] =>
  buildBoxCorners([radius * 2, radius * 2, length]);

const buildMeshBoundsCorners = (bounds: MeshBounds): GeometryReferencePoint[] => {
  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  return [
    [minX, minY, minZ],
    [minX, minY, maxZ],
    [minX, maxY, minZ],
    [minX, maxY, maxZ],
    [maxX, minY, minZ],
    [maxX, minY, maxZ],
    [maxX, maxY, minZ],
    [maxX, maxY, maxZ],
  ];
};

const transformPointsToLinkFrame = (
  points: GeometryReferencePoint[],
  collision: CollisionData
): GeometryReferencePoint[] => {
  const localMatrix = composeUrdfPoseMatrix(
    {
      xyz: collision.origin.xyz,
      rpy: collision.origin.rpy,
    },
    new THREE.Matrix4()
  );
  const vector = new THREE.Vector3();
  return points.map(([x, y, z]) => {
    vector.set(x, y, z).applyMatrix4(localMatrix);
    return [vector.x, vector.y, vector.z];
  });
};

const getBlobArrayBuffer = async (blob: Blob): Promise<ArrayBuffer> => {
  const cached = meshArrayBufferCache.get(blob);
  if (cached) {
    return cached;
  }
  const promise = blob.arrayBuffer();
  meshArrayBufferCache.set(blob, promise);
  return promise;
};

const getMeshBoundsForCollision = async (
  collision: CollisionData,
  meshFiles: MeshFiles,
  urdfBasePath?: string,
  packageRoots?: Record<string, string[]>
): Promise<MeshBounds | null> => {
  const meshReference = collision.geometry.params.filename?.trim();
  if (!meshReference) {
    return null;
  }
  const resolvedMesh = resolveMeshBlobFromReference(
    meshReference,
    meshFiles,
    urdfBasePath,
    packageRoots
  );
  if (!resolvedMesh) {
    return null;
  }
  const scale = collision.geometry.params.scale ?? DEFAULT_VECTOR_STRING;
  const arrayBuffer = await getBlobArrayBuffer(resolvedMesh.blob);
  const cacheKey = `${hashArrayBuffer(arrayBuffer)}:${scale}`;
  const cached = meshBoundsCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const bounds = computeMeshBoundsFromArrayBuffer(arrayBuffer, scale);
  meshBoundsCache.set(cacheKey, bounds);
  return bounds;
};

const resolveCollisionPoints = async (
  collision: CollisionData,
  meshFiles: MeshFiles,
  urdfBasePath?: string,
  packageRoots?: Record<string, string[]>
): Promise<{ points: GeometryReferencePoint[]; source: GeometryReferenceSource } | null> => {
  const geometry = collision.geometry;
  if (!geometry?.type) {
    return null;
  }

  if (geometry.type === "box") {
    const size = parseVectorString(geometry.params.size, [1, 1, 1]);
    if (size.some((value) => !Number.isFinite(value) || value <= 0)) {
      return null;
    }
    return {
      points: transformPointsToLinkFrame(buildBoxCorners(size), collision),
      source: "primitive",
    };
  }

  if (geometry.type === "sphere") {
    const radius = Number(geometry.params.radius ?? 0);
    if (!Number.isFinite(radius) || radius <= 0) {
      return null;
    }
    return {
      points: transformPointsToLinkFrame(buildSphereCorners(radius), collision),
      source: "primitive",
    };
  }

  if (geometry.type === "cylinder") {
    const radius = Number(geometry.params.radius ?? 0);
    const length = Number(geometry.params.length ?? 0);
    if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(length) || length <= 0) {
      return null;
    }
    return {
      points: transformPointsToLinkFrame(buildCylinderCorners(radius, length), collision),
      source: "primitive",
    };
  }

  if (geometry.type !== "mesh") {
    return null;
  }

  const meshBounds = await getMeshBoundsForCollision(collision, meshFiles, urdfBasePath, packageRoots);
  if (!meshBounds) {
    return null;
  }

  return {
    points: transformPointsToLinkFrame(buildMeshBoundsCorners(meshBounds), collision),
    source: "mesh-bounds",
  };
};

export const buildLinkCollisionGeometryReferences = async ({
  linkDataByName,
  meshFiles,
  urdfBasePath,
  packageRoots,
}: {
  linkDataByName: Record<string, LinkData>;
  meshFiles: MeshFiles;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
}): Promise<Map<string, LinkCollisionGeometryReference>> => {
  const references = new Map<string, LinkCollisionGeometryReference>();

  for (const [linkName, linkData] of Object.entries(linkDataByName)) {
    const points: GeometryReferencePoint[] = [];
    let primitiveCount = 0;
    let meshCount = 0;

    for (const collision of linkData.collisions ?? []) {
      const resolved = await resolveCollisionPoints(collision, meshFiles, urdfBasePath, packageRoots);
      if (!resolved) {
        continue;
      }
      points.push(...resolved.points);
      if (resolved.source === "primitive") {
        primitiveCount += 1;
      } else {
        meshCount += 1;
      }
    }

    if (points.length === 0) {
      continue;
    }

    const source: GeometryReferenceSource =
      primitiveCount > 0 && meshCount > 0
        ? "mixed"
        : meshCount > 0
          ? "mesh-bounds"
          : "primitive";

    references.set(linkName, {
      points,
      source,
      primitiveCount,
      meshCount,
    });
  }

  return references;
};
