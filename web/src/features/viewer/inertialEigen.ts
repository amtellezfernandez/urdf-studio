import * as THREE from "three";
import {
  INERTIA_EIGEN_MAX_ITERATIONS,
  INERTIA_NUMERICAL_EPSILON,
} from "@/features/viewer/inertialMathParams";

export type EigenDecomposition = {
  values: [number, number, number];
  vectors: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
};

const clampSmallEigenvalue = (value: number): number =>
  Math.abs(value) < INERTIA_NUMERICAL_EPSILON ? 0 : value;

const rotateJacobiVectorPair = (
  firstVector: THREE.Vector3,
  secondVector: THREE.Vector3,
  rotationCos: number,
  rotationSin: number
): void => {
  const { x: firstX, y: firstY, z: firstZ } = firstVector;
  const { x: secondX, y: secondY, z: secondZ } = secondVector;

  firstVector.set(
    rotationCos * firstX - rotationSin * secondX,
    rotationCos * firstY - rotationSin * secondY,
    rotationCos * firstZ - rotationSin * secondZ
  );
  secondVector.set(
    rotationSin * firstX + rotationCos * secondX,
    rotationSin * firstY + rotationCos * secondY,
    rotationSin * firstZ + rotationCos * secondZ
  );
};

const sortEigenPairs = (eigen: EigenDecomposition): EigenDecomposition => {
  const pairs = [
    { value: eigen.values[0], vector: eigen.vectors[0] },
    { value: eigen.values[1], vector: eigen.vectors[1] },
    { value: eigen.values[2], vector: eigen.vectors[2] },
  ].sort((a, b) => b.value - a.value);

  const largestMomentAxis = pairs[0].vector.clone();
  const middleMomentAxis = pairs[1].vector.clone();
  const smallestMomentAxis = pairs[2].vector.clone();

  const basisDeterminant = largestMomentAxis
    .clone()
    .cross(middleMomentAxis)
    .dot(smallestMomentAxis);
  if (basisDeterminant < 0) {
    smallestMomentAxis.multiplyScalar(-1);
  }

  return {
    values: [pairs[0].value, pairs[1].value, pairs[2].value],
    vectors: [largestMomentAxis, middleMomentAxis, smallestMomentAxis],
  };
};

export const computeEigenDecompositionSymmetric3x3 = (
  matrix: THREE.Matrix3
): EigenDecomposition => {
  const elements = matrix.elements;

  let diagonalXX = elements[0];
  let offDiagonalXY = elements[1];
  let offDiagonalXZ = elements[2];
  let diagonalYY = elements[4];
  let offDiagonalYZ = elements[5];
  let diagonalZZ = elements[8];

  const firstEigenvector = new THREE.Vector3(1, 0, 0);
  const secondEigenvector = new THREE.Vector3(0, 1, 0);
  const thirdEigenvector = new THREE.Vector3(0, 0, 1);

  for (let iterationIndex = 0; iterationIndex < INERTIA_EIGEN_MAX_ITERATIONS; iterationIndex += 1) {
    let largestOffDiagonalMagnitude = Math.abs(offDiagonalXY);
    let pivotFirstIndex = 0;
    let pivotSecondIndex = 1;

    if (Math.abs(offDiagonalXZ) > largestOffDiagonalMagnitude) {
      largestOffDiagonalMagnitude = Math.abs(offDiagonalXZ);
      pivotFirstIndex = 0;
      pivotSecondIndex = 2;
    }
    if (Math.abs(offDiagonalYZ) > largestOffDiagonalMagnitude) {
      largestOffDiagonalMagnitude = Math.abs(offDiagonalYZ);
      pivotFirstIndex = 1;
      pivotSecondIndex = 2;
    }

    if (largestOffDiagonalMagnitude < INERTIA_NUMERICAL_EPSILON) break;

    let pivotOffDiagonal: number;
    let firstPivotDiagonal: number;
    let secondPivotDiagonal: number;
    if (pivotFirstIndex === 0 && pivotSecondIndex === 1) {
      pivotOffDiagonal = offDiagonalXY;
      firstPivotDiagonal = diagonalXX;
      secondPivotDiagonal = diagonalYY;
    } else if (pivotFirstIndex === 0 && pivotSecondIndex === 2) {
      pivotOffDiagonal = offDiagonalXZ;
      firstPivotDiagonal = diagonalXX;
      secondPivotDiagonal = diagonalZZ;
    } else {
      pivotOffDiagonal = offDiagonalYZ;
      firstPivotDiagonal = diagonalYY;
      secondPivotDiagonal = diagonalZZ;
    }

    const jacobiTau = (secondPivotDiagonal - firstPivotDiagonal) / (2 * pivotOffDiagonal);
    const jacobiTauSign = jacobiTau >= 0 ? 1 : -1;
    const rotationTangent =
      jacobiTauSign / (Math.abs(jacobiTau) + Math.sqrt(1 + jacobiTau * jacobiTau));
    const rotationCos = 1 / Math.sqrt(1 + rotationTangent * rotationTangent);
    const rotationSin = rotationTangent * rotationCos;

    if (pivotFirstIndex === 0 && pivotSecondIndex === 1) {
      const previousDiagonalXX = diagonalXX;
      const previousOffDiagonalXY = offDiagonalXY;
      const previousOffDiagonalXZ = offDiagonalXZ;
      const previousDiagonalYY = diagonalYY;
      const previousOffDiagonalYZ = offDiagonalYZ;

      diagonalXX =
        rotationCos * rotationCos * previousDiagonalXX -
        2 * rotationCos * rotationSin * previousOffDiagonalXY +
        rotationSin * rotationSin * previousDiagonalYY;
      diagonalYY =
        rotationSin * rotationSin * previousDiagonalXX +
        2 * rotationCos * rotationSin * previousOffDiagonalXY +
        rotationCos * rotationCos * previousDiagonalYY;
      offDiagonalXY = 0;
      offDiagonalXZ = rotationCos * previousOffDiagonalXZ - rotationSin * previousOffDiagonalYZ;
      offDiagonalYZ = rotationSin * previousOffDiagonalXZ + rotationCos * previousOffDiagonalYZ;

      rotateJacobiVectorPair(firstEigenvector, secondEigenvector, rotationCos, rotationSin);
    } else if (pivotFirstIndex === 0 && pivotSecondIndex === 2) {
      const previousDiagonalXX = diagonalXX;
      const previousOffDiagonalXY = offDiagonalXY;
      const previousOffDiagonalXZ = offDiagonalXZ;
      const previousOffDiagonalYZ = offDiagonalYZ;
      const previousDiagonalZZ = diagonalZZ;

      diagonalXX =
        rotationCos * rotationCos * previousDiagonalXX -
        2 * rotationCos * rotationSin * previousOffDiagonalXZ +
        rotationSin * rotationSin * previousDiagonalZZ;
      diagonalZZ =
        rotationSin * rotationSin * previousDiagonalXX +
        2 * rotationCos * rotationSin * previousOffDiagonalXZ +
        rotationCos * rotationCos * previousDiagonalZZ;
      offDiagonalXZ = 0;
      offDiagonalXY = rotationCos * previousOffDiagonalXY - rotationSin * previousOffDiagonalYZ;
      offDiagonalYZ = rotationSin * previousOffDiagonalXY + rotationCos * previousOffDiagonalYZ;

      rotateJacobiVectorPair(firstEigenvector, thirdEigenvector, rotationCos, rotationSin);
    } else {
      const previousDiagonalYY = diagonalYY;
      const previousOffDiagonalXY = offDiagonalXY;
      const previousOffDiagonalYZ = offDiagonalYZ;
      const previousOffDiagonalXZ = offDiagonalXZ;
      const previousDiagonalZZ = diagonalZZ;

      diagonalYY =
        rotationCos * rotationCos * previousDiagonalYY -
        2 * rotationCos * rotationSin * previousOffDiagonalYZ +
        rotationSin * rotationSin * previousDiagonalZZ;
      diagonalZZ =
        rotationSin * rotationSin * previousDiagonalYY +
        2 * rotationCos * rotationSin * previousOffDiagonalYZ +
        rotationCos * rotationCos * previousDiagonalZZ;
      offDiagonalYZ = 0;
      offDiagonalXY = rotationCos * previousOffDiagonalXY - rotationSin * previousOffDiagonalXZ;
      offDiagonalXZ = rotationSin * previousOffDiagonalXY + rotationCos * previousOffDiagonalXZ;

      rotateJacobiVectorPair(secondEigenvector, thirdEigenvector, rotationCos, rotationSin);
    }
  }

  return sortEigenPairs({
    values: [
      clampSmallEigenvalue(diagonalXX),
      clampSmallEigenvalue(diagonalYY),
      clampSmallEigenvalue(diagonalZZ),
    ],
    vectors: [firstEigenvector, secondEigenvector, thirdEigenvector],
  });
};
