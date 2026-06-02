import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cloneOwnedSceneTemplate,
  sceneNeedsTemplatePreservation,
} from "@runtime-private/urdf/meshSceneTemplate";

describe("meshSceneTemplate", () => {
  it("requires template preservation for multi-material meshes", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)
    );
    geometry.addGroup(0, 3, 0);
    geometry.addGroup(0, 3, 1);

    const mesh = new THREE.Mesh(geometry, [
      new THREE.MeshBasicMaterial({ color: 0xff0000 }),
      new THREE.MeshBasicMaterial({ color: 0x00ff00 }),
    ]);
    const scene = new THREE.Group();
    scene.add(mesh);

    expect(sceneNeedsTemplatePreservation(scene)).toBe(true);
  });

  it("requires template preservation for textured meshes and clones textures by ownership", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)
    );

    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, map: texture });
    const mesh = new THREE.Mesh(geometry, material);
    const scene = new THREE.Group();
    scene.add(mesh);

    expect(sceneNeedsTemplatePreservation(scene)).toBe(true);

    const clonedScene = cloneOwnedSceneTemplate(scene);
    const clonedMesh = clonedScene.children[0] as THREE.Mesh;
    const clonedMaterial = clonedMesh.material as THREE.MeshStandardMaterial;

    expect(clonedMesh).not.toBe(mesh);
    expect(clonedMesh.geometry).not.toBe(mesh.geometry);
    expect(clonedMaterial).not.toBe(material);
    expect(clonedMaterial.map).toBeDefined();
    expect(clonedMaterial.map).not.toBe(texture);
  });
});
