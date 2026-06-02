import * as THREE from "three";
import {
  computeEigenDecompositionSymmetric3x3,
  type InertiaTensor,
} from "@/features/viewer/inertialMath";
import {
  INERTIAL_DIAGNOSTICS_ILL_CONDITIONED_RATIO,
  INERTIAL_DIAGNOSTICS_NEAR_MISS_EIGENVALUE_EPS,
  INERTIAL_DIAGNOSTICS_NEAR_MISS_TRIANGLE_GAP_EPS,
  INERTIAL_DIAGNOSTICS_PSD_EIGENVALUE_EPS,
  INERTIAL_DIAGNOSTICS_PSD_TRIANGLE_MARGIN_EPS,
} from "./inertialDiagnosticsParams";

export type InertialDiagnosticBucket =
  | "near-miss"
  | "triangle-inequality"
  | "non-positive-definite"
  | "ill-conditioned"
  | "degenerate";

export type InertialTensorDiagnostics = {
  rawTensor: InertiaTensor;
  eigenvalues: [number, number, number];
  determinant: number;
  trace: number;
  minEigenvalue: number;
  maxEigenvalue: number;
  conditionNumber: number | null;
  triangleGaps: [number, number, number];
  triangleInequalityGap: number;
  positiveDefinite: boolean;
  triangleInequalitySatisfied: boolean;
  bucket: InertialDiagnosticBucket;
};

const tensorToMatrix3 = (tensor: InertiaTensor): THREE.Matrix3 =>
  new THREE.Matrix3().set(
    tensor.ixx, tensor.ixy, tensor.ixz,
    tensor.ixy, tensor.iyy, tensor.iyz,
    tensor.ixz, tensor.iyz, tensor.izz
  );

const determinant3 = (matrix: THREE.Matrix3): number => {
  const e = matrix.elements;
  return (
    e[0] * (e[4] * e[8] - e[5] * e[7]) -
    e[1] * (e[3] * e[8] - e[5] * e[6]) +
    e[2] * (e[3] * e[7] - e[4] * e[6])
  );
};

const matrix3ToTensor = (matrix: THREE.Matrix3): InertiaTensor => {
  const elements = matrix.elements;
  return {
    ixx: elements[0],
    ixy: elements[1],
    ixz: elements[2],
    iyy: elements[4],
    iyz: elements[5],
    izz: elements[8],
  };
};

const regularizePrincipalMoments = (
  eigenvaluesAscending: [number, number, number]
): [number, number, number] => {
  const adjusted = eigenvaluesAscending.map((value) =>
    Math.max(value, INERTIAL_DIAGNOSTICS_PSD_EIGENVALUE_EPS)
  ) as [number, number, number];
  const [lambda1, lambda2, lambda3] = adjusted;
  const minimumTriangleGap =
    lambda3 + INERTIAL_DIAGNOSTICS_PSD_TRIANGLE_MARGIN_EPS - (lambda1 + lambda2);
  if (minimumTriangleGap > 0) {
    const correction = minimumTriangleGap * 0.5;
    adjusted[0] += correction;
    adjusted[1] += correction;
  }
  return adjusted;
};

const rebuildTensorFromEigenPairs = (
  pairs: Array<{ value: number; vector: THREE.Vector3 }>
): InertiaTensor => {
  const matrix = new THREE.Matrix3().set(
    0, 0, 0,
    0, 0, 0,
    0, 0, 0
  );
  const elements = matrix.elements;
  for (const pair of pairs) {
    const vector = pair.vector.clone().normalize();
    const { x, y, z } = vector;
    elements[0] += pair.value * x * x;
    elements[1] += pair.value * x * y;
    elements[2] += pair.value * x * z;
    elements[3] += pair.value * y * x;
    elements[4] += pair.value * y * y;
    elements[5] += pair.value * y * z;
    elements[6] += pair.value * z * x;
    elements[7] += pair.value * z * y;
    elements[8] += pair.value * z * z;
  }
  return matrix3ToTensor(matrix);
};

const classifyDiagnostics = ({
  determinant,
  minEigenvalue,
  maxEigenvalue,
  triangleGap,
  conditionNumber,
}: {
  determinant: number;
  minEigenvalue: number;
  maxEigenvalue: number;
  triangleGap: number;
  conditionNumber: number | null;
}): InertialDiagnosticBucket => {
  if (minEigenvalue <= 0) {
    return minEigenvalue >= -INERTIAL_DIAGNOSTICS_NEAR_MISS_EIGENVALUE_EPS
      ? "near-miss"
      : "non-positive-definite";
  }
  if (!Number.isFinite(determinant) || determinant <= 0) {
    return "degenerate";
  }
  if (triangleGap < 0) {
    return triangleGap >= -INERTIAL_DIAGNOSTICS_NEAR_MISS_TRIANGLE_GAP_EPS
      ? "near-miss"
      : "triangle-inequality";
  }
  if (
    conditionNumber !== null &&
    Number.isFinite(conditionNumber) &&
    conditionNumber > INERTIAL_DIAGNOSTICS_ILL_CONDITIONED_RATIO &&
    maxEigenvalue > 0
  ) {
    return "ill-conditioned";
  }
  return "near-miss";
};

export const computeInertialTensorDiagnostics = (
  tensor: InertiaTensor
): InertialTensorDiagnostics => {
  const matrix = tensorToMatrix3(tensor);
  const eigen = computeEigenDecompositionSymmetric3x3(matrix);
  const sorted = [...eigen.values].sort((left, right) => left - right) as [number, number, number];
  const [lambda1, lambda2, lambda3] = sorted;
  const determinant = determinant3(matrix);
  const trace = lambda1 + lambda2 + lambda3;
  const minEigenvalue = lambda1;
  const maxEigenvalue = lambda3;
  const conditionNumber =
    minEigenvalue > 0 ? maxEigenvalue / minEigenvalue : null;
  const triangleGaps: [number, number, number] = [
    lambda1 + lambda2 - lambda3,
    lambda2 + lambda3 - lambda1,
    lambda3 + lambda1 - lambda2,
  ];
  const triangleInequalityGap = Math.min(...triangleGaps);
  const positiveDefinite = minEigenvalue > 0;
  const triangleInequalitySatisfied = triangleInequalityGap >= 0;

  return {
    rawTensor: tensor,
    eigenvalues: [lambda1, lambda2, lambda3],
    determinant,
    trace,
    minEigenvalue,
    maxEigenvalue,
    conditionNumber,
    triangleGaps,
    triangleInequalityGap,
    positiveDefinite,
    triangleInequalitySatisfied,
    bucket: classifyDiagnostics({
      determinant,
      minEigenvalue,
      maxEigenvalue,
      triangleGap: triangleInequalityGap,
      conditionNumber,
    }),
  };
};

export const regularizeNearMissInertialTensor = (
  tensor: InertiaTensor
): InertiaTensor => {
  const matrix = tensorToMatrix3(tensor);
  const eigen = computeEigenDecompositionSymmetric3x3(matrix);
  const ascendingPairs = eigen.values
    .map((value, index) => ({
      value,
      vector: eigen.vectors[index].clone(),
    }))
    .sort((left, right) => left.value - right.value);
  const regularizedValues = regularizePrincipalMoments([
    ascendingPairs[0].value,
    ascendingPairs[1].value,
    ascendingPairs[2].value,
  ]);
  const regularizedPairs = ascendingPairs.map((pair, index) => ({
    value: regularizedValues[index],
    vector: pair.vector,
  }));
  return rebuildTensorFromEigenPairs(regularizedPairs);
};
