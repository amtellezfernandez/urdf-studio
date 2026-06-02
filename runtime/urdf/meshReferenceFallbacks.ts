import { normalizeMeshPathForMatch, parseMeshReference } from "i-love-urdf/browser";

const SUPPORTED_MESH_EXTENSIONS = [".stl", ".obj", ".dae", ".glb", ".gltf"] as const;

const buildMeshFolderAliasPaths = (value: string): string[] => {
  const normalized = normalizeMeshPathForMatch(value);
  if (!normalized) {
    return [];
  }

  const aliases = new Set<string>();
  const parts = normalized.split("/").filter(Boolean);
  parts.forEach((part, index) => {
    if (part === "meshes") {
      const next = [...parts];
      next[index] = "assets";
      aliases.add(next.join("/"));
    } else if (part === "assets") {
      const next = [...parts];
      next[index] = "meshes";
      aliases.add(next.join("/"));
    }
  });
  aliases.delete(normalized);
  return Array.from(aliases);
};

export const buildMeshFolderAliasReferences = (meshRef: string): string[] => {
  const refInfo = parseMeshReference(meshRef);
  if (refInfo.isAbsoluteFile) {
    return [];
  }
  const rawPath = refInfo.path || refInfo.raw;
  const aliasPaths = buildMeshFolderAliasPaths(rawPath);
  if (refInfo.scheme === "package" && refInfo.packageName) {
    return aliasPaths.map((path) => `package://${refInfo.packageName}/${path}`);
  }
  return aliasPaths;
};

export const buildMeshDecodeFallbackRefs = (meshRef: string): string[] => {
  const cleaned = meshRef.split("?")[0]?.split("#")[0] ?? meshRef;
  const match = cleaned.match(/\.[^./\\]+$/);
  if (!match) return [];
  const currentExt = match[0].toLowerCase();
  const base = cleaned.slice(0, -match[0].length);
  return SUPPORTED_MESH_EXTENSIONS
    .filter((ext) => ext !== currentExt)
    .map((ext) => `${base}${ext}`);
};

export const buildMeshReferenceCandidates = (meshRef: string): string[] => {
  const candidates = new Set<string>([meshRef]);
  buildMeshFolderAliasReferences(meshRef).forEach((candidateRef) => candidates.add(candidateRef));
  Array.from(candidates).forEach((candidateRef) => {
    buildMeshDecodeFallbackRefs(candidateRef).forEach((fallbackRef) => candidates.add(fallbackRef));
  });
  return Array.from(candidates);
};
