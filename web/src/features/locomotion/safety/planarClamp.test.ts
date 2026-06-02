import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { enforcePlanarBasePose } from "@/features/locomotion/safety/planarClamp";

describe("enforcePlanarBasePose", () => {
  it("clamps y, roll, and pitch to planar constraints", () => {
    const object = new THREE.Object3D();
    object.position.set(1.2, 0.45, -0.7);
    object.rotation.set(0.31, 0.2, -0.18);

    const result = enforcePlanarBasePose(object);

    expect(result.clamped).toBe(true);
    expect(new Set(result.reasons)).toEqual(new Set(["y", "roll", "pitch"]));
    expect(object.position.y).toBeCloseTo(0, 8);
    expect(object.rotation.x).toBeCloseTo(0, 8);
    expect(object.rotation.z).toBeCloseTo(0, 8);
  });

  it("respects a custom ground-height function", () => {
    const object = new THREE.Object3D();
    object.position.set(2, -3, 4);
    object.rotation.set(0, 0.3, 0);

    const result = enforcePlanarBasePose(object, {
      groundHeightFn: (x, z) => x * 0.1 + z * 0.05,
    });

    expect(result.clamped).toBe(true);
    expect(result.floorHeight).toBeCloseTo(0.4, 8);
    expect(object.position.y).toBeCloseTo(0.4, 8);
    expect(object.rotation.y).toBeCloseTo(0.3, 8);
  });

  it("is a no-op when already planar", () => {
    const object = new THREE.Object3D();
    object.position.set(0, 0, 0);
    object.rotation.set(0, 1.2, 0);

    const result = enforcePlanarBasePose(object);

    expect(result.clamped).toBe(false);
    expect(result.reasons).toEqual([]);
    expect(object.position.y).toBe(0);
    expect(object.rotation.x).toBe(0);
    expect(object.rotation.z).toBe(0);
    expect(object.rotation.y).toBeCloseTo(1.2, 8);
  });
});
