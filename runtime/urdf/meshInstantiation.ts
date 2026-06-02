import type * as THREE from "three";
import type { MeshFiles } from "@/shared/types/feature";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";
import { loadMeshFromBlob } from "./meshDecode";

export const instantiateMeshObject = async (params: {
  blob: Blob;
  path: string;
  gpuMode: GPUMode;
  meshFiles: MeshFiles;
  signal?: AbortSignal;
}): Promise<THREE.Object3D | null> => {
  const result = await loadMeshFromBlob({
    blob: params.blob,
    path: params.path,
    gpuMode: params.gpuMode,
    meshFiles: params.meshFiles,
    signal: params.signal,
  });
  return result?.object ?? null;
};
