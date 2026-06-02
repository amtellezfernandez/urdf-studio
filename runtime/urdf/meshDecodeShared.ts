import * as THREE from "three";
import {
  serializeMeshMaterial,
  type SerializedMaterial,
} from "./meshMaterialPayload";

export const ARRAY_CONSTRUCTORS = {
  Float32Array,
  Float64Array,
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
};

type ArrayType = keyof typeof ARRAY_CONSTRUCTORS;

export type SerializedAttribute = {
  buffer: ArrayBufferLike;
  type: ArrayType;
  itemSize: number;
  normalized?: boolean;
  count: number;
  interleaved?: {
    stride: number;
    offset: number;
  };
};

type GeometryPayload = {
  attributes: Record<string, SerializedAttribute>;
  index?: SerializedAttribute;
};

export type MeshPayload = {
  name?: string;
  geometry: GeometryPayload;
  material?: SerializedMaterial;
  transform?: {
    position: [number, number, number];
    quaternion: [number, number, number, number];
    scale: [number, number, number];
  };
};

type TypedArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array;

const cloneArray = (array: TypedArray) => {
  if (array.byteOffset === 0 && array.byteLength === array.buffer.byteLength) {
    return array;
  }
  return array.slice();
};

export const serializeGeometry = (geometry: THREE.BufferGeometry): GeometryPayload => {
  const attributes: Record<string, SerializedAttribute> = {};
  const interleavedCache = new WeakMap<TypedArray, TypedArray>();

  Object.entries(geometry.attributes).forEach(([name, attribute]) => {
    if (!attribute) {
      return;
    }

    if ((attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
      const interleaved = attribute as THREE.InterleavedBufferAttribute;
      const rawArray = interleaved.data.array as TypedArray;
      let sourceArray = interleavedCache.get(rawArray);
      if (!sourceArray) {
        sourceArray = cloneArray(rawArray);
        interleavedCache.set(rawArray, sourceArray);
      }
      const type = sourceArray.constructor.name as ArrayType;

      attributes[name] = {
        buffer: sourceArray.buffer,
        type,
        itemSize: interleaved.itemSize,
        normalized: interleaved.normalized,
        count: sourceArray.length,
        interleaved: {
          stride: interleaved.data.stride,
          offset: interleaved.offset,
        },
      };
      return;
    }

    const bufferAttribute = attribute as THREE.BufferAttribute;
    const sourceArray = cloneArray(bufferAttribute.array as TypedArray);
    const type = sourceArray.constructor.name as ArrayType;

    attributes[name] = {
      buffer: sourceArray.buffer,
      type,
      itemSize: bufferAttribute.itemSize,
      normalized: bufferAttribute.normalized,
      count: sourceArray.length,
    };
  });

  let indexPayload: SerializedAttribute | undefined;
  if (geometry.index?.array) {
    const sourceArray = cloneArray(geometry.index.array as TypedArray);
    const type = sourceArray.constructor.name as ArrayType;
    indexPayload = {
      buffer: sourceArray.buffer,
      type,
      itemSize: 1,
      normalized: geometry.index.normalized,
      count: sourceArray.length,
    };
  }

  return {
    attributes,
    index: indexPayload,
  };
};

export const serializeMeshesFromScene = (root: THREE.Object3D): MeshPayload[] => {
  root.updateMatrixWorld(true);
  const payloads: MeshPayload[] = [];

  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) {
      return;
    }

    const mesh = obj as THREE.Mesh;
    if (!mesh.geometry || !mesh.geometry.attributes?.position) {
      return;
    }

    // Bake the full world matrix into geometry to preserve exact hierarchy transforms.
    // This avoids TRS decomposition drift for some DAE/OBJ import graphs.
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);

    payloads.push({
      name: mesh.name || undefined,
      geometry: serializeGeometry(geometry),
      material: serializeMeshMaterial(mesh.material),
    });

    geometry.dispose();
  });

  return payloads;
};

const buildTypedArray = (payload: SerializedAttribute) => {
  const ctor = ARRAY_CONSTRUCTORS[payload.type];
  const buffer = payload.buffer as ArrayBuffer;
  return new ctor(buffer, 0, payload.count);
};

export const buildGeometryFromPayload = (payload: GeometryPayload): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry();

  Object.entries(payload.attributes).forEach(([name, attr]) => {
    const array = buildTypedArray(attr);
    if (attr.interleaved) {
      const interleaved = new THREE.InterleavedBuffer(array, attr.interleaved.stride);
      const attribute = new THREE.InterleavedBufferAttribute(
        interleaved,
        attr.itemSize,
        attr.interleaved.offset,
        attr.normalized ?? false
      );
      geometry.setAttribute(name, attribute);
    } else {
      geometry.setAttribute(name, new THREE.BufferAttribute(array, attr.itemSize, attr.normalized ?? false));
    }
  });

  if (payload.index) {
    const indexArray = buildTypedArray(payload.index);
    geometry.setIndex(new THREE.BufferAttribute(indexArray, payload.index.itemSize, payload.index.normalized ?? false));
  }

  return geometry;
};
