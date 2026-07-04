import { indexMeshResources } from "@/features/urdf/loader/urdfMeshIndex";

const JSON_EXTENSION_PATTERN = /\.json$/i;
const WORLD_LAYOUT_NAME_HINT_PATTERN = /world[-_]?(layout|package|scene)/i;

export type WorldLayoutFolderSplit = {
  assetFiles: File[];
  layoutFile: File | null;
};

export type WorldLayoutFolderAssetMap = {
  assetMap: Record<string, string>;
  objectUrls: string[];
};

export const splitWorldLayoutFolderFiles = (files: readonly File[]): WorldLayoutFolderSplit => {
  const jsonFiles = files.filter((file) => JSON_EXTENSION_PATTERN.test(file.name));
  const layoutFile =
    jsonFiles.find((file) => WORLD_LAYOUT_NAME_HINT_PATTERN.test(file.name)) ??
    jsonFiles[0] ??
    null;
  const assetFiles = files.filter((file) => file !== layoutFile);
  return { assetFiles, layoutFile };
};

export const buildWorldLayoutFolderAssetMap = async (
  assetFiles: readonly File[]
): Promise<WorldLayoutFolderAssetMap> => {
  const { meshes } = await indexMeshResources(assetFiles, {});
  const objectUrlByBlob = new Map<Blob, string>();
  const assetMap: Record<string, string> = {};

  Object.entries(meshes).forEach(([assetKey, blob]) => {
    let objectUrl = objectUrlByBlob.get(blob);
    if (!objectUrl) {
      objectUrl = URL.createObjectURL(blob);
      objectUrlByBlob.set(blob, objectUrl);
    }
    assetMap[assetKey] = objectUrl;
  });

  return {
    assetMap,
    objectUrls: Array.from(objectUrlByBlob.values()),
  };
};
