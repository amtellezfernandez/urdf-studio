import type { CollisionAutoFitResult, CollisionAutoFitType } from "./collisionAutoFit";
import { autoFitCollisionGeometry } from "./collisionAutoFit";
import { computeMeshBoundsFromArrayBuffer } from "./computeMeshGeometry";
import type { OriginData } from "./parseLinkData";

type MeshAutoFitResponse = {
  id: number;
  result?: CollisionAutoFitResult;
  error?: string;
};

const meshAutoFitMinBytes = 16 * 1024;
let meshAutoFitWorker: Worker | null = null;
let meshAutoFitNextId = 0;
const meshAutoFitPending = new Map<number, (response: MeshAutoFitResponse) => void>();

const getMeshAutoFitWorker = () => {
  if (typeof Worker === "undefined") {
    return null;
  }

  if (!meshAutoFitWorker) {
    meshAutoFitWorker = new Worker(new URL("./meshAutoFit.worker.ts", import.meta.url), {
      type: "module",
    });
    meshAutoFitWorker.onmessage = (event: MessageEvent<MeshAutoFitResponse>) => {
      const { id } = event.data;
      const resolver = meshAutoFitPending.get(id);
      if (!resolver) return;
      meshAutoFitPending.delete(id);
      resolver(event.data);
    };
    meshAutoFitWorker.onerror = () => {
      const pending = Array.from(meshAutoFitPending.values());
      meshAutoFitPending.clear();
      meshAutoFitWorker?.terminate();
      meshAutoFitWorker = null;
      pending.forEach((resolve) => resolve({ id: -1, error: "Mesh auto-fit worker failed" }));
    };
  }

  return meshAutoFitWorker;
};

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

  const worker = getMeshAutoFitWorker();
  if (!worker) {
    return computeAutoFitFallback(arrayBuffer, scale, visualOrigin, requestedType);
  }

  const requestId = meshAutoFitNextId;
  meshAutoFitNextId += 1;

  const response = await new Promise<MeshAutoFitResponse>((resolve) => {
    meshAutoFitPending.set(requestId, resolve);
    worker.postMessage(
      {
        id: requestId,
        arrayBuffer,
        scale,
        visualOrigin,
        requestedType,
      },
      [arrayBuffer]
    );
  });

  if (response.error) {
    return null;
  }

  return response.result ?? null;
};
