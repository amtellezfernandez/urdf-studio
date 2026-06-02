import * as THREE from "three";
import { ColladaLoader, GLTFLoader, OBJLoader, STLLoader } from "three-stdlib";
import { createWorkerTaskBroker } from "@/shared/lib/workerTaskRunner";
import { createLruCache, hashString } from "@/shared/lib/cache";
import type { MeshFiles } from "@/shared/types/feature";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";
import {
  getMeshSupportStatus,
  resolveMeshResourceBlob,
} from "./urdfCore";
import {
  createDefaultMeshMaterial,
  createMaterialFromPayload,
  isDefaultMeshMaterial,
  type SerializedMaterial,
} from "./meshMaterialPayload";
import {
  cloneOwnedSceneTemplate,
  sceneNeedsTemplatePreservation,
} from "./meshSceneTemplate";
import {
  ARRAY_CONSTRUCTORS,
  buildGeometryFromPayload,
  serializeGeometry,
  serializeMeshesFromScene,
  type MeshPayload,
  type SerializedAttribute,
} from "./meshDecodeShared";
import { acquireGeometry, hasGeometry, releaseGeometry } from "./meshResourceCache";
import { MESH_DECODE_PARAMS } from "./meshDecodeParams";

type MeshDecodeRequest = {
  arrayBuffer: ArrayBuffer;
  extension: string;
  filename?: string;
};

type MeshDecodeResponse = {
  id: number;
  ok: boolean;
  meshes?: MeshPayload[];
  format?: string;
  error?: string;
};

type MeshLayoutPart = {
  key: string;
  name?: string;
  material?: SerializedMaterial;
  transform?: MeshPayload["transform"];
};

type MeshLayout = {
  format: string;
  parts: MeshLayoutPart[];
};

type SceneTemplateCacheEntry = {
  format: string;
  template: THREE.Object3D;
};

type MeshLoadResult = {
  object: THREE.Object3D;
  format: string;
};

type PayloadMeshDecodeResult = {
  kind: "payload";
  layout: MeshLayout;
  payloads: MeshPayload[] | null;
  format: string;
};

type TemplateMeshDecodeResult = {
  kind: "template";
  format: string;
  templateKey: string;
};

type MeshDecodeResult = PayloadMeshDecodeResult | TemplateMeshDecodeResult;

type DecodedMeshSource =
  | {
      kind: "payload";
      format: string;
      payloads: MeshPayload[];
    }
  | {
      kind: "template";
      format: string;
      template: THREE.Object3D;
    };

type MeshLoadOptions = {
  blob: Blob;
  path: string;
  gpuMode: GPUMode;
  meshFiles?: MeshFiles;
  signal?: AbortSignal;
  timeoutMs?: number;
};

const MESH_DECODE_CONFIG = MESH_DECODE_PARAMS;
const layoutCache = createLruCache<MeshLayout>(MESH_DECODE_CONFIG.layoutCacheLimit);
const MESH_CACHE_SCHEMA_VERSION = MESH_DECODE_CONFIG.cacheSchemaVersion;
const SCENE_TEMPLATE_CACHE_LIMIT = MESH_DECODE_CONFIG.sceneTemplateCacheLimit;
type InFlightEntry = {
  promise: Promise<DecodedMeshSource>;
  controller: AbortController;
  subscribers: number;
};

const inFlight = new Map<string, InFlightEntry>();
const blobTokenCache = new WeakMap<Blob, string>();
const sceneTemplateCache = new Map<string, SceneTemplateCacheEntry>();
let nextBlobTokenId = MESH_DECODE_CONFIG.initialBlobTokenId;

const workerConcurrency = (() => {
  if (typeof navigator === "undefined") return MESH_DECODE_CONFIG.workerConcurrencyFallback;
  const cores = navigator.hardwareConcurrency ?? MESH_DECODE_CONFIG.defaultHardwareConcurrency;
  return Math.max(
    MESH_DECODE_CONFIG.minWorkerConcurrency,
    Math.min(MESH_DECODE_CONFIG.maxWorkerConcurrency, cores)
  );
})();

const broker = createWorkerTaskBroker<MeshDecodeRequest, MeshDecodeResponse>(
  () => {
    if (typeof Worker === "undefined") return null;
    return new Worker(new URL("./meshDecode.worker.ts", import.meta.url), { type: "module" });
  },
  { concurrency: workerConcurrency }
);

const getBlobToken = (blob: Blob) => {
  const existing = blobTokenCache.get(blob);
  if (existing) return existing;
  const token = `${MESH_DECODE_CONFIG.blobTokenPrefix}${nextBlobTokenId++}:${blob.size}`;
  blobTokenCache.set(blob, token);
  return token;
};

const disposeOwnedSceneTemplate = (root: THREE.Object3D) => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) {
      geometries.add(mesh.geometry);
    }
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    meshMaterials.forEach((material) => {
      if (materials.has(material)) return;
      materials.add(material);
      Object.values(material).forEach((value) => {
        if ((value as THREE.Texture | undefined)?.isTexture) {
          textures.add(value as THREE.Texture);
        }
      });
    });
  });

  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
};

const getCachedSceneTemplate = (key: string): SceneTemplateCacheEntry | null => {
  const cached = sceneTemplateCache.get(key);
  if (!cached) return null;
  sceneTemplateCache.delete(key);
  sceneTemplateCache.set(key, cached);
  return cached;
};

const setCachedSceneTemplate = (key: string, entry: SceneTemplateCacheEntry) => {
  const previous = sceneTemplateCache.get(key);
  if (previous) {
    sceneTemplateCache.delete(key);
    if (previous.template !== entry.template) {
      disposeOwnedSceneTemplate(previous.template);
    }
  }
  sceneTemplateCache.set(key, entry);

  while (sceneTemplateCache.size > SCENE_TEMPLATE_CACHE_LIMIT) {
    const oldestKey = sceneTemplateCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    const oldest = sceneTemplateCache.get(oldestKey);
    sceneTemplateCache.delete(oldestKey);
    if (oldest) {
      disposeOwnedSceneTemplate(oldest.template);
    }
  }
};

const buildMeshObject = (
  layout: MeshLayout,
  payloads: MeshPayload[] | null,
  gpuMode: GPUMode
): THREE.Object3D => {
  const payloadByKey = new Map<string, MeshPayload>();
  if (payloads) {
    layout.parts.forEach((part, index) => {
      const payload = payloads[index];
      if (payload) {
        payloadByKey.set(part.key, payload);
      }
    });
  }

  const createMesh = (part: MeshLayoutPart) => {
    const geometry = acquireGeometry(part.key, () => {
      const payload = payloadByKey.get(part.key);
      if (!payload) {
        throw new Error(`Missing geometry payload for ${part.key}`);
      }
      return buildGeometryFromPayload(payload.geometry);
    });

    const mesh = new THREE.Mesh(geometry, createMaterialFromPayload(part.material, gpuMode));
    mesh.castShadow = gpuMode === "high";
    mesh.receiveShadow = gpuMode === "high";
    mesh.userData.meshCacheKey = part.key;
    if (part.name) {
      mesh.name = part.name;
    }
    if (part.transform) {
      mesh.position.set(...part.transform.position);
      mesh.quaternion.set(...part.transform.quaternion);
      mesh.scale.set(...part.transform.scale);
    }
    return mesh;
  };

  if (layout.parts.length === 1) {
    return createMesh(layout.parts[0]);
  }

  const group = new THREE.Group();
  layout.parts.forEach((part) => {
    group.add(createMesh(part));
  });
  return group;
};

const buildLayout = (meshKey: string, format: string, payloads: MeshPayload[]): MeshLayout => ({
  format,
  parts: payloads.map((payload, index) => ({
    key: `${meshKey}#${index}`,
    name: payload.name,
    material: payload.material,
    transform: payload.transform,
  })),
});

const collectExistingLayout = (meshKey: string): MeshLayout | null => {
  const cached = layoutCache.get(meshKey);
  if (!cached) return null;
  const hasAllGeometry = cached.parts.every((part) => hasGeometry(part.key));
  if (!hasAllGeometry) {
    return null;
  }
  return cached;
};

const buildSceneTemplateResult = (scene: THREE.Object3D, format: string): DecodedMeshSource => {
  if (sceneNeedsTemplatePreservation(scene)) {
    return { kind: "template", format, template: scene };
  }
  return { kind: "payload", format, payloads: serializeMeshesFromScene(scene) };
};

const decodeMeshInWorker = async (
  arrayBuffer: ArrayBuffer,
  extension: string,
  filename: string | undefined,
  signal?: AbortSignal,
  timeoutMs = 45000
): Promise<MeshPayload[]> => {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

  const combinedController = new AbortController();
  const abort = () => combinedController.abort();
  signal?.addEventListener("abort", abort, { once: true });
  timeoutController.signal.addEventListener("abort", abort, { once: true });

  try {
    const response = await broker.run(
      {
        arrayBuffer,
        extension,
        filename,
      },
      {
        transfer: [arrayBuffer],
        signal: combinedController.signal,
      }
    );

    if (!response || !response.ok || !response.meshes) {
      const errorMsg = response?.error ?? "Worker decode failed";
      throw new Error(errorMsg);
    }
    return response.meshes;
  } finally {
    clearTimeout(timer);
  }
};

const decodeMeshOnMainThread = async (
  arrayBuffer: ArrayBuffer,
  extension: string,
  meshFiles: MeshFiles | undefined,
  basePath: string | undefined,
  gltfText?: string
) => {
  if (extension === "stl") {
    const loader = new STLLoader();
    const geometry = loader.parse(arrayBuffer);
    if (!geometry.attributes.normal && geometry.attributes.position) {
      const vertexCount = geometry.attributes.position.count;
      if (vertexCount < 10000) {
        geometry.computeVertexNormals();
      }
    }
    return {
      kind: "payload",
      format: extension,
      payloads: [{ geometry: serializeGeometry(geometry) } satisfies MeshPayload],
    } satisfies DecodedMeshSource;
  }

  const manager = new THREE.LoadingManager();
  const blobUrls: string[] = [];

  manager.setURLModifier((url) => {
    if (url.startsWith("data:")) {
      return url;
    }
    const resolved = resolveMeshResourceBlob(url, meshFiles, basePath);
    if (!resolved) return url;
    const blobUrl = URL.createObjectURL(resolved.blob);
    blobUrls.push(blobUrl);
    return blobUrl;
  });

  try {
    if (extension === "gltf" || extension === "glb") {
      const loader = new GLTFLoader(manager);
      const parseInput =
        extension === "gltf" ? gltfText ?? new TextDecoder().decode(arrayBuffer) : arrayBuffer;
      const scene = await new Promise<THREE.Group>((resolve, reject) => {
        loader.parse(parseInput, "", (result) => resolve(result.scene), (error) => reject(error));
      });
      return buildSceneTemplateResult(scene, extension);
    }

    if (extension === "obj") {
      const loader = new OBJLoader(manager);
      const text = new TextDecoder().decode(arrayBuffer);
      const object = loader.parse(text);
      return buildSceneTemplateResult(object, extension);
    }

    if (extension === "dae") {
      const loader = new ColladaLoader(manager);
      const text = new TextDecoder().decode(arrayBuffer);
      const hasZUpAxis = /<up_axis>\s*Z_UP\s*<\/up_axis>/i.test(text);
      const collada = loader.parse(text, "");
      if (hasZUpAxis) {
        collada.scene.rotation.x += Math.PI / 2;
        collada.scene.updateMatrixWorld(true);
      }
      return buildSceneTemplateResult(collada.scene, extension);
    }

    throw new Error(`Unsupported mesh format "${extension}".`);
  } finally {
    blobUrls.forEach((url) => URL.revokeObjectURL(url));
  }
};

const decodeMeshPayloads = async ({
  blob,
  path,
  meshFiles,
  signal,
  timeoutMs,
}: Pick<MeshLoadOptions, "blob" | "path" | "meshFiles" | "signal" | "timeoutMs">): Promise<MeshDecodeResult | null> => {
  if (signal?.aborted) return null;

  const support = getMeshSupportStatus(path);
  if (!support.ok) {
    const message =
      "reason" in support
        ? support.reason
        : "Unsupported mesh format.";
    throw new Error(message);
  }
  const extension = support.extension.slice(1);

  const blobToken = getBlobToken(blob);
  const basePath = path.includes("/") ? path.split("/").slice(0, -1).join("/") : "";
  const baseMeshKey = `v${MESH_CACHE_SCHEMA_VERSION}:${extension}:${blobToken}:${blob.size}`;

  const readCachedDecodeResult = (meshKey: string): MeshDecodeResult | null => {
    const cachedTemplate = getCachedSceneTemplate(meshKey);
    if (cachedTemplate) {
      return {
        kind: "template",
        format: cachedTemplate.format,
        templateKey: meshKey,
      };
    }
    const cachedLayout = collectExistingLayout(meshKey);
    if (cachedLayout) {
      return {
        kind: "payload",
        layout: cachedLayout,
        payloads: null,
        format: cachedLayout.format,
      };
    }
    return null;
  };

  const attachToInFlight = async (
    entry: InFlightEntry,
    abortSignal?: AbortSignal
  ): Promise<DecodedMeshSource | null> => {
    let detached = false;
    const detach = () => {
      if (detached) return;
      detached = true;
      entry.subscribers = Math.max(0, entry.subscribers - 1);
      if (entry.subscribers === 0) {
        entry.controller.abort();
      }
    };

    entry.subscribers += 1;

    if (abortSignal) {
      if (abortSignal.aborted) {
        detach();
        return null;
      }
      return new Promise<DecodedMeshSource | null>((resolve, reject) => {
        const onAbort = () => {
          abortSignal.removeEventListener("abort", onAbort);
          detach();
          resolve(null);
        };
        abortSignal.addEventListener("abort", onAbort, { once: true });

        entry.promise
          .then((result) => {
            abortSignal.removeEventListener("abort", onAbort);
            detach();
            resolve(abortSignal.aborted ? null : result);
          })
          .catch((error) => {
            abortSignal.removeEventListener("abort", onAbort);
            detach();
            reject(error);
          });
      });
    }

    try {
      return await entry.promise;
    } finally {
      detach();
    }
  };

  const finalizeDecodedMesh = (
    meshKey: string,
    payloads: DecodedMeshSource | null
  ): MeshDecodeResult | null => {
    if (!payloads) return null;

    if (payloads.kind === "template") {
      setCachedSceneTemplate(meshKey, {
        format: payloads.format,
        template: payloads.template,
      });
      return {
        kind: "template",
        format: payloads.format,
        templateKey: meshKey,
      };
    }

    if (payloads.payloads.length === 0) {
      throw new Error(`Failed to decode mesh ${path}`);
    }

    const layout = buildLayout(meshKey, payloads.format, payloads.payloads);
    layoutCache.set(meshKey, layout);

    return {
      kind: "payload",
      layout,
      payloads: payloads.payloads,
      format: layout.format,
    };
  };

  const createDecodeEntry = (
    meshKey: string,
    readSource: () => Promise<{
      arrayBuffer: ArrayBuffer;
      gltfText?: string;
    }>
  ): InFlightEntry => {
    const controller = new AbortController();
    const promise = (async () => {
      let sourceForFallback:
        | {
            arrayBuffer: ArrayBuffer;
            gltfText?: string;
          }
        | undefined;
      try {
        if (controller.signal.aborted) {
          throw new Error("Mesh decode aborted");
        }
        const source = await readSource();
        sourceForFallback = source;
        if (controller.signal.aborted) {
          throw new Error("Mesh decode aborted");
        }
        const requiresMainThread =
          extension !== "stl";

        if (requiresMainThread) {
          return decodeMeshOnMainThread(
            source.arrayBuffer,
            extension,
            meshFiles,
            basePath,
            source.gltfText
          );
        }
        return {
          kind: "payload",
          format: extension,
          payloads: await decodeMeshInWorker(
            source.arrayBuffer,
            extension,
            path,
            controller.signal,
            timeoutMs
          ),
        } satisfies DecodedMeshSource;
      } catch (error) {
        if (controller.signal.aborted) {
          throw error;
        }
        const fallbackBuffer = await blob.arrayBuffer();
        return decodeMeshOnMainThread(
          fallbackBuffer,
          extension,
          meshFiles,
          basePath,
          sourceForFallback?.gltfText
        );
      } finally {
        inFlight.delete(meshKey);
      }
    })();
    return { promise, controller, subscribers: 0 };
  };

  if (extension !== "gltf") {
    const cached = readCachedDecodeResult(baseMeshKey);
    if (cached) return cached;

    let entry = inFlight.get(baseMeshKey);
    if (!entry) {
      entry = createDecodeEntry(baseMeshKey, async () => ({
        arrayBuffer: await blob.arrayBuffer(),
      }));
      inFlight.set(baseMeshKey, entry);
    }

    const payloads = await attachToInFlight(entry, signal);
    return finalizeDecodedMesh(baseMeshKey, payloads);
  }

  const arrayBuffer = await blob.arrayBuffer();

  if (signal?.aborted) return null;

  let gltfText: string | undefined;
  let gltfHasExternalResources = false;
  let gltfExternalUris: string[] = [];

  if (extension === "gltf") {
    gltfText = new TextDecoder().decode(arrayBuffer);
    try {
      const data = JSON.parse(gltfText);
      const uris: string[] = [];
      const buffers = Array.isArray(data?.buffers) ? data.buffers : [];
      const images = Array.isArray(data?.images) ? data.images : [];
      buffers.forEach((buf: { uri?: string }) => {
        if (buf?.uri) uris.push(buf.uri);
      });
      images.forEach((img: { uri?: string }) => {
        if (img?.uri) uris.push(img.uri);
      });
      gltfExternalUris = uris.filter(
        (uri) => uri && !uri.startsWith("data:") && !uri.startsWith("http")
      );
      gltfHasExternalResources = gltfExternalUris.length > 0;
    } catch {
      gltfHasExternalResources = false;
      gltfExternalUris = [];
    }
  }

  if (extension === "gltf" && gltfHasExternalResources && !meshFiles) {
    throw new Error("GLTF external resources require accompanying files.");
  }

  let resourceSignatureHash = "";
  if (extension === "gltf" && gltfHasExternalResources && meshFiles) {
    const signatures = await Promise.all(
      gltfExternalUris.map(async (uri) => {
        const resolved = resolveMeshResourceBlob(uri, meshFiles, basePath);
        if (!resolved) {
          return `missing:${uri}`;
        }
        const resourceToken = getBlobToken(resolved.blob);
        return `${uri}:${resourceToken}:${resolved.blob.size}`;
      })
    );
    signatures.sort();
    if (signatures.length > 0) {
      resourceSignatureHash = hashString(signatures.join("|"));
    }
  }

  const meshKey = resourceSignatureHash ? `${baseMeshKey}:${resourceSignatureHash}` : baseMeshKey;
  const cached = readCachedDecodeResult(meshKey);
  if (cached) return cached;

  let entry = inFlight.get(meshKey);
  if (!entry) {
    entry = createDecodeEntry(meshKey, async () => ({ arrayBuffer, gltfText }));
    inFlight.set(meshKey, entry);
  }

  const payloads = await attachToInFlight(entry, signal);
  return finalizeDecodedMesh(meshKey, payloads);
};

const buildMeshObjectFromPayloads = (
  result: MeshDecodeResult,
  gpuMode: GPUMode
): THREE.Object3D => {
  if (result.kind === "template") {
    const cached = getCachedSceneTemplate(result.templateKey);
    if (!cached) {
      throw new Error(`Missing cached scene template for ${result.templateKey}`);
    }
    return cloneOwnedSceneTemplate(cached.template);
  }

  return buildMeshObject(result.layout, result.payloads, gpuMode);
};

const getPositionAttribute = (payload: MeshPayload): SerializedAttribute | null => {
  const attr = payload.geometry.attributes.position;
  if (!attr || attr.itemSize < 3) return null;
  return attr;
};

const buildTypedArray = (attr: SerializedAttribute) => {
  const ctor = ARRAY_CONSTRUCTORS[attr.type];
  const buffer = attr.buffer as ArrayBuffer;
  return new ctor(buffer, 0, attr.count);
};

const applyTransformToBounds = (
  min: THREE.Vector3,
  max: THREE.Vector3,
  transform?: MeshPayload["transform"]
) => {
  if (!transform) return { min, max };
  const position = new THREE.Vector3(...transform.position);
  const quaternion = new THREE.Quaternion(...transform.quaternion);
  const scale = new THREE.Vector3(...transform.scale);
  const matrix = new THREE.Matrix4().compose(position, quaternion, scale);

  const corners = [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ];

  const outMin = new THREE.Vector3(Infinity, Infinity, Infinity);
  const outMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const corner of corners) {
    corner.applyMatrix4(matrix);
    outMin.min(corner);
    outMax.max(corner);
  }
  return { min: outMin, max: outMax };
};

const computeBoundsFromPayloads = (payloads: MeshPayload[]) => {
  const globalMin = new THREE.Vector3(Infinity, Infinity, Infinity);
  const globalMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let hasData = false;

  for (const payload of payloads) {
    const positionAttr = getPositionAttribute(payload);
    if (!positionAttr) continue;
    const array = buildTypedArray(positionAttr);
    let localMinX = Infinity;
    let localMinY = Infinity;
    let localMinZ = Infinity;
    let localMaxX = -Infinity;
    let localMaxY = -Infinity;
    let localMaxZ = -Infinity;
    let hasLocalData = false;

    if (positionAttr.interleaved) {
      const { stride, offset } = positionAttr.interleaved;
      const vertexCount = stride > 0 ? Math.floor(array.length / stride) : 0;
      for (let i = 0; i < vertexCount; i += 1) {
        const base = i * stride + offset;
        const x = array[base];
        const y = array[base + 1];
        const z = array[base + 2];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        hasLocalData = true;
        localMinX = Math.min(localMinX, x);
        localMinY = Math.min(localMinY, y);
        localMinZ = Math.min(localMinZ, z);
        localMaxX = Math.max(localMaxX, x);
        localMaxY = Math.max(localMaxY, y);
        localMaxZ = Math.max(localMaxZ, z);
      }
    } else {
      for (let i = 0; i < array.length; i += positionAttr.itemSize) {
        const x = array[i];
        const y = array[i + 1];
        const z = array[i + 2];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        hasLocalData = true;
        localMinX = Math.min(localMinX, x);
        localMinY = Math.min(localMinY, y);
        localMinZ = Math.min(localMinZ, z);
        localMaxX = Math.max(localMaxX, x);
        localMaxY = Math.max(localMaxY, y);
        localMaxZ = Math.max(localMaxZ, z);
      }
    }

    if (!hasLocalData) continue;
    hasData = true;

    const transformed = applyTransformToBounds(
      new THREE.Vector3(localMinX, localMinY, localMinZ),
      new THREE.Vector3(localMaxX, localMaxY, localMaxZ),
      payload.transform
    );
    globalMin.min(transformed.min);
    globalMax.max(transformed.max);
  }

  if (!hasData) {
    return {
      min: new THREE.Vector3(-0.05, -0.05, -0.05),
      max: new THREE.Vector3(0.05, 0.05, 0.05),
      size: new THREE.Vector3(0.1, 0.1, 0.1),
      center: new THREE.Vector3(0, 0, 0),
    };
  }

  const size = new THREE.Vector3().subVectors(globalMax, globalMin);
  const center = new THREE.Vector3().addVectors(globalMin, globalMax).multiplyScalar(0.5);
  return { min: globalMin, max: globalMax, size, center };
};

export const loadMeshFromBlob = async ({
  blob,
  path,
  gpuMode,
  meshFiles,
  signal,
  timeoutMs,
}: MeshLoadOptions): Promise<MeshLoadResult | null> => {
  const decoded = await decodeMeshPayloads({ blob, path, meshFiles, signal, timeoutMs });
  if (!decoded) return null;
  return {
    object: buildMeshObjectFromPayloads(decoded, gpuMode),
    format: decoded.format,
  };
};

const disposeMaterial = (material: THREE.Material) => {
  Object.values(material).forEach((value) => {
    if ((value as THREE.Texture)?.isTexture) {
      (value as THREE.Texture).dispose();
    }
  });
  material.dispose();
};

export const disposeMeshResources = (root: THREE.Object3D) => {
  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const cacheKey = mesh.userData.meshCacheKey as string | undefined;
    if (cacheKey) {
      releaseGeometry(cacheKey);
    } else if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => disposeMaterial(material));
  });
};

export const updateMeshMaterialsForGpuMode = (root: THREE.Object3D, gpuMode: GPUMode) => {
  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const hasDefault = materials.some((material) => isDefaultMeshMaterial(material));
    if (hasDefault) {
      materials.forEach((material) => {
        if (isDefaultMeshMaterial(material)) {
          disposeMaterial(material);
        }
      });
      mesh.material = createDefaultMeshMaterial(gpuMode);
    }
    mesh.castShadow = gpuMode === "high";
    mesh.receiveShadow = gpuMode === "high";
  });
};
