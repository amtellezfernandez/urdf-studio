import * as THREE from "three";
import { MESH_RESOURCE_CACHE_PARAMS } from "./meshResourceCacheParams";

type GeometryCacheEntry = {
  geometry: THREE.BufferGeometry;
  refCount: number;
  lastUsed: number;
  bytes: number;
};

const MESH_RESOURCE_CACHE_CONFIG = MESH_RESOURCE_CACHE_PARAMS;
const MAX_CACHE_BYTES = MESH_RESOURCE_CACHE_CONFIG.maxCacheBytes;
const MAX_CACHE_ENTRIES = MESH_RESOURCE_CACHE_CONFIG.maxCacheEntries;

const cache = new Map<string, GeometryCacheEntry>();
let cacheBytes: number = MESH_RESOURCE_CACHE_CONFIG.emptyCacheBytes;

const estimateGeometryBytes = (geometry: THREE.BufferGeometry) => {
  let bytes = MESH_RESOURCE_CACHE_CONFIG.emptyCacheBytes;
  const attributes = geometry.attributes;
  for (const key of Object.keys(attributes)) {
    const attr = attributes[key];
    if (attr && "array" in attr && attr.array?.byteLength) {
      bytes += attr.array.byteLength;
    }
  }
  if (geometry.index?.array?.byteLength) {
    bytes += geometry.index.array.byteLength;
  }
  return bytes;
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const disposeEntry = (key: string, entry: GeometryCacheEntry) => {
  cache.delete(key);
  cacheBytes = Math.max(MESH_RESOURCE_CACHE_CONFIG.emptyCacheBytes, cacheBytes - entry.bytes);
  entry.geometry.dispose();
};

const pruneCache = () => {
  if (cache.size <= MAX_CACHE_ENTRIES && cacheBytes <= MAX_CACHE_BYTES) {
    return;
  }

  const evictable = Array.from(cache.entries())
    .filter(([, entry]) => entry.refCount <= MESH_RESOURCE_CACHE_CONFIG.minRefCount)
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

  for (const [key, entry] of evictable) {
    if (cache.size <= MAX_CACHE_ENTRIES && cacheBytes <= MAX_CACHE_BYTES) {
      break;
    }
    disposeEntry(key, entry);
  }
};

export const hasGeometry = (key: string) => cache.has(key);

export const acquireGeometry = (key: string, factory: () => THREE.BufferGeometry) => {
  const cached = cache.get(key);
  if (cached) {
    cached.refCount += 1;
    cached.lastUsed = now();
    return cached.geometry;
  }

  const geometry = factory();
  const bytes = estimateGeometryBytes(geometry);
  cache.set(key, {
    geometry,
    refCount: 1,
    lastUsed: now(),
    bytes,
  });
  cacheBytes += bytes;
  pruneCache();
  return geometry;
};

export const releaseGeometry = (key: string) => {
  const cached = cache.get(key);
  if (!cached) return;
  cached.refCount = Math.max(MESH_RESOURCE_CACHE_CONFIG.minRefCount, cached.refCount - 1);
  cached.lastUsed = now();
  pruneCache();
};

const clearGeometryCache = () => {
  for (const [key, entry] of cache.entries()) {
    if (entry.refCount <= MESH_RESOURCE_CACHE_CONFIG.minRefCount) {
      disposeEntry(key, entry);
    }
  }
  pruneCache();
};
