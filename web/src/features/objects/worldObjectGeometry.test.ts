import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_CUBE_SIZE,
  DEFAULT_CYLINDER_DIAMETER,
  DEFAULT_CYLINDER_HEIGHT,
  DEFAULT_POINT_SIZE,
  DEFAULT_SPHERE_DIAMETER,
} from "@/features/objects/objectCreatorHelpers";
import {
  normalizeWorldObjectPositionVector,
  normalizeWorldObjectSizeVector,
  resolveWorldObjectGeometry,
} from "@/features/objects/worldObjectGeometry";
import { WORLD_OBJECT_GEOMETRY_PARAMS } from "@/features/objects/worldObjectGeometryParams";

const TEST_VALID_POINT_SIZE = 0.14;
const TEST_VALID_POSITION = new THREE.Vector3(1.5, -0.4, 0.2);

describe("worldObjectGeometry", () => {
  it("keeps finite world positions and zeroes invalid coordinates", () => {
    const normalized = normalizeWorldObjectPositionVector({
      x: Number.NaN,
      y: TEST_VALID_POSITION.y,
      z: Number.POSITIVE_INFINITY,
    });
    expect(normalized.x).toBe(WORLD_OBJECT_GEOMETRY_PARAMS.fallbackPositionM);
    expect(normalized.y).toBe(TEST_VALID_POSITION.y);
    expect(normalized.z).toBe(WORLD_OBJECT_GEOMETRY_PARAMS.fallbackPositionM);
  });

  it("keeps explicit point size when all dimensions are positive and finite", () => {
    const normalized = normalizeWorldObjectSizeVector({
      type: "point",
      size: {
        x: TEST_VALID_POINT_SIZE,
        y: TEST_VALID_POINT_SIZE,
        z: TEST_VALID_POINT_SIZE,
      },
    });
    expect(normalized.x).toBe(TEST_VALID_POINT_SIZE);
    expect(normalized.y).toBe(TEST_VALID_POINT_SIZE);
    expect(normalized.z).toBe(TEST_VALID_POINT_SIZE);
  });

  it("falls back to default point size when any dimension is invalid", () => {
    const normalized = normalizeWorldObjectSizeVector({
      type: "point",
      size: { x: TEST_VALID_POINT_SIZE, y: 0, z: TEST_VALID_POINT_SIZE },
    });
    expect(normalized.x).toBe(DEFAULT_POINT_SIZE);
    expect(normalized.y).toBe(DEFAULT_POINT_SIZE);
    expect(normalized.z).toBe(DEFAULT_POINT_SIZE);
  });

  it("clamps cube size components to a valid minimum and finite fallback", () => {
    const normalized = normalizeWorldObjectSizeVector({
      type: "cube",
      size: {
        x: Number.NaN,
        y: -0.25,
        z: 0.3,
      },
    });
    expect(normalized.x).toBe(Math.max(DEFAULT_CUBE_SIZE, WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM));
    expect(normalized.y).toBe(WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM);
    expect(normalized.z).toBe(0.3);
  });

  it("normalizes spheres to a uniform diameter", () => {
    const normalized = normalizeWorldObjectSizeVector({
      type: "sphere",
      size: {
        x: 0.1,
        y: 0.2,
        z: Number.NaN,
      },
    });
    expect(normalized.x).toBe(DEFAULT_SPHERE_DIAMETER);
    expect(normalized.y).toBe(DEFAULT_SPHERE_DIAMETER);
    expect(normalized.z).toBe(DEFAULT_SPHERE_DIAMETER);
  });

  it("normalizes cylinders to equal diameters with finite height", () => {
    const normalized = normalizeWorldObjectSizeVector({
      type: "cylinder",
      size: {
        x: 0.12,
        y: Number.NaN,
        z: 0,
      },
    });
    expect(normalized.x).toBe(DEFAULT_CYLINDER_DIAMETER);
    expect(normalized.y).toBe(DEFAULT_CYLINDER_DIAMETER);
    expect(normalized.z).toBe(WORLD_OBJECT_GEOMETRY_PARAMS.cylinderMinHeightM);
  });

  it("normalizes both position and size from one canonical resolver", () => {
    const normalized = resolveWorldObjectGeometry({
      type: "cube",
      position: { x: Number.NaN, y: 0.5, z: 0.25 },
      size: { x: 0, y: 0.2, z: Number.NaN },
    });
    expect(normalized.position.x).toBe(WORLD_OBJECT_GEOMETRY_PARAMS.fallbackPositionM);
    expect(normalized.position.y).toBe(0.5);
    expect(normalized.position.z).toBe(0.25);
    expect(normalized.size.x).toBe(WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM);
    expect(normalized.size.y).toBe(0.2);
    expect(normalized.size.z).toBe(Math.max(DEFAULT_CUBE_SIZE, WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM));
  });

  it("normalizes cylinder geometry through the canonical resolver", () => {
    const normalized = resolveWorldObjectGeometry({
      type: "cylinder",
      position: { x: 0.1, y: Number.NaN, z: 0.25 },
      size: { x: 0.12, y: 0.08, z: Number.NaN },
    });
    expect(normalized.position.x).toBe(0.1);
    expect(normalized.position.y).toBe(WORLD_OBJECT_GEOMETRY_PARAMS.fallbackPositionM);
    expect(normalized.size.x).toBe(0.12);
    expect(normalized.size.y).toBe(0.12);
    expect(normalized.size.z).toBe(DEFAULT_CYLINDER_HEIGHT);
  });
});
