import * as THREE from "three";

import type { LinkData } from "@/shared/lib/urdfCore";
import { composeUrdfPoseMatrix } from "@/shared/lib/spatialFrame";
import type { InertiaReliabilityEntry } from "@/features/viewer/InertialVisualization";
import { computeEigenDecompositionSymmetric3x3 } from "@/features/viewer/inertialMath";
import {
  buildRepeatedMeshGroupKey,
  resolveRepeatedMeshBacking,
  type MeshSource,
} from "@/features/urdf/inertia/repeatedMeshBacking";
import {
  REPEATED_INERTIA_MASS_RELATIVE_TOLERANCE,
  REPEATED_INERTIA_MESH_LOCAL_COM_TOLERANCE_METERS,
  REPEATED_INERTIA_MIN_INSTANCE_COUNT,
  REPEATED_INERTIA_PRINCIPAL_MOMENT_RELATIVE_TOLERANCE,
  REPEATED_INERTIA_RELATIVE_SPREAD_EPSILON,
} from "@/features/layout/page/repeatedInertiaDiagnosticsParams";

export type RepeatedInertiaIssueKey =
  | "group-review"
  | "mass-mismatch"
  | "principal-moment-mismatch"
  | "mesh-local-com-mismatch"
  | "confidence-mismatch"
  | "strategy-mismatch";

export type RepeatedInertiaDiagnosticLinkEntry = {
  linkName: string;
  massKg: number;
  principalMomentsKgM2: [number, number, number];
  meshLocalComMeters: [number, number, number];
  confidence: InertiaReliabilityEntry["confidence"] | null;
  strategy: InertiaReliabilityEntry["strategy"] | null;
  mismatchScore: number | null;
  mismatchBreakdown: InertiaReliabilityEntry["mismatchBreakdown"] | null;
  centerOfMassOutsideReference: boolean;
};

export type RepeatedInertiaDiagnosticGroup = {
  groupKey: string;
  meshLabel: string;
  meshReference: string;
  source: MeshSource;
  instanceCount: number;
  issueKeys: RepeatedInertiaIssueKey[];
  issueSummary: string[];
  physicalMismatch: boolean;
  massRelativeSpread: number;
  principalMomentRelativeSpread: number;
  meshLocalComMaxSeparationMeters: number;
  confidenceValues: Array<NonNullable<RepeatedInertiaDiagnosticLinkEntry["confidence"]>>;
  strategyValues: Array<NonNullable<RepeatedInertiaDiagnosticLinkEntry["strategy"]>>;
  linkEntries: RepeatedInertiaDiagnosticLinkEntry[];
};

type RepeatedInertiaDiagnosticInput = {
  linkDataByName: Record<string, LinkData> | null | undefined;
  reliabilityEntries?: InertiaReliabilityEntry[] | null;
};

type GroupCandidate = {
  meshLabel: string;
  meshReference: string;
  source: MeshSource;
  linkEntries: RepeatedInertiaDiagnosticLinkEntry[];
};

const computePrincipalMoments = (
  inertia: NonNullable<LinkData["inertial"]>["inertia"]
): [number, number, number] | null => {
  const matrix = new THREE.Matrix3().set(
    inertia.ixx,
    inertia.ixy,
    inertia.ixz,
    inertia.ixy,
    inertia.iyy,
    inertia.iyz,
    inertia.ixz,
    inertia.iyz,
    inertia.izz
  );
  const eigen = computeEigenDecompositionSymmetric3x3(matrix);
  if (eigen.values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  return [
    Math.max(eigen.values[0], 0),
    Math.max(eigen.values[1], 0),
    Math.max(eigen.values[2], 0),
  ];
};

const computeMeshLocalCom = ({
  inertialOrigin,
  geometryOrigin,
}: {
  inertialOrigin: [number, number, number];
  geometryOrigin: {
    xyz: [number, number, number];
    rpy: [number, number, number];
  };
}): [number, number, number] => {
  const geometryMatrix = composeUrdfPoseMatrix(
    {
      xyz: geometryOrigin.xyz,
      rpy: geometryOrigin.rpy,
    },
    new THREE.Matrix4()
  );
  const localPoint = new THREE.Vector3(
    inertialOrigin[0],
    inertialOrigin[1],
    inertialOrigin[2]
  ).applyMatrix4(geometryMatrix.invert());
  return [localPoint.x, localPoint.y, localPoint.z];
};

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
  linkEntries: readonly RepeatedInertiaDiagnosticLinkEntry[]
): number => {
  const spreads = [0, 1, 2].map((index) =>
    computeRelativeSpread(linkEntries.map((entry) => entry.principalMomentsKgM2[index]))
  );
  return Math.max(...spreads);
};

const computeMaxPairwiseDistance = (points: readonly [number, number, number][]): number => {
  let maxDistance = 0;
  for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < points.length; rightIndex += 1) {
      const left = points[leftIndex];
      const right = points[rightIndex];
      const distance = Math.sqrt(
        (left[0] - right[0]) ** 2 +
        (left[1] - right[1]) ** 2 +
        (left[2] - right[2]) ** 2
      );
      maxDistance = Math.max(maxDistance, distance);
    }
  }
  return maxDistance;
};

const pushIfMissing = <T,>(values: T[], value: T) => {
  if (!values.includes(value)) {
    values.push(value);
  }
};

const hasUniformConfidence = (
  linkEntries: readonly RepeatedInertiaDiagnosticLinkEntry[],
  confidence: NonNullable<RepeatedInertiaDiagnosticLinkEntry["confidence"]>
): boolean => linkEntries.every((entry) => entry.confidence === confidence);

const formatDistinctValues = (values: readonly string[]): string => values.join(", ");

const formatMillimeters = (meters: number): string => `${(meters * 1000).toFixed(2)} mm`;

export const buildRepeatedInertiaDiagnostics = ({
  linkDataByName,
  reliabilityEntries = [],
}: RepeatedInertiaDiagnosticInput): RepeatedInertiaDiagnosticGroup[] => {
  if (!linkDataByName) {
    return [];
  }

  const reliabilityByLink = new Map(reliabilityEntries.map((entry) => [entry.linkName, entry]));
  const groupCandidates = new Map<string, GroupCandidate>();

  Object.entries(linkDataByName).forEach(([linkName, data]) => {
    if (!data.inertial) {
      return;
    }
    const massKg = Number(data.inertial.mass ?? 0);
    if (!Number.isFinite(massKg) || massKg <= 0) {
      return;
    }
    const meshBacking = resolveRepeatedMeshBacking(data);
    if (!meshBacking) {
      return;
    }
    const principalMomentsKgM2 = computePrincipalMoments(data.inertial.inertia);
    if (!principalMomentsKgM2) {
      return;
    }

    const groupKey = buildRepeatedMeshGroupKey(meshBacking);
    const candidate = groupCandidates.get(groupKey) ?? {
      meshLabel: meshBacking.meshLabel,
      meshReference: meshBacking.meshReference,
      source: meshBacking.source,
      linkEntries: [],
    };
    const reliability = reliabilityByLink.get(linkName) ?? null;
    candidate.linkEntries.push({
      linkName,
      massKg,
      principalMomentsKgM2,
      meshLocalComMeters: computeMeshLocalCom({
        inertialOrigin: data.inertial.origin.xyz,
        geometryOrigin: meshBacking.origin,
      }),
      confidence: reliability?.confidence ?? null,
      strategy: reliability?.strategy ?? null,
      mismatchScore: reliability?.mismatchScore ?? null,
      mismatchBreakdown: reliability?.mismatchBreakdown ?? null,
      centerOfMassOutsideReference: reliability?.centerOfMassOutsideReference ?? false,
    });
    groupCandidates.set(groupKey, candidate);
  });

  return Array.from(groupCandidates.entries())
    .map(([groupKey, candidate]) => {
      if (candidate.linkEntries.length < REPEATED_INERTIA_MIN_INSTANCE_COUNT) {
        return null;
      }

      const sortedLinkEntries = [...candidate.linkEntries].sort((left, right) =>
        left.linkName.localeCompare(right.linkName)
      );
      const massRelativeSpread = computeRelativeSpread(sortedLinkEntries.map((entry) => entry.massKg));
      const principalMomentRelativeSpread = computePrincipalMomentSpread(sortedLinkEntries);
      const meshLocalComMaxSeparationMeters = computeMaxPairwiseDistance(
        sortedLinkEntries.map((entry) => entry.meshLocalComMeters)
      );
      const confidenceValues: Array<NonNullable<RepeatedInertiaDiagnosticLinkEntry["confidence"]>> = [];
      const strategyValues: Array<NonNullable<RepeatedInertiaDiagnosticLinkEntry["strategy"]>> = [];
      sortedLinkEntries.forEach((entry) => {
        if (entry.confidence) {
          pushIfMissing(confidenceValues, entry.confidence);
        }
        if (entry.strategy) {
          pushIfMissing(strategyValues, entry.strategy);
        }
      });
      const uniformConfidence =
        confidenceValues.length === 1 && hasUniformConfidence(sortedLinkEntries, confidenceValues[0])
          ? confidenceValues[0]
          : null;

      const issueKeys: RepeatedInertiaIssueKey[] = [];
      const issueSummary: string[] = [];

      if (massRelativeSpread > REPEATED_INERTIA_MASS_RELATIVE_TOLERANCE) {
        issueKeys.push("mass-mismatch");
        issueSummary.push("Mass differs across repeated copies.");
      }
      if (principalMomentRelativeSpread > REPEATED_INERTIA_PRINCIPAL_MOMENT_RELATIVE_TOLERANCE) {
        issueKeys.push("principal-moment-mismatch");
        issueSummary.push("Principal inertia moments differ after frame normalization.");
      }
      if (meshLocalComMaxSeparationMeters > REPEATED_INERTIA_MESH_LOCAL_COM_TOLERANCE_METERS) {
        issueKeys.push("mesh-local-com-mismatch");
        issueSummary.push(
          `Center of mass shifts by up to ${formatMillimeters(meshLocalComMaxSeparationMeters)} in mesh-local space.`
        );
      }
      if (confidenceValues.length > 1) {
        issueKeys.push("confidence-mismatch");
        issueSummary.push(`Viewer confidence differs: ${formatDistinctValues(confidenceValues)}.`);
      }
      if (strategyValues.length > 1) {
        issueKeys.push("strategy-mismatch");
        issueSummary.push(`Viewer strategy differs: ${formatDistinctValues(strategyValues)}.`);
      }

      if (issueKeys.length === 0) {
        issueKeys.push("group-review");
        issueSummary.push(
          uniformConfidence
            ? `Viewer confidence is ${uniformConfidence} across repeated copies.`
            : "Repeated mesh copies should be reviewed together."
        );
      }

      const physicalMismatch =
        issueKeys.includes("mass-mismatch") ||
        issueKeys.includes("principal-moment-mismatch") ||
        issueKeys.includes("mesh-local-com-mismatch");

      return {
        groupKey,
        meshLabel: candidate.meshLabel,
        meshReference: candidate.meshReference,
        source: candidate.source,
        instanceCount: sortedLinkEntries.length,
        issueKeys,
        issueSummary,
        physicalMismatch,
        massRelativeSpread,
        principalMomentRelativeSpread,
        meshLocalComMaxSeparationMeters,
        confidenceValues,
        strategyValues,
        linkEntries: sortedLinkEntries,
      } satisfies RepeatedInertiaDiagnosticGroup;
    })
    .filter((group): group is RepeatedInertiaDiagnosticGroup => group !== null)
    .sort((left, right) => {
      if (left.physicalMismatch !== right.physicalMismatch) {
        return left.physicalMismatch ? -1 : 1;
      }
      return left.meshLabel.localeCompare(right.meshLabel);
    });
};
