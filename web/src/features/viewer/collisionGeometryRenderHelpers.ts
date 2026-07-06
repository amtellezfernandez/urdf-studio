import * as THREE from "three";

const COLLISION_OVERLAY_RENDER_PARAMS = {
  color: 0x808080,
  opacity: 0.32,
  depthTest: true,
  depthWrite: false,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
  renderOrder: 999,
} as const;

type CollisionOverlayMaterial = THREE.MeshBasicMaterial | THREE.MeshStandardMaterial;

const COLLISION_OVERLAY_MATERIAL_OPTIONS = {
  color: COLLISION_OVERLAY_RENDER_PARAMS.color,
  opacity: COLLISION_OVERLAY_RENDER_PARAMS.opacity,
  transparent: true,
  side: THREE.DoubleSide,
  depthWrite: COLLISION_OVERLAY_RENDER_PARAMS.depthWrite,
  depthTest: COLLISION_OVERLAY_RENDER_PARAMS.depthTest,
  polygonOffset: true,
  polygonOffsetFactor: COLLISION_OVERLAY_RENDER_PARAMS.polygonOffsetFactor,
  polygonOffsetUnits: COLLISION_OVERLAY_RENDER_PARAMS.polygonOffsetUnits,
} as const;

export const createCollisionOverlayMaterial = (
  isLowGPU: boolean
): CollisionOverlayMaterial =>
  isLowGPU
    ? new THREE.MeshBasicMaterial(COLLISION_OVERLAY_MATERIAL_OPTIONS)
    : new THREE.MeshStandardMaterial({
        ...COLLISION_OVERLAY_MATERIAL_OPTIONS,
        metalness: 0.1,
        roughness: 0.9,
      });

const markCollisionOverlayObject = (object: THREE.Object3D): void => {
  object.renderOrder = COLLISION_OVERLAY_RENDER_PARAMS.renderOrder;
  object.raycast = () => {};
  object.userData.isCollisionGeom = true;
  object.userData.isCollision = true;
};

export const configureCollisionOverlayMesh = (
  mesh: THREE.Mesh | THREE.InstancedMesh
): void => {
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  markCollisionOverlayObject(mesh);
};

export const configureCollisionOverlayInstancedMesh = (
  mesh: THREE.InstancedMesh
): void => {
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  configureCollisionOverlayMesh(mesh);
};
