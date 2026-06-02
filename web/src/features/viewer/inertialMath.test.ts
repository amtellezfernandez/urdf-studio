import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  computeEigenDecompositionSymmetric3x3,
  computeCollisionFittedInertiaBox,
  computeInertiaBox,
  computeInertiaBoxInInertialFrame,
  computeReliableInertiaBox,
} from "./inertialMath";

const createReferenceBoxPoints = (
  size: [number, number, number],
  center: [number, number, number] = [0, 0, 0]
) => {
  const [sx, sy, sz] = size;
  const [cx, cy, cz] = center;
  const hx = sx * 0.5;
  const hy = sy * 0.5;
  const hz = sz * 0.5;
  return [
    [cx - hx, cy - hy, cz - hz],
    [cx - hx, cy - hy, cz + hz],
    [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy + hy, cz + hz],
    [cx + hx, cy - hy, cz - hz],
    [cx + hx, cy - hy, cz + hz],
    [cx + hx, cy + hy, cz - hz],
    [cx + hx, cy + hy, cz + hz],
  ] as Array<[number, number, number]>;
};

const rotateReferencePoints = (
  points: Array<[number, number, number]>,
  rotation: THREE.Quaternion
): Array<[number, number, number]> =>
  points.map(([x, y, z]) => {
    const rotated = new THREE.Vector3(x, y, z).applyQuaternion(rotation);
    return [rotated.x, rotated.y, rotated.z];
  });

const ROTATION_ANGLE_RAD = Math.PI / 4;
const ROTATED_AXIS_ALIGNMENT_MIN = 0.999999;

describe("inertialMath", () => {
  it("solves the zero-tau Jacobi step for rotated symmetric tensors", () => {
    const matrix = new THREE.Matrix3().set(
      2, 1, 0,
      1, 2, 0,
      0, 0, 1
    );
    const eigen = computeEigenDecompositionSymmetric3x3(matrix);
    expect(eigen.values[0]).toBeCloseTo(3, 6);
    expect(eigen.values[1]).toBeCloseTo(1, 6);
    expect(eigen.values[2]).toBeCloseTo(1, 6);
    const dominantAxis = eigen.vectors[0].clone().normalize();
    const expectedAxis = new THREE.Vector3(
      Math.cos(ROTATION_ANGLE_RAD),
      Math.sin(ROTATION_ANGLE_RAD),
      0
    );
    expect(Math.abs(dominantAxis.dot(expectedAxis))).toBeGreaterThan(ROTATED_AXIS_ALIGNMENT_MIN);
  });

  it("computes an inertial-frame equivalent box from diagonal inertia", () => {
    const mass = 2;
    const inertia = {
      ixx: 13 / 6,
      ixy: 0,
      ixz: 0,
      iyy: 5 / 3,
      iyz: 0,
      izz: 5 / 6,
    };
    const box = computeInertiaBoxInInertialFrame(inertia, mass);
    expect(box).not.toBeNull();
    expect(box?.size[0]).toBeCloseTo(1, 6);
    expect(box?.size[1]).toBeCloseTo(2, 6);
    expect(box?.size[2]).toBeCloseTo(3, 6);
  });

  it("computes principal-axis equivalent box for valid inertia", () => {
    const mass = 2;
    const inertia = {
      ixx: 13 / 6,
      ixy: 0,
      ixz: 0,
      iyy: 5 / 3,
      iyz: 0,
      izz: 5 / 6,
    };
    const box = computeInertiaBox(inertia, mass);
    expect(box).not.toBeNull();
    expect(box?.size[0]).toBeCloseTo(1, 6);
    expect(box?.size[1]).toBeCloseTo(2, 6);
    expect(box?.size[2]).toBeCloseTo(3, 6);
  });

  it("recovers rotated principal axes from off-diagonal inertia", () => {
    const mass = 2;
    const principalIxx = 13 / 6;
    const principalIyy = 5 / 3;
    const principalIzz = 5 / 6;
    const rotatedDiagonal = (principalIxx + principalIyy) / 2;
    const rotatedOffDiagonal = (principalIxx - principalIyy) / 2;
    const inertia = {
      ixx: rotatedDiagonal,
      ixy: rotatedOffDiagonal,
      ixz: 0,
      iyy: rotatedDiagonal,
      iyz: 0,
      izz: principalIzz,
    };
    const box = computeInertiaBox(inertia, mass);
    expect(box).not.toBeNull();
    expect(box?.size[0]).toBeCloseTo(1, 6);
    expect(box?.size[1]).toBeCloseTo(2, 6);
    expect(box?.size[2]).toBeCloseTo(3, 6);
    const rotatedXAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(box!.rotation).normalize();
    const expectedAxis = new THREE.Vector3(
      Math.cos(ROTATION_ANGLE_RAD),
      Math.sin(ROTATION_ANGLE_RAD),
      0
    );
    expect(Math.abs(rotatedXAxis.dot(expectedAxis))).toBeGreaterThan(ROTATED_AXIS_ALIGNMENT_MIN);
  });

  it("rejects non-physical mass", () => {
    const inertia = { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 };
    expect(computeInertiaBox(inertia, 0)).toBeNull();
    expect(computeInertiaBoxInInertialFrame(inertia, 0)).toBeNull();
  });

  it("computes collision-fitted box from primitive collisions", () => {
    const fitted = computeCollisionFittedInertiaBox(
      [
        {
          type: "box",
          size: [1, 2, 3],
          origin: [0, 0, 0],
          rpy: [0, 0, 0],
        },
      ],
      [0, 0, 0],
      [0, 0, 0]
    );
    expect(fitted).not.toBeNull();
    const sortedSize = [...(fitted?.size ?? [])].sort((a, b) => a - b);
    expect(sortedSize[0]).toBeCloseTo(1, 6);
    expect(sortedSize[1]).toBeCloseTo(2, 6);
    expect(sortedSize[2]).toBeCloseTo(3, 6);
    expect(fitted?.center?.[0]).toBeCloseTo(0, 6);
    expect(fitted?.center?.[1]).toBeCloseTo(0, 6);
    expect(fitted?.center?.[2]).toBeCloseTo(0, 6);
  });

  it("tracks collision-fitted center offset in inertial frame", () => {
    const fitted = computeCollisionFittedInertiaBox(
      [
        {
          type: "box",
          size: [1, 1, 1],
          origin: [0.6, -0.2, 0.4],
          rpy: [0, 0, 0],
        },
      ],
      [0, 0, 0],
      [0, 0, 0]
    );
    expect(fitted).not.toBeNull();
    expect(fitted?.center?.[0]).toBeCloseTo(0.6, 6);
    expect(fitted?.center?.[1]).toBeCloseTo(-0.2, 6);
    expect(fitted?.center?.[2]).toBeCloseTo(0.4, 6);
  });

  it("fits rotated collision geometry without inflating the reference box", () => {
    const fitted = computeCollisionFittedInertiaBox(
      [
        {
          type: "box",
          size: [1, 2, 3],
          origin: [0, 0, 0],
          rpy: [0, 0, ROTATION_ANGLE_RAD],
        },
      ],
      [0, 0, 0],
      [0, 0, 0]
    );
    expect(fitted).not.toBeNull();
    const sortedSize = [...(fitted?.size ?? [])].sort((a, b) => a - b);
    expect(sortedSize[0]).toBeCloseTo(1, 6);
    expect(sortedSize[1]).toBeCloseTo(2, 6);
    expect(sortedSize[2]).toBeCloseTo(3, 6);
    expect(fitted?.center?.[0]).toBeCloseTo(0, 6);
    expect(fitted?.center?.[1]).toBeCloseTo(0, 6);
    expect(fitted?.center?.[2]).toBeCloseTo(0, 6);
  });

  it("prefers principal box when inertia and collisions agree", () => {
    const mass = 2;
    const inertia = {
      ixx: 13 / 6,
      ixy: 0,
      ixz: 0,
      iyy: 5 / 3,
      iyz: 0,
      izz: 5 / 6,
    };
    const result = computeReliableInertiaBox({
      inertia,
      mass,
      inertialOrigin: [0, 0, 0],
      inertialRpy: [0, 0, 0],
      collisions: [
        {
          type: "box",
          size: [1, 2, 3],
          origin: [0, 0, 0],
          rpy: [0, 0, 0],
        },
      ],
    });
    expect(result).not.toBeNull();
    expect(result?.strategy).toBe("principal");
    expect(result?.confidence).toBe("high");
    expect(result?.referenceSource).toBe("primitive");
  });

  it("marks valid inertia as unverified when no comparison geometry exists", () => {
    const mass = 2;
    const inertia = {
      ixx: 13 / 6,
      ixy: 0,
      ixz: 0,
      iyy: 5 / 3,
      iyz: 0,
      izz: 5 / 6,
    };
    const result = computeReliableInertiaBox({
      inertia,
      mass,
      inertialOrigin: [0, 0, 0],
      inertialRpy: [0, 0, 0],
    });
    expect(result).not.toBeNull();
    expect(result?.strategy).toBe("principal");
    expect(result?.confidence).toBe("unverified");
  });

  it("keeps the authored principal box when rotated mesh bounds agree", () => {
    const mass = 2;
    const inertia = {
      ixx: 13 / 6,
      ixy: 0,
      ixz: 0,
      iyy: 5 / 3,
      iyz: 0,
      izz: 5 / 6,
    };
    const result = computeReliableInertiaBox({
      inertia,
      mass,
      inertialOrigin: [0, 0, 0],
      inertialRpy: [0, 0, 0],
      geometryReference: {
        source: "mesh-bounds",
        points: rotateReferencePoints(
          createReferenceBoxPoints([1, 2, 3]),
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1),
            ROTATION_ANGLE_RAD
          )
        ),
      },
    });
    expect(result).not.toBeNull();
    expect(result?.strategy).toBe("principal");
    expect(result?.confidence).toBe("high");
    expect(result?.referenceSource).toBe("mesh-bounds");
    expect(result?.box.size[0]).toBeCloseTo(1, 6);
    expect(result?.box.size[1]).toBeCloseTo(2, 6);
    expect(result?.box.size[2]).toBeCloseTo(3, 6);
  });

  it("anchors near-degenerate principal axes to the reference orientation for stable visualization", () => {
    const mass = 2;
    const nearDegenerateInertia = {
      ixx: 1.000002,
      ixy: 0,
      ixz: 0,
      iyy: 1.000001,
      iyz: 0,
      izz: 2.5,
    };
    const referenceRotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      ROTATION_ANGLE_RAD
    );

    const result = computeReliableInertiaBox({
      inertia: nearDegenerateInertia,
      mass,
      inertialOrigin: [0, 0, 0],
      inertialRpy: [0, 0, 0],
      geometryReference: {
        source: "mesh-bounds",
        points: rotateReferencePoints(createReferenceBoxPoints([1, 2, 3]), referenceRotation),
      },
    });

    expect(result).not.toBeNull();
    expect(result?.strategy).toBe("principal");
    expect(result?.referenceBox).toBeTruthy();
    const renderedUniqueAxis = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(result!.box.rotation)
      .normalize();
    expect(Math.abs(renderedUniqueAxis.dot(new THREE.Vector3(0, 0, 1)))).toBeGreaterThan(
      ROTATED_AXIS_ALIGNMENT_MIN
    );
  });

  it("stabilizes near-degenerate reference-box spin for square-in-plane geometry", () => {
    const mass = 2;
    const symmetricWheelLikeInertia = {
      ixx: 5 / 6,
      ixy: 0,
      ixz: 0,
      iyy: 5 / 6,
      iyz: 0,
      izz: 4 / 3,
    };

    const baseResult = computeReliableInertiaBox({
      inertia: symmetricWheelLikeInertia,
      mass,
      inertialOrigin: [0, 0, 0],
      inertialRpy: [0, 0, 0],
      geometryReference: {
        source: "mesh-bounds",
        points: createReferenceBoxPoints([2, 2, 1]),
      },
    });
    const rotatedResult = computeReliableInertiaBox({
      inertia: symmetricWheelLikeInertia,
      mass,
      inertialOrigin: [0, 0, 0],
      inertialRpy: [0, 0, 0],
      geometryReference: {
        source: "mesh-bounds",
        points: rotateReferencePoints(
          createReferenceBoxPoints([2, 2, 1]),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ROTATION_ANGLE_RAD)
        ),
      },
    });

    expect(baseResult?.referenceBox).toBeTruthy();
    expect(rotatedResult?.referenceBox).toBeTruthy();
    expect(
      Math.abs(baseResult!.referenceBox!.rotation.dot(rotatedResult!.referenceBox!.rotation))
    ).toBeGreaterThan(ROTATED_AXIS_ALIGNMENT_MIN);
  });

  it("falls back to the reference box when inertia is implausible against mesh geometry", () => {
    const result = computeReliableInertiaBox({
      inertia: {
        ixx: 0,
        ixy: 0,
        ixz: 0,
        iyy: 0,
        iyz: 0,
        izz: 0,
      },
      mass: 2,
      inertialOrigin: [0, 0, 0],
      inertialRpy: [0, 0, 0],
      geometryReference: {
        source: "mesh-bounds",
        points: createReferenceBoxPoints([1, 2, 3]),
      },
    });
    expect(result).not.toBeNull();
    expect(result?.strategy).toBe("collision-fitted");
    expect(result?.confidence).toBe("low");
    expect(result?.referenceSource).toBe("mesh-bounds");
  });

  it("marks references with a center-of-mass outside the geometry as low confidence", () => {
    const mass = 2;
    const inertia = {
      ixx: 13 / 6,
      ixy: 0,
      ixz: 0,
      iyy: 5 / 3,
      iyz: 0,
      izz: 5 / 6,
    };
    const result = computeReliableInertiaBox({
      inertia,
      mass,
      inertialOrigin: [0, 0, 0],
      inertialRpy: [0, 0, 0],
      geometryReference: {
        source: "mesh-bounds",
        points: createReferenceBoxPoints([1, 1, 1], [1, 0, 0]),
      },
    });
    expect(result).not.toBeNull();
    expect(result?.strategy).toBe("principal");
    expect(result?.confidence).toBe("low");
    expect(result?.centerOfMassOutsideReference).toBe(true);
  });
});
