import { describe, expect, it } from "vitest";
import { autoFitCollisionGeometry, type MeshBounds, type OriginData } from "@/features/urdf";

const makeBounds = (vertices: Float32Array): MeshBounds => {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    vertices,
  };
};

describe("autoFitCollisionGeometry", () => {
  it("computes an AABB in the link frame for box fits", () => {
    const vertices = new Float32Array([
      -1, -1, -1,
      1, -1, -1,
      -1, 1, -1,
      1, 1, -1,
      -1, -1, 1,
      1, -1, 1,
      -1, 1, 1,
      1, 1, 1,
    ]);
    const bounds = makeBounds(vertices);
    const origin: OriginData = {
      xyz: [1, 2, 3],
      rpy: [0, 0, 0],
    };

    const result = autoFitCollisionGeometry(bounds, origin, "box");

    expect(result?.geometryType).toBe("box");
    const size = result?.geometryParams.size.split(" ").map(Number) ?? [];
    expect(size[0]).toBeCloseTo(2);
    expect(size[1]).toBeCloseTo(2);
    expect(size[2]).toBeCloseTo(2);
    expect(result?.origin.xyz[0]).toBeCloseTo(1);
    expect(result?.origin.xyz[1]).toBeCloseTo(2);
    expect(result?.origin.xyz[2]).toBeCloseTo(3);
  });
});
