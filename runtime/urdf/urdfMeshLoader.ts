import type * as THREE from "three";
import {
  buildPackageRootsFromMeshBlobMap,
  resolveMeshBlobFromReference,
} from "i-love-urdf/browser";
import type { MeshFiles } from "@/shared/types/feature";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";
import { buildMeshReferenceCandidates } from "./meshReferenceFallbacks";
import { resolveMeshCandidates } from "./urdfCore";
import { instantiateMeshObject as instantiateMeshObjectRuntime } from "./meshInstantiation";
import { disposeMeshResources } from "./meshDecode";

type UrdfMeshLoadResult =
  | {
      status: "loaded";
      object: THREE.Object3D;
      resolvedPath: string;
      reference: string;
    }
  | { status: "missing" }
  | { status: "aborted" }
  | { status: "error"; error: Error };

type InstantiateMeshObject = (params: {
  blob: Blob;
  path: string;
  gpuMode: GPUMode;
  meshFiles: MeshFiles;
  signal?: AbortSignal;
}) => Promise<THREE.Object3D | null>;

type GpuModeInput = GPUMode | (() => GPUMode);

type LoadMeshObjectParams = {
  ref: string;
  meshFiles: MeshFiles;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  gpuMode: GpuModeInput;
  signal?: AbortSignal;
  instantiateMeshObject?: InstantiateMeshObject;
};

const toError = (error: unknown) =>
  error instanceof Error ? error : new Error(typeof error === "string" ? error : "Mesh load failed");

const resolveGpuMode = (input: GpuModeInput): GPUMode =>
  typeof input === "function" ? input() : input;

const mergePackageRoots = (
  meshFiles: MeshFiles,
  packageRoots?: Record<string, string[]>
): Record<string, string[]> | undefined => {
  const inferred = buildPackageRootsFromMeshBlobMap(meshFiles);
  if (!packageRoots || Object.keys(packageRoots).length === 0) {
    return Object.keys(inferred).length > 0 ? inferred : packageRoots;
  }
  if (Object.keys(inferred).length === 0) {
    return packageRoots;
  }

  const merged: Record<string, string[]> = { ...packageRoots };
  Object.entries(inferred).forEach(([packageName, roots]) => {
    const existingRoots = merged[packageName] ?? [];
    const nextRoots = [...existingRoots];
    roots.forEach((root) => {
      if (!nextRoots.includes(root)) {
        nextRoots.push(root);
      }
    });
    merged[packageName] = nextRoots;
  });
  return merged;
};

const resolveMeshCandidatesWithAliases = ({
  ref,
  meshFiles,
  urdfBasePath,
  packageRoots,
}: {
  ref: string;
  meshFiles: MeshFiles;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
}) => {
  const candidates: Array<{ ref: string; resolvedPath: string; blob: Blob }> = [];
  const seenPaths = new Set<string>();
  buildMeshReferenceCandidates(ref).forEach((candidateRef) => {
    const resolved = resolveMeshBlobFromReference(
      candidateRef,
      meshFiles,
      urdfBasePath,
      packageRoots
    );
    if (!resolved || seenPaths.has(resolved.path)) {
      return;
    }
    seenPaths.add(resolved.path);
    candidates.push({
      ref: candidateRef,
      resolvedPath: resolved.path,
      blob: resolved.blob,
    });
  });
  return candidates;
};

export const loadMeshObjectForUrdfReference = async ({
  ref,
  meshFiles,
  urdfBasePath,
  packageRoots,
  gpuMode,
  signal,
  instantiateMeshObject = instantiateMeshObjectRuntime,
}: LoadMeshObjectParams): Promise<UrdfMeshLoadResult> => {
  if (signal?.aborted) return { status: "aborted" };

  const mergedPackageRoots = mergePackageRoots(meshFiles, packageRoots);
  const candidateRefs = resolveMeshCandidates({
    ref,
    meshFiles,
    urdfBasePath,
    packageRoots: mergedPackageRoots,
  });
  const resolvedCandidates =
    candidateRefs.length > 0
      ? candidateRefs
      : resolveMeshCandidatesWithAliases({
          ref,
          meshFiles,
          urdfBasePath,
          packageRoots: mergedPackageRoots,
        });
  if (resolvedCandidates.length === 0) {
    return { status: "missing" };
  }

  let lastError: Error | null = null;
  for (const candidate of resolvedCandidates) {
    if (signal?.aborted) return { status: "aborted" };
    try {
      const object = await instantiateMeshObject({
        blob: candidate.blob,
        path: candidate.resolvedPath,
        gpuMode: resolveGpuMode(gpuMode),
        meshFiles,
        signal,
      });
      if (signal?.aborted) {
        if (object) {
          disposeMeshResources(object);
        }
        return { status: "aborted" };
      }
      if (!object) continue;
      return {
        status: "loaded",
        object,
        resolvedPath: candidate.resolvedPath,
        reference: candidate.ref,
      };
    } catch (error) {
      lastError = toError(error);
    }
  }

  if (signal?.aborted) return { status: "aborted" };
  if (lastError) {
    return { status: "error", error: lastError };
  }
  return { status: "missing" };
};

type CreateUrdfMeshLoadCallbackParams = {
  meshFiles: MeshFiles;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  gpuMode: GpuModeInput;
  signal?: AbortSignal;
  instantiateMeshObject?: InstantiateMeshObject;
  onLoaded?: (object: THREE.Object3D, meta: { path: string; resolvedPath: string; reference: string }) => void;
  onMissing?: (path: string) => THREE.Object3D | null | undefined;
  onError?: (path: string, error: Error) => THREE.Object3D | null | undefined;
};

export const createUrdfMeshLoadCallback = ({
  meshFiles,
  urdfBasePath,
  packageRoots,
  gpuMode,
  signal,
  instantiateMeshObject,
  onLoaded,
  onMissing,
  onError,
}: CreateUrdfMeshLoadCallbackParams) => {
  return (
    path: string,
    _manager: THREE.LoadingManager,
    onComplete: (mesh: THREE.Object3D | null, err?: Error) => void
  ) => {
    loadMeshObjectForUrdfReference({
      ref: path,
      meshFiles,
      urdfBasePath,
      packageRoots,
      gpuMode,
      signal,
      instantiateMeshObject,
    })
      .then((result) => {
        if (signal?.aborted) {
          onComplete(null);
          return;
        }

        if (result.status === "aborted") {
          onComplete(null);
          return;
        }

        if (result.status === "loaded") {
          onLoaded?.(result.object, {
            path,
            resolvedPath: result.resolvedPath,
            reference: result.reference,
          });
          onComplete(result.object);
          return;
        }

        if (result.status === "missing") {
          const fallback = onMissing?.(path) ?? null;
          onComplete(fallback);
          return;
        }

        const fallback = onError?.(path, result.error) ?? null;
        if (fallback) {
          onComplete(fallback);
          return;
        }
        onComplete(null, result.error);
      })
      .catch((error) => {
        if (signal?.aborted) {
          onComplete(null);
          return;
        }
        const resolvedError = toError(error);
        const fallback = onError?.(path, resolvedError) ?? null;
        if (fallback) {
          onComplete(fallback);
          return;
        }
        onComplete(null, resolvedError);
      });
  };
};
