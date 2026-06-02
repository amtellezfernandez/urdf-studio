import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { cloneIkDragReferenceCamera } from "@/features/viewer/ikDragCamera";

describe("ikDragCamera", () => {
  it("clones perspective camera projection and world pose for stable drag raycasts", () => {
    const source = new THREE.PerspectiveCamera(47, 1.7, 0.05, 75);
    source.position.set(1.2, -0.4, 2.8);
    source.quaternion.setFromEuler(new THREE.Euler(0.2, -0.4, 0.1, "XYZ"));
    source.zoom = 1.3;
    source.updateMatrixWorld(true);
    source.updateProjectionMatrix();

    const cloned = cloneIkDragReferenceCamera(source);

    expect(cloned).not.toBe(source);
    expect(cloned.position.toArray()).toEqual(source.position.toArray());
    expect(cloned.quaternion.toArray()).toEqual(source.quaternion.toArray());
    expect(cloned.projectionMatrix.elements).toEqual(source.projectionMatrix.elements);
    expect(cloned.matrixWorld.elements).toEqual(source.matrixWorld.elements);
  });
});
