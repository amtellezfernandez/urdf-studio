import * as THREE from "three";
import { ColladaLoader } from "three-stdlib";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import {
  resolveMeshBlobFromReference,
  type CollisionData,
  type LinkData,
  type LinkGeometryType,
  type OriginData,
  type UrdfAnalysis,
  type VisualData,
} from "@/shared/lib/urdfCore";
import {
  computeEigenDecompositionSymmetric3x3,
  validateInertiaTensor,
  type InertiaTensor,
} from "@/features/viewer/inertialMath";
import {
  buildRepeatedMeshGroupKey,
  resolveRepeatedMeshBacking,
  type RepeatedMeshBacking,
} from "@/features/urdf/inertia/repeatedMeshBacking";
import {
  REPEATED_INERTIA_CANONICALIZATION_MAX_MASS_RELATIVE_SPREAD,
  REPEATED_INERTIA_CANONICALIZATION_MAX_MESH_LOCAL_COM_SEPARATION_METERS,
  REPEATED_INERTIA_CANONICALIZATION_MAX_PRINCIPAL_RELATIVE_SPREAD,
  REPEATED_INERTIA_MIN_INSTANCE_COUNT,
  REPEATED_INERTIA_RELATIVE_SPREAD_EPSILON,
} from "@/features/urdf/inertia/repeatedInertiaParams";
import {
  computeInertialTensorDiagnostics,
  regularizeNearMissInertialTensor,
  type InertialTensorDiagnostics,
} from "./inertialDiagnostics";
import { sanitizeMeshObject, type MeshSanitizationDiagnostics } from "./meshSanitizer";
import {
  INERTIAL_SYNTHESIS_DEFAULT_DENSITY_PRESET_ID,
  INERTIAL_SYNTHESIS_DEFAULT_MESH_SOLVE_MODE,
  INERTIAL_SYNTHESIS_DENSITY_PRESETS,
  INERTIAL_SYNTHESIS_GHOST_GEOMETRY_MASS_LOSS_RATIO,
  INERTIAL_SYNTHESIS_INERTIA_PRECISION_DECIMALS,
  INERTIAL_SYNTHESIS_PLAUSIBILITY_HIGH_DENSITY_PRESET_ID,
  INERTIAL_SYNTHESIS_PLAUSIBILITY_LOW_DENSITY_PRESET_ID,
  INERTIAL_SYNTHESIS_PLAUSIBILITY_MAX_HEAVY_RATIO,
  INERTIAL_SYNTHESIS_PLAUSIBILITY_MAX_TOP_OFFENDERS,
  INERTIAL_SYNTHESIS_PLAUSIBILITY_MIN_COMPARABLE_LINKS,
  INERTIAL_SYNTHESIS_PLAUSIBILITY_MIN_LIGHT_RATIO,
  INERTIAL_SYNTHESIS_MASS_PRECISION_DECIMALS,
  INERTIAL_SYNTHESIS_MIN_MASS_KG,
  INERTIAL_SYNTHESIS_MIN_VOLUME_M3,
  INERTIAL_SYNTHESIS_ORIGIN_PRECISION_DECIMALS,
  INERTIAL_SYNTHESIS_REPEATED_MESH_WARNING_LABEL,
  INERTIAL_SYNTHESIS_VOXEL_RECOVERY_MESH_SOLVE_MODE,
  INERTIAL_SYNTHESIS_ZERO_EPSILON,
  type InertialDensityPresetId,
} from "./inertialSynthesisParams";
import { computeVoxelMassPropertiesFromObject } from "./voxelInertia";

export type InertialGeometrySourceKind = "collision" | "visual";
export type InertialSynthesisStatus = "synthesized" | "skipped";
export type InertialRepairMode = "repair-missing-invalid" | "replace-all";
export type ExistingInertialStatus = "missing" | "invalid-mass" | "invalid-tensor" | "valid";
export type InertialMeshSolveMode = "surface-then-voxel" | "voxel-only";

export type InertialSynthesisWarningCode =
  | "missing-geometry"
  | "unresolved-mesh-reference"
  | "unsupported-mesh-format"
  | "degenerate-geometry"
  | "excessive-cleanup"
  | "mesh-sanitized"
  | "voxel-fallback"
  | "psd-regularized"
  | "invalid-scale"
  | "invalid-inertia"
  | "repeated-mesh-canonicalized";

export type InertialSynthesisWarning = {
  code: InertialSynthesisWarningCode;
  message: string;
};

export type LinkInertialSynthesisResult = {
  linkName: string;
  status: InertialSynthesisStatus;
  existingInertialStatus: ExistingInertialStatus;
  densityPresetId: InertialDensityPresetId;
  densityLabel: string;
  sourceKind: InertialGeometrySourceKind | null;
  geometryKinds: LinkGeometryType[];
  mass: number | null;
  origin: OriginData | null;
  inertia: InertiaTensor | null;
  warnings: InertialSynthesisWarning[];
  diagnostics?: InertialTensorDiagnostics | null;
  meshSanitization?: MeshSanitizationDiagnostics[];
};

export type InertialSynthesisResult = {
  robotName: string | null;
  repairMode: InertialRepairMode;
  densityPresetId: InertialDensityPresetId;
  densityLabel: string;
  regularizeNearMissTensors: boolean;
  results: LinkInertialSynthesisResult[];
  repeatedMeshCanonicalizationSummaries?: RepeatedMeshCanonicalizationSummary[];
};

export type InertialAuditEntry = {
  linkName: string;
  status: ExistingInertialStatus;
  massKg: number | null;
};

export type InertialAuditSummary = {
  robotName: string | null;
  totalLinkCount: number;
  presentLinkCount: number;
  missingLinkCount: number;
  invalidMassLinkCount: number;
  invalidTensorLinkCount: number;
  validLinkCount: number;
  repairableLinkCount: number;
  totalMassKg: number;
  entries: InertialAuditEntry[];
};

export type InertialPlausibilityVerdict = "plausible" | "mass-too-high" | "mass-too-low" | "insufficient-data";

export type InertialPlausibilityOffender = {
  linkName: string;
  authoredMassKg: number;
  heavyEstimateMassKg: number;
  ratioToHeavyEstimate: number;
};

export type InertialPlausibilityExclusionReason =
  | "missing-authored-mass"
  | "unresolved-mesh-reference"
  | "unsupported-mesh-format"
  | "excessive-cleanup"
  | "degenerate-geometry"
  | "missing-geometry"
  | "invalid-scale"
  | "invalid-inertia"
  | "other";

export type InertialPlausibilityExcludedLink = {
  linkName: string;
  reason: InertialPlausibilityExclusionReason;
  message: string;
  recoveryAction: "voxel" | null;
  recoveryEligible: boolean;
  recoveryMessage: string | null;
  recoveryDisposition:
    | "none"
    | "recover"
    | "regularize"
    | "auto-exclude-ghost"
    | "manual-review-proxy";
  diagnostics?: InertialTensorDiagnostics | null;
  meshSanitization?: MeshSanitizationDiagnostics[];
};

export type InertialPlausibilitySummary = {
  verdict: InertialPlausibilityVerdict;
  comparableLinkCount: number;
  excludedLinks: InertialPlausibilityExcludedLink[];
  authoredMassKg: number;
  lightEstimateMassKg: number;
  heavyEstimateMassKg: number;
  ratioToLightEstimate: number | null;
  ratioToHeavyEstimate: number | null;
  warning: string | null;
  offenders: InertialPlausibilityOffender[];
};

export type InertialSynthesisSummary = {
  targetedLinkCount: number;
  synthesizedLinkCount: number;
  skippedLinkCount: number;
  collisionSourceLinkCount: number;
  visualFallbackLinkCount: number;
  voxelFallbackLinkCount: number;
  psdRegularizedLinkCount: number;
  repeatedMeshCanonicalizationGroupCount: number;
  repeatedMeshCanonicalizationMeshReferences: string[];
  warningCount: number;
  totalMassKg: number;
  synthesizedLinkNames: string[];
  voxelFallbackLinkNames: string[];
  psdRegularizedLinkNames: string[];
  skippedLinkNames: string[];
  densityPresetId: InertialDensityPresetId;
  densityLabel: string;
  repairMode: InertialRepairMode;
};

type MassProperties = {
  mass: number;
  volume: number;
  centerOfMass: THREE.Vector3;
  inertiaAtCenter: THREE.Matrix3;
};

type LinkFrameComponentMassProperties = {
  mass: number;
  volume: number;
  centerOfMass: THREE.Vector3;
  inertiaAtLinkOrigin: THREE.Matrix3;
};

type GeometryExtractionResult = {
  sourceKind: InertialGeometrySourceKind;
  components: LinkFrameComponentMassProperties[];
  geometryKinds: LinkGeometryType[];
  warnings: InertialSynthesisWarning[];
  meshSanitization: MeshSanitizationDiagnostics[];
};

type SupportedGeometryEntry = CollisionData | VisualData;

type RepeatedMeshCanonicalizationStrategy = "matching-copy" | "median-consensus" | "skipped";

export type RepeatedMeshCanonicalizationSummary = {
  groupKey: string;
  meshReference: string;
  linkNames: string[];
  strategy: RepeatedMeshCanonicalizationStrategy;
  reason: string;
};

type CanonicalizableRepeatedMeshResult = {
  resultIndex: number;
  result: LinkInertialSynthesisResult & {
    status: "synthesized";
    mass: number;
    origin: OriginData;
    inertia: InertiaTensor;
    sourceKind: InertialGeometrySourceKind;
  };
  backing: RepeatedMeshBacking;
  massKg: number;
  meshLocalComMeters: THREE.Vector3;
  principalMomentsKgM2: [number, number, number];
  meshPrincipalRotation: THREE.Matrix3;
};

const IDENTITY_QUATERNION = new THREE.Quaternion();
const ZERO_VECTOR = new THREE.Vector3();

const createWarning = (
  code: InertialSynthesisWarningCode,
  message: string
): InertialSynthesisWarning => ({
  code,
  message,
});

const VOXEL_RECOVERY_EXCLUSION_REASONS = new Set<InertialPlausibilityExclusionReason>([
  "excessive-cleanup",
  "degenerate-geometry",
  "invalid-inertia",
]);

const classifyFailedVoxelRecoveryDisposition = (
  meshSanitization: MeshSanitizationDiagnostics[] | undefined,
  diagnostics: InertialTensorDiagnostics | null | undefined
): InertialPlausibilityExcludedLink["recoveryDisposition"] => {
  if (diagnostics?.bucket === "near-miss") {
    return "regularize";
  }

  const hasNegligibleMassLossFailure = (meshSanitization ?? []).some(
    (entry) =>
      entry.status === "excessive-deletion" &&
      entry.deletionSafetyReport.metrics.massLossRatio >= INERTIAL_SYNTHESIS_GHOST_GEOMETRY_MASS_LOSS_RATIO
  );
  if (hasNegligibleMassLossFailure) {
    return "auto-exclude-ghost";
  }
  return "manual-review-proxy";
};

const WARNING_PRIORITY: Record<InertialSynthesisWarningCode, number> = {
  "excessive-cleanup": 0,
  "invalid-inertia": 1,
  "degenerate-geometry": 2,
  "missing-geometry": 3,
  "unresolved-mesh-reference": 4,
  "unsupported-mesh-format": 5,
  "invalid-scale": 6,
  "mesh-sanitized": 7,
  "voxel-fallback": 8,
  "psd-regularized": 9,
  "repeated-mesh-canonicalized": 10,
};

const selectPrimaryWarning = (
  warnings: InertialSynthesisWarning[]
): InertialSynthesisWarning | null => {
  if (warnings.length === 0) {
    return null;
  }
  return warnings.reduce((best, warning) =>
    WARNING_PRIORITY[warning.code] < WARNING_PRIORITY[best.code] ? warning : best
  );
};

const toPlausibilityExclusionReason = (
  code: InertialSynthesisWarningCode | null
): InertialPlausibilityExclusionReason => {
  switch (code) {
    case "unresolved-mesh-reference":
      return "unresolved-mesh-reference";
    case "unsupported-mesh-format":
      return "unsupported-mesh-format";
    case "degenerate-geometry":
      return "degenerate-geometry";
    case "excessive-cleanup":
      return "excessive-cleanup";
    case "missing-geometry":
      return "missing-geometry";
    case "invalid-scale":
      return "invalid-scale";
    case "invalid-inertia":
      return "invalid-inertia";
    default:
      return "other";
  }
};

const resolveExistingInertialStatus = (linkData: LinkData): ExistingInertialStatus => {
  if (!linkData.inertial) {
    return "missing";
  }
  const mass = Number(linkData.inertial.mass ?? 0);
  if (!Number.isFinite(mass) || mass <= 0) {
    return "invalid-mass";
  }
  return validateInertiaTensor(linkData.inertial.inertia).valid ? "valid" : "invalid-tensor";
};

const roundNumberToDecimals = (value: number, decimals: number): number =>
  Number(value.toFixed(decimals));

const roundMassNumber = (value: number): number =>
  roundNumberToDecimals(value, INERTIAL_SYNTHESIS_MASS_PRECISION_DECIMALS);

const roundOriginNumber = (value: number): number =>
  roundNumberToDecimals(value, INERTIAL_SYNTHESIS_ORIGIN_PRECISION_DECIMALS);

const roundTensorNumber = (value: number): number =>
  roundNumberToDecimals(value, INERTIAL_SYNTHESIS_INERTIA_PRECISION_DECIMALS);

const roundNumber = roundMassNumber;

const toRoundedTriplet = (vector: THREE.Vector3): [number, number, number] => [
  roundOriginNumber(vector.x),
  roundOriginNumber(vector.y),
  roundOriginNumber(vector.z),
];

const createSymmetricMatrix3 = (
  xx: number,
  xy: number,
  xz: number,
  yy: number,
  yz: number,
  zz: number
): THREE.Matrix3 =>
  new THREE.Matrix3().set(
    xx, xy, xz,
    xy, yy, yz,
    xz, yz, zz
  );

const cloneMatrix3 = (matrix: THREE.Matrix3): THREE.Matrix3 =>
  new THREE.Matrix3().fromArray(matrix.toArray());

const addMatrix3 = (lhs: THREE.Matrix3, rhs: THREE.Matrix3): THREE.Matrix3 => {
  const lhsElements = lhs.elements;
  const rhsElements = rhs.elements;
  const result = new THREE.Matrix3();
  const resultElements = result.elements;
  for (let index = 0; index < resultElements.length; index += 1) {
    resultElements[index] = lhsElements[index] + rhsElements[index];
  }
  return result;
};

const scaleMatrix3 = (matrix: THREE.Matrix3, scale: number): THREE.Matrix3 => {
  const result = cloneMatrix3(matrix);
  const elements = result.elements;
  for (let index = 0; index < elements.length; index += 1) {
    elements[index] *= scale;
  }
  return result;
};

const transposeMatrix3 = (matrix: THREE.Matrix3): THREE.Matrix3 => cloneMatrix3(matrix).transpose();

const multiplyMatrix3 = (lhs: THREE.Matrix3, rhs: THREE.Matrix3): THREE.Matrix3 => {
  const a = lhs.elements;
  const b = rhs.elements;
  return new THREE.Matrix3().set(
    a[0] * b[0] + a[3] * b[1] + a[6] * b[2],
    a[0] * b[3] + a[3] * b[4] + a[6] * b[5],
    a[0] * b[6] + a[3] * b[7] + a[6] * b[8],
    a[1] * b[0] + a[4] * b[1] + a[7] * b[2],
    a[1] * b[3] + a[4] * b[4] + a[7] * b[5],
    a[1] * b[6] + a[4] * b[7] + a[7] * b[8],
    a[2] * b[0] + a[5] * b[1] + a[8] * b[2],
    a[2] * b[3] + a[5] * b[4] + a[8] * b[5],
    a[2] * b[6] + a[5] * b[7] + a[8] * b[8]
  );
};

const rotateInertiaMatrix = (matrix: THREE.Matrix3, rotation: THREE.Matrix3): THREE.Matrix3 =>
  multiplyMatrix3(multiplyMatrix3(rotation, matrix), transposeMatrix3(rotation));

const buildParallelAxisMatrix = (mass: number, offset: THREE.Vector3): THREE.Matrix3 => {
  const dx = offset.x;
  const dy = offset.y;
  const dz = offset.z;
  const distanceSquared = dx * dx + dy * dy + dz * dz;
  return createSymmetricMatrix3(
    mass * (distanceSquared - dx * dx),
    -mass * dx * dy,
    -mass * dx * dz,
    mass * (distanceSquared - dy * dy),
    -mass * dy * dz,
    mass * (distanceSquared - dz * dz)
  );
};

const shiftInertiaToPoint = (
  inertiaAtCenter: THREE.Matrix3,
  mass: number,
  offset: THREE.Vector3
): THREE.Matrix3 => addMatrix3(inertiaAtCenter, buildParallelAxisMatrix(mass, offset));

const shiftInertiaFromPoint = (
  inertiaAtPoint: THREE.Matrix3,
  mass: number,
  offset: THREE.Vector3
): THREE.Matrix3 => addMatrix3(inertiaAtPoint, scaleMatrix3(buildParallelAxisMatrix(mass, offset), -1));

const tensorFromMatrix3 = (matrix: THREE.Matrix3): InertiaTensor => {
  const elements = matrix.elements;
  return {
    ixx: roundTensorNumber(elements[0]),
    ixy: roundTensorNumber(elements[3]),
    ixz: roundTensorNumber(elements[6]),
    iyy: roundTensorNumber(elements[4]),
    iyz: roundTensorNumber(elements[7]),
    izz: roundTensorNumber(elements[8]),
  };
};

const matrix3FromTensor = (tensor: InertiaTensor): THREE.Matrix3 =>
  createSymmetricMatrix3(
    tensor.ixx,
    tensor.ixy,
    tensor.ixz,
    tensor.iyy,
    tensor.iyz,
    tensor.izz
  );

// `computeEigenDecompositionSymmetric3x3()` returns orthonormal eigenvectors as row vectors.
// Reconstructing Q * diag(lambda) * Q^T therefore needs those vectors written back as rows,
// not columns, or the repeated-mesh canonicalization path will transpose the basis and corrupt
// rotated copies after round-tripping through the URDF.
const buildEigenvectorBasisMatrix3 = (
  basis: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3]
): THREE.Matrix3 =>
  new THREE.Matrix3().set(
    basis[0].x, basis[0].y, basis[0].z,
    basis[1].x, basis[1].y, basis[1].z,
    basis[2].x, basis[2].y, basis[2].z
  );

const diagonalMatrix3 = (diagonal: readonly [number, number, number]): THREE.Matrix3 =>
  createSymmetricMatrix3(diagonal[0], 0, 0, diagonal[1], 0, diagonal[2]);

const computeRelativeSpread = (values: readonly number[]): number => {
  if (values.length <= 1) {
    return 0;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const scale = Math.max(
    ...values.map((value) => Math.abs(value)),
    REPEATED_INERTIA_RELATIVE_SPREAD_EPSILON
  );
  return (max - min) / scale;
};

const computePrincipalMomentSpread = (
  values: ReadonlyArray<[number, number, number]>
): number => {
  const spreads = [0, 1, 2].map((index) =>
    computeRelativeSpread(values.map((entry) => entry[index]))
  );
  return Math.max(...spreads);
};

const computeMaxPairwiseDistance = (points: readonly THREE.Vector3[]): number => {
  let maxDistance = 0;
  for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < points.length; rightIndex += 1) {
      maxDistance = Math.max(maxDistance, points[leftIndex].distanceTo(points[rightIndex]));
    }
  }
  return maxDistance;
};

const selectRepresentativeRepeatedMeshEntry = (
  entries: readonly CanonicalizableRepeatedMeshResult[]
): CanonicalizableRepeatedMeshResult => {
  const canonicalMassKg = computeMedian(entries.map((entry) => entry.massKg));
  const canonicalMeshLocalCom = new THREE.Vector3(
    computeMedian(entries.map((entry) => entry.meshLocalComMeters.x)),
    computeMedian(entries.map((entry) => entry.meshLocalComMeters.y)),
    computeMedian(entries.map((entry) => entry.meshLocalComMeters.z))
  );
  const canonicalPrincipalMoments: [number, number, number] = [
    computeMedian(entries.map((entry) => entry.principalMomentsKgM2[0])),
    computeMedian(entries.map((entry) => entry.principalMomentsKgM2[1])),
    computeMedian(entries.map((entry) => entry.principalMomentsKgM2[2])),
  ];

  return [...entries].sort((left, right) => {
    const leftScore =
      Math.abs(left.massKg - canonicalMassKg) +
      left.meshLocalComMeters.distanceToSquared(canonicalMeshLocalCom) +
      left.principalMomentsKgM2.reduce(
        (sum, value, index) => sum + Math.abs(value - canonicalPrincipalMoments[index]),
        0
      );
    const rightScore =
      Math.abs(right.massKg - canonicalMassKg) +
      right.meshLocalComMeters.distanceToSquared(canonicalMeshLocalCom) +
      right.principalMomentsKgM2.reduce(
        (sum, value, index) => sum + Math.abs(value - canonicalPrincipalMoments[index]),
        0
      );
    return leftScore - rightScore;
  })[0];
};

const computeMedian = (values: readonly number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middleIndex - 1] + sorted[middleIndex]) / 2
    : sorted[middleIndex];
};

const projectRepeatedMomentsToTriangleInequality = (
  moments: readonly [number, number, number]
): [number, number, number] => {
  const clamped: [number, number, number] = [
    Math.max(moments[0], 0),
    Math.max(moments[1], 0),
    Math.max(moments[2], 0),
  ];
  if (clamped[0] > clamped[1] + clamped[2]) {
    clamped[0] = clamped[1] + clamped[2];
  }
  return clamped;
};

const parseScale = (scaleValue: string | undefined): THREE.Vector3 | null => {
  const tokens = (scaleValue ?? "1 1 1")
    .trim()
    .split(/\s+/)
    .map((token) => Number.parseFloat(token));
  const scale = new THREE.Vector3(
    Number.isFinite(tokens[0]) ? tokens[0] : 1,
    Number.isFinite(tokens[1]) ? tokens[1] : 1,
    Number.isFinite(tokens[2]) ? tokens[2] : 1
  );
  if (
    !Number.isFinite(scale.x) ||
    !Number.isFinite(scale.y) ||
    !Number.isFinite(scale.z) ||
    Math.abs(scale.x) <= INERTIAL_SYNTHESIS_ZERO_EPSILON ||
    Math.abs(scale.y) <= INERTIAL_SYNTHESIS_ZERO_EPSILON ||
    Math.abs(scale.z) <= INERTIAL_SYNTHESIS_ZERO_EPSILON
  ) {
    return null;
  }
  return scale;
};

const originToTransform = (origin: OriginData): { translation: THREE.Vector3; rotation: THREE.Matrix3 } => {
  const translation = new THREE.Vector3(...origin.xyz);
  const rotationQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(origin.rpy[0], origin.rpy[1], origin.rpy[2], "XYZ")
  );
  const rotation = new THREE.Matrix3().setFromMatrix4(
    new THREE.Matrix4().makeRotationFromQuaternion(rotationQuaternion)
  );
  return { translation, rotation };
};

const computeRepeatedMeshLocalCom = (origin: OriginData, backingOrigin: OriginData): THREE.Vector3 => {
  const { translation, rotation } = originToTransform(backingOrigin);
  return new THREE.Vector3(...origin.xyz).sub(translation).applyMatrix3(transposeMatrix3(rotation));
};

const projectRepeatedMeshLocalComToLinkOrigin = (
  meshLocalCom: THREE.Vector3,
  backingOrigin: OriginData
): THREE.Vector3 => {
  const { translation, rotation } = originToTransform(backingOrigin);
  return meshLocalCom.clone().applyMatrix3(rotation).add(translation);
};

const resolveRepeatedMeshCanonicalizationEntries = ({
  results,
  linkDataByName,
}: {
  results: LinkInertialSynthesisResult[];
  linkDataByName: Record<string, LinkData>;
}): Map<string, CanonicalizableRepeatedMeshResult[]> => {
  const groups = new Map<string, CanonicalizableRepeatedMeshResult[]>();

  results.forEach((result, resultIndex) => {
    if (
      result.status !== "synthesized" ||
      result.mass === null ||
      result.origin === null ||
      result.inertia === null ||
      result.sourceKind === null
    ) {
      return;
    }

    const linkData = linkDataByName[result.linkName];
    if (!linkData) {
      return;
    }
    const backing = resolveRepeatedMeshBacking(linkData);
    if (!backing || backing.source !== result.sourceKind) {
      return;
    }

    const sourceEntries = backing.source === "collision" ? linkData.collisions : linkData.visuals;
    const matchingMeshEntries = sourceEntries.filter(
      (entry) =>
        entry.geometry.type === "mesh" &&
        entry.geometry.params.filename?.trim() === backing.meshReference
    );
    if (sourceEntries.length !== 1 || matchingMeshEntries.length !== 1) {
      return;
    }

    const inertiaMatrix = matrix3FromTensor(result.inertia);
    const eigen = computeEigenDecompositionSymmetric3x3(inertiaMatrix);
    const linkPrincipalRotation = buildEigenvectorBasisMatrix3(eigen.vectors);
    const { rotation } = originToTransform(backing.origin);
    const meshPrincipalRotation = multiplyMatrix3(transposeMatrix3(rotation), linkPrincipalRotation);
    const groupKey = buildRepeatedMeshGroupKey(backing);
    const entry: CanonicalizableRepeatedMeshResult = {
      resultIndex,
      result: result as CanonicalizableRepeatedMeshResult["result"],
      backing,
      massKg: result.mass,
      meshLocalComMeters: computeRepeatedMeshLocalCom(result.origin, backing.origin),
      principalMomentsKgM2: [
        Math.max(eigen.values[0], 0),
        Math.max(eigen.values[1], 0),
        Math.max(eigen.values[2], 0),
      ],
      meshPrincipalRotation,
    };
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), entry]);
  });

  return new Map(
    Array.from(groups.entries()).filter(([, entries]) => entries.length >= REPEATED_INERTIA_MIN_INSTANCE_COUNT)
  );
};

const appendRepeatedMeshCanonicalizationWarning = (
  warnings: InertialSynthesisWarning[],
  meshReference: string
): InertialSynthesisWarning[] => {
  if (warnings.some((warning) => warning.code === "repeated-mesh-canonicalized")) {
    return warnings;
  }
  return warnings.concat(
    createWarning(
      "repeated-mesh-canonicalized",
      `${INERTIAL_SYNTHESIS_REPEATED_MESH_WARNING_LABEL}: canonicalized against repeated mesh "${meshReference}".`
    )
  );
};

const createPrimitiveMassProperties = (
  type: LinkGeometryType,
  params: Record<string, string>,
  densityKgPerM3: number
): MassProperties | null => {
  if (type === "box") {
    const sizeTokens = (params.size ?? "")
      .trim()
      .split(/\s+/)
      .map((token) => Number.parseFloat(token));
    const width = sizeTokens[0];
    const height = sizeTokens[1];
    const depth = sizeTokens[2];
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      !Number.isFinite(depth) ||
      width <= 0 ||
      height <= 0 ||
      depth <= 0
    ) {
      return null;
    }
    const volume = width * height * depth;
    const mass = densityKgPerM3 * volume;
    const inertiaAtCenter = createSymmetricMatrix3(
      (mass * (height * height + depth * depth)) / 12,
      0,
      0,
      (mass * (width * width + depth * depth)) / 12,
      0,
      (mass * (width * width + height * height)) / 12
    );
    return {
      mass,
      volume,
      centerOfMass: ZERO_VECTOR.clone(),
      inertiaAtCenter,
    };
  }
  if (type === "sphere") {
    const radius = Number.parseFloat(params.radius ?? "");
    if (!Number.isFinite(radius) || radius <= 0) {
      return null;
    }
    const volume = (4 / 3) * Math.PI * radius * radius * radius;
    const mass = densityKgPerM3 * volume;
    const moment = (2 * mass * radius * radius) / 5;
    return {
      mass,
      volume,
      centerOfMass: ZERO_VECTOR.clone(),
      inertiaAtCenter: createSymmetricMatrix3(moment, 0, 0, moment, 0, moment),
    };
  }
  if (type === "cylinder") {
    const radius = Number.parseFloat(params.radius ?? "");
    const length = Number.parseFloat(params.length ?? "");
    if (!Number.isFinite(radius) || !Number.isFinite(length) || radius <= 0 || length <= 0) {
      return null;
    }
    const volume = Math.PI * radius * radius * length;
    const mass = densityKgPerM3 * volume;
    return {
      mass,
      volume,
      centerOfMass: ZERO_VECTOR.clone(),
      inertiaAtCenter: createSymmetricMatrix3(
        (mass * (3 * radius * radius + length * length)) / 12,
        0,
        0,
        (mass * (3 * radius * radius + length * length)) / 12,
        0,
        (mass * radius * radius) / 2
      ),
    };
  }
  return null;
};

const loadMeshObject = async (blob: Blob, resolvedPath: string): Promise<THREE.Object3D | null> => {
  const normalizedPath = resolvedPath.trim().toLowerCase();
  if (normalizedPath.endsWith(".obj")) {
    return new OBJLoader().parse(await blob.text());
  }
  if (normalizedPath.endsWith(".stl")) {
    const geometry = new STLLoader().parse(await blob.arrayBuffer());
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  }
  if (normalizedPath.endsWith(".dae")) {
    return new ColladaLoader().parse(await blob.text(), resolvedPath).scene;
  }
  return null;
};

const computeMeshSurfaceMassPropertiesFromObject = (
  object: THREE.Object3D,
  densityKgPerM3: number
): MassProperties | null => {
  object.updateMatrixWorld(true);

  let totalSignedVolume = 0;
  const firstMoment = new THREE.Vector3();
  let integralXX = 0;
  let integralYY = 0;
  let integralZZ = 0;
  let integralXY = 0;
  let integralXZ = 0;
  let integralYZ = 0;
  const vertexA = new THREE.Vector3();
  const vertexB = new THREE.Vector3();
  const vertexC = new THREE.Vector3();
  const positionA = new THREE.Vector3();
  const positionB = new THREE.Vector3();
  const positionC = new THREE.Vector3();
  const cross = new THREE.Vector3();

  const accumulateTriangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const signedVolume = a.dot(cross.crossVectors(b, c)) / 6;
    if (!Number.isFinite(signedVolume) || Math.abs(signedVolume) <= INERTIAL_SYNTHESIS_ZERO_EPSILON) {
      return;
    }
    totalSignedVolume += signedVolume;
    firstMoment.add(
      a.clone().add(b).add(c).multiplyScalar(signedVolume / 4)
    );

    const f1x = a.x * a.x + b.x * b.x + c.x * c.x + a.x * b.x + b.x * c.x + c.x * a.x;
    const f1y = a.y * a.y + b.y * b.y + c.y * c.y + a.y * b.y + b.y * c.y + c.y * a.y;
    const f1z = a.z * a.z + b.z * b.z + c.z * c.z + a.z * b.z + b.z * c.z + c.z * a.z;
    const f2xy =
      2 * a.x * a.y +
      2 * b.x * b.y +
      2 * c.x * c.y +
      a.x * b.y +
      a.y * b.x +
      a.x * c.y +
      a.y * c.x +
      b.x * c.y +
      b.y * c.x;
    const f2xz =
      2 * a.x * a.z +
      2 * b.x * b.z +
      2 * c.x * c.z +
      a.x * b.z +
      a.z * b.x +
      a.x * c.z +
      a.z * c.x +
      b.x * c.z +
      b.z * c.x;
    const f2yz =
      2 * a.y * a.z +
      2 * b.y * b.z +
      2 * c.y * c.z +
      a.y * b.z +
      a.z * b.y +
      a.y * c.z +
      a.z * c.y +
      b.y * c.z +
      b.z * c.y;

    integralXX += (signedVolume * f1x) / 10;
    integralYY += (signedVolume * f1y) / 10;
    integralZZ += (signedVolume * f1z) / 10;
    integralXY += (signedVolume * f2xy) / 20;
    integralXZ += (signedVolume * f2xz) / 20;
    integralYZ += (signedVolume * f2yz) / 20;
  };

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    const position = geometry?.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!mesh.isMesh || !geometry || !position || position.itemSize < 3) {
      return;
    }
    const index = geometry.getIndex();
    const localToRoot = mesh.matrixWorld.clone();

    const readVertex = (attributeIndex: number, target: THREE.Vector3) => {
      target.fromBufferAttribute(position, attributeIndex).applyMatrix4(localToRoot);
    };

    if (index) {
      const indexArray = index.array;
      for (let i = 0; i + 2 < indexArray.length; i += 3) {
        readVertex(indexArray[i] as number, vertexA);
        readVertex(indexArray[i + 1] as number, vertexB);
        readVertex(indexArray[i + 2] as number, vertexC);
        positionA.copy(vertexA);
        positionB.copy(vertexB);
        positionC.copy(vertexC);
        accumulateTriangle(positionA, positionB, positionC);
      }
      return;
    }

    for (let i = 0; i + 2 < position.count; i += 3) {
      readVertex(i, vertexA);
      readVertex(i + 1, vertexB);
      readVertex(i + 2, vertexC);
      positionA.copy(vertexA);
      positionB.copy(vertexB);
      positionC.copy(vertexC);
      accumulateTriangle(positionA, positionB, positionC);
    }
  });

  if (Math.abs(totalSignedVolume) <= INERTIAL_SYNTHESIS_MIN_VOLUME_M3) {
    return null;
  }

  const orientationSign = Math.sign(totalSignedVolume) || 1;
  const volume = Math.abs(totalSignedVolume);
  const centerOfMass = firstMoment.multiplyScalar(1 / totalSignedVolume);
  const mass = densityKgPerM3 * volume;
  const inertiaAtOrigin = createSymmetricMatrix3(
    orientationSign * (integralYY + integralZZ) * densityKgPerM3,
    -orientationSign * integralXY * densityKgPerM3,
    -orientationSign * integralXZ * densityKgPerM3,
    orientationSign * (integralXX + integralZZ) * densityKgPerM3,
    -orientationSign * integralYZ * densityKgPerM3,
    orientationSign * (integralXX + integralYY) * densityKgPerM3
  );
  const inertiaAtCenter = shiftInertiaFromPoint(inertiaAtOrigin, mass, centerOfMass);

  return {
    mass,
    volume,
    centerOfMass,
    inertiaAtCenter,
  };
};

const createMeshMassProperties = async ({
  meshReference,
  meshScale,
  densityKgPerM3,
  meshFiles,
  urdfBasePath,
  packageRoots,
  meshSolveMode,
}: {
  meshReference: string;
  meshScale: string | undefined;
  densityKgPerM3: number;
  meshFiles: Record<string, Blob>;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  meshSolveMode: InertialMeshSolveMode;
}): Promise<
  | {
      success: true;
      properties: MassProperties;
      warning?: InertialSynthesisWarning;
      meshSanitization?: MeshSanitizationDiagnostics;
    }
  | { success: false; warning: InertialSynthesisWarning; meshSanitization?: MeshSanitizationDiagnostics }
> => {
  const resolvedMesh = resolveMeshBlobFromReference(
    meshReference,
    meshFiles,
    urdfBasePath,
    packageRoots
  );
  if (!resolvedMesh) {
    return {
      success: false,
      warning: createWarning(
        "unresolved-mesh-reference",
        `Could not resolve mesh reference "${meshReference}".`
      ),
    };
  }
  const object = await loadMeshObject(resolvedMesh.blob, resolvedMesh.path);
  if (!object) {
    return {
      success: false,
      warning: createWarning(
        "unsupported-mesh-format",
        `Mesh format for "${meshReference}" is not supported for inertia synthesis.`
      ),
    };
  }
  const scale = parseScale(meshScale);
  if (!scale) {
    return {
      success: false,
      warning: createWarning(
        "invalid-scale",
        `Mesh "${meshReference}" has an invalid scale and could not be synthesized.`
      ),
    };
  }
  object.scale.copy(scale);
  const sanitizationResult = sanitizeMeshObject(object);
  if (sanitizationResult.diagnostics.status === "excessive-deletion") {
    const safetyReasons = sanitizationResult.diagnostics.deletionSafetyReport.reasons;
    const excessiveCleanupReason =
      sanitizationResult.diagnostics.deletionSafetyReport.status === "manual-review"
        ? safetyReasons[0] ?? "cleanup safety validation failed"
        : "cleanup exceeded the retained-volume guardrail";
    return {
      success: false,
      warning: createWarning(
        "excessive-cleanup",
        `Mesh "${meshReference}" needs manual review: ${excessiveCleanupReason}.`
      ),
      meshSanitization: sanitizationResult.diagnostics,
    };
  }
  const sanitizedObject = sanitizationResult.object;
  const surfaceProperties =
    meshSolveMode === "voxel-only"
      ? null
      : computeMeshSurfaceMassPropertiesFromObject(sanitizedObject, densityKgPerM3);
  const properties = surfaceProperties ?? computeVoxelMassPropertiesFromObject(sanitizedObject, densityKgPerM3);
  if (!properties) {
    return {
      success: false,
      warning: createWarning(
        "degenerate-geometry",
        `Mesh "${meshReference}" produced degenerate mass properties.`
      ),
      meshSanitization:
        sanitizationResult.diagnostics.status === "sanitized" ? sanitizationResult.diagnostics : undefined,
    };
  }
  const sanitizationWarning =
    sanitizationResult.diagnostics.status === "sanitized"
      ? createWarning(
          "mesh-sanitized",
          `Mesh "${meshReference}" removed ${sanitizationResult.diagnostics.removedComponents} disconnected component${sanitizationResult.diagnostics.removedComponents === 1 ? "" : "s"}, retained ${(sanitizationResult.diagnostics.volumeRetainedRatio * 100).toFixed(1)}% volume, and stayed within cleanup safety thresholds.`
        )
      : undefined;
  return {
    success: true,
    properties,
    meshSanitization:
      sanitizationResult.diagnostics.status === "sanitized" ? sanitizationResult.diagnostics : undefined,
    ...(surfaceProperties
      ? sanitizationWarning
        ? { warning: sanitizationWarning }
        : {}
      : {
          warning: createWarning(
            "voxel-fallback",
            `Mesh "${meshReference}" used volumetric voxel fallback for inertia synthesis.`
          ),
        }),
  };
};

const toLinkFrameComponent = (
  properties: MassProperties,
  origin: OriginData
): LinkFrameComponentMassProperties => {
  const { translation, rotation } = originToTransform(origin);
  const rotatedCenter = properties.centerOfMass.clone().applyMatrix3(rotation).add(translation);
  const rotatedInertiaAtCenter = rotateInertiaMatrix(properties.inertiaAtCenter, rotation);
  return {
    mass: properties.mass,
    volume: properties.volume,
    centerOfMass: rotatedCenter,
    inertiaAtLinkOrigin: shiftInertiaToPoint(
      rotatedInertiaAtCenter,
      properties.mass,
      rotatedCenter
    ),
  };
};

const extractGeometryMassProperties = async ({
  geometryType,
  geometryParams,
  origin,
  densityKgPerM3,
  meshFiles,
  urdfBasePath,
  packageRoots,
  meshSolveMode,
}: {
  geometryType: LinkGeometryType;
  geometryParams: Record<string, string>;
  origin: OriginData;
  densityKgPerM3: number;
  meshFiles: Record<string, Blob>;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  meshSolveMode: InertialMeshSolveMode;
}): Promise<
  | {
      success: true;
      component: LinkFrameComponentMassProperties;
      warning?: InertialSynthesisWarning;
      meshSanitization?: MeshSanitizationDiagnostics;
    }
  | { success: false; warning: InertialSynthesisWarning; meshSanitization?: MeshSanitizationDiagnostics }
> => {
  if (geometryType === "mesh") {
    const meshReference = geometryParams.filename?.trim();
    if (!meshReference) {
      return {
        success: false,
        warning: createWarning("missing-geometry", "Mesh geometry is missing a filename."),
      };
    }
    const meshResult = await createMeshMassProperties({
      meshReference,
      meshScale: geometryParams.scale,
      densityKgPerM3,
      meshFiles,
      urdfBasePath,
      packageRoots,
      meshSolveMode,
    });
    if (meshResult.success === false) {
      return {
        success: false,
        warning: meshResult.warning,
        meshSanitization: meshResult.meshSanitization,
      };
    }
    return {
      success: true,
      component: toLinkFrameComponent(meshResult.properties, origin),
      warning: meshResult.warning,
      meshSanitization: meshResult.meshSanitization,
    };
  }

  const primitiveProperties = createPrimitiveMassProperties(geometryType, geometryParams, densityKgPerM3);
  if (!primitiveProperties) {
    return {
      success: false,
      warning: createWarning(
        "degenerate-geometry",
        `Geometry "${geometryType}" has invalid dimensions and could not be synthesized.`
      ),
    };
  }
  return {
    success: true,
    component: toLinkFrameComponent(primitiveProperties, origin),
  };
};

const isEntryUsable = (entry: SupportedGeometryEntry): boolean => Boolean(entry.geometry?.type);

const extractLinkGeometry = async ({
  entries,
  sourceKind,
  densityKgPerM3,
  meshFiles,
  urdfBasePath,
  packageRoots,
  meshSolveMode,
}: {
  entries: SupportedGeometryEntry[];
  sourceKind: InertialGeometrySourceKind;
  densityKgPerM3: number;
  meshFiles: Record<string, Blob>;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  meshSolveMode: InertialMeshSolveMode;
}): Promise<GeometryExtractionResult | null> => {
  const usableEntries = entries.filter(isEntryUsable);
  if (usableEntries.length === 0) {
    return null;
  }

  const components: LinkFrameComponentMassProperties[] = [];
  const warnings: InertialSynthesisWarning[] = [];
  const meshSanitization: MeshSanitizationDiagnostics[] = [];
  const geometryKinds: LinkGeometryType[] = [];

  for (const entry of usableEntries) {
    const result = await extractGeometryMassProperties({
      geometryType: entry.geometry.type,
      geometryParams: entry.geometry.params ?? {},
      origin: entry.origin,
      densityKgPerM3,
      meshFiles,
      urdfBasePath,
      packageRoots,
      meshSolveMode,
    });
    geometryKinds.push(entry.geometry.type);
    if (result.success === false) {
      warnings.push(result.warning);
      if (result.meshSanitization) {
        meshSanitization.push(result.meshSanitization);
      }
      continue;
    }
    if (result.warning) {
      warnings.push(result.warning);
    }
    if (result.meshSanitization) {
      meshSanitization.push(result.meshSanitization);
    }
    components.push(result.component);
  }

  if (components.length === 0) {
    return {
      sourceKind,
      components: [],
      geometryKinds,
      warnings,
      meshSanitization,
    };
  }

  return {
    sourceKind,
    components,
    geometryKinds,
    warnings,
    meshSanitization,
  };
};

const combineLinkFrameComponents = (
  components: LinkFrameComponentMassProperties[]
): LinkFrameComponentMassProperties | null => {
  if (components.length === 0) {
    return null;
  }
  const totalMass = components.reduce((sum, component) => sum + component.mass, 0);
  const totalVolume = components.reduce((sum, component) => sum + component.volume, 0);
  if (totalMass <= INERTIAL_SYNTHESIS_MIN_MASS_KG || totalVolume <= INERTIAL_SYNTHESIS_MIN_VOLUME_M3) {
    return null;
  }

  const totalCenterOfMass = components.reduce(
    (sum, component) => sum.add(component.centerOfMass.clone().multiplyScalar(component.mass)),
    new THREE.Vector3()
  ).multiplyScalar(1 / totalMass);

  const inertiaAtLinkOrigin = components.reduce(
    (sum, component) => addMatrix3(sum, component.inertiaAtLinkOrigin),
    new THREE.Matrix3().identity().multiplyScalar(0)
  );

  return {
    mass: totalMass,
    volume: totalVolume,
    centerOfMass: totalCenterOfMass,
    inertiaAtLinkOrigin,
  };
};

const synthesizeLinkInertia = async ({
  linkName,
  linkData,
  existingInertialStatus,
  densityPresetId,
  meshFiles,
  urdfBasePath,
  packageRoots,
  meshSolveMode = INERTIAL_SYNTHESIS_DEFAULT_MESH_SOLVE_MODE,
  regularizeNearMissTensors = false,
}: {
  linkName: string;
  linkData: LinkData;
  existingInertialStatus: ExistingInertialStatus;
  densityPresetId: InertialDensityPresetId;
  meshFiles: Record<string, Blob>;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  meshSolveMode?: InertialMeshSolveMode;
  regularizeNearMissTensors?: boolean;
}): Promise<LinkInertialSynthesisResult> => {
  const densityPreset =
    INERTIAL_SYNTHESIS_DENSITY_PRESETS[densityPresetId] ??
    INERTIAL_SYNTHESIS_DENSITY_PRESETS[INERTIAL_SYNTHESIS_DEFAULT_DENSITY_PRESET_ID];
  const collisionExtraction = await extractLinkGeometry({
    entries: linkData.collisions,
    sourceKind: "collision",
    densityKgPerM3: densityPreset.densityKgPerM3,
    meshFiles,
    urdfBasePath,
    packageRoots,
    meshSolveMode,
  });
  const extraction =
    collisionExtraction && collisionExtraction.components.length > 0
      ? collisionExtraction
      : await extractLinkGeometry({
          entries: linkData.visuals,
          sourceKind: "visual",
          densityKgPerM3: densityPreset.densityKgPerM3,
          meshFiles,
          urdfBasePath,
          packageRoots,
          meshSolveMode,
        });

  const warnings = [
    ...(collisionExtraction?.warnings ?? []),
    ...(extraction?.sourceKind === "visual" ? extraction.warnings : []),
  ];

  if (!extraction) {
    return {
      linkName,
      status: "skipped",
      existingInertialStatus,
      densityPresetId,
      densityLabel: densityPreset.label,
      sourceKind: null,
      geometryKinds: [],
      mass: null,
      origin: null,
      inertia: null,
      warnings: [createWarning("missing-geometry", `Link "${linkName}" has no usable collision or visual geometry.`)],
      diagnostics: null,
      meshSanitization: [],
    };
  }

  const combined = combineLinkFrameComponents(extraction.components);
  if (!combined) {
    const missingGeometryWarnings =
      warnings.length > 0
        ? warnings
        : [
            createWarning(
              "degenerate-geometry",
              `Link "${linkName}" produced degenerate mass properties.`
            ),
          ];
    return {
      linkName,
      status: "skipped",
      existingInertialStatus,
      densityPresetId,
      densityLabel: densityPreset.label,
      sourceKind: extraction.sourceKind,
      geometryKinds: extraction.geometryKinds,
      mass: null,
      origin: null,
      inertia: null,
      warnings: missingGeometryWarnings,
      diagnostics: null,
      meshSanitization: extraction.meshSanitization,
    };
  }

  const inertiaAtCenter = shiftInertiaFromPoint(
    combined.inertiaAtLinkOrigin,
    combined.mass,
    combined.centerOfMass
  );
  const inertia = tensorFromMatrix3(inertiaAtCenter);
  const diagnostics = computeInertialTensorDiagnostics(inertia);
  if (!validateInertiaTensor(inertia).valid) {
    if (regularizeNearMissTensors && diagnostics.bucket === "near-miss") {
      const regularizedInertia = regularizeNearMissInertialTensor(inertia);
      const regularizedDiagnostics = computeInertialTensorDiagnostics(regularizedInertia);
      if (validateInertiaTensor(regularizedInertia).valid) {
        return {
          linkName,
          status: "synthesized",
          existingInertialStatus,
          densityPresetId,
          densityLabel: densityPreset.label,
          sourceKind: extraction.sourceKind,
          geometryKinds: extraction.geometryKinds,
          mass: roundNumber(combined.mass),
          origin: {
            xyz: toRoundedTriplet(combined.centerOfMass),
            rpy: [0, 0, 0],
          },
          inertia: regularizedInertia,
          warnings: warnings.concat(
            createWarning(
              "psd-regularized",
              `Link "${linkName}" was PSD-regularized from a near-miss inertia tensor.`
            )
          ),
          diagnostics: regularizedDiagnostics,
          meshSanitization: extraction.meshSanitization,
        };
      }
    }
    return {
      linkName,
      status: "skipped",
      existingInertialStatus,
      densityPresetId,
      densityLabel: densityPreset.label,
      sourceKind: extraction.sourceKind,
      geometryKinds: extraction.geometryKinds,
      mass: null,
      origin: null,
      inertia: null,
      warnings: warnings.concat(
        createWarning("invalid-inertia", `Link "${linkName}" produced a non-physical inertia tensor.`)
      ),
      diagnostics,
      meshSanitization: extraction.meshSanitization,
    };
  }

  return {
    linkName,
    status: "synthesized",
    existingInertialStatus,
    densityPresetId,
    densityLabel: densityPreset.label,
    sourceKind: extraction.sourceKind,
    geometryKinds: extraction.geometryKinds,
    mass: roundNumber(combined.mass),
    origin: {
      xyz: toRoundedTriplet(combined.centerOfMass),
      rpy: [0, 0, 0],
    },
    inertia,
    warnings,
    diagnostics,
    meshSanitization: extraction.meshSanitization,
  };
};

export const canonicalizeRepeatedMeshSynthesisResults = ({
  results,
  linkDataByName,
}: {
  results: LinkInertialSynthesisResult[];
  linkDataByName: Record<string, LinkData>;
}): {
  results: LinkInertialSynthesisResult[];
  summaries: RepeatedMeshCanonicalizationSummary[];
} => {
  const nextResults = [...results];
  const summaries: RepeatedMeshCanonicalizationSummary[] = [];
  const repeatedGroups = resolveRepeatedMeshCanonicalizationEntries({
    results,
    linkDataByName,
  });

  repeatedGroups.forEach((entries, groupKey) => {
    const linkNames = entries.map((entry) => entry.result.linkName).sort((left, right) => left.localeCompare(right));
    const massRelativeSpread = computeRelativeSpread(entries.map((entry) => entry.massKg));
    const principalMomentRelativeSpread = computePrincipalMomentSpread(
      entries.map((entry) => entry.principalMomentsKgM2)
    );
    const meshLocalComMaxSeparationMeters = computeMaxPairwiseDistance(
      entries.map((entry) => entry.meshLocalComMeters)
    );
    const withinConsensusEnvelope =
      massRelativeSpread <= REPEATED_INERTIA_CANONICALIZATION_MAX_MASS_RELATIVE_SPREAD &&
      principalMomentRelativeSpread <= REPEATED_INERTIA_CANONICALIZATION_MAX_PRINCIPAL_RELATIVE_SPREAD &&
      meshLocalComMaxSeparationMeters <=
        REPEATED_INERTIA_CANONICALIZATION_MAX_MESH_LOCAL_COM_SEPARATION_METERS;

    if (!withinConsensusEnvelope) {
      summaries.push({
        groupKey,
        meshReference: entries[0].backing.meshReference,
        linkNames,
        strategy: "skipped",
        reason: "Spread exceeds the repeated-mesh canonicalization safety envelope.",
      });
      return;
    }

    const canonicalMassKg = roundNumber(computeMedian(entries.map((entry) => entry.massKg)));
    const canonicalMeshLocalCom = new THREE.Vector3(
      computeMedian(entries.map((entry) => entry.meshLocalComMeters.x)),
      computeMedian(entries.map((entry) => entry.meshLocalComMeters.y)),
      computeMedian(entries.map((entry) => entry.meshLocalComMeters.z))
    );
    const canonicalPrincipalMoments = projectRepeatedMomentsToTriangleInequality([
      computeMedian(entries.map((entry) => entry.principalMomentsKgM2[0])),
      computeMedian(entries.map((entry) => entry.principalMomentsKgM2[1])),
      computeMedian(entries.map((entry) => entry.principalMomentsKgM2[2])),
    ]);

    const representativeEntry = selectRepresentativeRepeatedMeshEntry(entries);
    const canonicalMeshPrincipalRotation = representativeEntry.meshPrincipalRotation;

    entries.forEach((entry) => {
      const { rotation } = originToTransform(entry.backing.origin);
      const canonicalLinkPrincipalRotation = multiplyMatrix3(rotation, canonicalMeshPrincipalRotation);
      const canonicalInertia = tensorFromMatrix3(
        rotateInertiaMatrix(
          diagonalMatrix3(canonicalPrincipalMoments),
          canonicalLinkPrincipalRotation
        )
      );
      const canonicalOrigin = projectRepeatedMeshLocalComToLinkOrigin(
        canonicalMeshLocalCom,
        entry.backing.origin
      );
      const nextResult = nextResults[entry.resultIndex];
      if (
        nextResult?.status !== "synthesized" ||
        nextResult.origin === null ||
        nextResult.inertia === null ||
        nextResult.mass === null
      ) {
        return;
      }
      nextResults[entry.resultIndex] = {
        ...nextResult,
        mass: canonicalMassKg,
        origin: {
          xyz: toRoundedTriplet(canonicalOrigin),
          rpy: [0, 0, 0],
        },
        inertia: canonicalInertia,
        warnings: appendRepeatedMeshCanonicalizationWarning(
          nextResult.warnings,
          entry.backing.meshReference
        ),
      };
    });

    summaries.push({
      groupKey,
      meshReference: entries[0].backing.meshReference,
      linkNames,
      strategy: "median-consensus",
      reason: "Applied repeated-mesh median consensus for MuJoCo-safe canonicalization.",
    });
  });

  return {
    results: nextResults,
    summaries,
  };
};

export const adaptRepeatedMeshSynthesisResultsFromRepresentative = ({
  results,
  linkDataByName,
}: {
  results: LinkInertialSynthesisResult[];
  linkDataByName: Record<string, LinkData>;
}): {
  results: LinkInertialSynthesisResult[];
  summaries: RepeatedMeshCanonicalizationSummary[];
} => {
  const nextResults = [...results];
  const summaries: RepeatedMeshCanonicalizationSummary[] = [];
  const repeatedGroups = resolveRepeatedMeshCanonicalizationEntries({
    results,
    linkDataByName,
  });

  repeatedGroups.forEach((entries, groupKey) => {
    const linkNames = entries.map((entry) => entry.result.linkName).sort((left, right) => left.localeCompare(right));
    const representativeEntry = selectRepresentativeRepeatedMeshEntry(entries);
    const representativeMassKg = roundNumber(representativeEntry.massKg);
    const representativeMeshLocalCom = representativeEntry.meshLocalComMeters;
    const { rotation: representativeRotation } = originToTransform(representativeEntry.backing.origin);
    const representativeMeshInertia = rotateInertiaMatrix(
      matrix3FromTensor(representativeEntry.result.inertia),
      transposeMatrix3(representativeRotation)
    );

    entries.forEach((entry) => {
      const { rotation } = originToTransform(entry.backing.origin);
      const adaptedOrigin = projectRepeatedMeshLocalComToLinkOrigin(
        representativeMeshLocalCom,
        entry.backing.origin
      );
      const adaptedInertia = tensorFromMatrix3(
        rotateInertiaMatrix(representativeMeshInertia, rotation)
      );
      const nextResult = nextResults[entry.resultIndex];
      if (
        nextResult?.status !== "synthesized" ||
        nextResult.origin === null ||
        nextResult.inertia === null ||
        nextResult.mass === null
      ) {
        return;
      }
      nextResults[entry.resultIndex] = {
        ...nextResult,
        mass: representativeMassKg,
        origin: {
          xyz: toRoundedTriplet(adaptedOrigin),
          rpy: [0, 0, 0],
        },
        inertia: adaptedInertia,
        warnings: appendRepeatedMeshCanonicalizationWarning(
          nextResult.warnings,
          entry.backing.meshReference
        ),
      };
    });

    summaries.push({
      groupKey,
      meshReference: entries[0].backing.meshReference,
      linkNames,
      strategy: "matching-copy",
      reason: "Adapted repeated mesh from a matching source copy in mesh-local space.",
    });
  });

  return {
    results: nextResults,
    summaries,
  };
};

export const synthesizeInertialsFromGeometry = async ({
  urdfAnalysis,
  meshFiles,
  urdfBasePath,
  packageRoots,
  densityPresetId = INERTIAL_SYNTHESIS_DEFAULT_DENSITY_PRESET_ID,
  repairMode = "repair-missing-invalid",
  linkNames,
  meshSolveMode = INERTIAL_SYNTHESIS_DEFAULT_MESH_SOLVE_MODE,
  regularizeNearMissTensors = false,
  canonicalizeRepeatedMeshes = false,
}: {
  urdfAnalysis: UrdfAnalysis | null;
  meshFiles?: Record<string, Blob>;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  densityPresetId?: InertialDensityPresetId;
  repairMode?: InertialRepairMode;
  linkNames?: string[];
  meshSolveMode?: InertialMeshSolveMode;
  regularizeNearMissTensors?: boolean;
  canonicalizeRepeatedMeshes?: boolean;
}): Promise<InertialSynthesisResult | null> => {
  if (!urdfAnalysis?.isValid) {
    return null;
  }

  const targetLinkNames = (linkNames?.length ? linkNames : urdfAnalysis.linkNames).filter(
    (linkName, index, values) => values.indexOf(linkName) === index
  );
  const results = await Promise.all(
    targetLinkNames.map(async (linkName) => {
      const linkData = urdfAnalysis.linkDataByName[linkName];
      if (!linkData) {
        return {
          linkName,
          status: "skipped" as const,
          existingInertialStatus: "missing" as const,
          densityPresetId,
          densityLabel: INERTIAL_SYNTHESIS_DENSITY_PRESETS[densityPresetId].label,
          sourceKind: null,
          geometryKinds: [],
          mass: null,
          origin: null,
          inertia: null,
          warnings: [createWarning("missing-geometry", `Link "${linkName}" could not be found in the URDF analysis.`)],
          diagnostics: null,
          meshSanitization: [],
        };
      }
      const existingInertialStatus = resolveExistingInertialStatus(linkData);
      const shouldSynthesize =
        linkNames?.length
          ? true
          : repairMode === "replace-all"
            ? true
            : existingInertialStatus !== "valid";
      if (!shouldSynthesize) {
        return {
          linkName,
          status: "skipped" as const,
          existingInertialStatus,
          densityPresetId,
          densityLabel: INERTIAL_SYNTHESIS_DENSITY_PRESETS[densityPresetId].label,
          sourceKind: null,
          geometryKinds: [],
          mass: null,
          origin: null,
          inertia: null,
          warnings: [],
          diagnostics: null,
          meshSanitization: [],
        };
      }
      return synthesizeLinkInertia({
        linkName,
        linkData,
        existingInertialStatus,
        densityPresetId,
        meshFiles: meshFiles ?? {},
        urdfBasePath,
        packageRoots,
        meshSolveMode,
        regularizeNearMissTensors,
      });
    })
  );

  const canonicalization = canonicalizeRepeatedMeshes
    ? canonicalizeRepeatedMeshSynthesisResults({
        results,
        linkDataByName: urdfAnalysis.linkDataByName,
      })
    : { results, summaries: [] };

  return {
    robotName: urdfAnalysis.robotName ?? null,
    repairMode,
    densityPresetId,
    densityLabel: INERTIAL_SYNTHESIS_DENSITY_PRESETS[densityPresetId].label,
    regularizeNearMissTensors,
    results: canonicalization.results,
    repeatedMeshCanonicalizationSummaries: canonicalization.summaries,
  };
};

export const buildInertialAuditSummary = (
  urdfAnalysis: UrdfAnalysis | null
): InertialAuditSummary | null => {
  if (!urdfAnalysis?.isValid) {
    return null;
  }
  const entries = urdfAnalysis.linkNames.map((linkName) => {
    const linkData = urdfAnalysis.linkDataByName[linkName];
    const status = linkData ? resolveExistingInertialStatus(linkData) : "missing";
    const massKg =
      linkData?.inertial && Number.isFinite(Number(linkData.inertial.mass))
        ? Number(linkData.inertial.mass)
        : null;
    return {
      linkName,
      status,
      massKg,
    };
  });
  return {
    robotName: urdfAnalysis.robotName ?? null,
    totalLinkCount: entries.length,
    presentLinkCount: entries.filter((entry) => entry.status !== "missing").length,
    missingLinkCount: entries.filter((entry) => entry.status === "missing").length,
    invalidMassLinkCount: entries.filter((entry) => entry.status === "invalid-mass").length,
    invalidTensorLinkCount: entries.filter((entry) => entry.status === "invalid-tensor").length,
    validLinkCount: entries.filter((entry) => entry.status === "valid").length,
    repairableLinkCount: entries.filter((entry) => entry.status !== "valid").length,
    totalMassKg: roundNumber(
      entries.reduce((sum, entry) => sum + (entry.massKg ?? 0), 0)
    ),
    entries,
  };
};

export const buildInertialPlausibilitySummary = async ({
  urdfAnalysis,
  meshFiles,
  urdfBasePath,
  packageRoots,
}: {
  urdfAnalysis: UrdfAnalysis | null;
  meshFiles?: Record<string, Blob>;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
}): Promise<InertialPlausibilitySummary | null> => {
  const auditSummary = buildInertialAuditSummary(urdfAnalysis);
  if (!auditSummary) {
    return null;
  }

  const [lightEstimate, heavyEstimate] = await Promise.all([
    synthesizeInertialsFromGeometry({
      urdfAnalysis,
      meshFiles,
      urdfBasePath,
      packageRoots,
      densityPresetId: INERTIAL_SYNTHESIS_PLAUSIBILITY_LOW_DENSITY_PRESET_ID,
      repairMode: "replace-all",
    }),
    synthesizeInertialsFromGeometry({
      urdfAnalysis,
      meshFiles,
      urdfBasePath,
      packageRoots,
      densityPresetId: INERTIAL_SYNTHESIS_PLAUSIBILITY_HIGH_DENSITY_PRESET_ID,
      repairMode: "replace-all",
    }),
  ]);

  if (!lightEstimate || !heavyEstimate) {
    return null;
  }

  const lightMassByLink = new Map(
    lightEstimate.results
      .filter((result) => result.status === "synthesized" && result.mass !== null)
      .map((result) => [result.linkName, result.mass ?? 0] as const)
  );
  const heavyMassByLink = new Map(
    heavyEstimate.results
      .filter((result) => result.status === "synthesized" && result.mass !== null)
      .map((result) => [result.linkName, result.mass ?? 0] as const)
  );
  const lightResultByLink = new Map(lightEstimate.results.map((result) => [result.linkName, result] as const));
  const heavyResultByLink = new Map(heavyEstimate.results.map((result) => [result.linkName, result] as const));
  const excludedLinksBase = auditSummary.entries
    .filter((entry) => {
      const massKg = entry.massKg;
      return (
        massKg === null ||
        !lightMassByLink.has(entry.linkName) ||
        !heavyMassByLink.has(entry.linkName)
      );
    })
    .map((entry) => {
      if (entry.massKg === null) {
        return {
          linkName: entry.linkName,
          reason: "missing-authored-mass" as const,
          message: `Link "${entry.linkName}" has no authored inertial mass.`,
          diagnostics: null,
          meshSanitization: [],
        };
      }
      const lightResult = lightResultByLink.get(entry.linkName);
      const heavyResult = heavyResultByLink.get(entry.linkName);
      const warning = selectPrimaryWarning(lightResult?.warnings ?? []) ??
        selectPrimaryWarning(heavyResult?.warnings ?? []);
        return {
          linkName: entry.linkName,
          reason: toPlausibilityExclusionReason(warning?.code ?? null),
          message: warning?.message ?? `Link "${entry.linkName}" could not be compared against synthesized geometry.`,
          diagnostics:
            (lightResult?.status === "skipped" ? lightResult.diagnostics : null) ??
            (heavyResult?.status === "skipped" ? heavyResult.diagnostics : null) ??
            null,
          meshSanitization:
            lightResult?.meshSanitization?.length
              ? lightResult.meshSanitization
              : (heavyResult?.meshSanitization ?? []),
        };
      });
  const voxelRecoveryProbeLinkNames = excludedLinksBase
    .filter((entry) => VOXEL_RECOVERY_EXCLUSION_REASONS.has(entry.reason))
    .map((entry) => entry.linkName);
  const voxelRecoveryProbe =
    voxelRecoveryProbeLinkNames.length > 0
      ? await synthesizeInertialsFromGeometry({
          urdfAnalysis,
          meshFiles,
          urdfBasePath,
          packageRoots,
          densityPresetId: INERTIAL_SYNTHESIS_DEFAULT_DENSITY_PRESET_ID,
          repairMode: "replace-all",
          linkNames: voxelRecoveryProbeLinkNames,
          meshSolveMode: INERTIAL_SYNTHESIS_VOXEL_RECOVERY_MESH_SOLVE_MODE,
        })
      : null;
  const voxelRecoveryProbeByLink = new Map(
    voxelRecoveryProbe?.results.map((result) => [result.linkName, result] as const) ?? []
  );
  const excludedLinks = excludedLinksBase.map((entry) => {
    if (!VOXEL_RECOVERY_EXCLUSION_REASONS.has(entry.reason)) {
        return {
          ...entry,
          recoveryAction: null,
          recoveryEligible: false,
          recoveryMessage: null,
          recoveryDisposition: "none" as const,
          diagnostics: entry.diagnostics,
          meshSanitization: entry.meshSanitization,
        };
    }
    const probeResult = voxelRecoveryProbeByLink.get(entry.linkName);
    if (probeResult?.status === "synthesized") {
      return {
        ...entry,
        recoveryAction: "voxel" as const,
        recoveryEligible: true,
        recoveryMessage: null,
        recoveryDisposition: "recover" as const,
        diagnostics: probeResult.diagnostics,
        meshSanitization: probeResult.meshSanitization ?? entry.meshSanitization,
      };
    }
    const failedDiagnostics = probeResult?.diagnostics ?? entry.diagnostics;
    const failedMeshSanitization = probeResult?.meshSanitization ?? entry.meshSanitization;
    const recoveryDisposition = classifyFailedVoxelRecoveryDisposition(
      failedMeshSanitization,
      failedDiagnostics
    );
    return {
      ...entry,
      recoveryAction: recoveryDisposition === "regularize" ? ("voxel" as const) : null,
      recoveryEligible: false,
      recoveryMessage:
        recoveryDisposition === "auto-exclude-ghost"
          ? `Mesh cleanup would discard at least ${(INERTIAL_SYNTHESIS_GHOST_GEOMETRY_MASS_LOSS_RATIO * 100).toFixed(1)}% of "${entry.linkName}" mass. Treat it as ghost geometry and exclude it from repair.`
          : recoveryDisposition === "manual-review-proxy"
            ? `Voxel recovery still fails for "${entry.linkName}". Preserve the link and replace the mesh with a box or cylinder proxy.`
            : selectPrimaryWarning(probeResult?.warnings ?? [])?.message ??
              `Voxel recovery could not synthesize "${entry.linkName}".`,
      recoveryDisposition: recoveryDisposition as InertialPlausibilityExcludedLink["recoveryDisposition"],
      diagnostics: failedDiagnostics,
      meshSanitization: failedMeshSanitization,
    };
  });

  const comparableEntries = auditSummary.entries.filter((entry) => {
    const massKg = entry.massKg;
    return (
      massKg !== null &&
      lightMassByLink.has(entry.linkName) &&
      heavyMassByLink.has(entry.linkName)
    );
  });
  if (comparableEntries.length < INERTIAL_SYNTHESIS_PLAUSIBILITY_MIN_COMPARABLE_LINKS) {
    return {
      verdict: "insufficient-data",
      comparableLinkCount: comparableEntries.length,
      excludedLinks,
      authoredMassKg: roundNumber(comparableEntries.reduce((sum, entry) => sum + (entry.massKg ?? 0), 0)),
      lightEstimateMassKg: roundNumber(
        comparableEntries.reduce((sum, entry) => sum + (lightMassByLink.get(entry.linkName) ?? 0), 0)
      ),
      heavyEstimateMassKg: roundNumber(
        comparableEntries.reduce((sum, entry) => sum + (heavyMassByLink.get(entry.linkName) ?? 0), 0)
      ),
      ratioToLightEstimate: null,
      ratioToHeavyEstimate: null,
      warning: "Not enough geometry could be resolved to audit inertial plausibility.",
      offenders: [],
    };
  }

  const authoredMassKg = roundNumber(
    comparableEntries.reduce((sum, entry) => sum + (entry.massKg ?? 0), 0)
  );
  const lightEstimateMassKg = roundNumber(
    comparableEntries.reduce((sum, entry) => sum + (lightMassByLink.get(entry.linkName) ?? 0), 0)
  );
  const heavyEstimateMassKg = roundNumber(
    comparableEntries.reduce((sum, entry) => sum + (heavyMassByLink.get(entry.linkName) ?? 0), 0)
  );
  const ratioToLightEstimate =
    lightEstimateMassKg > INERTIAL_SYNTHESIS_MIN_MASS_KG
      ? roundNumber(authoredMassKg / lightEstimateMassKg)
      : null;
  const ratioToHeavyEstimate =
    heavyEstimateMassKg > INERTIAL_SYNTHESIS_MIN_MASS_KG
      ? roundNumber(authoredMassKg / heavyEstimateMassKg)
      : null;

  let verdict: InertialPlausibilityVerdict = "plausible";
  let warning: string | null = null;
  if (
    ratioToHeavyEstimate !== null &&
    ratioToHeavyEstimate > INERTIAL_SYNTHESIS_PLAUSIBILITY_MAX_HEAVY_RATIO
  ) {
    verdict = "mass-too-high";
    warning = `Authored mass ${authoredMassKg.toFixed(3)} kg exceeds the geometry-derived heavy-material estimate of ${heavyEstimateMassKg.toFixed(3)} kg.`;
  } else if (
    ratioToLightEstimate !== null &&
    ratioToLightEstimate < INERTIAL_SYNTHESIS_PLAUSIBILITY_MIN_LIGHT_RATIO
  ) {
    verdict = "mass-too-low";
    warning = `Authored mass ${authoredMassKg.toFixed(3)} kg is far below the geometry-derived light-material estimate of ${lightEstimateMassKg.toFixed(3)} kg.`;
  }

  const offenders =
    verdict === "mass-too-high"
      ? comparableEntries
          .map((entry) => {
            const heavyEstimateMass = heavyMassByLink.get(entry.linkName) ?? 0;
            return {
              linkName: entry.linkName,
              authoredMassKg: entry.massKg ?? 0,
              heavyEstimateMassKg: roundNumber(heavyEstimateMass),
              ratioToHeavyEstimate:
                heavyEstimateMass > INERTIAL_SYNTHESIS_MIN_MASS_KG
                  ? roundNumber((entry.massKg ?? 0) / heavyEstimateMass)
                  : Number.POSITIVE_INFINITY,
            };
          })
          .sort((left, right) => right.ratioToHeavyEstimate - left.ratioToHeavyEstimate)
          .slice(0, INERTIAL_SYNTHESIS_PLAUSIBILITY_MAX_TOP_OFFENDERS)
      : [];

  return {
    verdict,
    comparableLinkCount: comparableEntries.length,
    excludedLinks,
    authoredMassKg,
    lightEstimateMassKg,
    heavyEstimateMassKg,
    ratioToLightEstimate,
    ratioToHeavyEstimate,
    warning,
    offenders,
  };
};

export type InertialMassDeltaSummary = {
  changedLinkCount: number;
  totalMassBeforeKg: number;
  totalMassAfterKg: number;
  totalMassDeltaKg: number;
  largestChanges: Array<{
    linkName: string;
    massBeforeKg: number | null;
    massAfterKg: number;
    deltaKg: number;
  }>;
};

export const buildInertialMassDeltaSummary = ({
  auditSummary,
  synthesisResult,
}: {
  auditSummary: InertialAuditSummary | null;
  synthesisResult: InertialSynthesisResult | null;
}): InertialMassDeltaSummary | null => {
  if (!auditSummary || !synthesisResult) {
    return null;
  }
  const beforeByLink = new Map(auditSummary.entries.map((entry) => [entry.linkName, entry.massKg] as const));
  const changed = synthesisResult.results
    .filter((result) => result.status === "synthesized" && result.mass !== null)
    .map((result) => {
      const massBeforeKg = beforeByLink.get(result.linkName) ?? null;
      const massAfterKg = result.mass ?? 0;
      return {
        linkName: result.linkName,
        massBeforeKg,
        massAfterKg,
        deltaKg: roundNumber(massAfterKg - (massBeforeKg ?? 0)),
      };
    })
    .sort((left, right) => Math.abs(right.deltaKg) - Math.abs(left.deltaKg));
  const totalMassAfterKg = roundNumber(
    auditSummary.entries.reduce((sum, entry) => sum + (entry.massKg ?? 0), 0) +
      changed.reduce((sum, entry) => sum + entry.deltaKg, 0)
  );
  return {
    changedLinkCount: changed.length,
    totalMassBeforeKg: auditSummary.totalMassKg,
    totalMassAfterKg,
    totalMassDeltaKg: roundNumber(totalMassAfterKg - auditSummary.totalMassKg),
    largestChanges: changed.slice(0, 5),
  };
};

export const buildInertialSynthesisSummary = (
  synthesisResult: InertialSynthesisResult | null
): InertialSynthesisSummary | null => {
  if (!synthesisResult) {
    return null;
  }
  const synthesized = synthesisResult.results.filter((result) => result.status === "synthesized");
  const skipped = synthesisResult.results.filter((result) => result.status === "skipped");
  const repeatedMeshCanonicalizationSummaries = (
    synthesisResult.repeatedMeshCanonicalizationSummaries ?? []
  ).filter((summary) => summary.strategy === "median-consensus");
  return {
    targetedLinkCount: synthesisResult.results.length,
    synthesizedLinkCount: synthesized.length,
    skippedLinkCount: skipped.length,
    collisionSourceLinkCount: synthesized.filter((result) => result.sourceKind === "collision").length,
    visualFallbackLinkCount: synthesized.filter((result) => result.sourceKind === "visual").length,
    voxelFallbackLinkCount: synthesized.filter((result) =>
      result.warnings.some((warning) => warning.code === "voxel-fallback")
    ).length,
    psdRegularizedLinkCount: synthesized.filter((result) =>
      result.warnings.some((warning) => warning.code === "psd-regularized")
    ).length,
    repeatedMeshCanonicalizationGroupCount: repeatedMeshCanonicalizationSummaries.length,
    repeatedMeshCanonicalizationMeshReferences: repeatedMeshCanonicalizationSummaries.map(
      (summary) => summary.meshReference
    ),
    warningCount: synthesisResult.results.reduce((sum, result) => sum + result.warnings.length, 0),
    totalMassKg: roundNumber(
      synthesized.reduce((sum, result) => sum + (result.mass ?? 0), 0)
    ),
    synthesizedLinkNames: synthesized.map((result) => result.linkName),
    voxelFallbackLinkNames: synthesized
      .filter((result) => result.warnings.some((warning) => warning.code === "voxel-fallback"))
      .map((result) => result.linkName),
    psdRegularizedLinkNames: synthesized
      .filter((result) => result.warnings.some((warning) => warning.code === "psd-regularized"))
      .map((result) => result.linkName),
    skippedLinkNames: skipped.map((result) => result.linkName),
    densityPresetId: synthesisResult.densityPresetId,
    densityLabel: synthesisResult.densityLabel,
    repairMode: synthesisResult.repairMode,
  };
};
