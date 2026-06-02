/// <reference lib="webworker" />

import * as THREE from "three";
import { GLTFLoader, STLLoader } from "three-stdlib";
import { describeSupportedMeshExtensions, isSupportedMeshExtension } from "./urdfCore";
import type { MeshPayload } from "./meshDecodeShared";
import { serializeGeometry, serializeMeshesFromScene } from "./meshDecodeShared";

type MeshDecodeRequest = {
  id: number;
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

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const collectTransferables = (meshes: MeshPayload[]) => {
  const buffers: ArrayBuffer[] = [];
  const seen = new Set<ArrayBuffer>();
  for (const mesh of meshes) {
    const { geometry } = mesh;
    Object.values(geometry.attributes).forEach((attr) => {
      if (attr.buffer instanceof ArrayBuffer && !seen.has(attr.buffer)) {
        buffers.push(attr.buffer);
        seen.add(attr.buffer);
      }
    });
    if (geometry.index?.buffer instanceof ArrayBuffer) {
      if (!seen.has(geometry.index.buffer)) {
        buffers.push(geometry.index.buffer);
        seen.add(geometry.index.buffer);
      }
    }
  }
  return buffers;
};

const parseStl = (arrayBuffer: ArrayBuffer) => {
  const loader = new STLLoader();
  const geometry = loader.parse(arrayBuffer);
  if (!geometry.attributes.normal && geometry.attributes.position) {
    const vertexCount = geometry.attributes.position.count;
    if (vertexCount < 10000) {
      geometry.computeVertexNormals();
    }
  }
  const payload: MeshPayload = {
    geometry: serializeGeometry(geometry),
  };
  return [payload];
};

const parseGltf = async (arrayBuffer: ArrayBuffer, extension: string) => {
  const loader = new GLTFLoader();
  const parseInput = extension === "gltf" ? new TextDecoder().decode(arrayBuffer) : arrayBuffer;
  const gltf = await new Promise<THREE.Group>((resolve, reject) => {
    loader.parse(
      parseInput,
      "",
      (result) => resolve(result.scene),
      (error) => reject(error)
    );
  });
  return serializeMeshesFromScene(gltf);
};

ctx.onmessage = async (event: MessageEvent<MeshDecodeRequest>) => {
  const { id, arrayBuffer, extension } = event.data;

  try {
    const normalizedExt = extension.toLowerCase();
    const extWithDot = normalizedExt.startsWith(".") ? normalizedExt : `.${normalizedExt}`;
    if (!isSupportedMeshExtension(extWithDot)) {
      ctx.postMessage({
        id,
        ok: false,
        error: `Unsupported mesh format "${extWithDot}". Supported formats: ${describeSupportedMeshExtensions()}.`,
      } satisfies MeshDecodeResponse);
      return;
    }

    let meshes: MeshPayload[];
    if (normalizedExt === "stl") {
      meshes = parseStl(arrayBuffer);
    } else if (normalizedExt === "glb" || normalizedExt === "gltf") {
      meshes = await parseGltf(arrayBuffer, normalizedExt);
    } else {
      ctx.postMessage({
        id,
        ok: false,
        error: `Unsupported mesh format "${extWithDot}". Supported formats: ${describeSupportedMeshExtensions()}.`,
      } satisfies MeshDecodeResponse);
      return;
    }

    if (!meshes || meshes.length === 0) {
      ctx.postMessage({ id, ok: false, error: "No mesh primitives found" } satisfies MeshDecodeResponse);
      return;
    }

    const transferables = collectTransferables(meshes);
    ctx.postMessage(
      { id, ok: true, meshes, format: normalizedExt } satisfies MeshDecodeResponse,
      transferables
    );
  } catch (error) {
    ctx.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : "Mesh decode failed",
    } satisfies MeshDecodeResponse);
  }
};
