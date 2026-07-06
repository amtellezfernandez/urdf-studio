import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  configureCollisionOverlayInstancedMesh,
  configureCollisionOverlayMesh,
  createCollisionOverlayMaterial,
} from "@/features/viewer/collisionGeometryRenderHelpers";

describe("collisionGeometryRenderHelpers", () => {
  it("uses a basic material for low GPU collision overlays", () => {
    const material = createCollisionOverlayMaterial(true);

    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(material.color.getHex()).toBe(0x808080);
    expect(material.opacity).toBe(0.32);
    expect(material.transparent).toBe(true);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.polygonOffset).toBe(true);

    material.dispose();
  });

  it("uses a standard material for higher GPU collision overlays", () => {
    const material = createCollisionOverlayMaterial(false);

    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((material as THREE.MeshStandardMaterial).metalness).toBe(0.1);
    expect((material as THREE.MeshStandardMaterial).roughness).toBe(0.9);

    material.dispose();
  });

  it("marks collision overlay meshes as non-interactive collision geometry", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      createCollisionOverlayMaterial(true)
    );

    configureCollisionOverlayMesh(mesh);

    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
    expect(mesh.renderOrder).toBe(999);
    expect(mesh.userData.isCollisionGeom).toBe(true);
    expect(mesh.userData.isCollision).toBe(true);

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  it("enables dynamic matrix updates for instanced collision overlays", () => {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      createCollisionOverlayMaterial(true),
      1
    );

    configureCollisionOverlayInstancedMesh(mesh);

    expect(mesh.instanceMatrix.usage).toBe(THREE.DynamicDrawUsage);
    expect(mesh.userData.isCollisionGeom).toBe(true);

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
});
