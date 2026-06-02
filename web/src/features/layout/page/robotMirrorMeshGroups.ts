import type { LinkData } from "@/shared/lib/urdfCore";
import type {
  RepeatedInertiaDiagnosticGroup,
  RepeatedInertiaIssueKey,
} from "@/features/layout/page/repeatedInertiaDiagnostics";
import {
  resolveRepeatedMeshBacking,
  type MeshSource,
  type RepeatedMeshBacking,
} from "@/features/urdf/inertia/repeatedMeshBacking";
import {
  ROBOT_MIRROR_MESH_SCALE_COMPONENT_COUNT,
  ROBOT_MIRROR_MESH_SCALE_DEFAULT_COMPONENT,
} from "@/features/layout/page/robotMirrorSymmetryParams";

export type RobotMirrorMeshBacking = RepeatedMeshBacking & {
  groupKey: string;
};

export type RobotMirrorMeshLinkGroup = {
  groupKey: string;
  linkNames: string[];
  meshLabel: string;
};

const pushUnique = <T,>(values: T[], value: T) => {
  if (!values.includes(value)) {
    values.push(value);
  }
};

const normalizeScaleKeyForRobotMirror = (rawScale: string | undefined): string => {
  const parts = (rawScale ?? "").split(/\s+/).filter(Boolean);
  return Array.from({ length: ROBOT_MIRROR_MESH_SCALE_COMPONENT_COUNT }, (_, index) => {
    const value = Number(parts[index] ?? ROBOT_MIRROR_MESH_SCALE_DEFAULT_COMPONENT);
    return Number.isFinite(value)
      ? Math.abs(value)
      : ROBOT_MIRROR_MESH_SCALE_DEFAULT_COMPONENT;
  }).join(" ");
};

const buildRobotMirrorMeshGroupKey = ({
  meshReference,
  scaleKey,
  source,
}: {
  meshReference: string;
  scaleKey: string | undefined;
  source: MeshSource;
}): string => `${source}:${meshReference}:${normalizeScaleKeyForRobotMirror(scaleKey)}`;

const resolveDiagnosticScaleKey = (
  group: RepeatedInertiaDiagnosticGroup
): string | undefined => {
  const exactPrefix = `${group.source}:${group.meshReference}:`;
  if (group.groupKey.startsWith(exactPrefix)) {
    return group.groupKey.slice(exactPrefix.length);
  }
  return undefined;
};

const buildRobotMirrorMeshGroupKeyFromDiagnostic = (
  group: RepeatedInertiaDiagnosticGroup
): string =>
  buildRobotMirrorMeshGroupKey({
    meshReference: group.meshReference,
    scaleKey: resolveDiagnosticScaleKey(group),
    source: group.source,
  });

const resolveRobotMirrorMeshBacking = (data: LinkData): RobotMirrorMeshBacking | null => {
  const backing = resolveRepeatedMeshBacking(data);
  if (!backing) {
    return null;
  }
  return {
    ...backing,
    groupKey: buildRobotMirrorMeshGroupKey({
      meshReference: backing.meshReference,
      scaleKey: backing.scaleKey,
      source: backing.source,
    }),
  };
};

const sortRobotMirrorMeshLinkGroups = (
  groups: Iterable<RobotMirrorMeshLinkGroup>
): RobotMirrorMeshLinkGroup[] =>
  Array.from(groups)
    .map((group) => ({
      ...group,
      linkNames: Array.from(new Set(group.linkNames)).sort((left, right) =>
        left.localeCompare(right)
      ),
    }))
    .sort(
      (left, right) =>
        left.meshLabel.localeCompare(right.meshLabel) ||
        left.groupKey.localeCompare(right.groupKey)
    );

export const buildRobotMirrorMeshLinkGroupsFromLinkData = (
  linkDataByName: Record<string, LinkData> | null | undefined
): RobotMirrorMeshLinkGroup[] => {
  if (!linkDataByName) {
    return [];
  }

  const groups = new Map<string, RobotMirrorMeshLinkGroup>();
  Object.entries(linkDataByName).forEach(([linkName, linkData]) => {
    const backing = resolveRobotMirrorMeshBacking(linkData);
    if (!backing) {
      return;
    }
    const currentGroup = groups.get(backing.groupKey) ?? {
      groupKey: backing.groupKey,
      linkNames: [],
      meshLabel: backing.meshLabel,
    };
    currentGroup.linkNames.push(linkName);
    groups.set(backing.groupKey, currentGroup);
  });

  return sortRobotMirrorMeshLinkGroups(groups.values());
};

const mergeRepeatedInertiaDiagnosticsForRobotMirror = (
  groups: readonly RepeatedInertiaDiagnosticGroup[]
): RepeatedInertiaDiagnosticGroup[] => {
  const mergedGroups = new Map<string, RepeatedInertiaDiagnosticGroup>();

  groups.forEach((group) => {
    const groupKey = buildRobotMirrorMeshGroupKeyFromDiagnostic(group);
    const currentGroup =
      mergedGroups.get(groupKey) ??
      ({
        ...group,
        confidenceValues: [],
        groupKey,
        instanceCount: 0,
        issueKeys: [],
        issueSummary: [],
        linkEntries: [],
        massRelativeSpread: 0,
        meshLocalComMaxSeparationMeters: 0,
        physicalMismatch: false,
        principalMomentRelativeSpread: 0,
        strategyValues: [],
      } satisfies RepeatedInertiaDiagnosticGroup);

    group.confidenceValues.forEach((confidence) => {
      pushUnique(currentGroup.confidenceValues, confidence);
    });
    group.issueKeys.forEach((issueKey: RepeatedInertiaIssueKey) => {
      pushUnique(currentGroup.issueKeys, issueKey);
    });
    group.issueSummary.forEach((summary) => {
      pushUnique(currentGroup.issueSummary, summary);
    });
    group.strategyValues.forEach((strategy) => {
      pushUnique(currentGroup.strategyValues, strategy);
    });
    currentGroup.linkEntries.push(...group.linkEntries);
    currentGroup.instanceCount = currentGroup.linkEntries.length;
    currentGroup.massRelativeSpread = Math.max(
      currentGroup.massRelativeSpread,
      group.massRelativeSpread
    );
    currentGroup.meshLocalComMaxSeparationMeters = Math.max(
      currentGroup.meshLocalComMaxSeparationMeters,
      group.meshLocalComMaxSeparationMeters
    );
    currentGroup.physicalMismatch = currentGroup.physicalMismatch || group.physicalMismatch;
    currentGroup.principalMomentRelativeSpread = Math.max(
      currentGroup.principalMomentRelativeSpread,
      group.principalMomentRelativeSpread
    );
    currentGroup.linkEntries.sort((left, right) => left.linkName.localeCompare(right.linkName));
    mergedGroups.set(groupKey, currentGroup);
  });

  return Array.from(mergedGroups.values()).sort((left, right) =>
    left.meshLabel.localeCompare(right.meshLabel)
  );
};

export const buildRobotMirrorMeshLinkGroupsFromDiagnostics = (
  repeatedInertiaDiagnostics: readonly RepeatedInertiaDiagnosticGroup[]
): RobotMirrorMeshLinkGroup[] =>
  sortRobotMirrorMeshLinkGroups(
    mergeRepeatedInertiaDiagnosticsForRobotMirror(repeatedInertiaDiagnostics).map((group) => ({
      groupKey: group.groupKey,
      linkNames: group.linkEntries.map((entry) => entry.linkName),
      meshLabel: group.meshLabel,
    }))
  );
