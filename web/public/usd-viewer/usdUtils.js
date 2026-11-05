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
// Coordinate-frame adapter shared by native USD loading and diagnostics.
// URDF Studio's canonical workspace frame is Z-up. This deliberately does
// not guess when a source stage omits or declares an unsupported axis.
export function resolveAxisAdapter(sourceUpAxis, targetUpAxis = "z") {
  const source = String(sourceUpAxis || "").trim().toLowerCase();
  const target = String(targetUpAxis || "z").trim().toLowerCase();
  const supported = new Set(["x", "y", "z"]);
  if (!supported.has(source) || !supported.has(target)) {
    return {
      sourceUpAxis: source || null,
      targetUpAxis: target,
      rotationEuler: [0, 0, 0],
      applied: false,
      confidence: "unknown",
      warning: "USD stage up-axis is missing or unsupported; no axis remap was applied.",
    };
  }
  if (source === target) {
    return {
      sourceUpAxis: source,
      targetUpAxis: target,
      rotationEuler: [0, 0, 0],
      applied: false,
      confidence: "declared",
      warning: null,
    };
  }
  const rotations = {
    "x->z": [0, -Math.PI / 2, 0],
    "y->z": [Math.PI / 2, 0, 0],
    "z->x": [0, Math.PI / 2, 0],
    "z->y": [-Math.PI / 2, 0, 0],
    "x->y": [0, 0, -Math.PI / 2],
    "y->x": [0, 0, Math.PI / 2],
  };
  return {
    sourceUpAxis: source,
    targetUpAxis: target,
    rotationEuler: rotations[`${source}->${target}`] || [0, 0, 0],
    applied: true,
    confidence: "declared",
    warning: null,
  };
}
