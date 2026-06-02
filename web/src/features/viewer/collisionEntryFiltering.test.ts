import { describe, expect, it } from "vitest";
import type { CollisionEntry } from "@/shared/lib/urdfCore";
import {
  buildMeshCollisionPoseSet,
  shouldSkipPrimitiveCollisionWhenMeshOverlaps,
  toCollisionEntryPoseKey,
} from "@/features/viewer/collisionEntryFiltering";

const createCollisionEntry = (overrides?: Partial<CollisionEntry>): CollisionEntry => ({
  linkName: "wheel_link",
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

describe("collisionEntryFiltering", () => {
  it("builds mesh pose set from mesh collisions only", () => {
    const mesh = createCollisionEntry({
      geometry: {
        type: "mesh",
        filename: "wheel.stl",
        scale: [1, 1, 1],
      },
    });
    const box = createCollisionEntry();
    const poseSet = buildMeshCollisionPoseSet([mesh, box]);
    expect(poseSet.has(toCollisionEntryPoseKey(mesh))).toBe(true);
    expect(poseSet.size).toBe(1);
  });

  it("skips primitive collisions when mesh collision exists at same pose", () => {
    const mesh = createCollisionEntry({
      geometry: {
        type: "mesh",
        filename: "wheel.stl",
        scale: [1, 1, 1],
      },
    });
    const box = createCollisionEntry({
      geometry: {
        type: "box",
        size: [0.2, 0.2, 0.2],
      },
    });
    const poseSet = buildMeshCollisionPoseSet([mesh]);
    expect(shouldSkipPrimitiveCollisionWhenMeshOverlaps(box, poseSet)).toBe(true);
    expect(shouldSkipPrimitiveCollisionWhenMeshOverlaps(mesh, poseSet)).toBe(false);
  });

  it("keeps primitive collisions when pose does not overlap mesh pose", () => {
    const mesh = createCollisionEntry({
      geometry: {
        type: "mesh",
        filename: "wheel.stl",
        scale: [1, 1, 1],
      },
    });
    const cylinder = createCollisionEntry({
      origin: {
        xyz: [0.1, 0, 0],
        rpy: [0, 0, 0],
      },
      geometry: {
        type: "cylinder",
        radius: 0.5,
        length: 0.1,
      },
    });
    const poseSet = buildMeshCollisionPoseSet([mesh]);
    expect(shouldSkipPrimitiveCollisionWhenMeshOverlaps(cylinder, poseSet)).toBe(false);
  });
});
