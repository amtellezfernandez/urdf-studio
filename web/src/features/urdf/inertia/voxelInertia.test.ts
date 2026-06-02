/** @vitest-environment jsdom */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { computeVoxelMassPropertiesFromObject } from "./voxelInertia";

describe("voxelInertia", () => {
  it("estimates mass properties for a closed box mesh", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    const properties = computeVoxelMassPropertiesFromObject(mesh, 1000, 18);

    expect(properties).not.toBeNull();
    expect(properties?.volume).toBeGreaterThan(0.7);
    expect(properties?.volume).toBeLessThan(1.3);
    expect(properties?.mass).toBeGreaterThan(700);
    expect(properties?.mass).toBeLessThan(1300);
    expect(properties?.centerOfMass.length()).toBeLessThan(0.1);
  });
});
