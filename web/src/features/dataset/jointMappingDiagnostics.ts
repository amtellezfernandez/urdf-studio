import type { JointMapping } from "@/shared/types/feature";
import { JOINT_MAPPING_DIAGNOSTICS_PARAMS } from "@/features/dataset/jointMappingDiagnosticsParams";

export type MappingDiagnosticExcludedChannel = {
  name: string;
  semantic: string;
};

export type JointMappingDuplicateUrdfTarget = {
  urdfJoint: string;
  datasetJoints: string[];
};

export type JointMappingDiagnostics = {
  mappedDatasetJoints: string[];
  skippedDatasetJoints: string[];
  invalidMappedDatasetJoints: string[];
  usedUrdfJoints: string[];
  unusedUrdfJoints: string[];
  duplicateUrdfTargets: JointMappingDuplicateUrdfTarget[];
  excludedChannels: MappingDiagnosticExcludedChannel[];
  excludedBaseChannels: MappingDiagnosticExcludedChannel[];
  excludedOtherChannels: MappingDiagnosticExcludedChannel[];
  wheelLikeDatasetJoints: string[];
  mappedWheelLikeDatasetJoints: string[];
  skippedWheelLikeDatasetJoints: string[];
};

const normalizeToken = (value: string) => value.trim().toLowerCase();

const isSkippedUrdfJointMapping = (urdfJoint: string | null | undefined) => {
  const normalized = normalizeToken(urdfJoint ?? "");
  if (!normalized) {
    return true;
  }
  return JOINT_MAPPING_DIAGNOSTICS_PARAMS.skippedMappingValues.some(
    (candidate) => normalizeToken(candidate) === normalized
  );
};

const isWheelLikeDatasetJoint = (datasetJoint: string) => {
  const normalized = normalizeToken(datasetJoint);
  return JOINT_MAPPING_DIAGNOSTICS_PARAMS.wheelLikeDatasetJointTokens.some(
    (token) => normalized.includes(token)
  );
};

const isBaseSemantic = (semantic: string) => semantic.startsWith("base_");

export const computeJointMappingDiagnostics = ({
  datasetJoints,
  urdfJoints,
  mappings,
  excludedChannels = [],
}: {
  datasetJoints: string[];
  urdfJoints: string[];
  mappings: JointMapping[];
  excludedChannels?: MappingDiagnosticExcludedChannel[];
}): JointMappingDiagnostics => {
  const urdfJointSet = new Set(urdfJoints);
  const mappingByDatasetJoint = new Map<string, JointMapping>();
  mappings.forEach((mapping) => {
    mappingByDatasetJoint.set(mapping.datasetJoint, mapping);
  });

  const mappedDatasetJoints: string[] = [];
  const skippedDatasetJoints: string[] = [];
  const invalidMappedDatasetJoints: string[] = [];
  const usedUrdfJoints: string[] = [];
  const usedUrdfJointSet = new Set<string>();
  const datasetJointsByUrdfJoint = new Map<string, string[]>();

  datasetJoints.forEach((datasetJoint) => {
    const urdfJoint = mappingByDatasetJoint.get(datasetJoint)?.urdfJoint;
    if (isSkippedUrdfJointMapping(urdfJoint)) {
      skippedDatasetJoints.push(datasetJoint);
      return;
    }
    const normalizedUrdfJoint = String(urdfJoint).trim();
    if (!urdfJointSet.has(normalizedUrdfJoint)) {
      invalidMappedDatasetJoints.push(datasetJoint);
      return;
    }
    mappedDatasetJoints.push(datasetJoint);
    if (!usedUrdfJointSet.has(normalizedUrdfJoint)) {
      usedUrdfJointSet.add(normalizedUrdfJoint);
      usedUrdfJoints.push(normalizedUrdfJoint);
    }
    const current = datasetJointsByUrdfJoint.get(normalizedUrdfJoint) ?? [];
    datasetJointsByUrdfJoint.set(normalizedUrdfJoint, [...current, datasetJoint]);
  });

  const duplicateUrdfTargets = Array.from(datasetJointsByUrdfJoint.entries())
    .filter(([, datasetJointNames]) => datasetJointNames.length > 1)
    .map(([urdfJoint, datasetJointNames]) => ({
      urdfJoint,
      datasetJoints: datasetJointNames,
    }));

  const unusedUrdfJoints = urdfJoints.filter((jointName) => !usedUrdfJointSet.has(jointName));

  const wheelLikeDatasetJoints = datasetJoints.filter(isWheelLikeDatasetJoint);
  const mappedDatasetJointSet = new Set(mappedDatasetJoints);
  const mappedWheelLikeDatasetJoints = wheelLikeDatasetJoints.filter((datasetJoint) =>
    mappedDatasetJointSet.has(datasetJoint)
  );
  const skippedWheelLikeDatasetJoints = wheelLikeDatasetJoints.filter(
    (datasetJoint) => !mappedDatasetJointSet.has(datasetJoint)
  );

  const excludedBaseChannels = excludedChannels.filter((channel) =>
    isBaseSemantic(channel.semantic)
  );
  const excludedOtherChannels = excludedChannels.filter(
    (channel) => !isBaseSemantic(channel.semantic)
  );

  return {
    mappedDatasetJoints,
    skippedDatasetJoints,
    invalidMappedDatasetJoints,
    usedUrdfJoints,
    unusedUrdfJoints,
    duplicateUrdfTargets,
    excludedChannels,
    excludedBaseChannels,
    excludedOtherChannels,
    wheelLikeDatasetJoints,
    mappedWheelLikeDatasetJoints,
    skippedWheelLikeDatasetJoints,
  };
};

