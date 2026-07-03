import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Eye,
  EyeOff,
  List,
  LoaderCircle,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  SIMULATION_PREP_PANEL_DEFAULT_TOP_PX,
  SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX,
  SIMULATION_PREP_PANEL_WIDTH_PX,
  clampSimulationPrepPanelPosition,
  getSimulationPrepPanelInitialPosition,
  getSimulationPrepPanelWidthPx,
  type SimulationPrepPanelPosition,
} from "@/features/layout/page/simulationPrepPanelParams";
import {
  buildRobotMirrorSymmetryVisualizationScopeKey,
  buildRepeatedInertiaVisualizationScopeKey,
  buildRepeatedInertiaSymmetryFamilyOutcomeKey,
  buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey,
  collectRepeatedInertiaSymmetryFamilyLinkNames,
} from "@/features/layout/page/simulationPrepViewerState";
import { hasSimulationPrepPhysicsActionPending } from "@/features/layout/page/simulationPrepState";
import type { InertialDensityPresetId } from "@/features/urdf/inertia/inertialSynthesisParams";
import {
  buildRepeatedInertiaSymmetryChainKey,
  type RepeatedInertiaSymmetryChain,
} from "@/features/layout/page/repeatedInertiaSymmetry";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import type { RobotMirrorLinkResult } from "@/features/layout/page/robotMirrorSymmetryFix";
import type { RobotMirrorSelectionLink } from "@/features/layout/page/robotMirrorSymmetrySelection";
import { toSortedUniqueRobotMirrorLinkNames } from "@/features/layout/page/robotMirrorLinkNames";
import { resolveRobotMirrorSimulationPrepViewState } from "@/features/layout/page/robotMirrorSimulationPrepViewState";
import {
  REPEATED_INERTIA_SYMMETRY_CENTER_MODE_OPTIONS,
  type RepeatedInertiaSymmetryCenterMode,
} from "@/features/layout/page/repeatedInertiaSymmetryCenterMode";
import {
  REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_ANGLE_ERROR_DEGREES,
  REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_LATERAL_OFFSET_METERS,
  REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_OFFSET_METERS,
} from "@/features/layout/page/repeatedInertiaSymmetryParams";
import { cn } from "@/shared/lib/utils";
import {
  INERTIA_METRIC_PROBLEMATIC_THRESHOLD,
  INERTIA_METRIC_WARNING_THRESHOLD,
} from "@/features/viewer/inertialVisualizationParams";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { HEALTH_ACTION_PANEL_PARAMS } from "@/features/layout/page/healthActionPanelParams";
import { HealthActionPanelHeader } from "@/features/layout/page/HealthActionPanelHeader";
import type {
  CompatibilityRobotMirrorSelectionGroup,
  HealthActionPanelProps,
  SimStatusTone,
} from "@/features/layout/page/healthActionPanelTypes";
import {
  buildGeneratePhysicsDialogDescription,
  buildOverviewExtraNotes,
  buildOverviewLabelValueRows,
  buildPanelSubtitle,
} from "@/features/layout/page/healthActionPanelOverview";
import {
  buildExcludedLinkGroups,
  buildExclusionReasonSummary,
  buildGeometryDiagnosisHeadline,
  buildGeometryDiagnosisNote,
  buildSanitizationSummary,
  countGeometryDiagnosisAttentionLinks,
  formatDiagnosticNumber,
  getPreparationVisualizationScope,
} from "@/features/layout/page/healthActionPanelDiagnostics";
import {
  PhysicsMaterialPicker,
  PhysicsQuickActionCard,
} from "@/features/layout/page/HealthActionPanelPhysicsActions";
import {
  buildPhysicsPanelActions,
  getPhysicsActionButtonLabel,
  getPhysicsActionStatus,
  PHYSICS_ACTION_STATUS_LABELS,
  type PhysicsActionMaterialSelection,
  type PhysicsPanelAction,
  type PhysicsPanelActionKey,
} from "@/features/layout/page/healthActionPanelPhysicsActions";

type RecommendedAction = {
  kind: "frame";
  label: string;
  summary: string;
  onClick: () => void;
  variant?: "default" | "outline";
  icon: typeof Sparkles;
  disabled?: boolean;
};

const HEALTH_ACTION_CLASS_NAMES = HEALTH_ACTION_PANEL_PARAMS.classNames;
const ADVANCED_EXPORT_SECTION_LABEL = HEALTH_ACTION_PANEL_PARAMS.labels.advancedExportSection;

const STATUS_TONE_CLASS: Record<SimStatusTone, string> = {
  safe: "border-emerald-500/25 bg-emerald-500/10 text-emerald-100",
  warning: "border-amber-500/25 bg-amber-500/10 text-amber-100",
  danger: "border-red-500/25 bg-red-500/10 text-red-100",
};

const SUBTLE_STATUS_TONE_CLASS: Record<SimStatusTone, string> = {
  safe: "border-emerald-500/25 bg-background/40",
  warning: "border-amber-500/30 bg-background/40",
  danger: "border-red-500/30 bg-background/40",
};

const SUBTLE_STATUS_LABEL_CLASS: Record<SimStatusTone, string> = {
  safe: "text-emerald-200",
  warning: "text-amber-200",
  danger: "text-red-200",
};

const CHECKLIST_CARD_CLASS = HEALTH_ACTION_CLASS_NAMES.checklistCard;
const SYMMETRY_SUBSECTION_CLASS = HEALTH_ACTION_CLASS_NAMES.symmetrySubsection;
const SYMMETRY_SUBSECTION_INTERACTIVE_CLASS = HEALTH_ACTION_CLASS_NAMES.symmetrySubsectionInteractive;
const SYMMETRY_SUBSECTION_ACTIVE_CLASS = HEALTH_ACTION_CLASS_NAMES.symmetrySubsectionActive;

const STATUS_ICON = {
  safe: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertTriangle,
} as const;

const PHYSICS_SECTION_CARD_CLASS = HEALTH_ACTION_CLASS_NAMES.physicsSectionCard;

const buildPhysicsActionSummary = ({
  onOpenGeneratePhysicsDialog,
  physicsPreflightLoading,
  physicsAuditSummary,
  voxelRecoveryCount,
  nearMissCount,
}: {
  onOpenGeneratePhysicsDialog?: () => void | Promise<void>;
  physicsPreflightLoading: boolean;
  physicsAuditSummary: HealthActionPanelProps["physicsAuditSummary"];
  voxelRecoveryCount: number;
  nearMissCount: number;
}): { summary: string; disabled: boolean } => {
  if (onOpenGeneratePhysicsDialog && !physicsAuditSummary) {
    return {
      summary: physicsPreflightLoading
        ? "Analyzing physics now. Wait for the audit before clicking."
        : "Run the physics check before repairing masses.",
      disabled: physicsPreflightLoading,
    };
  }
  if (physicsAuditSummary && physicsAuditSummary.repairableLinkCount > 0 && onOpenGeneratePhysicsDialog) {
    return {
      summary: `Repair ${physicsAuditSummary.repairableLinkCount} missing or invalid inertial link${physicsAuditSummary.repairableLinkCount === 1 ? "" : "s"}.`,
      disabled: false,
    };
  }
  if (voxelRecoveryCount > 0 && onOpenGeneratePhysicsDialog) {
    return {
      summary:
        nearMissCount > 0
          ? `${voxelRecoveryCount} skipped link${voxelRecoveryCount === 1 ? "" : "s"} passed voxel precheck. ${nearMissCount} near-miss link${nearMissCount === 1 ? "" : "s"} can use PSD regularization.`
          : `${voxelRecoveryCount} skipped link${voxelRecoveryCount === 1 ? "" : "s"} passed voxel precheck.`,
      disabled: false,
    };
  }
  return {
    summary: "Physics check ready.",
    disabled: false,
  };
};

const buildPhysicsActionLabel = ({
  physicsPreflightLoading,
  physicsAuditSummary,
  voxelRecoveryCount,
  nearMissCount,
}: {
  physicsPreflightLoading: boolean;
  physicsAuditSummary: HealthActionPanelProps["physicsAuditSummary"];
  voxelRecoveryCount: number;
  nearMissCount: number;
}): string => {
  if (!physicsAuditSummary) {
    return physicsPreflightLoading ? "Analyzing physics check" : "Run physics check";
  }
  if (physicsAuditSummary.repairableLinkCount > 0) {
    return `Recalculate ${physicsAuditSummary.repairableLinkCount} missing / invalid inertial link${physicsAuditSummary.repairableLinkCount === 1 ? "" : "s"}`;
  }
  if (voxelRecoveryCount > 0) {
    return `Recover ${voxelRecoveryCount} prechecked skipped inertial link${voxelRecoveryCount === 1 ? "" : "s"}`;
  }
  if (nearMissCount > 0) {
    return `Regularize ${nearMissCount} near-miss inertial link${nearMissCount === 1 ? "" : "s"}`;
  }
  return "Physics check complete";
};

const buildRecommendedAction = ({
  onRepairOrientation,
  repairOrientationLabel,
  repairOrientationSummary,
}: {
  onRepairOrientation?: () => void;
  repairOrientationLabel?: string | null;
  repairOrientationSummary?: string | null;
}): RecommendedAction | null => {
  if (onRepairOrientation) {
    return {
      kind: "frame",
      label: repairOrientationLabel ?? "Fix Frame",
      summary:
        repairOrientationSummary ??
        "Align the robot to a stable Z-up frame when the frame policy allows it.",
      onClick: onRepairOrientation,
      variant: "outline",
      icon: Wrench,
    };
  }
  return null;
};

const DIAGNOSIS_CARD_CLASS = HEALTH_ACTION_CLASS_NAMES.diagnosisCard;
const DIAGNOSIS_GROUP_CLASS = HEALTH_ACTION_CLASS_NAMES.diagnosisGroup;
const REPEATED_PARTS_GROUP_CLASS = HEALTH_ACTION_CLASS_NAMES.repeatedPartsGroup;
const SIMULATION_PREP_DISABLED_ACTION_BUTTON_CLASS = HEALTH_ACTION_CLASS_NAMES.simulationPrepDisabledActionButton;
const VISUALIZATION_TOGGLE_BUTTON_BASE_CLASS = HEALTH_ACTION_CLASS_NAMES.visualizationToggleButtonBase;
const VISUALIZATION_TOGGLE_BUTTON_ACTIVE_CLASS = HEALTH_ACTION_CLASS_NAMES.visualizationToggleButtonActive;
const VISUALIZATION_TOGGLE_BUTTON_INACTIVE_CLASS = HEALTH_ACTION_CLASS_NAMES.visualizationToggleButtonInactive;
const VISUALIZATION_TOGGLE_ICON_CLASS = HEALTH_ACTION_CLASS_NAMES.visualizationToggleIcon;

const formatRepeatedInertiaSymmetryHeadline = (
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

const formatRepeatedInertiaSymmetryDistance = (meters: number): string =>
  `${(meters * 1000).toFixed(1)} mm`;
const RADIANS_TO_DEGREES = HEALTH_ACTION_PANEL_PARAMS.radiansToDegrees;

const formatRobotMirrorPlaneLabel = (
  planeLabel: RobotMirrorSymmetryCheck["planeLabel"]
): string => `${planeLabel.toUpperCase()} plane`;

const formatMirrorSelectionLinkCount = (linkCount: number): string =>
  `${linkCount} link${linkCount === 1 ? "" : "s"}`;

const MIRROR_SELECTION_STATUS_BADGE_BASE_CLASS = HEALTH_ACTION_CLASS_NAMES.mirrorSelectionStatusBadgeBase;
const MIRROR_SELECTION_RADIAL_BADGE_CLASS = HEALTH_ACTION_CLASS_NAMES.mirrorSelectionRadialBadge;

const resolveMirrorSelectionStatusBadge = (
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

const formatRobotMirrorLinkResultSummary = (linkResult: RobotMirrorLinkResult): string => {
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

const formatRobotMirrorLinkResultReason = (linkResult: RobotMirrorLinkResult): string | null => {
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

const formatRobotMirrorLinkResultMetrics = (linkResult: RobotMirrorLinkResult): string => {
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
    parts.push(`com ${formatRepeatedInertiaSymmetryDistance(linkResult.inertialOriginMovedDistanceMeters)}`);
  }
  if (linkResult.planeNormalResidualRadians !== null) {
    parts.push(`axis ${formatRobotMirrorAngle(linkResult.planeNormalResidualRadians)}`);
  }
  return parts.join(" • ");
};

const shouldIgnoreVisualizationCardClick = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  Boolean(target.closest("button, input, label, a, textarea, select, [role='checkbox']"));

const buildCompatibilityRobotMirrorSelectionState = ({
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

const formatRepeatedInertiaSymmetryType = (
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

const formatRepeatedInertiaSymmetryCenterMode = (
  centerMode: RepeatedInertiaSymmetryCenterMode
): string =>
  REPEATED_INERTIA_SYMMETRY_CENTER_MODE_OPTIONS.find((option) => option.value === centerMode)
    ?.label ?? centerMode;

const formatRepeatedInertiaSymmetryAngle = (degrees: number): string =>
  `${degrees.toFixed(1)}°`;

const formatRepeatedInertiaSymmetryRadiusComparison = (
  row: RepeatedInertiaSymmetryChain["branchRows"][number]
): string => {
  const actualDistance = formatRepeatedInertiaSymmetryDistance(row.radialDistanceMeters);
  if (row.idealRadialDistanceMeters === null) {
    return actualDistance;
  }
  return `${actualDistance} → ${formatRepeatedInertiaSymmetryDistance(row.idealRadialDistanceMeters)}`;
};

const formatRepeatedInertiaSymmetryAngleComparison = (
  row: RepeatedInertiaSymmetryChain["branchRows"][number]
): string => {
  const actualAngle = formatRepeatedInertiaSymmetryAngle(row.angleDegrees);
  if (row.idealAngleDegrees === null) {
    return actualAngle;
  }
  return `${actualAngle} → ${formatRepeatedInertiaSymmetryAngle(row.idealAngleDegrees)}`;
};

const formatRepeatedInertiaSymmetryLinkOffsets = (
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

const formatRepeatedInertiaSymmetrySignedDistance = (
  meters: number | null
): string => {
  if (meters === null) {
    return "n/a";
  }
  const signedPrefix = meters > 0 ? "+" : meters < 0 ? "-" : "";
  return `${signedPrefix}${formatRepeatedInertiaSymmetryDistance(Math.abs(meters))}`;
};

const formatRepeatedInertiaSymmetryOffsetSummary = (
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

const hasMeaningfulRepeatedInertiaSymmetryAlignmentError = (
  row: RepeatedInertiaSymmetryChain["branchRows"][number]
): boolean =>
  (row.angularErrorDegrees ?? 0) > REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_ANGLE_ERROR_DEGREES ||
  row.offsetDistanceMeters > REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_OFFSET_METERS ||
  (row.lateralOffsetMeters ?? 0) > REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_LATERAL_OFFSET_METERS;

const resolveRepeatedInertiaSymmetryStatusTone = (
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

const resolveRepeatedInertiaSymmetryDominantIssue = (
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

const formatRepeatedInertiaSymmetryStatus = (
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

const resolveRepeatedInertiaSymmetryStatusBadgeClass = (
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

const resolveRepeatedInertiaSymmetryRowToneClass = (
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

const formatRepeatedInertiaSymmetryBranchLinks = (
  branchLinkGroup: RepeatedInertiaSymmetryChain["branchLinkGroups"][number]
): string => branchLinkGroup.linkNames.join(", ");

const formatRepeatedInertiaSymmetryBranchSummary = (
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

const formatRepeatedInertiaSymmetryRepairMode = (
  repairPlan: RepeatedInertiaSymmetryChain["recommendedRepair"]
): string => {
  if (!repairPlan) {
    return "Manual alignment";
  }
  return repairPlan.stepCount === 1 ? "1 joint move" : `${repairPlan.stepCount} joint moves`;
};

const formatRepeatedInertiaSymmetryAutoAlignButtonLabel = ({
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

const resolveRepeatedInertiaSymmetryOutcome = ({
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

export const HealthActionPanel = ({
  open,
  onClose,
  statusTone = "warning",
  statusLabel = null,
  statusSummary = null,
  frameIssueSummary = null,
  physicsIssueSummary = null,
  physicsDraftSummary = null,
  physicsVoxelFallbackLinkNames = [],
  physicsRepeatedMeshCanonicalizationSummaries = [],
  robotMirrorSelectionGroups = [],
  selectedRobotMirrorGroupKeys = [],
  robotMirrorSelectionLinks = [],
  selectedRobotMirrorLinkNames = [],
  robotMirrorPlaneTouchingLinkNames = [],
  robotMirrorVisualizationLinkNames: providedRobotMirrorVisualizationLinkNames = [],
  robotMirrorSymmetryCheck = null,
  robotMirrorOutcome = null,
  repeatedInertiaSymmetryChains = [],
  repeatedInertiaSymmetryCenterMode = "robot-center",
  repeatedInertiaSymmetryOutcomeByChainKey = {},
  repeatedInertiaActingGroupKey = null,
  repeatedInertiaSymmetryActingChainKey = null,
  repeatedInertiaSymmetryActingProgress = null,
  onFixRepeatedInertiaSymmetryChain,
  onRepeatedInertiaSymmetryCenterModeChange,
  activeInertiaVisualizationScopeKey = null,
  onToggleInertiaVisualizationScope,
  onPreviewInertiaVisualizationScope,
  onClearInertiaVisualizationPreview,
  onAlignRobotMirrorOrientation,
  onFixRobotMirrorSymmetry,
  isRobotMirrorActing = false,
  isSimulationPrepFixBusy = false,
  isRobotMirrorAvailabilityLoading = false,
  activeRobotMirrorAction = null,
  canAlignRobotMirrorOrientation = true,
  canFixRobotMirrorSymmetry = true,
  onToggleRobotMirrorGroupSelection,
  onToggleRobotMirrorSelectionLink,
  physicsAuditSummary = null,
  physicsPlausibilitySummary = null,
  physicsDeltaSummary = null,
  physicsPreflightLoading = false,
  physicsActionStatusByKey,
  onOpenGeneratePhysicsDialog,
  onGeneratePhysics,
  onGenerateVoxelPhysics,
  onGenerateRegularizedPhysics,
  repairOrientationLabel = null,
  repairOrientationSummary = null,
  onRepairOrientation,
  repairOrientationDisabled = false,
  advancedOpenByDefault = false,
  advancedPrimaryActionLabel = null,
  onRunAdvancedPrimaryAction,
  advancedSecondaryActionLabel = null,
  onRunAdvancedSecondaryAction,
  synthesisRootLinkName = null,
  synthesisRobotName = null,
  synthesisLinkCount = 0,
  synthesisJointCount = 0,
  synthesisSupportEvidence = null,
  synthesisInferredUpLabel = null,
  synthesisConfidence = null,
  synthesisFallbackReason = null,
  synthesisSampleJoints = [],
  onClearSynthesisPreview,
  stagedEntryCount = 0,
  stagedMeshBackedEntryCount = 0,
  stagedLinkNames = [],
  onClearStagedAction,
  onClearPhysicsDraft,
}: HealthActionPanelProps) => {
  const [showPhysicsPanel, setShowPhysicsPanel] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(advancedOpenByDefault);
  const [armedPhysicsActionKey, setArmedPhysicsActionKey] = useState<PhysicsPanelActionKey | null>(null);
  const [selectedPhysicsMaterials, setSelectedPhysicsMaterials] = useState<PhysicsActionMaterialSelection>({});
  const [expandedDiagnosisGroups, setExpandedDiagnosisGroups] = useState<Record<string, boolean>>({});
  const [robotMirrorExpanded, setRobotMirrorExpanded] = useState(false);
  const [radialSymmetryExpanded, setRadialSymmetryExpanded] = useState(false);
  const [showUnifiedRepeatedMeshes, setShowUnifiedRepeatedMeshes] = useState(false);
  const [panelPosition, setPanelPosition] = useState<SimulationPrepPanelPosition>(() =>
    getSimulationPrepPanelInitialPosition(globalThis.window?.innerWidth ?? SIMULATION_PREP_PANEL_WIDTH_PX)
  );
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    originLeft: number;
    originTop: number;
    startX: number;
    startY: number;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setIsDragging(false);
      dragStateRef.current = null;
      return;
    }
    setArmedPhysicsActionKey(null);
    setSelectedPhysicsMaterials({});
    setPanelPosition(
      getSimulationPrepPanelInitialPosition(
        globalThis.window?.innerWidth ?? SIMULATION_PREP_PANEL_WIDTH_PX
      )
    );
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const syncPanelPositionToViewport = () => {
      const panelRect = panelRef.current?.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const panelWidth =
        panelRect && panelRect.width > 0
          ? panelRect.width
          : getSimulationPrepPanelWidthPx(viewportWidth);
      const panelHeight = panelRect?.height ?? 0;

      setPanelPosition((currentPosition) =>
        clampSimulationPrepPanelPosition({
          nextLeft: currentPosition.left,
          nextTop: currentPosition.top,
          panelWidth,
          panelHeight,
          viewportWidth,
          viewportHeight,
        })
      );
    };

    syncPanelPositionToViewport();
    window.addEventListener("resize", syncPanelPositionToViewport);
    return () => window.removeEventListener("resize", syncPanelPositionToViewport);
  }, [open]);

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";

    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }

      const panelRect = panelRef.current?.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const panelWidth =
        panelRect && panelRect.width > 0
          ? panelRect.width
          : getSimulationPrepPanelWidthPx(viewportWidth);
      const panelHeight = panelRect?.height ?? 0;

      setPanelPosition(
        clampSimulationPrepPanelPosition({
          nextLeft: dragState.originLeft + event.clientX - dragState.startX,
          nextTop: dragState.originTop + event.clientY - dragState.startY,
          panelWidth,
          panelHeight,
          viewportWidth,
          viewportHeight,
        })
      );
    };

    const stopDragging = () => {
      dragStateRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopDragging);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopDragging);
    };
  }, [isDragging]);

  const handlePanelDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, select")) {
      return;
    }

    event.preventDefault();
    dragStateRef.current = {
      originLeft: panelPosition.left,
      originTop: panelPosition.top,
      startX: event.clientX,
      startY: event.clientY,
    };
    setIsDragging(true);
  };

  const compatibilityRobotMirrorSelectionState = useMemo(
    () =>
      buildCompatibilityRobotMirrorSelectionState({
        robotMirrorSelectionGroups,
        selectedRobotMirrorGroupKeys,
      }),
    [robotMirrorSelectionGroups, selectedRobotMirrorGroupKeys]
  );
  const effectiveRobotMirrorSelectionLinks = useMemo(
    () =>
      robotMirrorSelectionLinks.length > 0
        ? [...robotMirrorSelectionLinks]
        : compatibilityRobotMirrorSelectionState.selectionLinks,
    [compatibilityRobotMirrorSelectionState.selectionLinks, robotMirrorSelectionLinks]
  );
  const robotMirrorSimulationPrepViewState = useMemo(
    () =>
      resolveRobotMirrorSimulationPrepViewState({
        robotMirrorSelectionLinks: effectiveRobotMirrorSelectionLinks,
        robotMirrorSymmetryCheck,
        robotMirrorPlaneTouchingLinkNames,
      }),
    [
      effectiveRobotMirrorSelectionLinks,
      robotMirrorPlaneTouchingLinkNames,
      robotMirrorSymmetryCheck,
    ]
  );
  const effectiveRobotMirrorSymmetryCheck =
    robotMirrorSimulationPrepViewState.robotMirrorSymmetryCheck;
  const displayRobotMirrorSelectionLinks =
    robotMirrorSimulationPrepViewState.robotMirrorSelectionLinks;
  const effectiveSelectedRobotMirrorLinkNames =
    selectedRobotMirrorLinkNames.length > 0
      ? [...selectedRobotMirrorLinkNames]
      : compatibilityRobotMirrorSelectionState.selectedLinkNames;

  if (!open) {
    return null;
  }

  const StatusIcon = STATUS_ICON[statusTone];
  const hasAdvancedContent =
    Boolean(advancedPrimaryActionLabel && onRunAdvancedPrimaryAction) ||
    Boolean(advancedSecondaryActionLabel && onRunAdvancedSecondaryAction) ||
    stagedEntryCount > 0 ||
    Boolean(synthesisRootLinkName);
  const excludedLinks = physicsPlausibilitySummary?.excludedLinks ?? [];
  const exclusionReasonSummary = buildExclusionReasonSummary(excludedLinks);
  const excludedLinkGroups = buildExcludedLinkGroups(excludedLinks);
  const sanitizationSummary = buildSanitizationSummary(excludedLinks);
  const voxelRecoveryLinkNames = excludedLinks
    .filter((entry) => entry.recoveryDisposition === "recover")
    .map((entry) => entry.linkName);
  const nearMissLinkNames = excludedLinks
    .filter((entry) => entry.recoveryDisposition === "regularize")
    .map((entry) => entry.linkName);
  const panelSubtitle = buildPanelSubtitle({
    audit: physicsAuditSummary,
    excludedCount: excludedLinks.length,
  });
  const generatePhysicsDialogDescription = buildGeneratePhysicsDialogDescription({
    audit: physicsAuditSummary,
    voxelRecoveryCount: voxelRecoveryLinkNames.length,
    nearMissCount: nearMissLinkNames.length,
    skippedLinkCount: excludedLinks.length,
  });
  const overviewRows = buildOverviewLabelValueRows({
    statusLabel,
    physicsIssueSummary,
    frameIssueSummary,
    physicsAuditSummary,
    physicsPlausibilitySummary,
  });
  const overviewExtraNotes = buildOverviewExtraNotes({
    statusSummary,
    physicsPlausibilityWarning: physicsPlausibilitySummary?.warning ?? null,
    overviewRowValues: overviewRows.map((row) => row.value),
  });
  const openPhysicsPanel = () => {
    if (!physicsAuditSummary) {
      void onOpenGeneratePhysicsDialog?.();
    }
    setArmedPhysicsActionKey(null);
    setSelectedPhysicsMaterials({});
    setShowPhysicsPanel(true);
  };
  const physicsAction = buildPhysicsActionSummary({
    onOpenGeneratePhysicsDialog,
    physicsPreflightLoading,
    physicsAuditSummary,
    voxelRecoveryCount: voxelRecoveryLinkNames.length,
    nearMissCount: nearMissLinkNames.length,
  });
  const physicsActionLabel = buildPhysicsActionLabel({
    physicsPreflightLoading,
    physicsAuditSummary,
    voxelRecoveryCount: voxelRecoveryLinkNames.length,
    nearMissCount: nearMissLinkNames.length,
  });
  const recommendedAction = buildRecommendedAction({
    onRepairOrientation,
    repairOrientationLabel,
    repairOrientationSummary,
  });
  const physicsPanelActions = buildPhysicsPanelActions({
    audit: physicsAuditSummary,
    voxelRecoveryCount: voxelRecoveryLinkNames.length,
    nearMissCount: nearMissLinkNames.length,
    onGeneratePhysics,
    onGenerateVoxelPhysics,
    onGenerateRegularizedPhysics,
  });
  const showPhysicsActionButton =
    !physicsAuditSummary || physicsPanelActions.length > 0;
  const showInlinePhysicsActions = Boolean(physicsAuditSummary) && physicsPanelActions.length > 0;
  const physicsActionByKey = Object.fromEntries(
    physicsPanelActions.map((action) => [action.key, action])
  ) as Partial<Record<PhysicsPanelActionKey, PhysicsPanelAction>>;
  const voxelRecoveryAction = physicsPanelActions.find((action) => action.key === "voxel-recovery");
  const regularizeAction = physicsPanelActions.find((action) => action.key === "psd-regularize");
  const voxelRecoveryStatus = voxelRecoveryAction
    ? getPhysicsActionStatus(physicsActionStatusByKey, voxelRecoveryAction.key)
    : "idle";
  const regularizeStatus = regularizeAction
    ? getPhysicsActionStatus(physicsActionStatusByKey, regularizeAction.key)
    : "idle";
  const hasPendingPhysicsAction = hasSimulationPrepPhysicsActionPending(physicsActionStatusByKey ?? {});
  const isAnySimulationPrepFixBusy =
    isSimulationPrepFixBusy ||
    hasPendingPhysicsAction ||
    repeatedInertiaActingGroupKey !== null ||
    repeatedInertiaSymmetryActingChainKey !== null ||
    isRobotMirrorActing;
  const handleSelectPhysicsMaterial = (
    actionKey: PhysicsPanelActionKey,
    materialId: InertialDensityPresetId
  ) => {
    setSelectedPhysicsMaterials((current) => ({
      ...current,
      [actionKey]: materialId,
    }));
    setArmedPhysicsActionKey(actionKey);

    const action = physicsActionByKey[actionKey];
    const actionStatus = getPhysicsActionStatus(physicsActionStatusByKey, actionKey);
    if (!action || actionStatus !== "idle") {
      return;
    }
    action.onClick(materialId);
  };
  const handleRunPhysicsAction = ({
    action,
    disabled,
  }: {
    action: PhysicsPanelAction;
    disabled: boolean;
  }) => {
    if (disabled) {
      return;
    }
    const selectedMaterial = selectedPhysicsMaterials[action.key] ?? null;
    if (armedPhysicsActionKey !== action.key || !selectedMaterial) {
      setArmedPhysicsActionKey(action.key);
      return;
    }
    action.onClick(selectedMaterial);
  };
  const toggleDiagnosisGroup = (groupKey: string) => {
    setExpandedDiagnosisGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  };
  const robotMirrorVisualizationLinkNames = effectiveRobotMirrorSymmetryCheck
    ? [...providedRobotMirrorVisualizationLinkNames]
    : [];
  const robotMirrorScopeKey = effectiveRobotMirrorSymmetryCheck
    ? buildRobotMirrorSymmetryVisualizationScopeKey(effectiveRobotMirrorSymmetryCheck)
    : null;
  const isRobotMirrorVisualizationActive =
    robotMirrorScopeKey !== null &&
    activeInertiaVisualizationScopeKey === robotMirrorScopeKey;
  const canToggleRobotMirrorVisualization =
    Boolean(onToggleInertiaVisualizationScope) &&
    robotMirrorScopeKey !== null &&
    robotMirrorVisualizationLinkNames.length > 0;
  const selectedRobotMirrorLinkCount = displayRobotMirrorSelectionLinks.filter((selectionLink) =>
    effectiveSelectedRobotMirrorLinkNames.includes(selectionLink.linkName)
  ).length;
  const selectedRobotMirrorMeshCount = new Set(
    displayRobotMirrorSelectionLinks
      .filter((selectionLink) =>
        effectiveSelectedRobotMirrorLinkNames.includes(selectionLink.linkName)
      )
      .map((selectionLink) => selectionLink.meshLabel)
  ).size;
  const robotMirrorSelectionLinksByMeshLabel = Array.from(
    displayRobotMirrorSelectionLinks.reduce(
      (groups, selectionLink) => {
        const currentLinks = groups.get(selectionLink.meshLabel) ?? [];
        currentLinks.push(selectionLink);
        groups.set(selectionLink.meshLabel, currentLinks);
        return groups;
      },
      new Map<string, RobotMirrorSelectionLink[]>()
    )
  )
    .map(([meshLabel, selectionLinks]) => ({
      meshLabel,
      radialExcludedCount: selectionLinks.filter(
        (selectionLink) => selectionLink.defaultExclusionReason === "radial-symmetry"
      ).length,
      selectionLinks: [...selectionLinks].sort((left, right) =>
        left.linkName.localeCompare(right.linkName)
      ),
    }))
    .sort((left, right) => left.meshLabel.localeCompare(right.meshLabel));
  const robotMirrorOutcomeByLinkName = new Map(
    robotMirrorOutcome?.linkResults?.map((linkResult) => [linkResult.linkName, linkResult]) ?? []
  );
  const handleToggleRobotMirrorSelection = (selectionLink: RobotMirrorSelectionLink) => {
    if (onToggleRobotMirrorSelectionLink) {
      onToggleRobotMirrorSelectionLink(selectionLink.linkName);
      return;
    }
    onToggleRobotMirrorGroupSelection?.(selectionLink.groupKey);
  };
  const isRobotMirrorOrientationActionActive =
    isRobotMirrorActing && activeRobotMirrorAction === "orientation-only";
  const isRobotMirrorCenterActionActive =
    isRobotMirrorActing && activeRobotMirrorAction === "center-only";
  const isRobotMirrorOrientationActionDisabled =
    isAnySimulationPrepFixBusy ||
    isRobotMirrorAvailabilityLoading ||
    effectiveSelectedRobotMirrorLinkNames.length === 0 ||
    !canAlignRobotMirrorOrientation;
  const isRobotMirrorCenterActionDisabled =
    isAnySimulationPrepFixBusy ||
    isRobotMirrorAvailabilityLoading ||
    effectiveSelectedRobotMirrorLinkNames.length === 0 ||
    !canFixRobotMirrorSymmetry;
  const hasSymmetryPlanesSection =
    effectiveRobotMirrorSymmetryCheck !== null || repeatedInertiaSymmetryChains.length > 0;
  const compactRadialHeaderChain =
    repeatedInertiaSymmetryChains.length === 1
      ? repeatedInertiaSymmetryChains[0]
      : null;
  const compactRadialHeaderScopeKey = compactRadialHeaderChain
    ? buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey(compactRadialHeaderChain)
    : null;
  const compactRadialHeaderLinkNames = compactRadialHeaderChain
    ? collectRepeatedInertiaSymmetryFamilyLinkNames(compactRadialHeaderChain)
    : null;
  const isCompactRadialHeaderActive =
    compactRadialHeaderScopeKey !== null &&
    activeInertiaVisualizationScopeKey === compactRadialHeaderScopeKey;
  const canToggleCompactRadialVisualization =
    Boolean(onToggleInertiaVisualizationScope) &&
    compactRadialHeaderChain !== null &&
    compactRadialHeaderScopeKey !== null &&
    compactRadialHeaderLinkNames !== null &&
    compactRadialHeaderLinkNames.length > 0;
  const handleRobotMirrorSectionClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (
      !canToggleRobotMirrorVisualization ||
      !robotMirrorScopeKey ||
      shouldIgnoreVisualizationCardClick(event.target)
    ) {
      return;
    }
    onToggleInertiaVisualizationScope?.(robotMirrorScopeKey, robotMirrorVisualizationLinkNames);
  };
  const handleCompactRadialSectionClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (
      !canToggleCompactRadialVisualization ||
      !compactRadialHeaderChain ||
      !compactRadialHeaderScopeKey ||
      !compactRadialHeaderLinkNames ||
      shouldIgnoreVisualizationCardClick(event.target)
    ) {
      return;
    }
    onToggleInertiaVisualizationScope?.(
      compactRadialHeaderScopeKey,
      compactRadialHeaderLinkNames,
      compactRadialHeaderChain
    );
  };
  const handleRobotMirrorSectionMouseEnter = () => {
    if (!canToggleRobotMirrorVisualization || !robotMirrorScopeKey) {
      return;
    }
    onPreviewInertiaVisualizationScope?.(robotMirrorScopeKey, robotMirrorVisualizationLinkNames);
  };
  const handleRobotMirrorSectionMouseLeave = () => {
    onClearInertiaVisualizationPreview?.();
  };
  const handleCompactRadialSectionMouseEnter = () => {
    if (
      !canToggleCompactRadialVisualization ||
      !compactRadialHeaderChain ||
      !compactRadialHeaderScopeKey ||
      !compactRadialHeaderLinkNames
    ) {
      return;
    }
    onPreviewInertiaVisualizationScope?.(
      compactRadialHeaderScopeKey,
      compactRadialHeaderLinkNames,
      compactRadialHeaderChain
    );
  };
  const handleCompactRadialSectionMouseLeave = () => {
    onClearInertiaVisualizationPreview?.();
  };

  return (
    <TooltipProvider>
    <>
      <div
        ref={panelRef}
        data-panel="workspace-launcher"
        className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-border/60 bg-background/95 shadow-lg backdrop-blur"
        style={{
          left: `${panelPosition.left}px`,
          top: `${panelPosition.top}px`,
          width: `min(${SIMULATION_PREP_PANEL_WIDTH_PX}px, calc(100vw - ${SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX * 2}px))`,
          maxHeight: `calc(100vh - ${SIMULATION_PREP_PANEL_DEFAULT_TOP_PX + SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX}px)`,
        }}
      >
        <HealthActionPanelHeader
          isDragging={isDragging}
          onClose={onClose}
          onDragStart={handlePanelDragStart}
          panelLabel="simulation prep"
          statusIcon={StatusIcon}
          title="Simulation Prep"
        />

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {hasSymmetryPlanesSection ? (
            <div data-section="symmetry-planes" className={CHECKLIST_CARD_CLASS}>
              <div className="text-[11px] font-medium text-foreground/85">Symmetry Planes</div>
              <div className="mt-0.5 text-[9px] text-muted-foreground">
                Check bilateral mirror alignment and repeated radial branches in one place.
              </div>
              <div className="mt-2 space-y-2">
          {effectiveRobotMirrorSymmetryCheck ? (
            <div
              data-section="robot-mirror-symmetry"
              className={cn(
                SYMMETRY_SUBSECTION_CLASS,
                canToggleRobotMirrorVisualization && SYMMETRY_SUBSECTION_INTERACTIVE_CLASS,
                isRobotMirrorVisualizationActive && SYMMETRY_SUBSECTION_ACTIVE_CLASS
              )}
              onClick={handleRobotMirrorSectionClick}
              onMouseEnter={handleRobotMirrorSectionMouseEnter}
              onMouseLeave={handleRobotMirrorSectionMouseLeave}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-medium text-foreground/85">Mirror</div>
                  <div className="mt-0.5 text-[9px] text-muted-foreground">
                    {formatRobotMirrorPlaneLabel(effectiveRobotMirrorSymmetryCheck.planeLabel)} •{" "}
                    {effectiveSelectedRobotMirrorLinkNames.length} selected •{" "}
                    {robotMirrorSelectionLinksByMeshLabel.length} mesh group
                    {robotMirrorSelectionLinksByMeshLabel.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[9px]"
                    onClick={() => setRobotMirrorExpanded((current) => !current)}
                    aria-expanded={robotMirrorExpanded}
                    aria-label={`${robotMirrorExpanded ? "Collapse" : "Expand"} mirror controls`}
                  >
                    {robotMirrorExpanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <span>{robotMirrorExpanded ? "Collapse" : "Expand"}</span>
                  </Button>
                  {onToggleInertiaVisualizationScope ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className={`${VISUALIZATION_TOGGLE_BUTTON_BASE_CLASS} ${
                        isRobotMirrorVisualizationActive
                          ? VISUALIZATION_TOGGLE_BUTTON_ACTIVE_CLASS
                          : VISUALIZATION_TOGGLE_BUTTON_INACTIVE_CLASS
                      }`}
                      onClick={() =>
                        onToggleInertiaVisualizationScope(
                          robotMirrorScopeKey,
                          robotMirrorVisualizationLinkNames
                        )
                      }
                      aria-label={`${
                        isRobotMirrorVisualizationActive ? "Hide" : "Show"
                      } robot-wide mirror plane guide`}
                      title={`${
                        isRobotMirrorVisualizationActive ? "Hide" : "Show"
                      } the mirror plane and the selected mirror links`}
                    >
                      {isRobotMirrorVisualizationActive ? (
                        <EyeOff className={VISUALIZATION_TOGGLE_ICON_CLASS} />
                      ) : (
                        <Eye className={VISUALIZATION_TOGGLE_ICON_CLASS} />
                      )}
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 overflow-hidden rounded border border-border/30 bg-background/10">
                {onFixRobotMirrorSymmetry || onAlignRobotMirrorOrientation ? (
                  <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="min-w-0 text-[9px] text-foreground/85">
                        {effectiveSelectedRobotMirrorLinkNames.length} selected •{" "}
                        {selectedRobotMirrorMeshCount} mesh
                        {selectedRobotMirrorMeshCount === 1 ? "" : "es"} •{" "}
                        {selectedRobotMirrorLinkCount} link
                        {selectedRobotMirrorLinkCount === 1 ? "" : "s"}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {onAlignRobotMirrorOrientation ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={`h-5 shrink-0 gap-1 px-1.5 text-[9px] ${SIMULATION_PREP_DISABLED_ACTION_BUTTON_CLASS}`}
                            onClick={onAlignRobotMirrorOrientation}
                            disabled={isRobotMirrorOrientationActionDisabled}
                            aria-label="Align selected mirror link orientation"
                          >
                            {isRobotMirrorOrientationActionActive ? (
                              <LoaderCircle className="h-3 w-3 animate-spin" />
                            ) : (
                              <Wrench className="h-3 w-3" />
                            )}
                            <span>Make Parallel</span>
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className={`h-5 shrink-0 gap-1 px-1.5 text-[9px] ${SIMULATION_PREP_DISABLED_ACTION_BUTTON_CLASS}`}
                          onClick={onFixRobotMirrorSymmetry}
                          disabled={isRobotMirrorCenterActionDisabled}
                          aria-label="Center selected mirror links"
                        >
                          {isRobotMirrorCenterActionActive ? (
                            <LoaderCircle className="h-3 w-3 animate-spin" />
                          ) : (
                            <Wrench className="h-3 w-3" />
                          )}
                          <span>Center Mirror</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
                {robotMirrorExpanded ? (
                  <div className="border-t border-border/30 bg-background/5 px-2 py-1.5 text-[9px] text-muted-foreground">
                    <div className="flex flex-wrap gap-1">
                      <span className="rounded border border-border/20 bg-background/10 px-1 py-0.5">
                        support {effectiveRobotMirrorSymmetryCheck.supportedLinkCount}/
                        {effectiveRobotMirrorSymmetryCheck.totalRepeatedLinkCount}
                      </span>
                      <span className="rounded border border-border/20 bg-background/10 px-1 py-0.5">
                        pairs {effectiveRobotMirrorSymmetryCheck.pairedLinkCount}
                      </span>
                      <span className="rounded border border-border/20 bg-background/10 px-1 py-0.5">
                        cut {effectiveRobotMirrorSymmetryCheck.centeredLinkCount}
                      </span>
                      <span className="rounded border border-border/20 bg-background/10 px-1 py-0.5">
                        max {formatRepeatedInertiaSymmetryDistance(
                          effectiveRobotMirrorSymmetryCheck.maxResidualMeters
                        )}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      {robotMirrorSelectionLinksByMeshLabel.length > 0 ? (
                        <div className="space-y-1">
                          {robotMirrorSelectionLinksByMeshLabel.map(
                            ({ meshLabel, radialExcludedCount, selectionLinks }) => {
                              return (
                                <div key={meshLabel} className="rounded border border-border/15 bg-background/10">
                                  <div className="flex items-center justify-between gap-2 px-1.5 py-1 text-[9px] leading-tight">
                                    <div className="min-w-0 font-medium text-foreground/85">
                                      <span className="truncate">{meshLabel}</span>
                                      <span className="ml-1 text-muted-foreground">
                                        {formatMirrorSelectionLinkCount(
                                          selectionLinks[0]?.groupLinkCount ?? 0
                                        )}
                                      </span>
                                    </div>
                                    {radialExcludedCount > 0 ? (
                                      <span
                                        className={MIRROR_SELECTION_RADIAL_BADGE_CLASS}
                                        title={`${radialExcludedCount} link${
                                          radialExcludedCount === 1 ? "" : "s"
                                        } in this mesh group are part of a radial pattern and stay out of the default mirror selection.`}
                                      >
                                        <CircleHelp className="h-2.5 w-2.5" />
                                        <span>{radialExcludedCount} radial</span>
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="border-t border-border/10">
                                    {selectionLinks.map((selectionLink) => {
                                      const isSelected = effectiveSelectedRobotMirrorLinkNames.includes(
                                        selectionLink.linkName
                                      );
                                      const statusBadge = resolveMirrorSelectionStatusBadge(selectionLink);
                                      const linkResult = robotMirrorOutcomeByLinkName.get(
                                        selectionLink.linkName
                                      );
                                      const resultReason = linkResult
                                        ? formatRobotMirrorLinkResultReason(linkResult)
                                        : null;
                                      return (
                                        <label
                                          key={selectionLink.linkName}
                                          className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] leading-tight"
                                        >
                                          <Checkbox
                                            checked={isSelected}
                                            onCheckedChange={() =>
                                              handleToggleRobotMirrorSelection(selectionLink)
                                            }
                                            aria-label={`${
                                              isSelected ? "Deselect" : "Select"
                                            } mirror link ${selectionLink.linkName}`}
                                            className="mt-0"
                                          />
                                          <span className="min-w-0 flex-1">
                                            <span className="flex min-w-0 items-center gap-1 overflow-hidden">
                                              <span className="truncate font-medium text-foreground/85">
                                                {selectionLink.linkName}
                                              </span>
                                              {statusBadge ? (
                                                <span className={statusBadge.className}>
                                                  <statusBadge.icon className="h-2.5 w-2.5" />
                                                  <span>{statusBadge.label}</span>
                                                </span>
                                              ) : null}
                                              {selectionLink.counterpartLinkName ? (
                                                <span className="truncate text-muted-foreground">
                                                  peer {selectionLink.counterpartLinkName}
                                                </span>
                                              ) : null}
                                            </span>
                                            {linkResult ? (
                                              <span className="mt-0.5 block truncate text-[8px] text-muted-foreground">
                                                {formatRobotMirrorLinkResultSummary(linkResult)} •{" "}
                                                {formatRobotMirrorLinkResultMetrics(linkResult)}
                                                {resultReason ? ` • ${resultReason}` : ""}
                                              </span>
                                            ) : null}
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            }
                          )}
                        </div>
                      ) : (
                        <div>No mirror-ready mesh links are available.</div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {repeatedInertiaSymmetryChains.length > 0 ? (
            <div
              data-section="symmetry-chains"
              className={cn(
                SYMMETRY_SUBSECTION_CLASS,
                canToggleCompactRadialVisualization && SYMMETRY_SUBSECTION_INTERACTIVE_CLASS,
                isCompactRadialHeaderActive && SYMMETRY_SUBSECTION_ACTIVE_CLASS
              )}
              onClick={handleCompactRadialSectionClick}
              onMouseEnter={handleCompactRadialSectionMouseEnter}
              onMouseLeave={handleCompactRadialSectionMouseLeave}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-medium text-foreground/85">Radial</div>
                  <div className="mt-0.5 text-[9px] text-muted-foreground">
                    {formatRepeatedInertiaSymmetryHeadline(repeatedInertiaSymmetryChains)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[9px]"
                    onClick={() => setRadialSymmetryExpanded((current) => !current)}
                    aria-expanded={radialSymmetryExpanded}
                    aria-label={`${radialSymmetryExpanded ? "Collapse" : "Expand"} radial symmetry controls`}
                  >
                    {radialSymmetryExpanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <span>{radialSymmetryExpanded ? "Collapse" : "Expand"}</span>
                  </Button>
                  {compactRadialHeaderChain &&
                  compactRadialHeaderScopeKey &&
                  compactRadialHeaderLinkNames &&
                  onToggleInertiaVisualizationScope ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className={`${VISUALIZATION_TOGGLE_BUTTON_BASE_CLASS} ${
                        isCompactRadialHeaderActive
                          ? VISUALIZATION_TOGGLE_BUTTON_ACTIVE_CLASS
                          : VISUALIZATION_TOGGLE_BUTTON_INACTIVE_CLASS
                      }`}
                      onClick={() =>
                        onToggleInertiaVisualizationScope(
                          compactRadialHeaderScopeKey,
                          compactRadialHeaderLinkNames,
                          compactRadialHeaderChain
                        )
                      }
                      aria-label={`${
                        isCompactRadialHeaderActive ? "Hide" : "Show"
                      } symmetry guide for ${compactRadialHeaderChain.outlierBranchRootLinkName}`}
                      title={`${
                        isCompactRadialHeaderActive ? "Hide" : "Show"
                      } symmetry guide and all branch inertia boxes in the viewer`}
                    >
                      {isCompactRadialHeaderActive ? (
                        <EyeOff className={VISUALIZATION_TOGGLE_ICON_CLASS} />
                      ) : (
                        <Eye className={VISUALIZATION_TOGGLE_ICON_CLASS} />
                      )}
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 space-y-1">
                {repeatedInertiaSymmetryChains.map((chain) => {
                  const symmetryChainKey = buildRepeatedInertiaSymmetryChainKey({
                    symmetryRootLinkName: chain.symmetryRootLinkName,
                    outlierBranchRootLinkName: chain.outlierBranchRootLinkName,
                  });
                  const symmetryScopeKey =
                    buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey(chain);
                  const symmetryVisualizationLinkNames =
                    collectRepeatedInertiaSymmetryFamilyLinkNames(chain);
                  const isSymmetryChainActive =
                    activeInertiaVisualizationScopeKey === symmetryScopeKey;
                  const isActingSymmetryChain =
                    repeatedInertiaSymmetryActingChainKey === symmetryChainKey;
                  const symmetryProgress =
                    repeatedInertiaSymmetryActingProgress?.chainKey === symmetryChainKey
                      ? repeatedInertiaSymmetryActingProgress
                      : null;
                  const symmetryOutcome = resolveRepeatedInertiaSymmetryOutcome({
                    chain,
                    outcomeByKey: repeatedInertiaSymmetryOutcomeByChainKey,
                  });
                  const completedSymmetryProgress = symmetryOutcome?.completedProgress ?? null;
                  const isSymmetryAutoAlignAvailable =
                    Boolean(chain.recommendedRepair) &&
                    chain.recommendedRepair.stepCount > 0;
                  return (
                    <div
                      key={`radial-summary:${chain.symmetryRootLinkName}:${chain.outlierBranchRootLinkName}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded border border-border/20 bg-background/10 px-2 py-1 text-[9px]"
                      onMouseEnter={() =>
                        onPreviewInertiaVisualizationScope?.(
                          symmetryScopeKey,
                          symmetryVisualizationLinkNames,
                          chain
                        )
                      }
                      onMouseLeave={() => onClearInertiaVisualizationPreview?.()}
                    >
                      <div className="min-w-0 truncate whitespace-nowrap text-muted-foreground">
                        <span className="font-medium text-foreground/85">
                          {chain.symmetryRootLinkName} {"->"} {chain.outlierBranchRootLinkName}
                        </span>
                        <span className="ml-1.5">
                          {formatRepeatedInertiaSymmetryType(chain)} • max{" "}
                          {formatRepeatedInertiaSymmetryDistance(chain.maxDistanceDeltaMeters)}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                        {onToggleInertiaVisualizationScope &&
                        repeatedInertiaSymmetryChains.length > 1 ? (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className={`${VISUALIZATION_TOGGLE_BUTTON_BASE_CLASS} ${
                              isSymmetryChainActive
                                ? VISUALIZATION_TOGGLE_BUTTON_ACTIVE_CLASS
                                : VISUALIZATION_TOGGLE_BUTTON_INACTIVE_CLASS
                            }`}
                            onClick={() =>
                              onToggleInertiaVisualizationScope(
                                symmetryScopeKey,
                                symmetryVisualizationLinkNames,
                                chain
                              )
                            }
                            aria-label={`${
                              isSymmetryChainActive ? "Hide" : "Show"
                            } symmetry guide for ${chain.outlierBranchRootLinkName}`}
                            title={`${
                              isSymmetryChainActive ? "Hide" : "Show"
                            } symmetry guide and all branch inertia boxes in the viewer`}
                          >
                            {isSymmetryChainActive ? (
                              <EyeOff className={VISUALIZATION_TOGGLE_ICON_CLASS} />
                            ) : (
                              <Eye className={VISUALIZATION_TOGGLE_ICON_CLASS} />
                            )}
                          </Button>
                        ) : null}
                        {onFixRepeatedInertiaSymmetryChain ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={`h-5 shrink-0 gap-1 px-1.5 text-[9px] ${SIMULATION_PREP_DISABLED_ACTION_BUTTON_CLASS}`}
                            onClick={() => onFixRepeatedInertiaSymmetryChain(chain)}
                            disabled={
                              (isAnySimulationPrepFixBusy && !isActingSymmetryChain) ||
                              isActingSymmetryChain ||
                              !isSymmetryAutoAlignAvailable
                            }
                            aria-label={`Auto-align symmetry branch ${chain.outlierBranchRootLinkName}`}
                          >
                            {isActingSymmetryChain ? (
                              <LoaderCircle className="h-3 w-3 animate-spin" />
                            ) : (
                              <Wrench className="h-3 w-3" />
                            )}
                            <span>
                              {formatRepeatedInertiaSymmetryAutoAlignButtonLabel({
                                completedProgress: completedSymmetryProgress,
                                isActing: isActingSymmetryChain,
                                progress: symmetryProgress,
                              })}
                            </span>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              {radialSymmetryExpanded ? (
                <>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="font-medium text-foreground/85">Blue lines</span>
                <div className="flex items-center gap-1 rounded border border-border/30 bg-background/20 p-0.5">
                  {REPEATED_INERTIA_SYMMETRY_CENTER_MODE_OPTIONS.map((option) => {
                    const isActive = repeatedInertiaSymmetryCenterMode === option.value;
                    return (
                      <Button
                        key={option.value}
                        type="button"
                        size="sm"
                        variant="ghost"
                        className={`h-6 px-2 text-[10px] ${
                          isActive
                            ? "bg-muted/60 text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => onRepeatedInertiaSymmetryCenterModeChange?.(option.value)}
                        aria-pressed={isActive}
                        aria-label={`Use ${option.label} for symmetry blue lines`}
                        title={option.description}
                      >
                        {option.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-2 space-y-1.5">
                {repeatedInertiaSymmetryChains.map((chain) => (
                  (() => {
                    const symmetryChainKey = buildRepeatedInertiaSymmetryChainKey({
                      symmetryRootLinkName: chain.symmetryRootLinkName,
                      outlierBranchRootLinkName: chain.outlierBranchRootLinkName,
                    });
                    const symmetryScopeKey =
                      buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey(chain);
                    const symmetryVisualizationLinkNames =
                      collectRepeatedInertiaSymmetryFamilyLinkNames(chain);
                    const isSymmetryChainActive =
                      activeInertiaVisualizationScopeKey === symmetryScopeKey;
                    const isActingSymmetryChain =
                      repeatedInertiaSymmetryActingChainKey === symmetryChainKey;
                    const symmetryProgress =
                      repeatedInertiaSymmetryActingProgress?.chainKey === symmetryChainKey
                        ? repeatedInertiaSymmetryActingProgress
                        : null;
                    const symmetryOutcome = resolveRepeatedInertiaSymmetryOutcome({
                      chain,
                      outcomeByKey: repeatedInertiaSymmetryOutcomeByChainKey,
                    });
                    const completedSymmetryProgress = symmetryOutcome?.completedProgress ?? null;
                    const isSymmetryAutoAlignAvailable =
                      Boolean(chain.recommendedRepair) &&
                      chain.recommendedRepair.stepCount > 0;

                    return (
                      <div
                        key={`${chain.symmetryRootLinkName}:${chain.outlierBranchRootLinkName}`}
                        className={REPEATED_PARTS_GROUP_CLASS}
                      >
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1 font-medium text-foreground">
                              {chain.symmetryRootLinkName} {"->"} {chain.outlierBranchRootLinkName}
                            </div>
                            {onToggleInertiaVisualizationScope ? (
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className={`${VISUALIZATION_TOGGLE_BUTTON_BASE_CLASS} ${
                                  isSymmetryChainActive
                                    ? VISUALIZATION_TOGGLE_BUTTON_ACTIVE_CLASS
                                    : VISUALIZATION_TOGGLE_BUTTON_INACTIVE_CLASS
                                }`}
                                onClick={() =>
                                  onToggleInertiaVisualizationScope(
                                    symmetryScopeKey,
                                    symmetryVisualizationLinkNames,
                                    chain
                                  )
                                }
                                aria-label={`${
                                  isSymmetryChainActive ? "Hide" : "Show"
                                } symmetry guide for ${chain.outlierBranchRootLinkName}`}
                                title={`${
                                  isSymmetryChainActive ? "Hide" : "Show"
                                } symmetry guide and all branch inertia boxes in the viewer`}
                              >
                                {isSymmetryChainActive ? (
                                  <EyeOff className={VISUALIZATION_TOGGLE_ICON_CLASS} />
                                ) : (
                                  <Eye className={VISUALIZATION_TOGGLE_ICON_CLASS} />
                                )}
                              </Button>
                            ) : null}
                          </div>
                          <div className="mt-1.5">
                            <div className="mt-2 overflow-hidden rounded border border-border/30">
                              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 bg-background/20 px-2 py-1.5 text-[10px] text-muted-foreground">
                                <div className="font-medium text-foreground/85">Geometry</div>
                                <div>{formatRepeatedInertiaSymmetryType(chain)}</div>
                                <div className="font-medium text-foreground/85">Blue lines</div>
                                <div>{formatRepeatedInertiaSymmetryCenterMode(repeatedInertiaSymmetryCenterMode)}</div>
                                <div className="font-medium text-foreground/85">Repair</div>
                                <div>{formatRepeatedInertiaSymmetryRepairMode(chain.recommendedRepair)}</div>
                                <div className="font-medium text-foreground/85">Starts at</div>
                                <div>{chain.earliestDivergenceLinkName}</div>
                                <div className="font-medium text-foreground/85">Mesh support</div>
                                <div>
                                  {chain.repeatedGroupCount} repeated group
                                  {chain.repeatedGroupCount === 1 ? "" : "s"}
                                </div>
                                <div className="font-medium text-foreground/85">Topology</div>
                                <div>
                                  {chain.topologyMatchingBranchCount}/{chain.branchCount} branches match
                                </div>
                                <div className="font-medium text-foreground/85">Max spread</div>
                                <div>
                                  {formatRepeatedInertiaSymmetryDistance(
                                    chain.maxDistanceDeltaMeters
                                  )}
                                </div>
                                <div className="font-medium text-foreground/85">Meshes</div>
                                <div className="break-words">
                                  {chain.repeatedMeshLabels.join(", ")}
                                </div>
                              </div>
                            </div>
                            {onFixRepeatedInertiaSymmetryChain ? (
                              <div className="mt-2 flex items-center justify-between gap-2 rounded border border-border/30 bg-background/20 px-2 py-1.5 text-[10px] text-muted-foreground">
                                <div className="min-w-0">
                                  <div className="truncate text-foreground/85">
                                    {chain.recommendedRepair?.summary ??
                                      "No auto-align steps remain for this branch."}
                                  </div>
                                  <div className="mt-0.5 truncate">
                                    {chain.recommendedRepair
                                      ? chain.recommendedRepair.blockedTargetLinkNames.length > 0
                                        ? chain.recommendedRepair.stepCount > 0
                                        ? `Auto-fix can edit up to ${chain.recommendedRepair.stepCount} joint${
                                            chain.recommendedRepair.stepCount === 1 ? "" : "s"
                                          } in order; ${
                                            chain.recommendedRepair.blockedTargetLinkNames.length
                                          } connected target${
                                            chain.recommendedRepair.blockedTargetLinkNames.length ===
                                            1
                                              ? ""
                                              : "s"
                                          } move with those rigid edits.`
                                        : `All ${chain.recommendedRepair.targetLinkNames.length} tracked target${
                                            chain.recommendedRepair.targetLinkNames.length === 1
                                              ? ""
                                              : "s"
                                          } sit past ${
                                            chain.recommendedRepair.articulatedBoundaryJointName ??
                                            "the articulated boundary"
                                          }; auto-fix will not rewrite that articulation.`
                                      : `Auto-fix checks up to ${chain.recommendedRepair.stepCount} joint${
                                          chain.recommendedRepair.stepCount === 1 ? "" : "s"
                                        } in order.`
                                      : "This branch is already aligned closely enough that no automatic radial step remains."}
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className={`h-6 shrink-0 gap-1 px-2 text-[10px] ${SIMULATION_PREP_DISABLED_ACTION_BUTTON_CLASS}`}
                                  onClick={() => onFixRepeatedInertiaSymmetryChain(chain)}
                                  disabled={
                                    (isAnySimulationPrepFixBusy && !isActingSymmetryChain) ||
                                    isActingSymmetryChain ||
                                    !isSymmetryAutoAlignAvailable
                                  }
                                  aria-label={`Auto-align symmetry branch ${chain.outlierBranchRootLinkName}`}
                                >
                                  {isActingSymmetryChain ? (
                                    <LoaderCircle className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Wrench className="h-3 w-3" />
                                  )}
                                  <span>
                                    {formatRepeatedInertiaSymmetryAutoAlignButtonLabel({
                                      completedProgress: completedSymmetryProgress,
                                      isActing: isActingSymmetryChain,
                                      progress: symmetryProgress,
                                    })}
                                  </span>
                                </Button>
                              </div>
                            ) : null}
                            {symmetryOutcome ? (
                              <div
                                className={`mt-2 rounded border px-2 py-1.5 text-[10px] ${
                                  symmetryOutcome.tone === "success"
                                    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                                    : "border-amber-400/30 bg-amber-500/10 text-amber-100"
                                }`}
                              >
                                {symmetryOutcome.message}
                              </div>
                            ) : null}
                            <div className="mt-2 overflow-hidden rounded border border-border/30">
                              <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1.1fr)_auto_auto_auto_auto] gap-x-3 bg-background/40 px-2 py-1 text-[10px] font-medium text-foreground/85">
                                <div>Branch</div>
                                <div>Chain</div>
                                <div>Radius</div>
                                <div>Angle</div>
                                <div>Offset</div>
                                <div>Status</div>
                              </div>
                              {chain.branchRows.map((row) => {
                                const branchLinkGroup = chain.branchLinkGroups.find(
                                  (candidate) =>
                                    candidate.branchRootLinkName === row.branchRootLinkName
                                );

                                return (
                                  <div
                                    key={`${chain.symmetryRootLinkName}:${row.branchRootLinkName}`}
                                    className={`border-t border-border/20 px-2 py-1 text-[10px] ${resolveRepeatedInertiaSymmetryRowToneClass(
                                      row
                                    )}`}
                                  >
                                    <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1.1fr)_auto_auto_auto_auto] gap-x-3">
                                      <div className="truncate">{row.representativeLinkName}</div>
                                      <div
                                        className="truncate"
                                        title={
                                          branchLinkGroup
                                            ? formatRepeatedInertiaSymmetryBranchLinks(branchLinkGroup)
                                            : row.representativeLinkName
                                        }
                                      >
                                        {branchLinkGroup
                                          ? formatRepeatedInertiaSymmetryBranchSummary(branchLinkGroup)
                                          : row.representativeLinkName}
                                      </div>
                                      <div>{formatRepeatedInertiaSymmetryRadiusComparison(row)}</div>
                                      <div>
                                        {formatRepeatedInertiaSymmetryAngleComparison(row)}
                                        {row.angularErrorDegrees !== null
                                          ? ` (${formatRepeatedInertiaSymmetryAngle(row.angularErrorDegrees)} err)`
                                          : ""}
                                      </div>
                                      <div>
                                        {formatRepeatedInertiaSymmetryOffsetSummary(row)}
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <span
                                          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.04em] ${resolveRepeatedInertiaSymmetryStatusBadgeClass(
                                            row
                                          )}`}
                                        >
                                          {formatRepeatedInertiaSymmetryStatus(row)}
                                        </span>
                                        {!row.topologyMatchesFamily ? (
                                          <span className="inline-flex items-center rounded-full border border-border/30 bg-background/30 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
                                            Topology
                                          </span>
                                        ) : null}
                                      </div>
                                    </div>
                                    <div className="mt-1 truncate text-[9px] text-muted-foreground/90">
                                      Offsets: {formatRepeatedInertiaSymmetryLinkOffsets(row)}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ))}
              </div>
                </>
              ) : null}
            </div>
          ) : null}
              </div>
            </div>
          ) : null}
          <div data-section="preparation" className={CHECKLIST_CARD_CLASS}>
            <div className="font-semibold text-foreground">Preparation</div>
            <div className="mt-2 space-y-1 text-[11px]">
              {physicsPreflightLoading ? (
                <div className={`flex items-center gap-2 rounded border px-2 py-1 ${SUBTLE_STATUS_TONE_CLASS[statusTone]}`}>
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  <span>Physics check running...</span>
                </div>
              ) : null}
              {overviewRows.length > 0 ? (
                overviewRows.map((row) => (
                  <div
                    key={row.label}
                    className={
                      row.emphasis === "result"
                        ? `rounded border px-2 py-1 ${SUBTLE_STATUS_TONE_CLASS[statusTone]}`
                        : undefined
                    }
                  >
                    <span
                      className={
                        row.emphasis === "result"
                          ? `font-medium ${SUBTLE_STATUS_LABEL_CLASS[statusTone]}`
                          : "font-medium text-foreground"
                      }
                    >
                      {row.label}:
                    </span>{" "}
                    {row.value}
                  </div>
                ))
              ) : (
                <div>Status unavailable.</div>
              )}
              {overviewExtraNotes.map((note) => (
                <div key={note} className={`rounded border px-2 py-1 ${SUBTLE_STATUS_TONE_CLASS[statusTone]}`}>
                  {note}
                </div>
              ))}
              {physicsPlausibilitySummary &&
              physicsAuditSummary &&
              physicsPlausibilitySummary.comparableLinkCount < physicsAuditSummary.presentLinkCount ? (
                <div className={DIAGNOSIS_CARD_CLASS}>
                  <div className="font-medium text-amber-200">
                    {buildGeometryDiagnosisHeadline({
                      excludedCount: physicsPlausibilitySummary.excludedLinks.length,
                      attentionCount: countGeometryDiagnosisAttentionLinks(
                        physicsPlausibilitySummary.excludedLinks
                      ),
                    })}
                  </div>
                  {physicsPlausibilitySummary.excludedLinks.length > 0 ? (
                    <div className="space-y-1.5">
                      {buildGeometryDiagnosisNote({ sanitizationSummary }) ? (
                        <div className="text-[10px] text-muted-foreground">
                          {buildGeometryDiagnosisNote({ sanitizationSummary })}
                        </div>
                      ) : null}
                      <div className="text-[10px]">
                        <span className="font-medium text-foreground">Why</span>
                        <span className="ml-2 text-muted-foreground">{exclusionReasonSummary.join(" | ")}</span>
                      </div>
                      {voxelRecoveryAction || regularizeAction ? (
                        <div className="space-y-1.5">
                          {voxelRecoveryAction ? (
                            <PhysicsQuickActionCard
                              action={voxelRecoveryAction}
                              status={voxelRecoveryStatus}
                              isArmed={armedPhysicsActionKey === voxelRecoveryAction.key}
                              selectedMaterial={selectedPhysicsMaterials[voxelRecoveryAction.key] ?? null}
                              disabled={isAnySimulationPrepFixBusy}
                              onRun={(action, disabled) =>
                                handleRunPhysicsAction({
                                  action,
                                  disabled,
                                })
                              }
                              onSelect={handleSelectPhysicsMaterial}
                            />
                          ) : null}
                          {regularizeAction ? (
                            <PhysicsQuickActionCard
                              action={regularizeAction}
                              status={regularizeStatus}
                              isArmed={armedPhysicsActionKey === regularizeAction.key}
                              selectedMaterial={selectedPhysicsMaterials[regularizeAction.key] ?? null}
                              disabled={isAnySimulationPrepFixBusy}
                              onRun={(action, disabled) =>
                                handleRunPhysicsAction({
                                  action,
                                  disabled,
                                })
                              }
                              onSelect={handleSelectPhysicsMaterial}
                            />
                          ) : null}
                        </div>
                      ) : null}
                      <div className="space-y-1.5" aria-label="Diagnosis details list">
                        {excludedLinkGroups.map((group) => {
                          const preparationVisualizationScope = getPreparationVisualizationScope(group);
                          const isPreparationScopeActive =
                            preparationVisualizationScope?.scopeKey === activeInertiaVisualizationScopeKey;

                          return (
                            <div key={group.key} className={DIAGNOSIS_GROUP_CLASS}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 font-medium text-foreground">{group.summary}</div>
                                <div className="flex items-center gap-1">
                                  {preparationVisualizationScope && onToggleInertiaVisualizationScope ? (
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      className={`${VISUALIZATION_TOGGLE_BUTTON_BASE_CLASS} ${
                                        isPreparationScopeActive
                                          ? VISUALIZATION_TOGGLE_BUTTON_ACTIVE_CLASS
                                          : VISUALIZATION_TOGGLE_BUTTON_INACTIVE_CLASS
                                      }`}
                                      onClick={() =>
                                        onToggleInertiaVisualizationScope(
                                          preparationVisualizationScope.scopeKey,
                                          preparationVisualizationScope.linkNames
                                        )
                                      }
                                      aria-label={`${
                                        isPreparationScopeActive ? "Hide" : "Show"
                                      } ${preparationVisualizationScope.label} inertia boxes`}
                                      title={`${
                                        isPreparationScopeActive ? "Hide" : "Show"
                                      } ${preparationVisualizationScope.label} inertia boxes in the viewer`}
                                    >
                                      {isPreparationScopeActive ? (
                                        <EyeOff className={VISUALIZATION_TOGGLE_ICON_CLASS} />
                                      ) : (
                                        <Eye className={VISUALIZATION_TOGGLE_ICON_CLASS} />
                                      )}
                                    </Button>
                                  ) : null}
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 shrink-0 px-1.5 text-[10px] font-normal text-muted-foreground hover:text-foreground"
                                    aria-expanded={expandedDiagnosisGroups[group.key] === true}
                                    aria-controls={`diagnosis-links-${group.key}`}
                                    aria-label={`${expandedDiagnosisGroups[group.key] ? "Hide" : "Show"} ${group.linkEntries.length} ${group.label.toLowerCase()} link${group.linkEntries.length === 1 ? "" : "s"}`}
                                    onClick={() => toggleDiagnosisGroup(group.key)}
                                  >
                                    {expandedDiagnosisGroups[group.key] ? (
                                      <ChevronDown className="mr-1 h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronRight className="mr-1 h-3.5 w-3.5" />
                                    )}
                                    {expandedDiagnosisGroups[group.key] ? "Hide" : "Show"} {group.linkEntries.length}
                                  </Button>
                                </div>
                              </div>
                              {expandedDiagnosisGroups[group.key] ? (
                                <div
                                  id={`diagnosis-links-${group.key}`}
                                  className="mt-1 space-y-0.5 border-t border-border/30 pt-1 text-[10px] text-muted-foreground"
                                >
                                  {group.linkEntries.map((entry) => (
                                    <div key={`${group.key}-${entry.linkName}`} className="truncate">
                                      {entry.linkName}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {group.guidance ? (
                                <div className="mt-1 text-[10px] text-muted-foreground">{group.guidance}</div>
                              ) : null}
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            {physicsPlausibilitySummary?.excludedLinks.length ? null : showInlinePhysicsActions ? (
              <div className={PHYSICS_SECTION_CARD_CLASS}>
                <div className="space-y-1.5">
                  {physicsPanelActions.map((action) => {
                    const actionStatus = getPhysicsActionStatus(physicsActionStatusByKey, action.key);
                    const isArmed = armedPhysicsActionKey === action.key;
                    const selectedMaterial = selectedPhysicsMaterials[action.key] ?? null;
                    const actionDisabled =
                      !action.available ||
                      actionStatus !== "idle" ||
                      hasPendingPhysicsAction ||
                      isAnySimulationPrepFixBusy;
                    return (
                      <div
                        key={`button-${action.key}`}
                        className="rounded border border-border/60 bg-background/40 p-2 text-[11px]"
                        aria-busy={actionStatus === "running"}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-foreground">{action.title}</div>
                            <div className="mt-0.5 text-muted-foreground">{action.description}</div>
                          </div>
                          {actionStatus === "running" ? (
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              <span>{PHYSICS_ACTION_STATUS_LABELS[action.key].running}</span>
                            </div>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 border-border/50 bg-transparent px-2.5 text-[10px] font-normal text-muted-foreground hover:text-foreground"
                            disabled={actionDisabled}
                            aria-label={action.title}
                            onClick={() => {
                              handleRunPhysicsAction({
                                action,
                                disabled: actionDisabled,
                              });
                            }}
                          >
                            {getPhysicsActionButtonLabel({
                              action,
                              status: actionStatus,
                              isArmed,
                              hasSelectedMaterial: selectedMaterial !== null,
                            })}
                          </Button>
                        </div>
                        {action.available && isArmed ? (
                          <div className="mt-2 space-y-1.5 border-t border-border/50 pt-2">
                            <div className="text-[10px] text-muted-foreground">Choose a material to continue.</div>
                            <PhysicsMaterialPicker
                              actionKey={action.key}
                              selectedMaterial={selectedMaterial}
                              disabled={actionDisabled}
                              onSelect={handleSelectPhysicsMaterial}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {physicsDeltaSummary ? (
                    <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-[11px] text-foreground">
                      <div className="font-semibold">Last Draft Delta</div>
                      <div className="mt-1 text-muted-foreground">
                        {physicsDeltaSummary.changedLinkCount} links changed • total mass {physicsDeltaSummary.totalMassBeforeKg.toFixed(3)} →{" "}
                        {physicsDeltaSummary.totalMassAfterKg.toFixed(3)} kg ({physicsDeltaSummary.totalMassDeltaKg >= 0 ? "+" : ""}
                        {physicsDeltaSummary.totalMassDeltaKg.toFixed(3)} kg)
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                {showPhysicsActionButton ? (
                  <Button
                    size="sm"
                    className="h-8 w-full justify-start gap-2 px-2 text-xs"
                    onClick={openPhysicsPanel}
                    disabled={
                      physicsAction.disabled ||
                      isAnySimulationPrepFixBusy ||
                      (!onOpenGeneratePhysicsDialog &&
                        !onGeneratePhysics &&
                        !onGenerateVoxelPhysics &&
                        !onGenerateRegularizedPhysics)
                    }
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {physicsActionLabel}
                  </Button>
                ) : physicsPreflightLoading ? null : (
                  <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-foreground">
                    Physics check complete. No repair action is needed.
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground">{physicsAction.summary}</div>
                {showPhysicsActionButton && showPhysicsPanel ? (
                  <div className={PHYSICS_SECTION_CARD_CLASS}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-foreground">{physicsActionLabel}</div>
                        <div className="text-[11px] text-muted-foreground">{generatePhysicsDialogDescription}</div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0"
                        onClick={() => {
                          setShowPhysicsPanel(false);
                        }}
                        aria-label="Close physics panel"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {physicsPreflightLoading && !physicsAuditSummary ? (
                      <div className="mt-3 rounded border border-border/60 bg-muted/10 p-2 text-[11px] text-muted-foreground">
                        Loading backend physics audit...
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
            {recommendedAction ? (
              <div className="space-y-2 border-t border-border/60 pt-2">
                <div className="text-xs font-semibold text-foreground">Frame / Export</div>
                <Button
                  size="sm"
                  variant={recommendedAction.variant ?? "outline"}
                  className="h-8 w-full justify-start gap-2 px-2 text-xs"
                  onClick={recommendedAction.onClick}
                  disabled={recommendedAction.disabled || isAnySimulationPrepFixBusy}
                >
                  <recommendedAction.icon className="h-3.5 w-3.5" />
                  {recommendedAction.label}
                </Button>
                <div className="text-[11px] text-muted-foreground">{recommendedAction.summary}</div>
              </div>
            ) : null}
            {physicsDraftSummary ? (
              <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-[11px] text-foreground">
                <div className="font-medium">Physics Draft Ready</div>
                <div className="mt-1 text-muted-foreground">{physicsDraftSummary}</div>
                {physicsVoxelFallbackLinkNames.length > 0 ? (
                  <div className="mt-2 text-muted-foreground">
                    Voxel-derived links: {physicsVoxelFallbackLinkNames.length}
                  </div>
                ) : null}
                {physicsRepeatedMeshCanonicalizationSummaries.length > 0 ? (
                  <div className="mt-2">
                    <button
                      type="button"
                      className="flex items-center gap-1 text-left text-muted-foreground hover:text-foreground"
                      onClick={() => setShowUnifiedRepeatedMeshes((current) => !current)}
                      aria-label={`${
                        showUnifiedRepeatedMeshes ? "Hide" : "Show"
                      } unified repeated meshes`}
                    >
                      {showUnifiedRepeatedMeshes ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      <span>
                        Unified repeated meshes: {physicsRepeatedMeshCanonicalizationSummaries.length}
                      </span>
                    </button>
                    {showUnifiedRepeatedMeshes ? (
                      <div className="mt-1 space-y-1 pl-5 text-muted-foreground">
                        {physicsRepeatedMeshCanonicalizationSummaries.map((summary) => {
                          const scopeKey = buildRepeatedInertiaVisualizationScopeKey(summary.groupKey);
                          const isActive = activeInertiaVisualizationScopeKey === scopeKey;

                          return onToggleInertiaVisualizationScope ? (
                            <button
                              key={summary.groupKey}
                              type="button"
                              className={`block text-left ${
                                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                              }`}
                              onClick={() =>
                                onToggleInertiaVisualizationScope(scopeKey, summary.linkNames)
                              }
                              aria-label={`${
                                isActive ? "Hide" : "Show"
                              } unified repeated mesh inertia boxes for ${summary.meshReference}`}
                            >
                              {summary.meshReference}
                            </button>
                          ) : (
                            <div key={summary.groupKey}>{summary.meshReference}</div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {onClearPhysicsDraft ? (
                  <div className="mt-2">
                    <Button size="sm" variant="outline" onClick={onClearPhysicsDraft}>
                      Clear Physics Draft
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {hasAdvancedContent ? (
            <div className="rounded-md border border-border/70 bg-muted/10">
              <button
                type="button"
                className="flex w-full items-center justify-between p-2 text-left"
                onClick={() => setAdvancedOpen((current) => !current)}
              >
                <div className="text-xs font-semibold text-foreground">{ADVANCED_EXPORT_SECTION_LABEL}</div>
                {advancedOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              {advancedOpen ? (
                <div className="space-y-3 border-t border-border/60 p-2">
                  {stagedEntryCount > 0 ? (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-foreground">
                      <div className="font-medium">Baked Export Ready</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {stagedEntryCount} entr{stagedEntryCount === 1 ? "y" : "ies"} • {stagedMeshBackedEntryCount} mesh-backed
                      </div>
                      {stagedLinkNames.length > 0 ? (
                        <div className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
                          {stagedLinkNames.length} link{stagedLinkNames.length === 1 ? "" : "s"}: {stagedLinkNames.join(", ")}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {synthesisRootLinkName ? (
                    <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-2 text-xs text-foreground">
                      <div className="font-medium">Clean Export Draft Ready</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {synthesisRobotName || "robot"} • root {synthesisRootLinkName} • {synthesisLinkCount} link{synthesisLinkCount === 1 ? "" : "s"}
                      </div>
                      {synthesisInferredUpLabel ? (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {synthesisInferredUpLabel} {"->"} Z-up
                        </div>
                      ) : null}
                      {synthesisConfidence !== null ? (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Confidence: {synthesisConfidence.toFixed(2)}
                        </div>
                      ) : null}
                      {synthesisSupportEvidence ? (
                        <div className="mt-1 text-[11px] text-muted-foreground line-clamp-3">
                          {synthesisSupportEvidence}
                        </div>
                      ) : null}
                      {synthesisFallbackReason ? (
                        <div className="mt-1 text-[11px] text-amber-200 line-clamp-2">
                          Fallback: {synthesisFallbackReason}
                        </div>
                      ) : null}
                      {synthesisSampleJoints.length > 0 ? (
                        <div className="mt-1 space-y-1 text-[11px] text-muted-foreground">
                          {synthesisSampleJoints.map((joint) => (
                            <div key={joint.jointName} className="line-clamp-2">
                              {joint.jointName}: {joint.parentLinkName} {"->"} {joint.childLinkName} | xyz{" "}
                              {joint.xyz.join(", ")} | rpy {joint.rpy.join(", ")}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    {advancedPrimaryActionLabel && onRunAdvancedPrimaryAction ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={onRunAdvancedPrimaryAction}
                        disabled={isAnySimulationPrepFixBusy}
                      >
                        {advancedPrimaryActionLabel}
                      </Button>
                    ) : null}
                    {advancedSecondaryActionLabel && onRunAdvancedSecondaryAction ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={onRunAdvancedSecondaryAction}
                        disabled={isAnySimulationPrepFixBusy}
                      >
                        {advancedSecondaryActionLabel}
                      </Button>
                    ) : null}
                    {stagedEntryCount > 0 && onClearStagedAction ? (
                      <Button size="sm" variant="outline" onClick={onClearStagedAction}>
                        Clear Bake Draft
                      </Button>
                    ) : null}
                    {synthesisRootLinkName && onClearSynthesisPreview ? (
                      <Button size="sm" variant="outline" onClick={onClearSynthesisPreview}>
                        Clear Canonical Draft
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

    </>
    </TooltipProvider>
  );
};
