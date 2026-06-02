// Studio-local boundary over the browser-safe i-love-urdf entrypoint.
// Web code should import from here instead of reaching into i-love-urdf/browser directly.

import {
  buildPackageRootsFromMeshBlobMap,
  fixMissingMeshReferences as fixMissingMeshReferencesBase,
  normalizeMeshPathForMatch,
  parseMeshReference,
  parseURDF,
  resolveMeshBlobFromReference as resolveMeshBlobFromReferenceBase,
  serializeURDF,
  type MeshBlobMap,
  type PackageRootMap,
} from "i-love-urdf/browser";
import {
  buildMeshFolderAliasReferences,
  buildMeshReferenceCandidates,
} from "@runtime-private/urdf/meshReferenceFallbacks";

export * from "i-love-urdf/browser";

const mergePackageRootMaps = (
  preferred: PackageRootMap | undefined,
  inferred: PackageRootMap
): PackageRootMap | undefined => {
  if (!preferred || Object.keys(preferred).length === 0) {
    return Object.keys(inferred).length > 0 ? inferred : preferred;
  }
  if (Object.keys(inferred).length === 0) {
    return preferred;
  }

  const merged: PackageRootMap = { ...preferred };
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

export const mergePackageRootsWithMeshFiles = (
  meshFiles: MeshBlobMap | undefined,
  packageRoots?: PackageRootMap
): PackageRootMap | undefined => {
  if (!meshFiles) {
    return packageRoots;
  }
  return mergePackageRootMaps(packageRoots, buildPackageRootsFromMeshBlobMap(meshFiles));
};

const makeRelativePath = (fromDir: string, toPath: string): string => {
  const fromParts = fromDir.split("/").filter(Boolean);
  const toParts = toPath.split("/").filter(Boolean);
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common += 1;
  }
  const ups = fromParts.length - common;
  const down = toParts.slice(common).join("/");
  const prefix = ups > 0 ? Array.from({ length: ups }, () => "..").join("/") : "";
  if (!prefix) return down;
  if (!down) return prefix;
  return `${prefix}/${down}`;
};

const buildPreferredMeshReference = (
  resolvedPath: string,
  basePath?: string,
  packageRoots?: PackageRootMap,
  preferredPackage?: string,
  preferPackageReference: boolean = false
): string => {
  const normalizedResolvedPath = normalizeMeshPathForMatch(resolvedPath);
  if (!normalizedResolvedPath) {
    return resolvedPath;
  }

  if (preferPackageReference && packageRoots) {
    let bestMatch: { packageName: string; root: string } | null = null;
    const consider = (packageName: string, root: string) => {
      const normalizedRoot = normalizeMeshPathForMatch(root) || "";
      if (
        normalizedResolvedPath !== normalizedRoot &&
        !normalizedResolvedPath.startsWith(`${normalizedRoot}/`)
      ) {
        return;
      }
      if (!bestMatch || normalizedRoot.length > bestMatch.root.length) {
        bestMatch = { packageName, root: normalizedRoot };
      }
    };

    if (preferredPackage && packageRoots[preferredPackage]) {
      packageRoots[preferredPackage].forEach((root) => consider(preferredPackage, root));
    }
    Object.entries(packageRoots).forEach(([packageName, roots]) => {
      roots.forEach((root) => consider(packageName, root));
    });

    if (bestMatch) {
      const relativePath = normalizedResolvedPath.slice(bestMatch.root.length).replace(/^\/+/, "");
      return relativePath
        ? `package://${bestMatch.packageName}/${relativePath}`
        : `package://${bestMatch.packageName}`;
    }
  }

  const normalizedBasePath = normalizeMeshPathForMatch(basePath ?? "");
  if (!normalizedBasePath) {
    return normalizedResolvedPath;
  }
  return makeRelativePath(normalizedBasePath, normalizedResolvedPath);
};

export const resolveMeshBlobFromReference = (
  meshRef: Parameters<typeof resolveMeshBlobFromReferenceBase>[0],
  meshFiles: Parameters<typeof resolveMeshBlobFromReferenceBase>[1],
  basePath?: Parameters<typeof resolveMeshBlobFromReferenceBase>[2],
  packageRoots?: Parameters<typeof resolveMeshBlobFromReferenceBase>[3]
): ReturnType<typeof resolveMeshBlobFromReferenceBase> => {
  const mergedPackageRoots = mergePackageRootsWithMeshFiles(meshFiles, packageRoots);
  const candidateRefs = [meshRef, ...buildMeshFolderAliasReferences(meshRef)];
  for (const candidateRef of candidateRefs) {
    const resolved = resolveMeshBlobFromReferenceBase(
      candidateRef,
      meshFiles,
      basePath,
      mergedPackageRoots
    );
    if (resolved) {
      return resolved;
    }
  }
  return null;
};

export const resolveMeshCandidates = (
  params: {
    ref: string;
    meshFiles: MeshBlobMap;
    urdfBasePath?: string;
    packageRoots?: PackageRootMap;
  }
) => {
  const { ref, meshFiles, urdfBasePath, packageRoots } = params;
  const matches: Array<{ ref: string; resolvedPath: string; blob: Blob }> = [];
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
    matches.push({
      ref: candidateRef,
      resolvedPath: resolved.path,
      blob: resolved.blob,
    });
  });
  return matches;
};

export const fixMissingMeshReferences = (
  urdfContent: string,
  meshFiles: Record<string, Blob> | undefined,
  options: {
    basePath?: string;
    packageRoots?: PackageRootMap;
  } = {}
) => {
  const mergedPackageRoots = mergePackageRootsWithMeshFiles(meshFiles, options.packageRoots);
  const initialResult = fixMissingMeshReferencesBase(urdfContent, meshFiles, {
    ...options,
    packageRoots: mergedPackageRoots,
  });
  if (!meshFiles || initialResult.unresolved.length === 0) {
    return initialResult;
  }

  const parsed = parseURDF(initialResult.content);
  if (!parsed.isValid) {
    return initialResult;
  }

  const unresolvedReferences = new Set(initialResult.unresolved);
  const extraCorrections: typeof initialResult.corrections = [];
  const meshElements = Array.from(parsed.document.querySelectorAll("mesh"));
  meshElements.forEach((mesh) => {
    const filename = mesh.getAttribute("filename")?.trim();
    if (!filename || !unresolvedReferences.has(filename)) {
      return;
    }

    const resolved = resolveMeshBlobFromReference(
      filename,
      meshFiles,
      options.basePath,
      mergedPackageRoots
    );
    if (!resolved) {
      return;
    }

    const refInfo = parseMeshReference(filename);
    const corrected = buildPreferredMeshReference(
      resolved.path,
      options.basePath,
      mergedPackageRoots,
      refInfo.packageName,
      refInfo.scheme === "package"
    );
    if (!corrected || corrected === filename) {
      return;
    }

    mesh.setAttribute("filename", corrected);
    unresolvedReferences.delete(filename);
    extraCorrections.push({
      original: filename,
      corrected,
      reason: "Resolved meshes/assets directory alias",
    });
  });

  if (extraCorrections.length === 0) {
    return initialResult;
  }

  return {
    ...initialResult,
    content: serializeURDF(parsed.document),
    corrections: [...initialResult.corrections, ...extraCorrections],
    unresolved: initialResult.unresolved.filter((ref) => unresolvedReferences.has(ref)),
  };
};
