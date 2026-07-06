import { COMMON_MESH_FOLDERS } from "@/features/layout/page/constants";
import { isSupportedMeshExtension } from "@/shared/lib/urdfCore";
import { getBrowserFileRelativePath } from "@/shared/lib/browserFilePaths";
import type { MeshFiles } from "@/shared/types/feature";
import type { IndexedMeshAsset } from "@/features/urdf/loader/urdfMeshDebugInfo";

type IndexMeshResourcesOptions = {
  logFailures?: boolean;
};

export const getFileRelativePath = getBrowserFileRelativePath;

const registerMeshKey = (
  meshes: MeshFiles,
  collisionKeys: Set<string>,
  key: string,
  blob: Blob
) => {
  if (!key) return;
  if (collisionKeys.has(key)) {
    return;
  }
  const existing = meshes[key];
  if (existing && existing !== blob) {
    collisionKeys.add(key);
    delete meshes[key];
    return;
  }
  meshes[key] = blob;
};

export const registerMeshFilePaths = (
  meshes: MeshFiles,
  collisionKeys: Set<string>,
  relativePath: string,
  filename: string,
  blob: Blob
) => {
  const normalizedPath = relativePath.replace(/^\/+|\/+$/g, "");
  const pathParts = normalizedPath.split("/").filter(Boolean);

  registerMeshKey(meshes, collisionKeys, filename, blob);
  registerMeshKey(meshes, collisionKeys, normalizedPath, blob);
  registerMeshKey(meshes, collisionKeys, `/${normalizedPath}`, blob);

  if (relativePath !== normalizedPath) {
    registerMeshKey(meshes, collisionKeys, relativePath, blob);
    const noLeadingSlash = relativePath.replace(/^\/+/, "");
    if (noLeadingSlash !== relativePath && noLeadingSlash !== normalizedPath) {
      registerMeshKey(meshes, collisionKeys, noLeadingSlash, blob);
    }
  }

  if (pathParts.length > 1) {
    const lastFolderAndFile = `${pathParts[pathParts.length - 2]}/${pathParts[pathParts.length - 1]}`;
    if (lastFolderAndFile !== normalizedPath) {
      registerMeshKey(meshes, collisionKeys, lastFolderAndFile, blob);
      registerMeshKey(meshes, collisionKeys, `/${lastFolderAndFile}`, blob);
    }

    for (let i = 0; i < pathParts.length; i++) {
      const suffixPath = pathParts.slice(i).join("/");
      registerMeshKey(meshes, collisionKeys, suffixPath, blob);
      registerMeshKey(meshes, collisionKeys, `/${suffixPath}`, blob);
    }

    const withoutFirst = pathParts.slice(1).join("/");
    registerMeshKey(meshes, collisionKeys, withoutFirst, blob);
    registerMeshKey(meshes, collisionKeys, `/${withoutFirst}`, blob);
  }

  try {
    const decodedPath = decodeURIComponent(normalizedPath);
    if (decodedPath !== normalizedPath) {
      registerMeshKey(meshes, collisionKeys, decodedPath, blob);
      registerMeshKey(meshes, collisionKeys, `/${decodedPath}`, blob);
    }
  } catch {
    // Ignore decode errors.
  }

  for (const folder of COMMON_MESH_FOLDERS) {
    registerMeshKey(meshes, collisionKeys, `${folder}/${filename}`, blob);
    registerMeshKey(meshes, collisionKeys, `/${folder}/${filename}`, blob);
  }
};

const warnOnAmbiguousMeshKeys = (collisionKeys: Set<string>) => {
  if (!import.meta.env.DEV || collisionKeys.size === 0) {
    return;
  }
  console.warn(
    `Skipped ${collisionKeys.size} ambiguous mesh key(s) due to basename collisions.`,
    Array.from(collisionKeys).slice(0, 10)
  );
};

export const indexMeshResources = async (
  files: readonly File[],
  initialMeshes: MeshFiles,
  options: IndexMeshResourcesOptions = {}
): Promise<{ meshAssets: IndexedMeshAsset[]; meshes: MeshFiles }> => {
  const meshes: MeshFiles = { ...initialMeshes };
  const collisionKeys = new Set<string>();
  const meshAssets = (
    await Promise.all(
      files.map(async (file): Promise<IndexedMeshAsset | null> => {
        try {
          const relativePath = getFileRelativePath(file);
          const blob = new Blob([await file.arrayBuffer()]);

          registerMeshFilePaths(meshes, collisionKeys, relativePath, file.name, blob);

          return isSupportedMeshExtension(file.name)
            ? {
                blob,
                filename: file.name,
                relativePath,
              }
            : null;
        } catch (error) {
          if (import.meta.env.DEV && options.logFailures) {
            console.warn(`Failed to load mesh: ${file.name}`, error);
          }
          return null;
        }
      })
    )
  ).filter((asset): asset is IndexedMeshAsset => asset !== null);

  warnOnAmbiguousMeshKeys(collisionKeys);

  return { meshAssets, meshes };
};
