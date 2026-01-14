/// <reference lib="webworker" />

import { autoFitCollisionGeometry } from "./collisionAutoFit";
import { computeMeshBoundsFromArrayBuffer } from "./computeMeshGeometry";
import type { CollisionAutoFitResult, CollisionAutoFitType } from "./collisionAutoFit";
import type { OriginData } from "../parsing/parseLinkData";

type MeshAutoFitRequest = {
  id: number;
  arrayBuffer: ArrayBuffer;
  scale: string;
  visualOrigin: OriginData;
  requestedType: CollisionAutoFitType;
};

type MeshAutoFitResponse = {
  id: number;
  result?: CollisionAutoFitResult;
  error?: string;
};

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<MeshAutoFitRequest>) => {
  const { id, arrayBuffer, scale, visualOrigin, requestedType } = event.data;

  let response: MeshAutoFitResponse;
  try {
    const bounds = computeMeshBoundsFromArrayBuffer(arrayBuffer, scale);
    if (!bounds) {
      response = { id, error: "Failed to compute mesh bounds" };
    } else {
      const result = autoFitCollisionGeometry(bounds, visualOrigin, requestedType);
      if (!result) {
        response = { id, error: "Failed to compute collision geometry" };
      } else {
        response = { id, result };
      }
    }
  } catch (error) {
    response = {
      id,
      error: error instanceof Error ? error.message : "Mesh auto-fit failed",
    };
  }

  ctx.postMessage(response);
};
