import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  resolveRoverPlanarObjectApproachDistance,
  type ApproachObjectGeometry,
} from "./approachObjectDistance";

const CENTER_DISTANCE_METERS = 1;
const CUBE_SIZE_X_METERS = 0.4;
const CUBE_SIZE_Y_METERS = 0.2;
const CUBE_SIZE_Z_METERS = 0.2;
const POINT_DIAMETER_METERS = 0.02;
const LARGE_POINT_DIAMETER_METERS = 0.1;
const SUPPORT_X_METERS = CUBE_SIZE_X_METERS * 0.5;
const SUPPORT_Y_METERS = CUBE_SIZE_Y_METERS * 0.5;
const EXPECTED_DIAGONAL_SUPPORT_METERS = Math.sqrt(0.5) * (SUPPORT_X_METERS + SUPPORT_Y_METERS);
const ROTATED_EXPECTED_FORWARD_SUPPORT_METERS = SUPPORT_Y_METERS;

const createObject = (overrides: Partial<ApproachObjectGeometry> = {}): ApproachObjectGeometry => ({
  type: "cube",
  size: new THREE.Vector3(CUBE_SIZE_X_METERS, CUBE_SIZE_Y_METERS, CUBE_SIZE_Z_METERS),
  ...overrides,
});

describe("resolveRoverPlanarObjectApproachDistance", () => {
  it("subtracts cube support along forward direction to get surface distance", () => {
    const distance = resolveRoverPlanarObjectApproachDistance({
      object: createObject(),
      targetDirectionPlanarWorld: new THREE.Vector3(CENTER_DISTANCE_METERS, 0, 0),
    });
    expect(distance.centerDistanceM).toBeCloseTo(CENTER_DISTANCE_METERS);
    expect(distance.supportRadiusM).toBeCloseTo(SUPPORT_X_METERS);
    expect(distance.surfaceDistanceM).toBeCloseTo(CENTER_DISTANCE_METERS - SUPPORT_X_METERS);
  });

  it("computes directional support for diagonal approach directions", () => {
    const distance = resolveRoverPlanarObjectApproachDistance({
      object: createObject(),
      targetDirectionPlanarWorld: new THREE.Vector3(1, 1, 0),
    });
    expect(distance.supportRadiusM).toBeCloseTo(EXPECTED_DIAGONAL_SUPPORT_METERS);
    expect(distance.surfaceDistanceM).toBeCloseTo(
      Math.sqrt(2) - EXPECTED_DIAGONAL_SUPPORT_METERS
    );
  });

  it("respects cube rotation when resolving support radius", () => {
    const distance = resolveRoverPlanarObjectApproachDistance({
      object: createObject({
        rotation: new THREE.Euler(0, 0, Math.PI / 2),
      }),
      targetDirectionPlanarWorld: new THREE.Vector3(CENTER_DISTANCE_METERS, 0, 0),
    });
    expect(distance.supportRadiusM).toBeCloseTo(ROTATED_EXPECTED_FORWARD_SUPPORT_METERS);
    expect(distance.surfaceDistanceM).toBeCloseTo(
      CENTER_DISTANCE_METERS - ROTATED_EXPECTED_FORWARD_SUPPORT_METERS
    );
  });

  it("uses point radius for point targets", () => {
    const distance = resolveRoverPlanarObjectApproachDistance({
      object: createObject({
        type: "point",
        size: new THREE.Vector3(
          POINT_DIAMETER_METERS,
          POINT_DIAMETER_METERS,
          POINT_DIAMETER_METERS
        ),
      }),
      targetDirectionPlanarWorld: new THREE.Vector3(CENTER_DISTANCE_METERS, 0, 0),
    });
    expect(distance.supportRadiusM).toBeCloseTo(POINT_DIAMETER_METERS * 0.5);
    expect(distance.surfaceDistanceM).toBeCloseTo(
      CENTER_DISTANCE_METERS - POINT_DIAMETER_METERS * 0.5
    );
  });

  it("preserves imported point size for support radius calculations", () => {
    const distance = resolveRoverPlanarObjectApproachDistance({
      object: createObject({
        type: "point",
        size: new THREE.Vector3(
          LARGE_POINT_DIAMETER_METERS,
          LARGE_POINT_DIAMETER_METERS,
          LARGE_POINT_DIAMETER_METERS
        ),
      }),
      targetDirectionPlanarWorld: new THREE.Vector3(CENTER_DISTANCE_METERS, 0, 0),
    });
    expect(distance.supportRadiusM).toBeCloseTo(LARGE_POINT_DIAMETER_METERS * 0.5);
    expect(distance.surfaceDistanceM).toBeCloseTo(
      CENTER_DISTANCE_METERS - LARGE_POINT_DIAMETER_METERS * 0.5
    );
  });

  it("returns zero distances for near-zero planar direction vectors", () => {
    const distance = resolveRoverPlanarObjectApproachDistance({
      object: createObject(),
      targetDirectionPlanarWorld: new THREE.Vector3(0, 0, 0),
    });
    expect(distance.centerDistanceM).toBe(0);
    expect(distance.supportRadiusM).toBe(0);
    expect(distance.surfaceDistanceM).toBe(0);
  });

  it("returns zero distances for non-finite planar direction vectors", () => {
    const distance = resolveRoverPlanarObjectApproachDistance({
      object: createObject(),
      targetDirectionPlanarWorld: new THREE.Vector3(Number.NaN, 0, 0),
    });
    expect(distance.centerDistanceM).toBe(0);
    expect(distance.supportRadiusM).toBe(0);
    expect(distance.surfaceDistanceM).toBe(0);
  });

  it("ignores invalid object dimensions when resolving support radius", () => {
    const distance = resolveRoverPlanarObjectApproachDistance({
      object: createObject({
        size: new THREE.Vector3(Number.NaN, -1, Number.POSITIVE_INFINITY),
      }),
      targetDirectionPlanarWorld: new THREE.Vector3(CENTER_DISTANCE_METERS, 0, 0),
    });
    expect(distance.centerDistanceM).toBeCloseTo(CENTER_DISTANCE_METERS);
    expect(distance.supportRadiusM).toBe(0);
    expect(distance.surfaceDistanceM).toBeCloseTo(CENTER_DISTANCE_METERS);
  });

  it("never returns negative surface distance when object contains base projection", () => {
    const distance = resolveRoverPlanarObjectApproachDistance({
      object: createObject({
        size: new THREE.Vector3(4, 4, 4),
      }),
      targetDirectionPlanarWorld: new THREE.Vector3(0.2, 0, 0),
    });
    expect(distance.surfaceDistanceM).toBe(0);
    expect(distance.supportRadiusM).toBeCloseTo(0.2);
  });
});
