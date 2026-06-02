import * as THREE from "three";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";
import { MESH_MATERIAL_PAYLOAD_PARAMS } from "./meshMaterialPayloadParams";

const MESH_MATERIAL_PAYLOAD_CONFIG = MESH_MATERIAL_PAYLOAD_PARAMS;
export const DEFAULT_MESH_MATERIAL_FLAG = MESH_MATERIAL_PAYLOAD_CONFIG.defaultMaterialFlag;

export type SerializedMaterial = {
  type: "basic" | "lambert" | "phong" | "standard";
  color?: [number, number, number];
  emissive?: [number, number, number];
  opacity?: number;
  transparent?: boolean;
  side?: number;
  metalness?: number;
  roughness?: number;
};

type MeshMaterialLike = THREE.Material & {
  isMeshBasicMaterial?: boolean;
  isMeshLambertMaterial?: boolean;
  isMeshPhongMaterial?: boolean;
  isMeshStandardMaterial?: boolean;
  color?: THREE.Color;
  emissive?: THREE.Color;
  metalness?: number;
  roughness?: number;
};

const serializeColor = (color: unknown): [number, number, number] | undefined => {
  const candidate = color as THREE.Color | undefined;
  if (!candidate?.isColor) return undefined;
  return [candidate.r, candidate.g, candidate.b];
};

const applySerializedColor = (
  target: THREE.Color | undefined,
  value?: [number, number, number]
) => {
  if (!target || !value) return;
  target.setRGB(value[0], value[1], value[2]);
};

export const serializeMeshMaterial = (
  material: THREE.Material | THREE.Material[] | null | undefined
): SerializedMaterial | undefined => {
  const candidate = (Array.isArray(material) ? material.find(Boolean) : material) as
    | MeshMaterialLike
    | undefined;
  if (!candidate) return undefined;

  const materialRecord: SerializedMaterial = {
    type: candidate.isMeshPhongMaterial
      ? "phong"
      : candidate.isMeshStandardMaterial
        ? "standard"
        : candidate.isMeshLambertMaterial
          ? "lambert"
          : candidate.isMeshBasicMaterial
            ? "basic"
            : "standard",
    opacity: candidate.opacity,
    transparent: candidate.transparent,
    side: candidate.side,
  };

  const color = serializeColor(candidate.color);
  if (color) {
    materialRecord.color = color;
  }

  const emissive = serializeColor(candidate.emissive);
  if (emissive) {
    materialRecord.emissive = emissive;
  }

  if (candidate.isMeshStandardMaterial) {
    materialRecord.metalness = candidate.metalness;
    materialRecord.roughness = candidate.roughness;
  }

  return materialRecord;
};

export const createDefaultMeshMaterial = (gpuMode: GPUMode) => {
  const isLow = gpuMode === "low";
  const material = isLow
    ? new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({
        metalness: MESH_MATERIAL_PAYLOAD_CONFIG.defaultStandardMaterial.metalness,
        roughness: MESH_MATERIAL_PAYLOAD_CONFIG.defaultStandardMaterial.roughness,
        side: THREE.DoubleSide,
      });
  material.userData[DEFAULT_MESH_MATERIAL_FLAG] = true;
  material.userData.gpuMode = gpuMode;
  return material;
};

export const createMaterialFromPayload = (
  material: SerializedMaterial | undefined,
  gpuMode: GPUMode
) => {
  if (!material) {
    return createDefaultMeshMaterial(gpuMode);
  }

  let nextMaterial: THREE.Material;
  switch (material.type) {
    case "basic":
      nextMaterial = new THREE.MeshBasicMaterial();
      break;
    case "lambert":
      nextMaterial = new THREE.MeshLambertMaterial();
      break;
    case "phong":
      nextMaterial = new THREE.MeshPhongMaterial();
      break;
    case "standard":
    default:
      nextMaterial = new THREE.MeshStandardMaterial();
      break;
  }

  nextMaterial.side = (material.side ?? THREE.DoubleSide) as THREE.Side;
  nextMaterial.opacity = material.opacity ?? MESH_MATERIAL_PAYLOAD_CONFIG.defaultOpacity;
  nextMaterial.transparent = material.transparent ?? nextMaterial.opacity < MESH_MATERIAL_PAYLOAD_CONFIG.defaultOpacity;
  nextMaterial.depthWrite = nextMaterial.opacity >= MESH_MATERIAL_PAYLOAD_CONFIG.defaultOpacity;

  const colorMaterial = nextMaterial as THREE.MeshStandardMaterial;
  applySerializedColor(colorMaterial.color, material.color);
  applySerializedColor(colorMaterial.emissive, material.emissive);

  if (nextMaterial instanceof THREE.MeshStandardMaterial) {
    nextMaterial.metalness = material.metalness ?? nextMaterial.metalness;
    nextMaterial.roughness = material.roughness ?? nextMaterial.roughness;
  }

  return nextMaterial;
};

export const isDefaultMeshMaterial = (material: THREE.Material) =>
  material.userData?.[DEFAULT_MESH_MATERIAL_FLAG] === true;
