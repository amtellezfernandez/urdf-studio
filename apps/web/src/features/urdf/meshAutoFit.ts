import { createWorkerTaskRunner } from "@/shared/lib/workerTaskRunner";
import type { CollisionAutoFitResult, CollisionAutoFitType } from "./collisionAutoFit";
import { autoFitCollisionGeometry } from "./collisionAutoFit";
import { computeMeshBoundsFromArrayBuffer } from "./computeMeshGeometry";
import type { OriginData } from "./parseLinkData";

type MeshAutoFitResponse = {
  id: number;
  result?: CollisionAutoFitResult;
  error?: string;
};

type MeshAutoFitRequest = {
  id: number;
  arrayBuffer: ArrayBuffer;
  scale: string;
  visualOrigin: OriginData;
  requestedType: CollisionAutoFitType;
};

const meshAutoFitMinBytes = 16 * 1024;
const runner = createWorkerTaskRunner<MeshAutoFitRequest, MeshAutoFitResponse>(() => {
  if (typeof Worker === "undefined") {
    return null;
  }
  return new Worker(new URL("./meshAutoFit.worker.ts", import.meta.url), { type: "module" });
});

const computeAutoFitFallback = (
  arrayBuffer: ArrayBuffer,
  scale: string,
  visualOrigin: OriginData,
  requestedType: CollisionAutoFitType
) => {
  const bounds = computeMeshBoundsFromArrayBuffer(arrayBuffer, scale);
  if (!bounds) {
    return null;
  }
  return autoFitCollisionGeometry(bounds, visualOrigin, requestedType);
};

export const autoFitCollisionGeometryFromMesh = async (
  meshFile: Blob,
  scale: string,
  visualOrigin: OriginData,
  requestedType: CollisionAutoFitType
): Promise<CollisionAutoFitResult | null> => {
  const arrayBuffer = await meshFile.arrayBuffer();

  if (arrayBuffer.byteLength < meshAutoFitMinBytes) {
    return computeAutoFitFallback(arrayBuffer, scale, visualOrigin, requestedType);
  }

  if (typeof Worker === "undefined") {
    return computeAutoFitFallback(arrayBuffer, scale, visualOrigin, requestedType);
  }
  const response = await runner.run(
    {
      arrayBuffer,
      scale,
      visualOrigin,
      requestedType,
    },
    [arrayBuffer]
  );

  if (!response || response.error) {
    return null;
  }

  return response.result ?? null;
};
