export const MESH_DECODE_PARAMS = {
  layoutCacheLimit: 64,
  cacheSchemaVersion: 3,
  sceneTemplateCacheLimit: 16,
  initialBlobTokenId: 1,
  workerConcurrencyFallback: 1,
  defaultHardwareConcurrency: 2,
  minWorkerConcurrency: 1,
  maxWorkerConcurrency: 4,
  blobTokenPrefix: "b",
} as const;
