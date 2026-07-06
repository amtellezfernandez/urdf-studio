import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { CollisionEntry } from "@/shared/lib/urdfCore";
import {
  buildMeshCollisionProxyInstanceFromBounds,
  buildPrimitiveCollisionInstance,
} from "@/features/viewer/collisionGeometryInstances";

const createCollisionEntry = (
  overrides?: Partial<CollisionEntry>
): CollisionEntry => ({
  linkName: "base_link",
  index: 0,
  origin: {
    xyz: [0, 0, 0],
    rpy: [0, 0, 0],
  },
  geometry: {
    type: "box",
    size: [1, 1, 1],
  },
  ...overrides,
});

const decomposeMatrix = (matrix: THREE.Matrix4) => {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  return { position, quaternion, scale };
};

describe("collisionGeometryInstances", () => {
  it("builds primitive box collision instances", () => {
    const instance = buildPrimitiveCollisionInstance({
      collision: createCollisionEntry({
        origin: {
          xyz: [1, 2, 3],
          rpy: [0, 0, 0],
        },
        geometry: {
          type: "box",
          size: [0.2, 0.3, 0.4],
        },
      }),
      linkName: "base_link",
    });

    expect(instance?.primitiveType).toBe("box");
    const { position, scale } = decomposeMatrix(instance?.localMatrix ?? new THREE.Matrix4());
    expect(position.toArray()).toEqual([1, 2, 3]);
    expect(scale.toArray()).toEqual([0.2, 0.3, 0.4]);
  });

  it("uses diameter scale for merged sphere box proxies", () => {
    const instance = buildPrimitiveCollisionInstance({
      collision: createCollisionEntry({
        geometry: {
          type: "sphere",
          radius: 0.25,
        },
      }),
      linkName: "ball_link",
      useBoxProxyScale: true,
    });

    expect(instance?.primitiveType).toBe("sphere");
    const { scale } = decomposeMatrix(instance?.localMatrix ?? new THREE.Matrix4());
    expect(scale.toArray()).toEqual([0.5, 0.5, 0.5]);
  });

  it("builds mesh collision proxy instances from scaled bounds", () => {
    const instance = buildMeshCollisionProxyInstanceFromBounds({
      bounds: new THREE.Box3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(2, 4, 6)
      ),
      meshScale: [2, 0.5, 1],
      collision: createCollisionEntry({
        origin: {
          xyz: [10, 20, 30],
          rpy: [0, 0, 0],
        },
        geometry: {
          type: "mesh",
          filename: "body.stl",
          scale: [2, 0.5, 1],
        },
      }),
      linkName: "body_link",
    });

    expect(instance?.linkName).toBe("body_link");
    const { position, scale } = decomposeMatrix(instance?.localMatrix ?? new THREE.Matrix4());
    expect(position.toArray()).toEqual([12, 21, 33]);
    expect(scale.toArray()).toEqual([4, 2, 6]);
  });

  it("does not build mesh proxy instances from empty bounds", () => {
    expect(
      buildMeshCollisionProxyInstanceFromBounds({
        bounds: new THREE.Box3(),
        meshScale: [1, 1, 1],
        collision: createCollisionEntry(),
        linkName: "empty_link",
      })
    ).toBeNull();
  });
});
