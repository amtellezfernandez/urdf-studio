import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  buildAxisFrameBasis,
  localDirectionFromWorld,
  projectDirectionOntoPlane,
  projectVectorOntoPlane,
  resolveForwardWorldFromWheelAxes,
  worldDirectionFromLocal,
} from "./axisFrame";

const ORTHOGONALITY_THRESHOLD = 1e-8;
const ALIGNMENT_THRESHOLD = 0.99;
const TEST_ROBOT_ROTATION_Y = Math.PI / 3;

describe("axisFrame", () => {
  it("builds a right-handed orthonormal basis from forward/up hints", () => {
    const basis = buildAxisFrameBasis({
      forwardHint: new THREE.Vector3(1, 0.2, 0.1),
      upHint: new THREE.Vector3(0, 0, 1),
    });
    expect(Math.abs(basis.forward.length() - 1)).toBeLessThan(ORTHOGONALITY_THRESHOLD);
    expect(Math.abs(basis.right.length() - 1)).toBeLessThan(ORTHOGONALITY_THRESHOLD);
    expect(Math.abs(basis.up.length() - 1)).toBeLessThan(ORTHOGONALITY_THRESHOLD);
    expect(Math.abs(basis.forward.dot(basis.right))).toBeLessThan(ORTHOGONALITY_THRESHOLD);
    expect(Math.abs(basis.forward.dot(basis.up))).toBeLessThan(ORTHOGONALITY_THRESHOLD);
    expect(Math.abs(basis.right.dot(basis.up))).toBeLessThan(ORTHOGONALITY_THRESHOLD);
    const recomposedUp = new THREE.Vector3()
      .crossVectors(basis.forward, basis.right)
      .normalize();
    expect(recomposedUp.dot(basis.up)).toBeGreaterThan(ALIGNMENT_THRESHOLD);
  });

  it("projects direction onto plane and falls back deterministically", () => {
    const projected = projectDirectionOntoPlane(
      new THREE.Vector3(1, 2, 3),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 0, 0)
    );
    expect(Math.abs(projected.z)).toBeLessThan(ORTHOGONALITY_THRESHOLD);
    expect(projected.length()).toBeCloseTo(1, 9);
  });

  it("projects vectors onto plane without normalizing magnitude", () => {
    const projected = projectVectorOntoPlane(
      new THREE.Vector3(2, 3, 4),
      new THREE.Vector3(0, 0, 1)
    );
    expect(projected.x).toBeCloseTo(2, 9);
    expect(projected.y).toBeCloseTo(3, 9);
    expect(projected.z).toBeCloseTo(0, 9);
  });

  it("converts local/world direction without drift", () => {
    const worldQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, TEST_ROBOT_ROTATION_Y, 0, "XYZ")
    );
    const localDirection = new THREE.Vector3(1, 0, 0);
    const worldDirection = worldDirectionFromLocal(localDirection, worldQuaternion);
    const roundtripLocal = localDirectionFromWorld(worldDirection, worldQuaternion);
    expect(roundtripLocal.dot(localDirection)).toBeGreaterThan(ALIGNMENT_THRESHOLD);
  });

  it("resolves wheel forward axis from average wheel axis and up reference", () => {
    const forward = resolveForwardWorldFromWheelAxes(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 0, 0)
    );
    expect(Math.abs(forward.z)).toBeLessThan(ORTHOGONALITY_THRESHOLD);
    expect(forward.dot(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(ALIGNMENT_THRESHOLD);
  });
});
