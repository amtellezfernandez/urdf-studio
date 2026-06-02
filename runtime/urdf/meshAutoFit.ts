import { createWorkerTaskBroker } from "@/shared/lib/workerTaskRunner";
import {
  autoFitCollisionGeometry,
  computeMeshBoundsFromArrayBuffer,
  type CollisionAutoFitResult,
  type CollisionAutoFitType,
  type OriginData,
} from "./urdfCore";

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
const broker = createWorkerTaskBroker<Omit<MeshAutoFitRequest, "id">, MeshAutoFitResponse>(() => {
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
  const response = await broker.run(
    {
      arrayBuffer,
      scale,
      visualOrigin,
      requestedType,
    },
    {
      transfer: [arrayBuffer],
      shouldUseWorker: (request) => request.arrayBuffer.byteLength >= meshAutoFitMinBytes,
      fallback: (request) => ({
        id: -1,
        result:
          request.arrayBuffer.byteLength > 0
            ? computeAutoFitFallback(
                request.arrayBuffer,
                request.scale,
                request.visualOrigin,
                request.requestedType
              )
            : null,
      }),
      shouldFallback: (result) => Boolean(result?.error),
    }
  );

  if (!response || response.error) {
    return null;
  }

  return response.result ?? null;
};
