import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createWorldLabsSplatGroundProbe,
  estimateWorldLabsGroundSurface,
} from "./worldLabsSplatGroundProbe";

const intersectionObject = new THREE.Object3D();

describe("createWorldLabsSplatGroundProbe", () => {
  it("samples a horizontal splat surface with downward rays", () => {
    const probe = createWorldLabsSplatGroundProbe({
      packageId: "world-labs-test",
      raycast: (raycaster) => {
        const point = new THREE.Vector3();
        const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point);
        if (!hit) return [];
        return [
          {
            distance: hit.distanceTo(raycaster.ray.origin),
            point: hit.clone(),
            object: intersectionObject,
          },
        ];
      },
    });

    const result = probe.probeDown(new THREE.Vector3(0, 2, 0), {
      maxDistance: 5,
      sampleRadius: 0.25,
    });

    expect(result).not.toBeNull();
    expect(result?.point.y).toBeCloseTo(0);
    expect(result?.normal.y).toBeGreaterThan(0.99);
    expect(result?.hitCount).toBe(9);
    expect(result?.confidence).toBeGreaterThan(0.95);
  });

  it("returns null when too few rays hit the splat", () => {
    const probe = createWorldLabsSplatGroundProbe({
      packageId: "world-labs-test",
      raycast: () => [],
    });

    expect(probe.probeDown(new THREE.Vector3(0, 2, 0))).toBeNull();
  });
});

describe("estimateWorldLabsGroundSurface", () => {
  it("estimates a tilted local surface normal from hit points", () => {
    const samples = [
      { offsetU: 0, offsetV: 0, point: new THREE.Vector3(0, 0, 0) },
      { offsetU: 1, offsetV: 0, point: new THREE.Vector3(1, 0.2, 0) },
      { offsetU: -1, offsetV: 0, point: new THREE.Vector3(-1, -0.2, 0) },
      { offsetU: 0, offsetV: 1, point: new THREE.Vector3(0, 0, 1) },
      { offsetU: 0, offsetV: -1, point: new THREE.Vector3(0, 0, -1) },
    ];

    const result = estimateWorldLabsGroundSurface({
      samples,
      sampleCount: 5,
      sampleRadius: 1,
      surfaceTolerance: 0.05,
    });

    expect(result).not.toBeNull();
    expect(result?.normal.y).toBeGreaterThan(0.95);
    expect(result?.normal.x).toBeLessThan(0);
    expect(result?.maxPlaneResidual).toBeLessThan(1e-6);
  });
});
