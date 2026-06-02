import * as THREE from "three";

import { projectDirectionOntoPlane } from "@/shared/lib/axisFrame";

type VectorAxis = "x" | "y" | "z";

type BuildRadialSymmetrySlotGuideOptions = {
  anchorDirectionsWorld: readonly THREE.Vector3[];
  branchVectors: readonly THREE.Vector3[];
  centerWorld: THREE.Vector3;
  liftMeters: number;
  minRadiusMeters: number;
  radiusScale: number;
  worldUp?: THREE.Vector3;
};

export type RadialSymmetryAssignment = {
  actualAngleRadians: number;
  actualPoint: THREE.Vector3;
  actualRadiusMeters: number;
  actualVector: THREE.Vector3;
  angularErrorRadians: number;
  branchIndex: number;
  idealAngleRadians: number;
  idealPoint: THREE.Vector3;
  idealRadiusMeters: number;
  idealVector: THREE.Vector3;
  offsetMeters: number;
  offsetVector: THREE.Vector3;
  slotIndex: number;
};

export type RadialSymmetryFit = {
  assignments: RadialSymmetryAssignment[];
  droppedAxis: VectorAxis;
  expectedDroppedCoordinate: number;
  expectedPlanarRadius: number;
  expectedStepRadians: number;
  firstAxis: VectorAxis;
  planeNormal: THREE.Vector3;
  secondAxis: VectorAxis;
  slotPoints: THREE.Vector3[];
};


const DEFAULT_WORLD_UP = new THREE.Vector3(0, 0, 1);

const resolveMedian = (values: readonly number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sortedValues = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) {
    return sortedValues[middleIndex] ?? 0;
  }
  return ((sortedValues[middleIndex - 1] ?? 0) + (sortedValues[middleIndex] ?? 0)) / 2;
};

const normalizeAngleRadians = (angle: number): number => {
  const normalizedAngle = angle % (Math.PI * 2);
  return normalizedAngle < 0 ? normalizedAngle + Math.PI * 2 : normalizedAngle;
};

const wrapAngleDeltaRadians = (angle: number): number => {
  const normalizedAngle = normalizeAngleRadians(angle);
  return normalizedAngle > Math.PI ? normalizedAngle - Math.PI * 2 : normalizedAngle;
};

const resolveBestCyclicShift = ({
  sortedBranchAngles,
  expectedAngles,
}: {
  sortedBranchAngles: readonly number[];
  expectedAngles: readonly number[];
}): {
  maxAngularErrorRadians: number;
  shiftIndex: number;
} => {
  let bestShiftIndex = 0;
  let bestShiftScore = Number.POSITIVE_INFINITY;
  for (let shiftIndex = 0; shiftIndex < sortedBranchAngles.length; shiftIndex += 1) {
    const shiftScore = sortedBranchAngles.reduce((maxErrorRadians, branchAngleRadians, index) => {
      const expectedAngleRadians = expectedAngles[(index + shiftIndex) % expectedAngles.length] ?? 0;
      return Math.max(
        maxErrorRadians,
        Math.abs(wrapAngleDeltaRadians(branchAngleRadians - expectedAngleRadians))
      );
    }, 0);
    if (shiftScore < bestShiftScore) {
      bestShiftScore = shiftScore;
      bestShiftIndex = shiftIndex;
    }
  }
  return {
    maxAngularErrorRadians: bestShiftScore,
    shiftIndex: bestShiftIndex,
  };
};

const resolveProjectionAxes = (
  vectors: readonly THREE.Vector3[]
): [VectorAxis, VectorAxis, VectorAxis] => {
  const spans = {
    x:
      Math.max(...vectors.map((vector) => vector.x)) -
      Math.min(...vectors.map((vector) => vector.x)),
    y:
      Math.max(...vectors.map((vector) => vector.y)) -
      Math.min(...vectors.map((vector) => vector.y)),
    z:
      Math.max(...vectors.map((vector) => vector.z)) -
      Math.min(...vectors.map((vector) => vector.z)),
  };
  const droppedAxis = [...(["x", "y", "z"] as const)].sort(
    (left, right) => spans[left] - spans[right]
  )[0];
  switch (droppedAxis) {
    case "x":
      return ["y", "z", "x"];
    case "y":
      return ["x", "z", "y"];
    case "z":
    default:
      return ["x", "y", "z"];
  }
};

export const buildRadialSymmetryFit = ({
  anchorDirectionsWorld,
  branchVectors,
  centerWorld,
  liftMeters,
  minRadiusMeters,
  radiusScale,
  worldUp = DEFAULT_WORLD_UP,
}: BuildRadialSymmetrySlotGuideOptions): RadialSymmetryFit | null => {
  if (branchVectors.length < 2) {
    return null;
  }

  const [firstAxis, secondAxis, droppedAxis] = resolveProjectionAxes(branchVectors);
  const planeNormal =
    droppedAxis === "x"
      ? new THREE.Vector3(1, 0, 0)
      : droppedAxis === "y"
        ? new THREE.Vector3(0, 1, 0)
        : worldUp;
  const branchAngleEntries = branchVectors
    .map((branchVector, index) => ({
      angleRadians: normalizeAngleRadians(
        Math.atan2(branchVector[secondAxis], branchVector[firstAxis])
      ),
      branchIndex: index,
    }))
    .sort(
      (left, right) =>
        left.angleRadians - right.angleRadians || left.branchIndex - right.branchIndex
    );

  const expectedStepRadians = (Math.PI * 2) / branchAngleEntries.length;
  const normalizedAnchorAngles = anchorDirectionsWorld
    .map((directionWorld) =>
      projectDirectionOntoPlane(directionWorld, planeNormal, new THREE.Vector3(1, 0, 0))
    )
    .map((projectedDirection) =>
      normalizeAngleRadians(
        Math.atan2(projectedDirection[secondAxis], projectedDirection[firstAxis])
      )
    );
  const anchorPhaseOffsets = branchAngleEntries.length % 2 === 0 ? [0, expectedStepRadians / 2] : [0];

  const resolveExpectedAngles = (baseAngleRadians: number): number[] =>
    Array.from({ length: branchAngleEntries.length }, (_, index) =>
      normalizeAngleRadians(baseAngleRadians + expectedStepRadians * index)
    ).sort((left, right) => left - right);

  const sortedBranchAngles = branchAngleEntries.map((entry) => entry.angleRadians);
  const candidateBaseAngles = normalizedAnchorAngles.flatMap((anchorAngleRadians) =>
    anchorPhaseOffsets.map((offsetRadians) =>
      normalizeAngleRadians(anchorAngleRadians + offsetRadians)
    )
  );
  const bestBaseAngle =
    candidateBaseAngles
      .map((candidateBaseAngleRadians) => {
        const expectedAngles = resolveExpectedAngles(candidateBaseAngleRadians);
        const { maxAngularErrorRadians, shiftIndex } = resolveBestCyclicShift({
          expectedAngles,
          sortedBranchAngles,
        });
        return {
          angleRadians: candidateBaseAngleRadians,
          expectedAngles,
          score: maxAngularErrorRadians,
          shiftIndex,
        };
      })
      .sort((left, right) => left.score - right.score || left.angleRadians - right.angleRadians)[0]
      ?? null;
  const bestBaseAngleRadians = bestBaseAngle?.angleRadians ?? 0;
  const bestExpectedAngles = bestBaseAngle?.expectedAngles ?? resolveExpectedAngles(bestBaseAngleRadians);
  const bestShiftIndex = bestBaseAngle?.shiftIndex ?? 0;

  const expectedPlanarRadius = Math.max(
    minRadiusMeters,
    resolveMedian(
      branchVectors.map((branchVector) =>
        Math.hypot(branchVector[firstAxis], branchVector[secondAxis])
      )
    ) * radiusScale
  );
  const expectedDroppedCoordinate = resolveMedian(
    branchVectors.map((branchVector) => branchVector[droppedAxis])
  );
  const liftedCenter = centerWorld.clone().addScaledVector(worldUp, liftMeters);
  const slotPoints = Array.from({ length: branchAngleEntries.length }, (_, index) => {
    const angleRadians = normalizeAngleRadians(bestBaseAngleRadians + expectedStepRadians * index);
    const slotVector = new THREE.Vector3();
    slotVector[firstAxis] = Math.cos(angleRadians) * expectedPlanarRadius;
    slotVector[secondAxis] = Math.sin(angleRadians) * expectedPlanarRadius;
    slotVector[droppedAxis] = expectedDroppedCoordinate;
    return liftedCenter.clone().add(slotVector);
  });
  const assignments = branchAngleEntries
    .map((entry, sortedIndex) => {
      const slotIndex = (sortedIndex + bestShiftIndex) % bestExpectedAngles.length;
      const idealAngleRadians = bestExpectedAngles[slotIndex] ?? 0;
      const actualVector = branchVectors[entry.branchIndex]?.clone() ?? new THREE.Vector3();
      const actualRadiusMeters = Math.hypot(actualVector[firstAxis], actualVector[secondAxis]);
      const idealVector = new THREE.Vector3();
      idealVector[firstAxis] = Math.cos(idealAngleRadians) * expectedPlanarRadius;
      idealVector[secondAxis] = Math.sin(idealAngleRadians) * expectedPlanarRadius;
      idealVector[droppedAxis] = expectedDroppedCoordinate;
      const actualPoint = centerWorld.clone().add(actualVector);
      const idealPoint = centerWorld.clone().add(idealVector);
      const offsetVector = idealPoint.clone().sub(actualPoint);
      return {
        actualAngleRadians: entry.angleRadians,
        actualPoint,
        actualRadiusMeters,
        actualVector,
        angularErrorRadians: Math.abs(
          wrapAngleDeltaRadians(entry.angleRadians - idealAngleRadians)
        ),
        branchIndex: entry.branchIndex,
        idealAngleRadians,
        idealPoint,
        idealRadiusMeters: expectedPlanarRadius,
        idealVector,
        offsetMeters: offsetVector.length(),
        offsetVector,
        slotIndex,
      } satisfies RadialSymmetryAssignment;
    })
    .sort((left, right) => left.branchIndex - right.branchIndex);

  return {
    assignments,
    droppedAxis,
    expectedDroppedCoordinate,
    expectedPlanarRadius,
    expectedStepRadians,
    firstAxis,
    planeNormal,
    secondAxis,
    slotPoints,
  };
};
