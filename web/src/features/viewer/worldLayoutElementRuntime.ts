import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

export type WorldLayoutElementVec3 = [number, number, number];

export type WorldLayoutElementAsset = {
  id: string;
  assetId: string;
  sourceWorldSlug: string;
  baseObjectId: string;
  name: string;
  url: string;
  metadataUrl?: string;
  realWorldHeightM?: number;
  realWorldFootprintM?: number;
  realWorldMassKg?: number;
};

export type WorldLayoutElementPlacement = {
  instanceId: string;
  objectId: string;
  assetId?: string;
  position: WorldLayoutElementVec3;
  rotation: WorldLayoutElementVec3;
  scale: WorldLayoutElementVec3;
};

export type WorldLayoutElementVisual = {
  scene: THREE.Object3D;
  offset: THREE.Vector3;
  size: THREE.Vector3;
  bounds: THREE.Box3;
};

export const WORLD_LAYOUT_ELEMENT_SCALE = 0.5;
const WORLD_LAYOUT_ELEMENT_MIN_METRIC_SCALE = 0.02;
const WORLD_LAYOUT_ELEMENT_MAX_METRIC_SCALE = 200;
const FALLBACK_FOOTPRINT_M = 2;
const OBJECT_GAP_M = 6;
const SPAWN_FRONT_CLEARANCE_M = 8;
const CHARACTER_SPAWN_Z = -0.5;

export function resolveWorldLayoutElementScale(
  realWorldHeightM: number | undefined,
  boundsHeight: number
): number {
  if (realWorldHeightM === undefined || boundsHeight <= 0) return WORLD_LAYOUT_ELEMENT_SCALE;
  return THREE.MathUtils.clamp(
    realWorldHeightM / boundsHeight,
    WORLD_LAYOUT_ELEMENT_MIN_METRIC_SCALE,
    WORLD_LAYOUT_ELEMENT_MAX_METRIC_SCALE
  );
}

function footprintOf(object: WorldLayoutElementAsset): number {
  return Math.max(
    object.realWorldFootprintM ?? object.realWorldHeightM ?? FALLBACK_FOOTPRINT_M,
    FALLBACK_FOOTPRINT_M
  );
}

export function createDefaultWorldLayoutElementPlacements(
  objects: WorldLayoutElementAsset[]
): WorldLayoutElementPlacement[] {
  const footprints = objects.map(footprintOf);
  const maxFootprint = footprints.reduce((max, footprint) => Math.max(max, footprint), FALLBACK_FOOTPRINT_M);
  const totalWidth =
    footprints.reduce((sum, footprint) => sum + footprint, 0) +
    OBJECT_GAP_M * Math.max(0, objects.length - 1);
  const rowZ = CHARACTER_SPAWN_Z - SPAWN_FRONT_CLEARANCE_M - maxFootprint / 2;

  let cursorX = -totalWidth / 2;
  return objects.map((object, index) => {
    const footprint = footprints[index] ?? FALLBACK_FOOTPRINT_M;
    const x = cursorX + footprint / 2;
    cursorX += footprint + OBJECT_GAP_M;
    return {
      instanceId: object.id,
      objectId: object.id,
      assetId: object.assetId,
      position: [x, 0, rowZ],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
  });
}

export function getInitialWorldLayoutElementPlacements(
  objects: WorldLayoutElementAsset[],
  savedPlacements?: WorldLayoutElementPlacement[]
): WorldLayoutElementPlacement[] {
  return savedPlacements ?? createDefaultWorldLayoutElementPlacements(objects);
}

export function mapSimuGenYUpPositionToStudioXyFloor(
  position: WorldLayoutElementVec3
): WorldLayoutElementVec3 {
  return [position[0], -position[2], position[1]];
}

export function createWorldLayoutElementVisual(
  sourceScene: THREE.Object3D,
  asset: Pick<WorldLayoutElementAsset, "id" | "name" | "metadataUrl">
): WorldLayoutElementVisual {
  const clonedScene = cloneSkeleton(sourceScene);
  const box = new THREE.Box3().setFromObject(clonedScene);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  clonedScene.name = asset.name;
  clonedScene.position.set(-center.x, -box.min.y, -center.z);
  clonedScene.userData.worldLayoutElementId = asset.id;
  clonedScene.userData.worldLayoutElementMetadata = asset.metadataUrl ?? null;
  clonedScene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = true;
  });

  return {
    scene: clonedScene,
    offset: new THREE.Vector3(-center.x, -box.min.y, -center.z),
    size,
    bounds: box.clone(),
  };
}
