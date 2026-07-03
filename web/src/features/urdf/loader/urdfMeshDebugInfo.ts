import {
  normalizeMeshPathForMatch,
  parseMeshReference,
} from "@/shared/lib/urdfBrowser";
import type { DebugMeshInfo, MeshFiles } from "@/shared/types/feature";

export type IndexedMeshAsset = {
  blob: Blob;
  filename: string;
  relativePath: string;
};

const buildRegisteredPathsByBlob = (meshes: MeshFiles): Map<Blob, string[]> => {
  const registeredPathsByBlob = new Map<Blob, string[]>();
  Object.entries(meshes).forEach(([path, blob]) => {
    const existingPaths = registeredPathsByBlob.get(blob);
    if (existingPaths) {
      existingPaths.push(path);
      return;
    }
    registeredPathsByBlob.set(blob, [path]);
  });
  return registeredPathsByBlob;
};

const getReferenceMatchCandidates = (meshReference: string): string[] => {
  const refInfo = parseMeshReference(meshReference);
  if (refInfo.isAbsoluteFile) {
    return [];
  }

  const candidates = new Set<string>();
  const addPathCandidate = (value?: string) => {
    if (!value) return;
    const normalized = normalizeMeshPathForMatch(value)?.replace(/^\/+/, "");
    if (!normalized) return;
    candidates.add(normalized);
  };

  addPathCandidate(refInfo.path || refInfo.raw);

  try {
    addPathCandidate(decodeURIComponent(refInfo.path || refInfo.raw));
  } catch {
    // Ignore decode errors.
  }

  return Array.from(candidates);
};

const doesRegisteredPathMatchReference = (
  registeredPath: string,
  meshReference: string
): boolean => {
  const normalizedRegisteredPath = registeredPath.replace(/^\/+|\/+$/g, "");
  return getReferenceMatchCandidates(meshReference).some(
    (candidate) =>
      normalizedRegisteredPath === candidate ||
      normalizedRegisteredPath.endsWith(`/${candidate}`)
  );
};

export const buildDebugMeshInfo = (
  meshAssets: readonly IndexedMeshAsset[],
  meshes: MeshFiles,
  urdfMeshReferences: readonly string[]
): DebugMeshInfo[] => {
  const registeredPathsByBlob = buildRegisteredPathsByBlob(meshes);

  return meshAssets.map(({ blob, filename, relativePath }) => {
    const registeredPaths = registeredPathsByBlob.get(blob) ?? [];
    const matchedReference = urdfMeshReferences.find((reference) =>
      registeredPaths.some((registeredPath) =>
        doesRegisteredPathMatchReference(registeredPath, reference)
      )
    );

    return {
      filename,
      found: matchedReference !== undefined,
      registeredPaths: registeredPaths.slice(0, 20),
      urdfReference: matchedReference,
      webkitRelativePath: relativePath,
    };
  });
};
