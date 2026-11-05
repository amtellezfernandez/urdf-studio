// Common utilities for the USD viewer

export const USD_EXTENSIONS = ["usd", "usdc", "usda", "usdz"];

export const ASSET_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "exr",
  "hdr",
  "tiff",
  "tga",
  "bmp",
  "webp",
  "obj",
  "fbx",
  "dae",
  "stl",
  "ply",
  "gltf",
  "glb",
  "wav",
  "mp3",
  "ogg",
  "json",
  "xml",
];

export function shouldInclude(name) {
  const ext = name.split(".").pop()?.toLowerCase();
  return USD_EXTENSIONS.includes(ext) || ASSET_EXTENSIONS.includes(ext);
}

export function isUsdFile(filename) {
  return USD_EXTENSIONS.includes(filename.split(".").pop()?.toLowerCase());
}

export async function getFileFromHandle(fileOrHandle) {
  return fileOrHandle.getFile ? await fileOrHandle.getFile() : fileOrHandle;
}

export function parseFilePath(fullPath, defaultName) {
  if (!fullPath) return { fileName: defaultName, directory: "/" };
  const fileName = fullPath.split("/").pop();
  const directory = fullPath.substring(0, fullPath.length - fileName.length);
  return { fileName, directory };
}

export function safeCall(obj, method, ...args) {
  try {
    if (obj && typeof obj[method] === "function") {
      return obj[method](...args);
    }
  } catch {}
  return null;
}

export async function getEntryFile(fileEntry) {
  try {
    return await new Promise((resolve, reject) =>
      fileEntry.file(resolve, reject)
    );
  } catch (err) {
    console.warn("Error getting file:", err);
    return null;
  }
}
