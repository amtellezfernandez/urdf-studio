import * as THREE from "three";

import type { RepeatedInertiaDiagnosticGroup } from "@/features/layout/page/repeatedInertiaDiagnostics";
import {
  REPEATED_INERTIA_SYMMETRY_DEFAULT_CENTER_MODE,
  type RepeatedInertiaSymmetryCenterMode,
} from "@/features/layout/page/repeatedInertiaSymmetryCenterMode";
import {
  parseRepeatedInertiaSymmetryRobot,
  type ParsedRobot,
  type RepeatedInertiaSymmetryLinkCentersLocal,
} from "@/features/layout/page/repeatedInertiaSymmetryRobot";
import { buildRadialSymmetryFit } from "@/features/viewer/symmetryOverlayMath";
import {
  REPEATED_INERTIA_SYMMETRY_MAX_LINEAR_LATERAL_ERROR_METERS,
  REPEATED_INERTIA_SYMMETRY_MAX_MIRROR_ANGLE_ERROR_DEGREES,
  REPEATED_INERTIA_SYMMETRY_MAX_RADIAL_ANGLE_ERROR_DEGREES,
  REPEATED_INERTIA_SYMMETRY_MIN_BRANCH_COUNT,
  REPEATED_INERTIA_SYMMETRY_MIN_LINEAR_AXIS_SPREAD_METERS,
  REPEATED_INERTIA_SYMMETRY_MIN_LINEAR_OUTLIER_DELTA_METERS,
  REPEATED_INERTIA_SYMMETRY_MIN_OUTLIER_DELTA_GAP_METERS,
  REPEATED_INERTIA_SYMMETRY_MIN_OUTLIER_DELTA_METERS,
  REPEATED_INERTIA_SYMMETRY_MIN_OUTLIER_DELTA_RATIO,
  REPEATED_INERTIA_SYMMETRY_MIN_REPEATED_GROUP_SUPPORT,
  REPEATED_INERTIA_SYMMETRY_REPAIR_MIN_STEP_METERS,
} from "@/features/layout/page/repeatedInertiaSymmetryParams";

type VectorAxis = "x" | "y" | "z";

export type RepeatedInertiaSymmetryType = "linear" | "mirror" | "radial" | "unclassified";

type SymmetryTransformSummary = {
  branchRows: Array<{
    angleDegrees: number;
    angularErrorDegrees: number | null;
    branchRootLinkName: string;
    idealAngleDegrees: number | null;
    idealPointWorld: THREE.Vector3 | null;
    idealRadialDistanceMeters: number | null;
    offsetDistanceMeters: number;
    offsetVectorWorld: THREE.Vector3;
    radialDistanceMeters: number;
    rotationRadians: number | null;
  }>;
  branchCount: number;
  expectedAngleDegrees: number | null;
  maxAngularErrorDegrees: number | null;
  outlierAngularErrorDegrees: number | null;
  planeNormalWorld: THREE.Vector3 | null;
  symmetryType: RepeatedInertiaSymmetryType;
};

type SymmetryOutlierCandidate = {
  allBranchRootLinkNames: string[];
  branchRepresentativeLinks: Array<{
    branchRootLinkName: string;
    depthFromRoot: number;
    linkName: string;
    repeatedGroupKey: string;
  }>;
  branchCount: number;
  depthFromRoot: number;
  distanceDeltaMeters: number;
  expectedAngleDegrees: number | null;
  groupKey: string;
  maxAngularErrorDegrees: number | null;
  meshLabel: string;
  outlierBranchRootLinkName: string;
  outlierAngularErrorDegrees: number | null;
  outlierLinkName: string;
  siblingBranchRootLinkNames: string[];
  symmetryRootLinkName: string;
  symmetryType: RepeatedInertiaSymmetryType;
};

type SymmetryFamilySupport = {
  aggregateKey: string;
  allBranchRootLinkNames: string[];
  branchEntries: Array<{
    branchRootLinkName: string;
    branchRootWorldPosition: THREE.Vector3;
    confidence: RepeatedInertiaDiagnosticGroup["linkEntries"][number]["confidence"];
    depthFromRoot: number;
    entryOrder: number;
    linkName: string;
    mismatchScore: number | null;
    worldPosition: THREE.Vector3;
  }>;
  branchRootWorldPositions: Map<string, THREE.Vector3>;
  rootWorldPosition: THREE.Vector3;
  rootWorldQuaternion: THREE.Quaternion;
  symmetryRootLinkName: string;
  transformSummary: SymmetryTransformSummary;
};

type SymmetryBranchLinkRecord = {
  depthFromRoot: number;
  linkName: string;
  repeatedGroupKey: string | null;
};

type RepeatedInertiaSymmetryBranchLinkGroup = {
  branchRootLinkName: string;
  linkNames: string[];
  status: "aligned" | "outlier";
};

type RepeatedInertiaSymmetryLinkRow = {
  idealPositionMeters: [number, number, number];
  idealLayerRadiusMeters: number | null;
  lateralOffsetMeters: number | null;
  linkName: string;
  offsetDistanceMeters: number;
  offsetVectorMeters: [number, number, number];
  radialOffsetMeters: number | null;
};

type RepeatedInertiaSymmetryBranchRow = {
  angleDegrees: number;
  angularErrorDegrees: number | null;
  branchRootLinkName: string;
  idealAngleDegrees: number | null;
  idealPositionMeters: [number, number, number];
  idealRadialDistanceMeters: number | null;
  linkRows: RepeatedInertiaSymmetryLinkRow[];
  lateralOffsetMeters: number | null;
  offsetDistanceMeters: number;
  offsetVectorMeters: [number, number, number];
  radialOffsetMeters: number | null;
  radialDistanceDeltaMeters: number;
  radialDistanceMeters: number;
  representativeLinkName: string;
  rotationRadians: number | null;
  status: "aligned" | "outlier";
  topologyMatchesFamily: boolean;
};

type RepeatedInertiaSymmetryRepairStep = {
  childLinkName: string;
  jointName: string;
  parentLinkName: string;
  targetPositionMeters: [number, number, number];
};

type RepeatedInertiaSymmetryRepairPlan = {
  articulatedBoundaryJointName: string | null;
  blockedTargetLinkNames: string[];
  kind: "translation";
  mode: "single-joint" | "multi-joint";
  stepCount: number;
  summary: string;
  steps: RepeatedInertiaSymmetryRepairStep[];
  targetLinkNames: string[];
};

type SymmetryAggregate = {
  affectedLinksByBranchRoot: Map<string, Map<string, number>>;
  allBranchRootLinkNames: Set<string>;
  branchRepresentativeLinksByRoot: Map<string, Map<string, SymmetryBranchLinkRecord>>;
  branchCount: number;
  branchEvidenceByRoot: Map<string, number>;
  candidates: SymmetryOutlierCandidate[];
  groupKeys: Set<string>;
  expectedAngleDegrees: number | null;
  maxAngularErrorDegrees: number | null;
  maxDistanceDeltaMeters: number;
  repeatedMeshLabels: Set<string>;
  symmetryRootLinkName: string;
  symmetryType: RepeatedInertiaSymmetryType;
};

export type RepeatedInertiaSymmetryChain = {
  affectedLinkNames: string[];
  branchCount: number;
  branchLinkGroups: RepeatedInertiaSymmetryBranchLinkGroup[];
  branchRows: RepeatedInertiaSymmetryBranchRow[];
  earliestDivergenceLinkName: string;
  expectedAngleDegrees: number | null;
  maxDistanceDeltaMeters: number;
  maxAngularErrorDegrees: number | null;
  outlierBranchRootLinkName: string;
  outlierAngularErrorDegrees: number | null;
  repeatedGroupCount: number;
  repeatedMeshLabels: string[];
  rootMeshCenterPositionMeters: [number, number, number];
  siblingBranchRootLinkNames: string[];
  symmetryCenterMode: RepeatedInertiaSymmetryCenterMode;
  symmetryCenterPositionMeters: [number, number, number];
  symmetryRootLinkName: string;
  symmetryType: RepeatedInertiaSymmetryType;
  topologyMatchingBranchCount: number;
  recommendedRepair: RepeatedInertiaSymmetryRepairPlan | null;
};

export const buildRepeatedInertiaSymmetryChainKey = ({
  outlierBranchRootLinkName,
  symmetryRootLinkName,
}: {
  outlierBranchRootLinkName: string;
  symmetryRootLinkName: string;
}): string => `${symmetryRootLinkName}:${outlierBranchRootLinkName}`;

const hasMaterialSymmetryMisalignment = (
  chain: RepeatedInertiaSymmetryChain
): boolean => {
  const minimumOffsetMeters =
    chain.symmetryType === "linear"
      ? REPEATED_INERTIA_SYMMETRY_MIN_LINEAR_OUTLIER_DELTA_METERS
      : REPEATED_INERTIA_SYMMETRY_MIN_OUTLIER_DELTA_METERS;
  return chain.branchRows.some((branchRow) => {
    if (branchRow.offsetDistanceMeters >= minimumOffsetMeters) {
      return true;
    }
    if (
      chain.symmetryType === "radial" &&
      Math.abs(branchRow.radialOffsetMeters ?? 0) >= minimumOffsetMeters
    ) {
      return true;
    }
    return branchRow.linkRows.some((linkRow) => {
      if (linkRow.offsetDistanceMeters >= minimumOffsetMeters) {
        return true;
      }
      return (
        chain.symmetryType === "radial" &&
        Math.abs(linkRow.radialOffsetMeters ?? 0) >= minimumOffsetMeters
      );
    });
  });
};

const buildAncestorChain = (
  linkName: string,
  parentByChildLink: ReadonlyMap<string, string>
): string[] => {
  const chain: string[] = [];
  let cursor: string | undefined = linkName;
  while (cursor) {
    chain.unshift(cursor);
    cursor = parentByChildLink.get(cursor);
  }
  return chain;
};

const resolveLowestCommonAncestor = (chains: readonly string[][]): string | null => {
  if (chains.length === 0) {
    return null;
  }
  const shortestChainLength = Math.min(...chains.map((chain) => chain.length));
  let lowestCommonAncestor: string | null = null;
  for (let index = 0; index < shortestChainLength; index += 1) {
    const candidate = chains[0]?.[index] ?? null;
    if (!candidate || !chains.every((chain) => chain[index] === candidate)) {
      break;
    }
    lowestCommonAncestor = candidate;
  }
  return lowestCommonAncestor;
};

const resolveBranchRootLinkName = (
  ancestorChain: readonly string[],
  lowestCommonAncestor: string
): string | null => {
  const lcaIndex = ancestorChain.lastIndexOf(lowestCommonAncestor);
  return lcaIndex >= 0 ? ancestorChain[lcaIndex + 1] ?? null : null;
};

const resolveDepthFromRoot = (
  ancestorChain: readonly string[],
  lowestCommonAncestor: string
): number => {
  const lcaIndex = ancestorChain.lastIndexOf(lowestCommonAncestor);
  if (lcaIndex < 0) {
    return Number.POSITIVE_INFINITY;
  }
  return ancestorChain.length - lcaIndex - 1;
};

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

const toDegrees = (radians: number): number => radians * (180 / Math.PI);

const projectVectorOntoPlane = ({
  planeNormalWorld,
  vector,
}: {
  planeNormalWorld: THREE.Vector3 | null;
  vector: THREE.Vector3;
}): THREE.Vector3 => {
  if (!planeNormalWorld || planeNormalWorld.lengthSq() <= Number.EPSILON) {
    return vector.clone();
  }
  const normalizedPlaneNormal = planeNormalWorld.clone().normalize();
  return vector
    .clone()
    .sub(normalizedPlaneNormal.multiplyScalar(vector.dot(normalizedPlaneNormal)));
};

const preserveNormalAxisPosition = ({
  actualWorld,
  planeNormalWorld,
  targetWorld,
}: {
  actualWorld: THREE.Vector3;
  planeNormalWorld: THREE.Vector3 | null;
  targetWorld: THREE.Vector3;
}): THREE.Vector3 => {
  const planarDelta = projectVectorOntoPlane({
    planeNormalWorld,
    vector: targetWorld.clone().sub(actualWorld),
  });
  return actualWorld.clone().add(planarDelta);
};

const buildPlanarDirection = ({
  originWorld,
  planeNormalWorld,
  targetWorld,
}: {
  originWorld: THREE.Vector3;
  planeNormalWorld: THREE.Vector3 | null;
  targetWorld: THREE.Vector3;
}): THREE.Vector3 | null => {
  const planarVector = projectVectorOntoPlane({
    planeNormalWorld,
    vector: targetWorld.clone().sub(originWorld),
  });
  return planarVector.lengthSq() > Number.EPSILON ? planarVector.normalize() : null;
};

const resolveLinkAlignmentPointWorld = (
  robot: ParsedRobot,
  linkName: string
): THREE.Vector3 | null =>
  robot.linkReferenceCentersWorld.get(linkName) ?? robot.linkWorldPositions.get(linkName) ?? null;

const resolvePlanarDistanceFromRootMeters = ({
  planeNormalWorld,
  rootWorldPosition,
  worldPosition,
}: {
  planeNormalWorld: THREE.Vector3 | null;
  rootWorldPosition: THREE.Vector3;
  worldPosition: THREE.Vector3;
}): number =>
  projectVectorOntoPlane({
    planeNormalWorld,
    vector: worldPosition.clone().sub(rootWorldPosition),
  }).length();

const projectPointOntoGuideLine = ({
  actualWorld,
  idealDirectionWorld,
  planeNormalWorld,
  rootWorldPosition,
}: {
  actualWorld: THREE.Vector3;
  idealDirectionWorld: THREE.Vector3;
  planeNormalWorld: THREE.Vector3 | null;
  rootWorldPosition: THREE.Vector3;
}): THREE.Vector3 => {
  const planarActualVector = projectVectorOntoPlane({
    planeNormalWorld,
    vector: actualWorld.clone().sub(rootWorldPosition),
  });
  const projectedDistanceMeters = planarActualVector.dot(idealDirectionWorld);
  return preserveNormalAxisPosition({
    actualWorld,
    planeNormalWorld,
    targetWorld: rootWorldPosition
      .clone()
      .add(idealDirectionWorld.clone().multiplyScalar(projectedDistanceMeters)),
  });
};

const buildIdealAlignmentPointWorld = ({
  actualRootWorld,
  actualWorld,
  idealDirectionWorld,
  idealRadiusMeters = null,
  idealRootWorld,
  planeNormalWorld,
  rootWorldPosition,
  rotationRadians,
}: {
  actualRootWorld: THREE.Vector3 | null;
  actualWorld: THREE.Vector3;
  idealDirectionWorld: THREE.Vector3 | null;
  idealRadiusMeters?: number | null;
  idealRootWorld: THREE.Vector3 | null;
  planeNormalWorld: THREE.Vector3 | null;
  rootWorldPosition: THREE.Vector3;
  rotationRadians: number | null;
}): THREE.Vector3 => {
  if (idealDirectionWorld) {
    if (idealRadiusMeters != null) {
      // Place the element at the ideal radial distance along the guide line, preserving
      // the normal-axis position. This corrects both angular and radial errors together,
      // unlike projectPointOntoGuideLine which preserves the along-guide projection of
      // the actual position and therefore cannot fix radial distance errors.
      return preserveNormalAxisPosition({
        actualWorld,
        planeNormalWorld,
        targetWorld: rootWorldPosition
          .clone()
          .add(idealDirectionWorld.clone().multiplyScalar(idealRadiusMeters)),
      });
    }
    return projectPointOntoGuideLine({
      actualWorld,
      idealDirectionWorld,
      planeNormalWorld,
      rootWorldPosition,
    });
  }

  if (!actualRootWorld || !idealRootWorld) {
    return actualWorld.clone();
  }

  if (
    planeNormalWorld &&
    rotationRadians !== null &&
    Math.abs(rotationRadians) > Number.EPSILON
  ) {
    return preserveNormalAxisPosition({
      actualWorld,
      planeNormalWorld,
      targetWorld: actualWorld
        .clone()
        .sub(actualRootWorld)
        .applyAxisAngle(planeNormalWorld, rotationRadians)
        .add(idealRootWorld),
    });
  }

  return preserveNormalAxisPosition({
    actualWorld,
    planeNormalWorld,
    targetWorld: actualWorld.clone().add(idealRootWorld.clone().sub(actualRootWorld)),
  });
};

const normalizeAngleRadians = (angle: number): number => {
  const normalizedAngle = angle % (Math.PI * 2);
  return normalizedAngle < 0 ? normalizedAngle + Math.PI * 2 : normalizedAngle;
};

const wrapAngleDeltaRadians = (angle: number): number => {
  const normalizedAngle = normalizeAngleRadians(angle);
  return normalizedAngle > Math.PI ? normalizedAngle - Math.PI * 2 : normalizedAngle;
};

const resolveConfidencePriority = (
  confidence: RepeatedInertiaDiagnosticGroup["linkEntries"][number]["confidence"]
): number => {
  switch (confidence) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
    case "unverified":
      return 3;
    default:
      return 4;
  }
};

const buildSubtreeSignature = (
  linkName: string,
  childJointsByParentLink: ParsedRobot["childJointsByParentLink"],
  signatureCache: Map<string, string>
): string => {
  const cachedSignature = signatureCache.get(linkName);
  if (cachedSignature) {
    return cachedSignature;
  }

  const childJoints = childJointsByParentLink.get(linkName) ?? [];
  const childSignatures = childJoints
    .map(
      (joint) =>
        `${joint.jointType}(${buildSubtreeSignature(
          joint.childLinkName,
          childJointsByParentLink,
          signatureCache
        )})`
    )
    .sort((left, right) => left.localeCompare(right));
  const signature = childSignatures.length === 0 ? "leaf" : childSignatures.join("|");
  signatureCache.set(linkName, signature);
  return signature;
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

type LinearSymmetryAssignment = {
  actualAngleRadians: number;
  angularErrorRadians: number;
  branchIndex: number;
  idealAngleRadians: number;
  idealPoint: THREE.Vector3;
  idealProjectionMeters: number;
  lateralOffsetMeters: number;
  offsetVector: THREE.Vector3;
};

type LinearSymmetryFit = {
  assignments: LinearSymmetryAssignment[];
  axisDirectionWorld: THREE.Vector3;
  maxLateralOffsetMeters: number;
  planeNormal: THREE.Vector3;
};

const dedupeDirectionCandidates = (directions: readonly THREE.Vector3[]): THREE.Vector3[] => {
  const uniqueDirections: THREE.Vector3[] = [];
  directions.forEach((direction) => {
    if (direction.lengthSq() <= Number.EPSILON) {
      return;
    }
    const normalizedDirection = direction.clone().normalize();
    const isDuplicate = uniqueDirections.some(
      (candidate) => Math.abs(candidate.dot(normalizedDirection)) >= 1 - 1e-4
    );
    if (!isDuplicate) {
      uniqueDirections.push(normalizedDirection);
    }
  });
  return uniqueDirections;
};

const buildLinearSymmetryFit = ({
  branchVectors,
  centerWorld,
  rootWorldQuaternion,
}: {
  branchVectors: readonly THREE.Vector3[];
  centerWorld: THREE.Vector3;
  rootWorldQuaternion: THREE.Quaternion;
}): LinearSymmetryFit | null => {
  if (branchVectors.length < REPEATED_INERTIA_SYMMETRY_MIN_BRANCH_COUNT) {
    return null;
  }
  const [firstAxis, secondAxis, droppedAxis] = resolveProjectionAxes(branchVectors);
  const planeNormal =
    droppedAxis === "x"
      ? new THREE.Vector3(1, 0, 0)
      : droppedAxis === "y"
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);
  const planarVectors = branchVectors.map((branchVector) =>
    projectVectorOntoPlane({
      planeNormalWorld: planeNormal,
      vector: branchVector,
    })
  );
  const planarDirections = [
    new THREE.Vector3(1, 0, 0).applyQuaternion(rootWorldQuaternion),
    new THREE.Vector3(0, 1, 0).applyQuaternion(rootWorldQuaternion),
    ...planarVectors.flatMap((leftVector, leftIndex) =>
      planarVectors
        .slice(leftIndex + 1)
        .map((rightVector) => rightVector.clone().sub(leftVector))
    ),
  ]
    .map((direction) =>
      projectVectorOntoPlane({
        planeNormalWorld: planeNormal,
        vector: direction,
      })
    )
    .filter((direction) => direction.lengthSq() > Number.EPSILON);
  const candidateDirections = dedupeDirectionCandidates(planarDirections);
  let bestFit: LinearSymmetryFit | null = null;
  candidateDirections.forEach((candidateDirectionWorld) => {
    const perpendicularDirectionWorld = new THREE.Vector3()
      .crossVectors(planeNormal, candidateDirectionWorld)
      .normalize();
    const projectedDistances = planarVectors.map((planarVector) =>
      planarVector.dot(candidateDirectionWorld)
    );
    const lateralDistances = planarVectors.map((planarVector) =>
      planarVector.dot(perpendicularDirectionWorld)
    );
    const idealLateralDistanceMeters = resolveMedian(lateralDistances);
    const assignments = planarVectors.map((planarVector, branchIndex) => {
      const actualAngleRadians = normalizeAngleRadians(
        Math.atan2(planarVector[secondAxis], planarVector[firstAxis])
      );
      const idealProjectionMeters = projectedDistances[branchIndex] ?? 0;
      const idealPlanarVector = candidateDirectionWorld
        .clone()
        .multiplyScalar(idealProjectionMeters)
        .addScaledVector(perpendicularDirectionWorld, idealLateralDistanceMeters);
      const idealAngleRadians = normalizeAngleRadians(
        Math.atan2(idealPlanarVector[secondAxis], idealPlanarVector[firstAxis])
      );
      const actualPoint = centerWorld.clone().add(planarVector);
      const idealPoint = preserveNormalAxisPosition({
        actualWorld: actualPoint,
        planeNormalWorld: planeNormal,
        targetWorld: centerWorld.clone().add(idealPlanarVector),
      });
      const offsetVector = idealPoint.clone().sub(actualPoint);
      return {
        actualAngleRadians,
        angularErrorRadians: Math.abs(
          wrapAngleDeltaRadians(actualAngleRadians - idealAngleRadians)
        ),
        branchIndex,
        idealAngleRadians,
        idealPoint,
        idealProjectionMeters,
        lateralOffsetMeters: Math.abs(
          (lateralDistances[branchIndex] ?? 0) - idealLateralDistanceMeters
        ),
        offsetVector,
      };
    });
    const projections = projectedDistances;
    const axisSpreadMeters = Math.max(...projections) - Math.min(...projections);
    const maxLateralOffsetMeters = Math.max(
      ...assignments.map((assignment) => assignment.lateralOffsetMeters),
      0
    );
    if (axisSpreadMeters < REPEATED_INERTIA_SYMMETRY_MIN_LINEAR_AXIS_SPREAD_METERS) {
      return;
    }
    if (maxLateralOffsetMeters > REPEATED_INERTIA_SYMMETRY_MAX_LINEAR_LATERAL_ERROR_METERS) {
      return;
    }
    if (
      !bestFit ||
      maxLateralOffsetMeters < bestFit.maxLateralOffsetMeters ||
      (Math.abs(maxLateralOffsetMeters - bestFit.maxLateralOffsetMeters) <= Number.EPSILON &&
        axisSpreadMeters >
          Math.max(
            ...bestFit.assignments.map((assignment) => assignment.idealProjectionMeters)
          ) -
            Math.min(
              ...bestFit.assignments.map((assignment) => assignment.idealProjectionMeters)
            ))
    ) {
      bestFit = {
        assignments,
        axisDirectionWorld: candidateDirectionWorld.clone(),
        maxLateralOffsetMeters,
        planeNormal,
      };
    }
  });
  return bestFit;
};

const buildSymmetryTransformSummary = ({
  branchRootWorldPositions,
  outlierBranchRootLinkName,
  rootWorldPosition,
  rootWorldQuaternion,
}: {
  branchRootWorldPositions: ReadonlyMap<string, THREE.Vector3>;
  outlierBranchRootLinkName: string;
  rootWorldPosition: THREE.Vector3;
  rootWorldQuaternion: THREE.Quaternion;
}): SymmetryTransformSummary => {
  const branchEntries = Array.from(branchRootWorldPositions.entries()).map(
    ([branchRootLinkName, worldPosition]) => ({
      branchRootLinkName,
      vectorFromRoot: worldPosition.clone().sub(rootWorldPosition),
    })
  );
  if (branchEntries.length < REPEATED_INERTIA_SYMMETRY_MIN_BRANCH_COUNT) {
    return {
      branchRows: branchEntries.map((entry) => ({
        angleDegrees: 0,
        angularErrorDegrees: null,
        branchRootLinkName: entry.branchRootLinkName,
        idealAngleDegrees: null,
        idealPointWorld: null,
        idealRadialDistanceMeters: null,
        offsetDistanceMeters: 0,
        offsetVectorWorld: new THREE.Vector3(),
        radialDistanceMeters: entry.vectorFromRoot.length(),
        rotationRadians: null,
      })),
      branchCount: branchEntries.length,
      expectedAngleDegrees: null,
      maxAngularErrorDegrees: null,
      outlierAngularErrorDegrees: null,
      planeNormalWorld: null,
      symmetryType: "unclassified",
    };
  }

  const [firstAxis, secondAxis] = resolveProjectionAxes(
    branchEntries.map((entry) => entry.vectorFromRoot)
  );
  const angleEntries = branchEntries
    .map((entry) => ({
      angleRadians: normalizeAngleRadians(
        Math.atan2(entry.vectorFromRoot[secondAxis], entry.vectorFromRoot[firstAxis])
      ),
      branchRootLinkName: entry.branchRootLinkName,
    }))
    .sort(
      (left, right) =>
        left.angleRadians - right.angleRadians ||
        left.branchRootLinkName.localeCompare(right.branchRootLinkName)
    );
  const radialFit = buildRadialSymmetryFit({
    anchorDirectionsWorld: [
      new THREE.Vector3(1, 0, 0).applyQuaternion(rootWorldQuaternion),
      new THREE.Vector3(0, 1, 0).applyQuaternion(rootWorldQuaternion),
      new THREE.Vector3(-1, 0, 0).applyQuaternion(rootWorldQuaternion),
      new THREE.Vector3(0, -1, 0).applyQuaternion(rootWorldQuaternion),
    ],
    branchVectors: branchEntries.map((entry) => entry.vectorFromRoot),
    centerWorld: rootWorldPosition,
    liftMeters: 0,
    minRadiusMeters: 0,
    radiusScale: 1,
  });
  const linearFit = buildLinearSymmetryFit({
    branchVectors: branchEntries.map((entry) => entry.vectorFromRoot),
    centerWorld: rootWorldPosition,
    rootWorldQuaternion,
  });
  if (!radialFit && !linearFit) {
    return {
      branchRows: angleEntries
        .map((entry) => ({
          angleDegrees: toDegrees(entry.angleRadians),
          angularErrorDegrees: null,
          branchRootLinkName: entry.branchRootLinkName,
          idealAngleDegrees: null,
          idealPointWorld: null,
          idealRadialDistanceMeters: null,
          offsetDistanceMeters: 0,
          offsetVectorWorld: new THREE.Vector3(),
          radialDistanceMeters: resolvePlanarDistanceFromRootMeters({
            planeNormalWorld: null,
            rootWorldPosition,
            worldPosition:
              branchRootWorldPositions.get(entry.branchRootLinkName) ?? rootWorldPosition,
          }),
          rotationRadians: null,
        }))
        .sort(
          (left, right) =>
            left.angleDegrees - right.angleDegrees ||
            left.branchRootLinkName.localeCompare(right.branchRootLinkName)
        ),
      branchCount: angleEntries.length,
      expectedAngleDegrees: null,
      maxAngularErrorDegrees: null,
      outlierAngularErrorDegrees: null,
      planeNormalWorld: null,
      symmetryType: "unclassified",
    };
  }
  const radialAssignmentsByBranchRoot = new Map(
    (radialFit?.assignments ?? []).map((assignment) => [
      branchEntries[assignment.branchIndex]?.branchRootLinkName ?? "",
      assignment,
    ] as const)
  );
  const maxAngularErrorDegrees = Math.max(
    ...Array.from(radialAssignmentsByBranchRoot.values()).map((assignment) =>
      toDegrees(assignment.angularErrorRadians)
    ),
    0
  );
  const outlierAngularErrorDegrees =
    radialAssignmentsByBranchRoot.get(outlierBranchRootLinkName)?.angularErrorRadians ?? null;
  let symmetryType: RepeatedInertiaSymmetryType =
    angleEntries.length === 2
      ? maxAngularErrorDegrees <= REPEATED_INERTIA_SYMMETRY_MAX_MIRROR_ANGLE_ERROR_DEGREES
        ? "mirror"
        : "unclassified"
      : maxAngularErrorDegrees <= REPEATED_INERTIA_SYMMETRY_MAX_RADIAL_ANGLE_ERROR_DEGREES
        ? "radial"
        : "unclassified";
  if (symmetryType === "unclassified" && linearFit) {
    symmetryType = "linear";
  }
  const linearAssignmentsByBranchRoot =
    symmetryType === "linear"
      ? new Map(
          (linearFit?.assignments ?? []).map((assignment) => [
            branchEntries[assignment.branchIndex]?.branchRootLinkName ?? "",
            assignment,
          ] as const)
        )
      : null;
  return {
    branchRows: angleEntries
      .map((entry) => {
        const radialAssignment = radialAssignmentsByBranchRoot.get(entry.branchRootLinkName) ?? null;
        const linearAssignment = linearAssignmentsByBranchRoot?.get(entry.branchRootLinkName) ?? null;
        const angularErrorRadians = radialAssignment?.angularErrorRadians ?? null;
        const worldPosition =
          branchRootWorldPositions.get(entry.branchRootLinkName) ?? rootWorldPosition;
        if (linearAssignment) {
          const idealPlanarRadiusMeters = projectVectorOntoPlane({
            planeNormalWorld: linearFit?.planeNormal ?? null,
            vector: linearAssignment.idealPoint.clone().sub(rootWorldPosition),
          }).length();
          return {
            angleDegrees: toDegrees(entry.angleRadians),
            angularErrorDegrees: toDegrees(linearAssignment.angularErrorRadians),
            branchRootLinkName: entry.branchRootLinkName,
            idealAngleDegrees: toDegrees(linearAssignment.idealAngleRadians),
            idealPointWorld: linearAssignment.idealPoint.clone(),
            idealRadialDistanceMeters: idealPlanarRadiusMeters,
            offsetDistanceMeters: linearAssignment.offsetVector.length(),
            offsetVectorWorld: linearAssignment.offsetVector.clone(),
            radialDistanceMeters: resolvePlanarDistanceFromRootMeters({
              planeNormalWorld: linearFit?.planeNormal ?? null,
              rootWorldPosition,
              worldPosition,
            }),
            rotationRadians: wrapAngleDeltaRadians(
              linearAssignment.idealAngleRadians - linearAssignment.actualAngleRadians
            ),
          };
        }
        return {
          angleDegrees: toDegrees(entry.angleRadians),
          angularErrorDegrees:
            angularErrorRadians == null ? null : toDegrees(angularErrorRadians),
          branchRootLinkName: entry.branchRootLinkName,
          idealAngleDegrees:
            radialAssignment == null ? null : toDegrees(radialAssignment.idealAngleRadians),
          idealPointWorld: radialAssignment?.idealPoint ?? null,
          idealRadialDistanceMeters: radialAssignment?.idealRadiusMeters ?? null,
          offsetDistanceMeters: radialAssignment?.offsetMeters ?? 0,
          offsetVectorWorld: radialAssignment?.offsetVector.clone() ?? new THREE.Vector3(),
          radialDistanceMeters: resolvePlanarDistanceFromRootMeters({
            planeNormalWorld: radialFit.planeNormal,
            rootWorldPosition,
            worldPosition,
          }),
          rotationRadians:
            radialAssignment == null
              ? null
              : wrapAngleDeltaRadians(
                  radialAssignment.idealAngleRadians - radialAssignment.actualAngleRadians
                ),
        };
      })
      .sort(
        (left, right) =>
          left.angleDegrees - right.angleDegrees ||
          left.branchRootLinkName.localeCompare(right.branchRootLinkName)
      ),
    branchCount: angleEntries.length,
    expectedAngleDegrees:
      symmetryType === "mirror"
        ? 180
        : symmetryType === "radial"
        ? angleEntries.length === 2
          ? 180
          : toDegrees(radialFit.expectedStepRadians)
        : null,
    maxAngularErrorDegrees:
      symmetryType === "linear" ? null : maxAngularErrorDegrees,
    outlierAngularErrorDegrees:
      symmetryType === "linear"
        ? null
        : outlierAngularErrorDegrees == null
          ? null
          : toDegrees(outlierAngularErrorDegrees),
    planeNormalWorld:
      symmetryType === "linear"
        ? linearFit?.planeNormal.clone() ?? null
        : radialFit.planeNormal.clone(),
    symmetryType,
  };
};

const buildSymmetryOutlierCandidate = (
  group: RepeatedInertiaDiagnosticGroup,
  support: SymmetryFamilySupport,
): SymmetryOutlierCandidate | null => {
  const {
    branchEntries,
    branchRootWorldPositions,
    rootWorldPosition,
    rootWorldQuaternion,
    symmetryRootLinkName,
    transformSummary,
  } = support;
  const medianDistanceMeters = resolveMedian(
    branchEntries.map((entry) =>
      resolvePlanarDistanceFromRootMeters({
        planeNormalWorld: transformSummary.planeNormalWorld,
        rootWorldPosition,
        worldPosition: entry.worldPosition,
      })
    )
  );
  const transformRowByBranchRoot = new Map(
    transformSummary.branchRows.map((row) => [row.branchRootLinkName, row] as const)
  );
  const entriesByDelta = branchEntries
    .map((entry) => {
      const transformRow = transformRowByBranchRoot.get(entry.branchRootLinkName);
      const radialDistanceDeltaMeters = Math.abs(
        resolvePlanarDistanceFromRootMeters({
          planeNormalWorld: transformSummary.planeNormalWorld,
          rootWorldPosition,
          worldPosition: entry.worldPosition,
        }) - medianDistanceMeters
      );
      const guideOffsetDistanceMeters =
        transformRow == null
          ? 0
          : buildCandidateGuideOffsetDistanceMeters({
              branchRootWorldPositions,
              entry,
              rootWorldPosition,
              row: transformRow,
              transformSummary,
            });
      return {
        ...entry,
        confidencePriority: resolveConfidencePriority(entry.confidence),
        guideOffsetDistanceMeters,
        radialDistanceDeltaMeters,
        distanceDeltaMeters:
          transformSummary.symmetryType === "mirror"
            ? guideOffsetDistanceMeters
            : transformSummary.symmetryType === "linear"
              ? transformRow?.offsetDistanceMeters ?? guideOffsetDistanceMeters
              : Math.max(radialDistanceDeltaMeters, guideOffsetDistanceMeters),
      };
    })
    .sort(
      (left, right) =>
        right.distanceDeltaMeters - left.distanceDeltaMeters ||
        right.confidencePriority - left.confidencePriority ||
        (right.mismatchScore ?? Number.NEGATIVE_INFINITY) -
          (left.mismatchScore ?? Number.NEGATIVE_INFINITY) ||
        left.depthFromRoot - right.depthFromRoot ||
        left.entryOrder - right.entryOrder
    );
  const outlierEntry = entriesByDelta[0];
  const secondEntryDelta = entriesByDelta[1]?.distanceDeltaMeters ?? 0;
  const radialEntriesByDelta = [...entriesByDelta].sort(
    (left, right) =>
      right.radialDistanceDeltaMeters - left.radialDistanceDeltaMeters ||
      right.confidencePriority - left.confidencePriority ||
      left.depthFromRoot - right.depthFromRoot ||
      left.entryOrder - right.entryOrder
  );
  const radialOutlierDeltaGapMeters =
    (radialEntriesByDelta[0]?.radialDistanceDeltaMeters ?? 0) -
    (radialEntriesByDelta[1]?.radialDistanceDeltaMeters ?? 0);
  if (!outlierEntry) {
    return null;
  }
  const outlierTransformSummary = buildSymmetryTransformSummary({
    branchRootWorldPositions,
    outlierBranchRootLinkName: outlierEntry.branchRootLinkName,
    rootWorldPosition,
    rootWorldQuaternion,
  });
  const relativeDistanceDelta =
    outlierEntry.distanceDeltaMeters / Math.max(medianDistanceMeters, Number.EPSILON);
  const minimumOutlierDeltaMeters =
    transformSummary.symmetryType === "linear"
      ? REPEATED_INERTIA_SYMMETRY_MIN_LINEAR_OUTLIER_DELTA_METERS
      : REPEATED_INERTIA_SYMMETRY_MIN_OUTLIER_DELTA_METERS;
  const hasMaterialFamilyMisalignment =
    transformSummary.symmetryType !== "mirror" &&
    entriesByDelta.every(
      (entry) => entry.distanceDeltaMeters >= minimumOutlierDeltaMeters
    );
  if (
    outlierEntry.distanceDeltaMeters < minimumOutlierDeltaMeters ||
    ((transformSummary.symmetryType === "radial" ||
      transformSummary.symmetryType === "unclassified") &&
      relativeDistanceDelta < REPEATED_INERTIA_SYMMETRY_MIN_OUTLIER_DELTA_RATIO) ||
    (((transformSummary.symmetryType === "mirror" && entriesByDelta.length >= 2) ||
      (transformSummary.symmetryType !== "mirror" &&
        entriesByDelta.length > 2 &&
        !hasMaterialFamilyMisalignment &&
        radialOutlierDeltaGapMeters < REPEATED_INERTIA_SYMMETRY_MIN_OUTLIER_DELTA_GAP_METERS)) &&
      outlierEntry.distanceDeltaMeters - secondEntryDelta <
        REPEATED_INERTIA_SYMMETRY_MIN_OUTLIER_DELTA_GAP_METERS)
  ) {
    return null;
  }

  return {
    allBranchRootLinkNames: support.allBranchRootLinkNames,
    branchRepresentativeLinks: branchEntries
      .map((entry) => ({
        branchRootLinkName: entry.branchRootLinkName,
        depthFromRoot: entry.depthFromRoot,
        linkName: entry.linkName,
        repeatedGroupKey: group.groupKey,
      }))
      .sort(
        (left, right) =>
          left.depthFromRoot - right.depthFromRoot ||
          left.branchRootLinkName.localeCompare(right.branchRootLinkName)
      ),
    branchCount: transformSummary.branchCount,
    depthFromRoot: outlierEntry.depthFromRoot,
    distanceDeltaMeters: outlierEntry.distanceDeltaMeters,
    expectedAngleDegrees: outlierTransformSummary.expectedAngleDegrees,
    groupKey: group.groupKey,
    maxAngularErrorDegrees: outlierTransformSummary.maxAngularErrorDegrees,
    meshLabel: group.meshLabel,
    outlierBranchRootLinkName: outlierEntry.branchRootLinkName,
    outlierAngularErrorDegrees: outlierTransformSummary.outlierAngularErrorDegrees,
    outlierLinkName: outlierEntry.linkName,
    siblingBranchRootLinkNames: support.allBranchRootLinkNames
      .filter((branchRootLinkName) => branchRootLinkName !== outlierEntry.branchRootLinkName)
      .sort((left, right) => left.localeCompare(right)),
    symmetryRootLinkName,
    symmetryType: outlierTransformSummary.symmetryType,
  };
};

const buildSymmetryFamilySupport = (
  group: RepeatedInertiaDiagnosticGroup,
  robot: ParsedRobot,
  centerMode: RepeatedInertiaSymmetryCenterMode
): SymmetryFamilySupport | null => {
  const entries = group.linkEntries
    .map((entry, entryOrder) => {
      const worldPosition = resolveLinkAlignmentPointWorld(robot, entry.linkName);
      if (!worldPosition) {
        return null;
      }
      const ancestorChain = buildAncestorChain(entry.linkName, robot.parentByChildLink);
      return {
        ancestorChain,
        confidence: entry.confidence,
        entryOrder,
        linkName: entry.linkName,
        mismatchScore: entry.mismatchScore,
        worldPosition,
      };
    })
    .filter(
      (
        entry
      ): entry is {
        ancestorChain: string[];
        confidence: RepeatedInertiaDiagnosticGroup["linkEntries"][number]["confidence"];
        entryOrder: number;
        linkName: string;
        mismatchScore: number | null;
        worldPosition: THREE.Vector3;
      } => entry !== null
    );
  if (entries.length < REPEATED_INERTIA_SYMMETRY_MIN_BRANCH_COUNT) {
    return null;
  }

  const lowestCommonAncestor = resolveLowestCommonAncestor(
    entries.map((entry) => entry.ancestorChain)
  );
  if (!lowestCommonAncestor) {
    return null;
  }
  const rootWorldPosition =
    centerMode === "root-mesh-center"
      ? robot.linkReferenceCentersWorld.get(lowestCommonAncestor) ??
        robot.linkWorldPositions.get(lowestCommonAncestor)
      : robot.linkWorldPositions.get(lowestCommonAncestor);
  const rootWorldMatrix = robot.linkWorldMatrices.get(lowestCommonAncestor);
  if (!rootWorldPosition || !rootWorldMatrix) {
    return null;
  }
  const rootWorldQuaternion = new THREE.Quaternion().setFromRotationMatrix(rootWorldMatrix);

  const branchEntries = entries
    .map((entry) => {
      const branchRootLinkName = resolveBranchRootLinkName(
        entry.ancestorChain,
        lowestCommonAncestor
      );
      if (!branchRootLinkName) {
        return null;
      }
      const branchRootWorldPosition = resolveLinkAlignmentPointWorld(robot, branchRootLinkName);
      if (!branchRootWorldPosition) {
        return null;
      }
      return {
        branchRootLinkName,
        branchRootWorldPosition,
        confidence: entry.confidence,
        depthFromRoot: resolveDepthFromRoot(entry.ancestorChain, lowestCommonAncestor),
        entryOrder: entry.entryOrder,
        linkName: entry.linkName,
        mismatchScore: entry.mismatchScore,
        worldPosition: entry.worldPosition,
      };
    })
    .filter(
      (
        entry
      ): entry is {
        branchRootLinkName: string;
        branchRootWorldPosition: THREE.Vector3;
        confidence: RepeatedInertiaDiagnosticGroup["linkEntries"][number]["confidence"];
        depthFromRoot: number;
        entryOrder: number;
        linkName: string;
        mismatchScore: number | null;
        worldPosition: THREE.Vector3;
      } => entry !== null
    );
  const uniqueBranchRootLinkNames = new Set(
    branchEntries.map((entry) => entry.branchRootLinkName)
  );
  if (uniqueBranchRootLinkNames.size < REPEATED_INERTIA_SYMMETRY_MIN_BRANCH_COUNT) {
    return null;
  }

  const branchRootWorldPositions = new Map(
    branchEntries.map((entry) => [entry.branchRootLinkName, entry.branchRootWorldPosition] as const)
  );
  const transformSummary = buildSymmetryTransformSummary({
    branchRootWorldPositions,
    outlierBranchRootLinkName: branchEntries[0]?.branchRootLinkName ?? "",
    rootWorldPosition,
    rootWorldQuaternion,
  });
  return {
    aggregateKey: `${lowestCommonAncestor}|${Array.from(uniqueBranchRootLinkNames)
      .sort((left, right) => left.localeCompare(right))
      .join(",")}`,
    allBranchRootLinkNames: Array.from(uniqueBranchRootLinkNames).sort((left, right) =>
      left.localeCompare(right)
    ),
    branchEntries,
    branchRootWorldPositions,
    rootWorldPosition,
    rootWorldQuaternion,
    symmetryRootLinkName: lowestCommonAncestor,
    transformSummary,
  };
};

const toVector3Tuple = (vector: THREE.Vector3): [number, number, number] => [
  vector.x,
  vector.y,
  vector.z,
];

const buildRadialIdealRadiiByRepeatedGroupKey = ({
  branchLinkRecordsByRoot,
  planeNormalWorld,
  rootWorldPosition,
  robot,
}: {
  branchLinkRecordsByRoot: ReadonlyMap<string, readonly SymmetryBranchLinkRecord[]>;
  planeNormalWorld: THREE.Vector3 | null;
  rootWorldPosition: THREE.Vector3;
  robot: ParsedRobot;
}): Map<string, number> => {
  const distancesByRepeatedGroupKey = new Map<string, number[]>();
  branchLinkRecordsByRoot.forEach((branchLinkRecords) => {
    branchLinkRecords.forEach((record) => {
      if (!record.repeatedGroupKey) {
        return;
      }
      const worldPosition = resolveLinkAlignmentPointWorld(robot, record.linkName);
      if (!worldPosition) {
        return;
      }
      const planarRadiusMeters = projectVectorOntoPlane({
        planeNormalWorld,
        vector: worldPosition.clone().sub(rootWorldPosition),
      }).length();
      const currentDistances = distancesByRepeatedGroupKey.get(record.repeatedGroupKey) ?? [];
      currentDistances.push(planarRadiusMeters);
      distancesByRepeatedGroupKey.set(record.repeatedGroupKey, currentDistances);
    });
  });
  return new Map(
    Array.from(distancesByRepeatedGroupKey.entries()).map(([repeatedGroupKey, distances]) => [
      repeatedGroupKey,
      resolveMedian(distances),
    ])
  );
};

const buildRadialOffsetBreakdown = ({
  actualWorld,
  idealDirectionWorld,
  idealRadiusMeters,
  planeNormalWorld,
  rootWorldPosition,
}: {
  actualWorld: THREE.Vector3;
  idealDirectionWorld: THREE.Vector3;
  idealRadiusMeters: number | null;
  planeNormalWorld: THREE.Vector3 | null;
  rootWorldPosition: THREE.Vector3;
}): {
  lateralOffsetMeters: number | null;
  radialOffsetMeters: number | null;
} => {
  if (idealRadiusMeters === null || idealDirectionWorld.lengthSq() <= Number.EPSILON) {
    return {
      lateralOffsetMeters: null,
      radialOffsetMeters: null,
    };
  }
  const actualVector = projectVectorOntoPlane({
    planeNormalWorld,
    vector: actualWorld.clone().sub(rootWorldPosition),
  });
  const actualAlongIdealMeters = actualVector.dot(idealDirectionWorld);
  const radialComponent = idealDirectionWorld.clone().multiplyScalar(actualAlongIdealMeters);
  return {
    lateralOffsetMeters: actualVector.clone().sub(radialComponent).length(),
    radialOffsetMeters: actualAlongIdealMeters - idealRadiusMeters,
  };
};

const buildCandidateGuideOffsetDistanceMeters = ({
  branchRootWorldPositions,
  entry,
  rootWorldPosition,
  row,
  transformSummary,
}: {
  branchRootWorldPositions: ReadonlyMap<string, THREE.Vector3>;
  entry: {
    branchRootLinkName: string;
    worldPosition: THREE.Vector3;
  };
  rootWorldPosition: THREE.Vector3;
  row: SymmetryTransformSummary["branchRows"][number];
  transformSummary: SymmetryTransformSummary;
}): number => {
  const idealDirectionWorld =
    row.idealPointWorld == null
      ? null
      : buildPlanarDirection({
          originWorld: rootWorldPosition,
          planeNormalWorld: transformSummary.planeNormalWorld,
          targetWorld: row.idealPointWorld,
        });
  const actualRootWorld = branchRootWorldPositions.get(entry.branchRootLinkName) ?? null;
  const idealWorld = buildIdealAlignmentPointWorld({
    actualRootWorld,
    actualWorld: entry.worldPosition,
    idealDirectionWorld,
    idealRootWorld: row.idealPointWorld,
    planeNormalWorld: transformSummary.planeNormalWorld,
    rootWorldPosition,
    rotationRadians: row.rotationRadians,
  });
  return idealWorld.distanceTo(entry.worldPosition);
};

const sortBranchLinkRecords = (
  branchLinkRecords: readonly SymmetryBranchLinkRecord[]
): SymmetryBranchLinkRecord[] =>
  [...branchLinkRecords].sort(
    (left, right) =>
      left.depthFromRoot - right.depthFromRoot ||
      (left.repeatedGroupKey ?? "").localeCompare(right.repeatedGroupKey ?? "") ||
      left.linkName.localeCompare(right.linkName)
  );

const expandBranchLinkRecordsByRoot = ({
  branchLinkRecordsByRoot,
  robot,
}: {
  branchLinkRecordsByRoot: ReadonlyMap<string, readonly SymmetryBranchLinkRecord[]>;
  robot: ParsedRobot;
}): Map<string, SymmetryBranchLinkRecord[]> =>
  new Map(
    Array.from(branchLinkRecordsByRoot.entries()).map(([branchRootLinkName, branchLinkRecords]) => {
      const recordsByLinkName = new Map(
        branchLinkRecords.map((record) => [record.linkName, record] as const)
      );
      if (!recordsByLinkName.has(branchRootLinkName)) {
        recordsByLinkName.set(branchRootLinkName, {
          depthFromRoot: 0,
          linkName: branchRootLinkName,
          repeatedGroupKey: null,
        });
      }
      branchLinkRecords.forEach((record) => {
        const ancestorPath: string[] = [record.linkName];
        let cursor = record.linkName;
        while (cursor && cursor !== branchRootLinkName) {
          cursor = robot.parentByChildLink.get(cursor) ?? "";
          if (!cursor) {
            ancestorPath.length = 0;
            break;
          }
          ancestorPath.push(cursor);
        }
        ancestorPath.reverse().forEach((linkName, depthFromRoot) => {
          if (!recordsByLinkName.has(linkName)) {
            recordsByLinkName.set(linkName, {
              depthFromRoot,
              linkName,
              repeatedGroupKey: null,
            });
          }
        });
      });
      return [
        branchRootLinkName,
        sortBranchLinkRecords(Array.from(recordsByLinkName.values())),
      ] as const;
    })
  );

const buildBranchLinkOffsetRows = ({
  branchLinkRecords,
  branchRootLinkName,
  idealDirectionWorld,
  idealRadiusByRepeatedGroupKey,
  rootWorldPosition,
  planeNormalWorld,
  robot,
  row,
}: {
  branchLinkRecords: readonly SymmetryBranchLinkRecord[];
  branchRootLinkName: string;
  idealDirectionWorld: THREE.Vector3 | null;
  idealRadiusByRepeatedGroupKey: ReadonlyMap<string, number>;
  rootWorldPosition: THREE.Vector3;
  planeNormalWorld: THREE.Vector3 | null;
  robot: ParsedRobot;
  row: SymmetryTransformSummary["branchRows"][number];
}): RepeatedInertiaSymmetryLinkRow[] => {
  const actualRootWorld = resolveLinkAlignmentPointWorld(robot, branchRootLinkName);
  return branchLinkRecords
    .map((record) => {
      const linkName = record.linkName;
      const actualLinkWorld = resolveLinkAlignmentPointWorld(robot, linkName);
      if (!actualLinkWorld) {
        return null;
      }
      let idealLinkWorld = actualLinkWorld.clone();
      const idealLayerRadiusMeters =
        record.repeatedGroupKey == null
          ? null
          : idealRadiusByRepeatedGroupKey.get(record.repeatedGroupKey) ?? null;
      const recordIdealDirectionWorld =
        idealLayerRadiusMeters == null ? null : idealDirectionWorld;
      idealLinkWorld = buildIdealAlignmentPointWorld({
        actualRootWorld,
        actualWorld: actualLinkWorld,
        idealDirectionWorld: recordIdealDirectionWorld,
        idealRadiusMeters: idealLayerRadiusMeters,
        idealRootWorld: row.idealPointWorld,
        planeNormalWorld,
        rootWorldPosition,
        rotationRadians: row.rotationRadians,
      });
      const offsetVectorWorld = idealLinkWorld.clone().sub(actualLinkWorld);
      const radialOffsetBreakdown = buildRadialOffsetBreakdown({
        actualWorld: actualLinkWorld,
        idealDirectionWorld: recordIdealDirectionWorld ?? new THREE.Vector3(),
        idealRadiusMeters: idealLayerRadiusMeters,
        planeNormalWorld,
        rootWorldPosition,
      });
      return {
        idealPositionMeters: toVector3Tuple(idealLinkWorld),
        idealLayerRadiusMeters,
        lateralOffsetMeters: radialOffsetBreakdown.lateralOffsetMeters,
        linkName,
        offsetDistanceMeters: offsetVectorWorld.length(),
        offsetVectorMeters: toVector3Tuple(offsetVectorWorld),
        radialOffsetMeters: radialOffsetBreakdown.radialOffsetMeters,
      };
    })
    .filter(
      (
        linkRow
      ): linkRow is RepeatedInertiaSymmetryLinkRow => linkRow !== null
    );
};

const buildBranchLinkRecordsByRoot = (
  branchRepresentativeLinksByRoot: ReadonlyMap<string, Map<string, SymmetryBranchLinkRecord>>
): Map<string, SymmetryBranchLinkRecord[]> =>
  new Map(
    Array.from(branchRepresentativeLinksByRoot.entries()).map(
      ([branchRootLinkName, linksByRepeatedGroup]) =>
        [branchRootLinkName, sortBranchLinkRecords(Array.from(linksByRepeatedGroup.values()))] as const
    )
  );

const buildRepresentativeLinkByRoot = (
  branchLinkRecordsByRoot: ReadonlyMap<string, readonly SymmetryBranchLinkRecord[]>
): Map<string, string> =>
  new Map(
    Array.from(branchLinkRecordsByRoot.entries()).map(([branchRootLinkName, branchLinkRecords]) => [
      branchRootLinkName,
      branchLinkRecords[0]?.linkName ?? branchRootLinkName,
    ] as const)
  );

const buildBranchLinkGroups = ({
  allBranchRootLinkNames,
  branchLinkRecordsByRoot,
  outlierBranchRootLinkName,
}: {
  allBranchRootLinkNames: ReadonlySet<string>;
  branchLinkRecordsByRoot: ReadonlyMap<string, readonly SymmetryBranchLinkRecord[]>;
  outlierBranchRootLinkName: string;
}): RepeatedInertiaSymmetryBranchLinkGroup[] =>
  Array.from(allBranchRootLinkNames)
    .sort((left, right) => left.localeCompare(right))
    .map((branchRootLinkName) => ({
      branchRootLinkName,
      linkNames: (branchLinkRecordsByRoot.get(branchRootLinkName) ?? []).map(
        (record) => record.linkName
      ),
  status: branchRootLinkName === outlierBranchRootLinkName ? "outlier" : "aligned",
    }));

type RepairPlanRigidIsland = {
  linkNames: string[];
  rootLinkName: string;
};

const buildRepairPlanRigidIslands = ({
  linkNames,
  robot,
}: {
  linkNames: readonly string[];
  robot: ParsedRobot;
}): RepairPlanRigidIsland[] => {
  const rigidIslands: RepairPlanRigidIsland[] = [];
  linkNames.forEach((linkName, index) => {
    const incomingJoint = robot.jointByChildLink.get(linkName);
    const shouldStartNewIsland =
      index === 0 || !incomingJoint || incomingJoint.jointType !== "fixed";
    if (shouldStartNewIsland) {
      rigidIslands.push({
        linkNames: [linkName],
        rootLinkName: linkName,
      });
      return;
    }
    rigidIslands[rigidIslands.length - 1]?.linkNames.push(linkName);
  });
  return rigidIslands;
};

const resolveAverageIslandTranslationDeltaWorld = ({
  island,
  linkRowsByName,
  robot,
}: {
  island: RepairPlanRigidIsland;
  linkRowsByName: ReadonlyMap<string, RepeatedInertiaSymmetryLinkRow>;
  robot: ParsedRobot;
}): {
  blockedTargetLinkNames: string[];
  targetLinkNames: string[];
  translationDeltaWorld: THREE.Vector3 | null;
} => {
  const translationDeltaWorld = new THREE.Vector3();
  const targetLinkNames: string[] = [];
  const blockedTargetLinkNames: string[] = [];
  let contributingTargetCount = 0;

  island.linkNames.forEach((linkName) => {
    const currentAlignmentPoint = resolveLinkAlignmentPointWorld(robot, linkName);
    const linkRow = linkRowsByName.get(linkName);
    if (!currentAlignmentPoint || !linkRow) {
      return;
    }
    const idealWorldPosition = new THREE.Vector3().fromArray(linkRow.idealPositionMeters);
    const currentDeltaWorld = idealWorldPosition.clone().sub(currentAlignmentPoint);
    if (currentDeltaWorld.length() < REPEATED_INERTIA_SYMMETRY_REPAIR_MIN_STEP_METERS) {
      return;
    }
    targetLinkNames.push(linkName);
    if (linkName !== island.rootLinkName) {
      blockedTargetLinkNames.push(linkName);
    }
    translationDeltaWorld.add(currentDeltaWorld);
    contributingTargetCount += 1;
  });

  if (contributingTargetCount === 0) {
    return {
      blockedTargetLinkNames,
      targetLinkNames,
      translationDeltaWorld: null,
    };
  }

  return {
    blockedTargetLinkNames,
    targetLinkNames,
    translationDeltaWorld: translationDeltaWorld.multiplyScalar(1 / contributingTargetCount),
  };
};

const buildRepeatedInertiaSymmetryRepairPlan = ({
  branchLinkGroups,
  branchRows,
  outlierBranchRootLinkName,
  robot,
  symmetryCenterWorldPosition,
}: {
  branchLinkGroups: RepeatedInertiaSymmetryBranchLinkGroup[];
  branchRows: RepeatedInertiaSymmetryBranchRow[];
  outlierBranchRootLinkName: string;
  robot: ParsedRobot;
  symmetryCenterWorldPosition: THREE.Vector3;
}): RepeatedInertiaSymmetryRepairPlan | null => {
  const outlierBranchLinkGroup = branchLinkGroups.find(
    (group) => group.branchRootLinkName === outlierBranchRootLinkName
  );
  const outlierBranchRow = branchRows.find(
    (row) => row.branchRootLinkName === outlierBranchRootLinkName
  );
  if (!outlierBranchLinkGroup || !outlierBranchRow) {
    return null;
  }

  const linkRowsByName = new Map(
    outlierBranchRow.linkRows.map((linkRow) => [linkRow.linkName, linkRow] as const)
  );
  const linkOrderByName = new Map(
    outlierBranchLinkGroup.linkNames.map((linkName, index) => [linkName, index] as const)
  );
  const targetSteps: Array<
    RepeatedInertiaSymmetryRepairStep & {
      distanceToSymmetryCenterMeters: number;
      linkOrderIndex: number;
    }
  > = [];
  const targetLinkNames: string[] = [];
  const blockedTargetLinkNames: string[] = [];

  buildRepairPlanRigidIslands({
    linkNames: outlierBranchLinkGroup.linkNames,
    robot,
  }).forEach((island) => {
    const currentAlignmentPoint = resolveLinkAlignmentPointWorld(robot, island.rootLinkName);
    const joint = robot.jointByChildLink.get(island.rootLinkName);
    if (!currentAlignmentPoint || !joint) {
      return;
    }

    const islandRepairTarget = resolveAverageIslandTranslationDeltaWorld({
      island,
      linkRowsByName,
      robot,
    });
    islandRepairTarget.targetLinkNames.forEach((linkName) => {
      if (!targetLinkNames.includes(linkName)) {
        targetLinkNames.push(linkName);
      }
    });
    islandRepairTarget.blockedTargetLinkNames.forEach((linkName) => {
      if (!blockedTargetLinkNames.includes(linkName)) {
        blockedTargetLinkNames.push(linkName);
      }
    });

    const translationDeltaWorld = islandRepairTarget.translationDeltaWorld;
    if (
      !translationDeltaWorld ||
      translationDeltaWorld.length() < REPEATED_INERTIA_SYMMETRY_REPAIR_MIN_STEP_METERS
    ) {
      return;
    }
    // Auto-align is translation-only: keep the authored joint rotations unchanged.
    targetSteps.push({
      childLinkName: island.rootLinkName,
      distanceToSymmetryCenterMeters: currentAlignmentPoint.distanceTo(
        symmetryCenterWorldPosition
      ),
      jointName: joint.jointName,
      linkOrderIndex: linkOrderByName.get(island.rootLinkName) ?? Number.POSITIVE_INFINITY,
      parentLinkName: joint.parentLinkName,
      targetPositionMeters: toVector3Tuple(
        currentAlignmentPoint.clone().add(translationDeltaWorld)
      ),
    });
  });

  if (targetSteps.length === 0) {
    return null;
  }

  targetSteps.sort(
    (left, right) =>
      left.linkOrderIndex - right.linkOrderIndex ||
      left.distanceToSymmetryCenterMeters - right.distanceToSymmetryCenterMeters ||
      left.childLinkName.localeCompare(right.childLinkName)
  );

  const orderedSteps: RepeatedInertiaSymmetryRepairStep[] = targetSteps.map(
    ({ childLinkName, jointName, parentLinkName, targetPositionMeters }) => ({
      childLinkName,
      jointName,
      parentLinkName,
      targetPositionMeters,
    })
  );
  const targetCount = targetLinkNames.length;
  const autoStepCount = orderedSteps.length;
  const targetLabel = targetCount === 1 ? "target position" : "target positions";

  return {
    articulatedBoundaryJointName: null,
    blockedTargetLinkNames,
    kind: "translation",
    mode: autoStepCount <= 1 ? "single-joint" : "multi-joint",
    stepCount: autoStepCount,
    summary:
      targetCount === 1
        ? `Adjust ${orderedSteps[0]?.jointName ?? outlierBranchRootLinkName} once to align 1 ${targetLabel}.`
        : blockedTargetLinkNames.length > 0
          ? `Check ${targetCount} ${targetLabel} across ${autoStepCount} rigid moves for the outlier branch.`
          : `Check ${targetCount} ${targetLabel} from the symmetry center outward for the outlier branch.`,
    steps: orderedSteps,
    targetLinkNames,
  };
};

const mergeBranchRepresentativeLink = ({
  aggregate,
  branchLink,
}: {
  aggregate: SymmetryAggregate;
  branchLink: {
    branchRootLinkName: string;
    depthFromRoot: number;
    linkName: string;
    repeatedGroupKey: string;
  };
}) => {
  const branchLinksByRepeatedGroup =
    aggregate.branchRepresentativeLinksByRoot.get(branchLink.branchRootLinkName) ??
    new Map<string, SymmetryBranchLinkRecord>();
  const existingRecord = branchLinksByRepeatedGroup.get(branchLink.repeatedGroupKey);
  if (!existingRecord || branchLink.depthFromRoot < existingRecord.depthFromRoot) {
    branchLinksByRepeatedGroup.set(branchLink.repeatedGroupKey, {
      depthFromRoot: branchLink.depthFromRoot,
      linkName: branchLink.linkName,
      repeatedGroupKey: branchLink.repeatedGroupKey,
    });
  }
  aggregate.branchRepresentativeLinksByRoot.set(
    branchLink.branchRootLinkName,
    branchLinksByRepeatedGroup
  );
};

export const buildRepeatedInertiaSymmetryChains = ({
  repeatedInertiaDiagnostics,
  urdfContent,
  linkCentersLocal,
  centerMode = REPEATED_INERTIA_SYMMETRY_DEFAULT_CENTER_MODE,
}: {
  repeatedInertiaDiagnostics: RepeatedInertiaDiagnosticGroup[];
  urdfContent: string;
  linkCentersLocal?: RepeatedInertiaSymmetryLinkCentersLocal | null;
  centerMode?: RepeatedInertiaSymmetryCenterMode;
}): RepeatedInertiaSymmetryChain[] => {
  const trimmedUrdfContent = urdfContent.trim();
  if (trimmedUrdfContent.length === 0 || repeatedInertiaDiagnostics.length === 0) {
    return [];
  }
  const robot = parseRepeatedInertiaSymmetryRobot(trimmedUrdfContent, {
    linkCentersLocal,
  });
  if (!robot) {
    return [];
  }

  const familySupports = repeatedInertiaDiagnostics
    .map((group) => ({
      group,
      support: buildSymmetryFamilySupport(group, robot, centerMode),
    }))
    .filter(
      (
        entry
      ): entry is {
        group: RepeatedInertiaDiagnosticGroup;
        support: SymmetryFamilySupport;
      } => entry.support !== null
    );

  const aggregates = new Map<string, SymmetryAggregate>();

  familySupports.forEach(({ group, support }) => {
    const candidate = buildSymmetryOutlierCandidate(group, support);
    if (!candidate) {
      return;
    }
    const aggregateKey = support.aggregateKey;
    const aggregate = aggregates.get(aggregateKey) ?? {
      affectedLinksByBranchRoot: new Map<string, Map<string, number>>(),
      allBranchRootLinkNames: new Set<string>(),
      branchRepresentativeLinksByRoot: new Map<string, Map<string, SymmetryBranchLinkRecord>>(),
      branchCount: candidate.branchCount,
      branchEvidenceByRoot: new Map<string, number>(),
      candidates: [],
      groupKeys: new Set<string>(),
      expectedAngleDegrees: candidate.expectedAngleDegrees,
      maxAngularErrorDegrees: candidate.maxAngularErrorDegrees,
      maxDistanceDeltaMeters: 0,
      repeatedMeshLabels: new Set<string>(),
      symmetryRootLinkName: candidate.symmetryRootLinkName,
      symmetryType: candidate.symmetryType,
    };
    aggregate.groupKeys.add(candidate.groupKey);
    aggregate.repeatedMeshLabels.add(candidate.meshLabel);
    candidate.branchRepresentativeLinks.forEach((branchLink) => {
      mergeBranchRepresentativeLink({
        aggregate,
        branchLink,
      });
    });
    const affectedLinksByName =
      aggregate.affectedLinksByBranchRoot.get(candidate.outlierBranchRootLinkName) ??
      new Map<string, number>();
    affectedLinksByName.set(
      candidate.outlierLinkName,
      Math.min(
        affectedLinksByName.get(candidate.outlierLinkName) ?? Number.POSITIVE_INFINITY,
        candidate.depthFromRoot
      )
    );
    aggregate.affectedLinksByBranchRoot.set(candidate.outlierBranchRootLinkName, affectedLinksByName);
    aggregate.branchEvidenceByRoot.set(
      candidate.outlierBranchRootLinkName,
      (aggregate.branchEvidenceByRoot.get(candidate.outlierBranchRootLinkName) ?? 0) +
        candidate.distanceDeltaMeters
    );
    candidate.allBranchRootLinkNames.forEach((linkName) => {
      aggregate.allBranchRootLinkNames.add(linkName);
    });
    aggregate.candidates.push(candidate);
    aggregate.maxDistanceDeltaMeters = Math.max(
      aggregate.maxDistanceDeltaMeters,
      candidate.distanceDeltaMeters
    );
    aggregate.maxAngularErrorDegrees = Math.max(
      aggregate.maxAngularErrorDegrees ?? 0,
      candidate.maxAngularErrorDegrees ?? 0
    );
    if (
      aggregate.symmetryType === "unclassified" &&
      candidate.symmetryType !== "unclassified"
    ) {
      aggregate.symmetryType = candidate.symmetryType;
    }
    aggregates.set(aggregateKey, aggregate);
  });

  familySupports.forEach(({ group, support }) => {
    const aggregate = aggregates.get(support.aggregateKey);
    if (!aggregate) {
      return;
    }
    aggregate.groupKeys.add(group.groupKey);
    aggregate.repeatedMeshLabels.add(group.meshLabel);
    support.branchEntries.forEach((entry) => {
      mergeBranchRepresentativeLink({
        aggregate,
        branchLink: {
          branchRootLinkName: entry.branchRootLinkName,
          depthFromRoot: entry.depthFromRoot,
          linkName: entry.linkName,
          repeatedGroupKey: group.groupKey,
        },
      });
    });
    support.allBranchRootLinkNames.forEach((linkName) => {
      aggregate.allBranchRootLinkNames.add(linkName);
    });
  });

  return Array.from(aggregates.values())
    .filter(
      (aggregate) =>
        aggregate.groupKeys.size >= REPEATED_INERTIA_SYMMETRY_MIN_REPEATED_GROUP_SUPPORT
    )
    .map((aggregate) => {
      const outlierBranchRootLinkName = Array.from(aggregate.branchEvidenceByRoot.entries())
        .sort(
          ([leftLinkName, leftScore], [rightLinkName, rightScore]) =>
            rightScore - leftScore || leftLinkName.localeCompare(rightLinkName)
        )[0]?.[0];
      if (!outlierBranchRootLinkName) {
        return null;
      }
      const symmetryRootWorldPosition = robot.linkWorldPositions.get(aggregate.symmetryRootLinkName);
      const rootMeshCenterWorldPosition =
        robot.linkReferenceCentersWorld.get(aggregate.symmetryRootLinkName) ??
        symmetryRootWorldPosition;
      const symmetryRootWorldMatrix = robot.linkWorldMatrices.get(aggregate.symmetryRootLinkName);
      if (!symmetryRootWorldPosition || !rootMeshCenterWorldPosition || !symmetryRootWorldMatrix) {
        return null;
      }
      const symmetryCenterWorldPosition =
        centerMode === "root-mesh-center"
          ? rootMeshCenterWorldPosition
          : symmetryRootWorldPosition;
      const symmetryRootWorldQuaternion = new THREE.Quaternion().setFromRotationMatrix(
        symmetryRootWorldMatrix
      );
      const branchRootWorldPositions = new Map(
        Array.from(aggregate.allBranchRootLinkNames)
          .map((branchRootLinkName) => {
            const worldPosition = resolveLinkAlignmentPointWorld(robot, branchRootLinkName);
            return worldPosition
              ? ([branchRootLinkName, worldPosition] as const)
              : null;
          })
          .filter(
            (
              entry
            ): entry is readonly [string, THREE.Vector3] => entry !== null
          )
      );
      const transformSummary = buildSymmetryTransformSummary({
        branchRootWorldPositions,
        outlierBranchRootLinkName,
        rootWorldPosition: symmetryCenterWorldPosition,
        rootWorldQuaternion: symmetryRootWorldQuaternion,
      });
      const branchCandidate = aggregate.candidates
        .filter((candidate) => candidate.outlierBranchRootLinkName === outlierBranchRootLinkName)
        .sort(
          (left, right) =>
            left.depthFromRoot - right.depthFromRoot ||
            right.distanceDeltaMeters - left.distanceDeltaMeters
        )[0];
      const affectedLinksByName =
        aggregate.affectedLinksByBranchRoot.get(outlierBranchRootLinkName) ?? new Map<string, number>();
      const branchLinkRecordsByRoot = buildBranchLinkRecordsByRoot(
        aggregate.branchRepresentativeLinksByRoot
      );
      const expandedBranchLinkRecordsByRoot = expandBranchLinkRecordsByRoot({
        branchLinkRecordsByRoot,
        robot,
      });
      const representativeLinkByRoot = buildRepresentativeLinkByRoot(branchLinkRecordsByRoot);
      const subtreeSignatureCache = new Map<string, string>();
      const topologySignatureByBranchRoot = new Map(
        Array.from(aggregate.allBranchRootLinkNames).map((branchRootLinkName) => [
          branchRootLinkName,
          buildSubtreeSignature(
            branchRootLinkName,
            robot.childJointsByParentLink,
            subtreeSignatureCache
          ),
        ] as const)
      );
      const topologySignatureCounts = new Map<string, number>();
      topologySignatureByBranchRoot.forEach((signature) => {
        topologySignatureCounts.set(signature, (topologySignatureCounts.get(signature) ?? 0) + 1);
      });
      const familyTopologySignature = Array.from(topologySignatureCounts.entries()).sort(
        ([leftSignature, leftCount], [rightSignature, rightCount]) =>
          rightCount - leftCount || leftSignature.localeCompare(rightSignature)
      )[0]?.[0] ?? "";
      const topologyMatchingBranchCount =
        topologySignatureCounts.get(familyTopologySignature) ?? 0;
      const medianRadialDistanceMeters = resolveMedian(
        transformSummary.branchRows.map((row) => row.radialDistanceMeters)
      );
      const branchLinkGroups = buildBranchLinkGroups({
        allBranchRootLinkNames: aggregate.allBranchRootLinkNames,
        branchLinkRecordsByRoot: expandedBranchLinkRecordsByRoot,
        outlierBranchRootLinkName,
      });
      const radialIdealRadiiByRepeatedGroupKey =
        transformSummary.symmetryType === "linear"
          ? new Map<string, number>()
          : buildRadialIdealRadiiByRepeatedGroupKey({
              branchLinkRecordsByRoot,
              planeNormalWorld: transformSummary.planeNormalWorld,
              rootWorldPosition: symmetryCenterWorldPosition,
              robot,
            });
      const branchRows: RepeatedInertiaSymmetryChain["branchRows"] = transformSummary.branchRows.map(
        (row) => {
          const branchLinkRecords =
            expandedBranchLinkRecordsByRoot.get(row.branchRootLinkName) ??
            branchLinkRecordsByRoot.get(row.branchRootLinkName) ??
            [];
          const idealDirectionWorld =
            row.idealPointWorld == null
              ? null
              : buildPlanarDirection({
                  originWorld: symmetryCenterWorldPosition,
                  planeNormalWorld: transformSummary.planeNormalWorld,
                  targetWorld: row.idealPointWorld,
                });
          const branchActualWorld = resolveLinkAlignmentPointWorld(robot, row.branchRootLinkName);
          const idealBranchWorld =
            branchActualWorld == null
              ? row.idealPointWorld
              : buildIdealAlignmentPointWorld({
                  actualRootWorld: branchActualWorld,
                  actualWorld: branchActualWorld,
                  idealDirectionWorld,
                  idealRadiusMeters: row.idealRadialDistanceMeters,
                  idealRootWorld: row.idealPointWorld,
                  planeNormalWorld: transformSummary.planeNormalWorld,
                  rootWorldPosition: symmetryCenterWorldPosition,
                  rotationRadians: row.rotationRadians,
                });
          const branchOffsetBreakdown =
            transformSummary.symmetryType === "linear"
              ? {
                  lateralOffsetMeters: row.offsetDistanceMeters,
                  radialOffsetMeters: null,
                }
              : branchActualWorld == null || idealDirectionWorld == null
              ? {
                  lateralOffsetMeters: null,
                  radialOffsetMeters: null,
                }
              : buildRadialOffsetBreakdown({
                  actualWorld: branchActualWorld,
                  idealDirectionWorld,
                  idealRadiusMeters: row.idealRadialDistanceMeters,
                  planeNormalWorld: transformSummary.planeNormalWorld,
                  rootWorldPosition: symmetryCenterWorldPosition,
                });
          const branchOffsetVector =
            branchActualWorld && idealBranchWorld
              ? idealBranchWorld.clone().sub(branchActualWorld)
              : row.offsetVectorWorld.clone();

          return {
            angleDegrees: row.angleDegrees,
            angularErrorDegrees: row.angularErrorDegrees,
            branchRootLinkName: row.branchRootLinkName,
            idealAngleDegrees: row.idealAngleDegrees,
            idealPositionMeters: toVector3Tuple(idealBranchWorld ?? new THREE.Vector3()),
            idealRadialDistanceMeters: row.idealRadialDistanceMeters,
            linkRows: buildBranchLinkOffsetRows({
              branchLinkRecords,
              branchRootLinkName: row.branchRootLinkName,
              idealDirectionWorld,
              idealRadiusByRepeatedGroupKey: radialIdealRadiiByRepeatedGroupKey,
              rootWorldPosition: symmetryCenterWorldPosition,
              planeNormalWorld: transformSummary.planeNormalWorld,
              robot,
              row,
            }),
            lateralOffsetMeters: branchOffsetBreakdown.lateralOffsetMeters,
            offsetDistanceMeters: branchOffsetVector.length(),
            offsetVectorMeters: toVector3Tuple(branchOffsetVector),
            radialOffsetMeters: branchOffsetBreakdown.radialOffsetMeters,
            radialDistanceDeltaMeters: Math.abs(
              row.radialDistanceMeters - medianRadialDistanceMeters
            ),
            radialDistanceMeters: row.radialDistanceMeters,
            representativeLinkName:
              representativeLinkByRoot.get(row.branchRootLinkName) ?? row.branchRootLinkName,
            rotationRadians: row.rotationRadians,
            status:
              row.branchRootLinkName === outlierBranchRootLinkName ? "outlier" : "aligned",
            topologyMatchesFamily:
              topologySignatureByBranchRoot.get(row.branchRootLinkName) === familyTopologySignature,
          };
        }
      );
      return {
        affectedLinkNames: Array.from(affectedLinksByName.entries())
          .sort(
            ([leftName, leftDepth], [rightName, rightDepth]) =>
              leftDepth - rightDepth || leftName.localeCompare(rightName)
          )
          .map(([linkName]) => linkName),
        branchCount: aggregate.branchCount,
        branchLinkGroups,
        branchRows,
        earliestDivergenceLinkName:
          branchCandidate?.outlierLinkName ?? outlierBranchRootLinkName,
        expectedAngleDegrees: aggregate.expectedAngleDegrees,
        maxAngularErrorDegrees: aggregate.maxAngularErrorDegrees,
        maxDistanceDeltaMeters: aggregate.maxDistanceDeltaMeters,
        outlierBranchRootLinkName,
        outlierAngularErrorDegrees: Math.max(
          ...aggregate.candidates
            .filter((candidate) => candidate.outlierBranchRootLinkName === outlierBranchRootLinkName)
            .map((candidate) => candidate.outlierAngularErrorDegrees ?? 0)
        ),
        repeatedGroupCount: aggregate.groupKeys.size,
        repeatedMeshLabels: Array.from(aggregate.repeatedMeshLabels).sort((left, right) =>
          left.localeCompare(right)
        ),
        recommendedRepair: buildRepeatedInertiaSymmetryRepairPlan({
          branchLinkGroups,
          branchRows,
          outlierBranchRootLinkName,
          robot,
          symmetryCenterWorldPosition,
        }),
        siblingBranchRootLinkNames: Array.from(aggregate.allBranchRootLinkNames)
          .filter((linkName) => linkName !== outlierBranchRootLinkName)
          .sort((left, right) => left.localeCompare(right)),
        rootMeshCenterPositionMeters: toVector3Tuple(rootMeshCenterWorldPosition),
        symmetryCenterMode: centerMode,
        symmetryCenterPositionMeters: toVector3Tuple(symmetryCenterWorldPosition),
        symmetryRootLinkName: aggregate.symmetryRootLinkName,
        symmetryType: aggregate.symmetryType,
        topologyMatchingBranchCount,
      } satisfies RepeatedInertiaSymmetryChain;
    })
    .filter((aggregate): aggregate is RepeatedInertiaSymmetryChain => aggregate !== null)
    .filter((chain) => hasMaterialSymmetryMisalignment(chain))
    .sort(
      (left, right) =>
        right.repeatedGroupCount - left.repeatedGroupCount ||
        right.maxDistanceDeltaMeters - left.maxDistanceDeltaMeters ||
        left.symmetryRootLinkName.localeCompare(right.symmetryRootLinkName) ||
        left.outlierBranchRootLinkName.localeCompare(right.outlierBranchRootLinkName)
    );
};
