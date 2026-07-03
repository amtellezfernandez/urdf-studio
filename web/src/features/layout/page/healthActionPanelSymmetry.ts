import { AlertTriangle } from "lucide-react";
import { HEALTH_ACTION_PANEL_PARAMS } from "@/features/layout/page/healthActionPanelParams";
import type {
  CompatibilityRobotMirrorSelectionGroup,
  HealthActionPanelProps,
} from "@/features/layout/page/healthActionPanelTypes";
import {
  buildRepeatedInertiaSymmetryChainKey,
  type RepeatedInertiaSymmetryChain,
} from "@/features/layout/page/repeatedInertiaSymmetry";
import {
  REPEATED_INERTIA_SYMMETRY_CENTER_MODE_OPTIONS,
  type RepeatedInertiaSymmetryCenterMode,
} from "@/features/layout/page/repeatedInertiaSymmetryCenterMode";
import {
  REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_ANGLE_ERROR_DEGREES,
  REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_LATERAL_OFFSET_METERS,
  REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_OFFSET_METERS,
} from "@/features/layout/page/repeatedInertiaSymmetryParams";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import type { RobotMirrorLinkResult } from "@/features/layout/page/robotMirrorSymmetryFix";
import { toSortedUniqueRobotMirrorLinkNames } from "@/features/layout/page/robotMirrorLinkNames";
import type { RobotMirrorSelectionLink } from "@/features/layout/page/robotMirrorSymmetrySelection";
import {
  buildRepeatedInertiaSymmetryFamilyOutcomeKey,
  buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey,
  collectRepeatedInertiaSymmetryFamilyLinkNames,
} from "@/features/layout/page/simulationPrepViewerState";

const HEALTH_ACTION_CLASS_NAMES = HEALTH_ACTION_PANEL_PARAMS.classNames;
const RADIANS_TO_DEGREES = HEALTH_ACTION_PANEL_PARAMS.radiansToDegrees;
const MIRROR_SELECTION_STATUS_BADGE_BASE_CLASS =
  HEALTH_ACTION_CLASS_NAMES.mirrorSelectionStatusBadgeBase;

export const MIRROR_SELECTION_RADIAL_BADGE_CLASS =
  HEALTH_ACTION_CLASS_NAMES.mirrorSelectionRadialBadge;

export const formatRepeatedInertiaSymmetryHeadline = (
  chains: readonly RepeatedInertiaSymmetryChain[]
): string => {
  if (chains.length === 1) {
    const branchCount = chains[0]?.branchCount ?? 0;
    return `[1] repeated branch family found (${branchCount} repeated branch${
      branchCount === 1 ? "" : "es"
    }).`;
  }
  return `[${chains.length}] repeated branch famil${chains.length === 1 ? "y" : "ies"} found.`;
};

export const formatRepeatedInertiaSymmetryDistance = (meters: number): string =>
  `${(meters * 1000).toFixed(1)} mm`;

export const formatRobotMirrorPlaneLabel = (
  planeLabel: RobotMirrorSymmetryCheck["planeLabel"]
): string => `${planeLabel.toUpperCase()} plane`;

export const formatMirrorSelectionLinkCount = (linkCount: number): string =>
  `${linkCount} link${linkCount === 1 ? "" : "s"}`;

export const resolveMirrorSelectionStatusBadge = (
  selectionLink: RobotMirrorSelectionLink
):
  | {
      className: string;
      icon: typeof AlertTriangle;
      label: string;
    }
  | null => {
  if (selectionLink.status === "review") {
    return {
      className: `${MIRROR_SELECTION_STATUS_BADGE_BASE_CLASS} border-amber-400/30 bg-amber-500/10 text-amber-100`,
      icon: AlertTriangle,
      label: "attention",
    };
  }
  return null;
};

const formatRobotMirrorAngle = (radians: number): string =>
  `${(radians * RADIANS_TO_DEGREES).toFixed(1)}°`;

export const formatRobotMirrorLinkResultSummary = (
  linkResult: RobotMirrorLinkResult
): string => {
  if (linkResult.repairMode === "ignored") {
    return "no auto target";
  }
  if (linkResult.repairMode === "unchanged") {
    return "already aligned";
  }
  if (linkResult.repairMode === "orientation-only") {
    return "orientation only";
  }
  if (linkResult.repairMode === "inertia-center-only") {
    return "inertia center only";
  }
  if (linkResult.repairMode === "inertia-center-and-orientation") {
    return "inertia center + orientation";
  }
  if (linkResult.repairMode === "position-and-orientation") {
    return "position + orientation";
  }
  if (linkResult.orientationSkipReason === "rotation-too-large") {
    return "position only, kept orientation";
  }
  if (linkResult.orientationSkipReason === "ambiguous-axis") {
    return "position only, kept orientation";
  }
  return "position only";
};

export const formatRobotMirrorLinkResultReason = (
  linkResult: RobotMirrorLinkResult
): string | null => {
  if (linkResult.orientationSkipReason === "rotation-too-large") {
    return "large rotation would be risky";
  }
  if (linkResult.orientationSkipReason === "ambiguous-axis") {
    return "plane-normal axis was ambiguous";
  }
  if (linkResult.orientationSkipReason === "no-automatic-target") {
    return "selected, but no automatic mirror target was available";
  }
  return null;
};

export const formatRobotMirrorLinkResultMetrics = (
  linkResult: RobotMirrorLinkResult
): string => {
  const parts = [`move ${formatRepeatedInertiaSymmetryDistance(linkResult.movedDistanceMeters)}`];
  if (linkResult.finalResidualMeters !== null) {
    parts.push(`res ${formatRepeatedInertiaSymmetryDistance(linkResult.finalResidualMeters)}`);
  }
  if (linkResult.repairMode !== "ignored") {
    parts.push(`rot ${formatRobotMirrorAngle(linkResult.rotationAppliedRadians)}`);
  }
  if (
    linkResult.inertialOriginMovedDistanceMeters !== undefined &&
    linkResult.inertialOriginMovedDistanceMeters > 0
  ) {
    parts.push(
      `com ${formatRepeatedInertiaSymmetryDistance(
        linkResult.inertialOriginMovedDistanceMeters
      )}`
    );
  }
  if (linkResult.planeNormalResidualRadians !== null) {
    parts.push(`axis ${formatRobotMirrorAngle(linkResult.planeNormalResidualRadians)}`);
  }
  return parts.join(" • ");
};

export const shouldIgnoreVisualizationCardClick = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  Boolean(target.closest("button, input, label, a, textarea, select, [role='checkbox']"));

export const buildCompatibilityRobotMirrorSelectionState = ({
  robotMirrorSelectionGroups,
  selectedRobotMirrorGroupKeys,
}: {
  robotMirrorSelectionGroups: readonly CompatibilityRobotMirrorSelectionGroup[];
  selectedRobotMirrorGroupKeys: readonly string[];
}): {
  selectedLinkNames: string[];
  selectionLinks: RobotMirrorSelectionLink[];
} => {
  const selectedGroupKeySet = new Set(selectedRobotMirrorGroupKeys);
  const selectedLinkNameSet = new Set<string>();
  const selectionLinks = robotMirrorSelectionGroups.flatMap((group) => {
    const groupLinkNames = toSortedUniqueRobotMirrorLinkNames(group.linkNames ?? []);
    const meshLabel = group.meshLabel?.trim() || group.groupKey;
    const isSelected = selectedGroupKeySet.has(group.groupKey);
    if (isSelected) {
      groupLinkNames.forEach((linkName) => selectedLinkNameSet.add(linkName));
    }
    return groupLinkNames.map((linkName) => ({
      counterpartLinkName: null,
      defaultExclusionReason: null,
      groupKey: group.groupKey,
      groupLinkCount: groupLinkNames.length,
      linkName,
      meshLabel,
      preselected: isSelected,
      status: "available" as const,
    } satisfies RobotMirrorSelectionLink));
  });

  return {
    selectedLinkNames: Array.from(selectedLinkNameSet).sort((left, right) =>
      left.localeCompare(right)
    ),
    selectionLinks,
  };
};

export type RobotMirrorSelectionStats = {
  selectedLinkCount: number;
  selectedMeshCount: number;
};

export const buildRobotMirrorSelectionStats = ({
  selectedLinkNames,
  selectionLinks,
}: {
  selectedLinkNames: readonly string[];
  selectionLinks: readonly RobotMirrorSelectionLink[];
}): RobotMirrorSelectionStats => {
  const selectedLinkNameSet = new Set(selectedLinkNames);
  const selectedLinks = selectionLinks.filter((selectionLink) =>
    selectedLinkNameSet.has(selectionLink.linkName)
  );
  return {
    selectedLinkCount: selectedLinks.length,
    selectedMeshCount: new Set(selectedLinks.map((selectionLink) => selectionLink.meshLabel)).size,
  };
};

export type RobotMirrorSelectionMeshGroup = {
  meshLabel: string;
  radialExcludedCount: number;
  selectionLinks: RobotMirrorSelectionLink[];
};

export const groupRobotMirrorSelectionLinksByMeshLabel = (
  selectionLinks: readonly RobotMirrorSelectionLink[]
): RobotMirrorSelectionMeshGroup[] =>
  Array.from(
    selectionLinks.reduce(
      (groups, selectionLink) => {
        const currentLinks = groups.get(selectionLink.meshLabel) ?? [];
        currentLinks.push(selectionLink);
        groups.set(selectionLink.meshLabel, currentLinks);
        return groups;
      },
      new Map<string, RobotMirrorSelectionLink[]>()
    )
  )
    .map(([meshLabel, groupedSelectionLinks]) => ({
      meshLabel,
      radialExcludedCount: groupedSelectionLinks.filter(
        (selectionLink) => selectionLink.defaultExclusionReason === "radial-symmetry"
      ).length,
      selectionLinks: [...groupedSelectionLinks].sort((left, right) =>
        left.linkName.localeCompare(right.linkName)
      ),
    }))
    .sort((left, right) => left.meshLabel.localeCompare(right.meshLabel));

export const formatRepeatedInertiaSymmetryType = (
  chain: Pick<
    RepeatedInertiaSymmetryChain,
    "branchCount" | "expectedAngleDegrees" | "symmetryType"
  >
): string => {
  if (chain.symmetryType === "radial" && chain.expectedAngleDegrees !== null) {
    return `${chain.branchCount} repeated branches on ${chain.branchCount} branch planes (${chain.expectedAngleDegrees.toFixed(1)}° spacing)`;
  }
  if (chain.symmetryType === "mirror" && chain.expectedAngleDegrees !== null) {
    return `mirror symmetry (${chain.expectedAngleDegrees.toFixed(1)}° separation)`;
  }
  if (chain.symmetryType === "linear") {
    return `${chain.branchCount}-branch linear symmetry`;
  }
  return `${chain.branchCount}-branch symmetry`;
};

export const formatRepeatedInertiaSymmetryCenterMode = (
  centerMode: RepeatedInertiaSymmetryCenterMode
): string =>
  REPEATED_INERTIA_SYMMETRY_CENTER_MODE_OPTIONS.find((option) => option.value === centerMode)
    ?.label ?? centerMode;

export const formatRepeatedInertiaSymmetryAngle = (degrees: number): string =>
  `${degrees.toFixed(1)}°`;

export const formatRepeatedInertiaSymmetryRadiusComparison = (
  row: RepeatedInertiaSymmetryChain["branchRows"][number]
): string => {
  const actualDistance = formatRepeatedInertiaSymmetryDistance(row.radialDistanceMeters);
  if (row.idealRadialDistanceMeters === null) {
    return actualDistance;
  }
  return `${actualDistance} → ${formatRepeatedInertiaSymmetryDistance(row.idealRadialDistanceMeters)}`;
};

export const formatRepeatedInertiaSymmetryAngleComparison = (
  row: RepeatedInertiaSymmetryChain["branchRows"][number]
): string => {
  const actualAngle = formatRepeatedInertiaSymmetryAngle(row.angleDegrees);
  if (row.idealAngleDegrees === null) {
    return actualAngle;
  }
  return `${actualAngle} → ${formatRepeatedInertiaSymmetryAngle(row.idealAngleDegrees)}`;
};

export const formatRepeatedInertiaSymmetrySignedDistance = (
  meters: number | null
): string => {
  if (meters === null) {
    return "n/a";
  }
  const signedPrefix = meters > 0 ? "+" : meters < 0 ? "-" : "";
  return `${signedPrefix}${formatRepeatedInertiaSymmetryDistance(Math.abs(meters))}`;
};

export const formatRepeatedInertiaSymmetryLinkOffsets = (
  row: RepeatedInertiaSymmetryChain["branchRows"][number]
): string => {
  const linkRows = Array.isArray(row.linkRows) ? row.linkRows : [];
  if (linkRows.length === 0) {
    return "No tracked link offsets.";
  }
  return linkRows
    .map(
      (linkRow) =>
        `${linkRow.linkName} ${formatRepeatedInertiaSymmetryDistance(linkRow.offsetDistanceMeters ?? 0)}${
          linkRow.radialOffsetMeters !== null || linkRow.lateralOffsetMeters !== null
            ? ` (rad ${formatRepeatedInertiaSymmetrySignedDistance(linkRow.radialOffsetMeters)} • lat ${formatRepeatedInertiaSymmetryDistance(linkRow.lateralOffsetMeters ?? 0)})`
            : ""
        }`
    )
    .join(" • ");
};

export const formatRepeatedInertiaSymmetryOffsetSummary = (
  row: RepeatedInertiaSymmetryChain["branchRows"][number]
): string => {
  const total = formatRepeatedInertiaSymmetryDistance(row.offsetDistanceMeters ?? 0);
  if (row.radialOffsetMeters === null || row.lateralOffsetMeters === null) {
    return total;
  }
  return `${total} (rad ${formatRepeatedInertiaSymmetrySignedDistance(
    row.radialOffsetMeters
  )} • lat ${formatRepeatedInertiaSymmetryDistance(row.lateralOffsetMeters)})`;
};

export const hasMeaningfulRepeatedInertiaSymmetryAlignmentError = (
  row: RepeatedInertiaSymmetryChain["branchRows"][number]
): boolean =>
  (row.angularErrorDegrees ?? 0) > REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_ANGLE_ERROR_DEGREES ||
  row.offsetDistanceMeters > REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_OFFSET_METERS ||
  (row.lateralOffsetMeters ?? 0) > REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_LATERAL_OFFSET_METERS;

export const resolveRepeatedInertiaSymmetryStatusTone = (
  row: RepeatedInertiaSymmetryChain["branchRows"][number]
): "aligned" | "warning" | "danger" => {
  if (row.status === "outlier") {
    return "danger";
  }
  if (hasMeaningfulRepeatedInertiaSymmetryAlignmentError(row)) {
    return "warning";
  }
  return "aligned";
};

export const resolveRepeatedInertiaSymmetryDominantIssue = (
  row: RepeatedInertiaSymmetryChain["branchRows"][number]
): "aligned" | "angle" | "offset" | "outlier" => {
  if (row.status === "outlier") {
    return "outlier";
  }
  if (!hasMeaningfulRepeatedInertiaSymmetryAlignmentError(row)) {
    return "aligned";
  }
  const angularRatio =
    (row.angularErrorDegrees ?? 0) / REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_ANGLE_ERROR_DEGREES;
  const totalOffsetRatio =
    row.offsetDistanceMeters / REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_OFFSET_METERS;
  const lateralOffsetRatio =
    (row.lateralOffsetMeters ?? 0) /
    REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_LATERAL_OFFSET_METERS;
  return angularRatio >= Math.max(totalOffsetRatio, lateralOffsetRatio) ? "angle" : "offset";
};

export const formatRepeatedInertiaSymmetryStatus = (
  row: RepeatedInertiaSymmetryChain["branchRows"][number]
): string => {
  switch (resolveRepeatedInertiaSymmetryDominantIssue(row)) {
    case "aligned":
      return "Aligned";
    case "angle":
      return "Angle";
    case "offset":
      return "Offset";
    case "outlier":
      return "Outlier";
    default:
      return "Aligned";
  }
};

export const resolveRepeatedInertiaSymmetryStatusBadgeClass = (
  row: RepeatedInertiaSymmetryChain["branchRows"][number]
): string => {
  switch (resolveRepeatedInertiaSymmetryStatusTone(row)) {
    case "aligned":
      return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
    case "warning":
      return "border-rose-400/30 bg-rose-500/10 text-rose-100";
    case "danger":
      return "border-amber-400/30 bg-amber-500/10 text-amber-100";
    default:
      return "border-border/30 bg-background/30 text-muted-foreground";
  }
};

export const resolveRepeatedInertiaSymmetryRowToneClass = (
  row: RepeatedInertiaSymmetryChain["branchRows"][number]
): string => {
  switch (resolveRepeatedInertiaSymmetryStatusTone(row)) {
    case "danger":
      return "bg-amber-500/10 text-amber-100";
    case "warning":
      return "bg-rose-500/10 text-rose-100";
    case "aligned":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
};

export const formatRepeatedInertiaSymmetryBranchLinks = (
  branchLinkGroup: RepeatedInertiaSymmetryChain["branchLinkGroups"][number]
): string => branchLinkGroup.linkNames.join(", ");

export const formatRepeatedInertiaSymmetryBranchSummary = (
  branchLinkGroup: RepeatedInertiaSymmetryChain["branchLinkGroups"][number]
): string => {
  if (branchLinkGroup.linkNames.length === 0) {
    return branchLinkGroup.branchRootLinkName;
  }
  if (branchLinkGroup.linkNames.length === 1) {
    return branchLinkGroup.linkNames[0];
  }
  return `${branchLinkGroup.linkNames[0]} -> ${branchLinkGroup.linkNames[branchLinkGroup.linkNames.length - 1]}`;
};

export const formatRepeatedInertiaSymmetryRepairMode = (
  repairPlan: RepeatedInertiaSymmetryChain["recommendedRepair"]
): string => {
  if (!repairPlan) {
    return "Manual alignment";
  }
  return repairPlan.stepCount === 1 ? "1 joint move" : `${repairPlan.stepCount} joint moves`;
};

export type RepeatedInertiaSymmetryBranchRowViewState = {
  angleText: string;
  branchSummary: string;
  branchTitle: string;
  key: string;
  offsetText: string;
  offsetsText: string;
  radiusText: string;
  representativeLinkName: string;
  row: RepeatedInertiaSymmetryChain["branchRows"][number];
  rowToneClass: string;
  showTopologyBadge: boolean;
  statusBadgeClass: string;
  statusText: string;
};

export const buildRepeatedInertiaSymmetryBranchRowViewState = ({
  chain,
  row,
}: {
  chain: Pick<
    RepeatedInertiaSymmetryChain,
    "branchLinkGroups" | "symmetryRootLinkName"
  >;
  row: RepeatedInertiaSymmetryChain["branchRows"][number];
}): RepeatedInertiaSymmetryBranchRowViewState => {
  const branchLinkGroup = chain.branchLinkGroups.find(
    (candidate) => candidate.branchRootLinkName === row.branchRootLinkName
  );
  const angleComparison = formatRepeatedInertiaSymmetryAngleComparison(row);
  return {
    angleText:
      row.angularErrorDegrees !== null
        ? `${angleComparison} (${formatRepeatedInertiaSymmetryAngle(row.angularErrorDegrees)} err)`
        : angleComparison,
    branchSummary: branchLinkGroup
      ? formatRepeatedInertiaSymmetryBranchSummary(branchLinkGroup)
      : row.representativeLinkName,
    branchTitle: branchLinkGroup
      ? formatRepeatedInertiaSymmetryBranchLinks(branchLinkGroup)
      : row.representativeLinkName,
    key: `${chain.symmetryRootLinkName}:${row.branchRootLinkName}`,
    offsetText: formatRepeatedInertiaSymmetryOffsetSummary(row),
    offsetsText: formatRepeatedInertiaSymmetryLinkOffsets(row),
    radiusText: formatRepeatedInertiaSymmetryRadiusComparison(row),
    representativeLinkName: row.representativeLinkName,
    row,
    rowToneClass: resolveRepeatedInertiaSymmetryRowToneClass(row),
    showTopologyBadge: !row.topologyMatchesFamily,
    statusBadgeClass: resolveRepeatedInertiaSymmetryStatusBadgeClass(row),
    statusText: formatRepeatedInertiaSymmetryStatus(row),
  };
};

export type RepeatedInertiaSymmetryRepairText = {
  detail: string;
  summary: string;
};

export const buildRepeatedInertiaSymmetryRepairText = (
  repairPlan: RepeatedInertiaSymmetryChain["recommendedRepair"]
): RepeatedInertiaSymmetryRepairText => {
  if (!repairPlan) {
    return {
      detail:
        "This branch is already aligned closely enough that no automatic radial step remains.",
      summary: "No auto-align steps remain for this branch.",
    };
  }

  const jointLabel = repairPlan.stepCount === 1 ? "joint" : "joints";
  if (repairPlan.blockedTargetLinkNames.length > 0) {
    if (repairPlan.stepCount > 0) {
      const connectedTargetLabel =
        repairPlan.blockedTargetLinkNames.length === 1 ? "target" : "targets";
      return {
        detail: `Auto-fix can edit up to ${repairPlan.stepCount} ${jointLabel} in order; ${repairPlan.blockedTargetLinkNames.length} connected ${connectedTargetLabel} move with those rigid edits.`,
        summary: repairPlan.summary,
      };
    }

    const trackedTargetLabel = repairPlan.targetLinkNames.length === 1 ? "target" : "targets";
    return {
      detail: `All ${repairPlan.targetLinkNames.length} tracked ${trackedTargetLabel} sit past ${repairPlan.articulatedBoundaryJointName ?? "the articulated boundary"}; auto-fix will not rewrite that articulation.`,
      summary: repairPlan.summary,
    };
  }

  return {
    detail: `Auto-fix checks up to ${repairPlan.stepCount} ${jointLabel} in order.`,
    summary: repairPlan.summary,
  };
};

export const formatRepeatedInertiaSymmetryAutoAlignButtonLabel = ({
  completedProgress,
  isActing,
  progress,
}: {
  completedProgress?:
    | {
        appliedStepCount: number;
        totalStepCount: number;
      }
    | null
    | undefined;
  isActing: boolean;
  progress:
    | {
        appliedStepCount: number;
        totalStepCount: number;
      }
    | null
    | undefined;
}): string => {
  const effectiveProgress = isActing ? progress : completedProgress;
  if (!isActing && !effectiveProgress) {
    return "Auto Align";
  }
  if (effectiveProgress && effectiveProgress.totalStepCount > 0) {
    const appliedStepCount = Math.min(
      effectiveProgress.totalStepCount,
      Math.max(0, effectiveProgress.appliedStepCount)
    );
    const jointMoveLabel =
      effectiveProgress.totalStepCount === 1 ? "joint move" : "joint moves";
    return `Auto Align ${appliedStepCount}/${effectiveProgress.totalStepCount} ${jointMoveLabel}`;
  }
  return "Auto Align";
};

export const resolveRepeatedInertiaSymmetryOutcome = ({
  chain,
  outcomeByKey,
}: {
  chain: RepeatedInertiaSymmetryChain;
  outcomeByKey: NonNullable<HealthActionPanelProps["repeatedInertiaSymmetryOutcomeByChainKey"]>;
}) =>
  outcomeByKey[
    buildRepeatedInertiaSymmetryChainKey({
      symmetryRootLinkName: chain.symmetryRootLinkName,
      outlierBranchRootLinkName: chain.outlierBranchRootLinkName,
    })
  ] ?? outcomeByKey[buildRepeatedInertiaSymmetryFamilyOutcomeKey(chain)] ?? null;

export type RepeatedInertiaSymmetryChainViewState = {
  branchRows: RepeatedInertiaSymmetryBranchRowViewState[];
  chain: RepeatedInertiaSymmetryChain;
  chainKey: string;
  completedProgress: {
    appliedStepCount: number;
    totalStepCount: number;
  } | null;
  isActing: boolean;
  isAutoAlignAvailable: boolean;
  isVisualizationActive: boolean;
  outcome: NonNullable<
    HealthActionPanelProps["repeatedInertiaSymmetryOutcomeByChainKey"]
  >[string] | null;
  progress: {
    appliedStepCount: number;
    totalStepCount: number;
  } | null;
  repairText: RepeatedInertiaSymmetryRepairText;
  scopeKey: string;
  visualizationLinkNames: string[];
};

export const buildRepeatedInertiaSymmetryChainViewState = ({
  activeInertiaVisualizationScopeKey,
  chain,
  outcomeByKey,
  repeatedInertiaSymmetryActingChainKey,
  repeatedInertiaSymmetryActingProgress,
}: {
  activeInertiaVisualizationScopeKey: string | null;
  chain: RepeatedInertiaSymmetryChain;
  outcomeByKey: NonNullable<HealthActionPanelProps["repeatedInertiaSymmetryOutcomeByChainKey"]>;
  repeatedInertiaSymmetryActingChainKey: string | null;
  repeatedInertiaSymmetryActingProgress: HealthActionPanelProps["repeatedInertiaSymmetryActingProgress"];
}): RepeatedInertiaSymmetryChainViewState => {
  const chainKey = buildRepeatedInertiaSymmetryChainKey({
    symmetryRootLinkName: chain.symmetryRootLinkName,
    outlierBranchRootLinkName: chain.outlierBranchRootLinkName,
  });
  const scopeKey = buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey(chain);
  const outcome = resolveRepeatedInertiaSymmetryOutcome({ chain, outcomeByKey });
  return {
    branchRows: chain.branchRows.map((row) =>
      buildRepeatedInertiaSymmetryBranchRowViewState({ chain, row })
    ),
    chain,
    chainKey,
    completedProgress: outcome?.completedProgress ?? null,
    isActing: repeatedInertiaSymmetryActingChainKey === chainKey,
    isAutoAlignAvailable: Boolean(chain.recommendedRepair) && chain.recommendedRepair.stepCount > 0,
    isVisualizationActive: activeInertiaVisualizationScopeKey === scopeKey,
    outcome,
    progress:
      repeatedInertiaSymmetryActingProgress?.chainKey === chainKey
        ? repeatedInertiaSymmetryActingProgress
        : null,
    repairText: buildRepeatedInertiaSymmetryRepairText(chain.recommendedRepair),
    scopeKey,
    visualizationLinkNames: collectRepeatedInertiaSymmetryFamilyLinkNames(chain),
  };
};
