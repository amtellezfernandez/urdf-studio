import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  buildUrdfOriginAttributes,
  composeUrdfOriginMatrix,
  createFullUrdfOriginBake,
  decomposeUrdfOriginMatrix,
  IDENTITY_URDF_ORIGIN,
  resolveUrdfOriginBake,
  URDF_BAKE_SCALE_EPSILON,
} from "./transformMath";

const POSITION_EPSILON = 1e-8;
const ROTATION_ALIGNMENT_MIN_DOT = 0.999999;
const HALF_PI_RAD = Math.PI / 2;
const TEST_ORIGIN = {
  xyz: [0.2, -0.3, 0.4] as [number, number, number],
  rpy: [0.15, -0.25, 0.35] as [number, number, number],
};

const expectMatrixAlignment = (left: THREE.Matrix4, right: THREE.Matrix4) => {
  const leftPosition = new THREE.Vector3();
  const leftRotation = new THREE.Quaternion();
  const leftScale = new THREE.Vector3();
  const rightPosition = new THREE.Vector3();
  const rightRotation = new THREE.Quaternion();
  const rightScale = new THREE.Vector3();

  left.decompose(leftPosition, leftRotation, leftScale);
  right.decompose(rightPosition, rightRotation, rightScale);

  expect(leftPosition.distanceTo(rightPosition)).toBeLessThan(POSITION_EPSILON);
  expect(Math.abs(leftRotation.normalize().dot(rightRotation.normalize()))).toBeGreaterThan(
    ROTATION_ALIGNMENT_MIN_DOT
  );
  expect(leftScale.distanceTo(rightScale)).toBeLessThan(URDF_BAKE_SCALE_EPSILON);
};

describe("transformMath", () => {
  it("roundtrips a rigid URDF origin through Matrix4 composition and decomposition", () => {
    const matrix = composeUrdfOriginMatrix(TEST_ORIGIN);
    const decomposedOrigin = decomposeUrdfOriginMatrix(matrix);
    const recomposedMatrix = composeUrdfOriginMatrix(decomposedOrigin);

    expectMatrixAlignment(recomposedMatrix, matrix);
  });

  it("resolves a full bake to an identity residual origin", () => {
    const result = createFullUrdfOriginBake(TEST_ORIGIN);

    expect(result.bakedOrigin).toEqual(IDENTITY_URDF_ORIGIN);
    expectMatrixAlignment(result.bakeMatrix, composeUrdfOriginMatrix(TEST_ORIGIN));
  });

  it("keeps the transform contract consistent for a partial bake", () => {
    const partialBakeMatrix = new THREE.Matrix4().makeRotationZ(HALF_PI_RAD);
    const result = resolveUrdfOriginBake(TEST_ORIGIN, partialBakeMatrix);

    const originalMatrix = composeUrdfOriginMatrix(result.originalOrigin);
    const residualMatrix = composeUrdfOriginMatrix(result.bakedOrigin);
    const recomposedMatrix = residualMatrix.clone().multiply(result.bakeMatrix);

    expectMatrixAlignment(recomposedMatrix, originalMatrix);
  });

  it("formats URDF origin attributes with clean identity values", () => {
    expect(buildUrdfOriginAttributes(IDENTITY_URDF_ORIGIN)).toEqual({
      xyz: "0 0 0",
      rpy: "0 0 0",
    });
  });

  it("rejects non-rigid bake matrices with non-unit scale", () => {
    const scaledBakeMatrix = new THREE.Matrix4().makeScale(2, 1, 1);

    expect(() => resolveUrdfOriginBake(TEST_ORIGIN, scaledBakeMatrix)).toThrow(
      "URDF origin bake math only supports rigid transforms with unit scale."
    );
  });
});
