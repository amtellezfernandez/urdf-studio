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
  buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey,
  collectRepeatedInertiaSymmetryFamilyLinkNames,
} from "@/features/layout/page/simulationPrepViewerState";
import { hasSimulationPrepPhysicsActionPending } from "@/features/layout/page/simulationPrepState";
import type { InertialDensityPresetId } from "@/features/urdf/inertia/inertialSynthesisParams";
import type { RobotMirrorSelectionLink } from "@/features/layout/page/robotMirrorSymmetrySelection";
import { resolveRobotMirrorSimulationPrepViewState } from "@/features/layout/page/robotMirrorSimulationPrepViewState";
import { REPEATED_INERTIA_SYMMETRY_CENTER_MODE_OPTIONS } from "@/features/layout/page/repeatedInertiaSymmetryCenterMode";
import { cn } from "@/shared/lib/utils";
import {
  INERTIA_METRIC_PROBLEMATIC_THRESHOLD,
  INERTIA_METRIC_WARNING_THRESHOLD,
} from "@/features/viewer/inertialVisualizationParams";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { HEALTH_ACTION_PANEL_PARAMS } from "@/features/layout/page/healthActionPanelParams";
import { HealthActionPanelHeader } from "@/features/layout/page/HealthActionPanelHeader";
import type {
  HealthActionPanelProps,
  SimStatusTone,
} from "@/features/layout/page/healthActionPanelTypes";
import {
  buildGeneratePhysicsDialogDescription,
  buildOverviewExtraNotes,
  buildOverviewLabelValueRows,
  buildPanelSubtitle,
  buildPhysicsActionLabel,
  buildPhysicsActionSummary,
} from "@/features/layout/page/healthActionPanelOverview";
import {
  buildGeometryDiagnosisViewState,
  formatDiagnosticNumber,
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
import {
  buildCompatibilityRobotMirrorSelectionState,
  buildRepeatedInertiaSymmetryChainViewState,
  buildRobotMirrorSelectionMeshGroupViewStates,
  buildRobotMirrorSelectionStats,
  formatMirrorSelectionLinkCount,
  formatRepeatedInertiaSymmetryAutoAlignButtonLabel,
  formatRepeatedInertiaSymmetryCenterMode,
  formatRepeatedInertiaSymmetryDistance,
  formatRepeatedInertiaSymmetryHeadline,
  formatRepeatedInertiaSymmetryRepairMode,
  formatRepeatedInertiaSymmetryType,
  formatRobotMirrorPlaneLabel,
  MIRROR_SELECTION_RADIAL_BADGE_CLASS,
  shouldIgnoreVisualizationCardClick,
} from "@/features/layout/page/healthActionPanelSymmetry";

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
  const geometryDiagnosis = buildGeometryDiagnosisViewState({
    activeInertiaVisualizationScopeKey,
    excludedLinks,
  });
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
  const robotMirrorSelectionStats = buildRobotMirrorSelectionStats({
    selectedLinkNames: effectiveSelectedRobotMirrorLinkNames,
    selectionLinks: displayRobotMirrorSelectionLinks,
  });
  const robotMirrorSelectionMeshGroups = buildRobotMirrorSelectionMeshGroupViewStates({
    linkResults: robotMirrorOutcome?.linkResults ?? [],
    selectedLinkNames: effectiveSelectedRobotMirrorLinkNames,
    selectionLinks: displayRobotMirrorSelectionLinks,
  });
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
  const repeatedInertiaSymmetryChainViewStates = repeatedInertiaSymmetryChains.map((chain) =>
    buildRepeatedInertiaSymmetryChainViewState({
      activeInertiaVisualizationScopeKey,
      chain,
      outcomeByKey: repeatedInertiaSymmetryOutcomeByChainKey,
      repeatedInertiaSymmetryActingChainKey,
      repeatedInertiaSymmetryActingProgress,
    })
  );
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
                    {robotMirrorSelectionMeshGroups.length} mesh group
                    {robotMirrorSelectionMeshGroups.length === 1 ? "" : "s"}
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
                        {robotMirrorSelectionStats.selectedMeshCount} mesh
                        {robotMirrorSelectionStats.selectedMeshCount === 1 ? "" : "es"} •{" "}
                        {robotMirrorSelectionStats.selectedLinkCount} link
                        {robotMirrorSelectionStats.selectedLinkCount === 1 ? "" : "s"}
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
                      {robotMirrorSelectionMeshGroups.length > 0 ? (
                        <div className="space-y-1">
                          {robotMirrorSelectionMeshGroups.map(
                            ({ meshLabel, radialExcludedCount, selectionLinkRows }) => {
                              return (
                                <div key={meshLabel} className="rounded border border-border/15 bg-background/10">
                                  <div className="flex items-center justify-between gap-2 px-1.5 py-1 text-[9px] leading-tight">
                                    <div className="min-w-0 font-medium text-foreground/85">
                                      <span className="truncate">{meshLabel}</span>
                                      <span className="ml-1 text-muted-foreground">
                                        {formatMirrorSelectionLinkCount(
                                          selectionLinkRows[0]?.selectionLink.groupLinkCount ?? 0
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
                                    {selectionLinkRows.map((rowState) => {
                                      const {
                                        counterpartLinkName,
                                        isSelected,
                                        linkName,
                                        resultMetrics,
                                        resultReason,
                                        resultSummary,
                                        selectionLink,
                                        statusBadge,
                                      } = rowState;
                                      return (
                                        <label
                                          key={rowState.key}
                                          className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] leading-tight"
                                        >
                                          <Checkbox
                                            checked={isSelected}
                                            onCheckedChange={() =>
                                              handleToggleRobotMirrorSelection(selectionLink)
                                            }
                                            aria-label={`${
                                              isSelected ? "Deselect" : "Select"
                                            } mirror link ${linkName}`}
                                            className="mt-0"
                                          />
                                          <span className="min-w-0 flex-1">
                                            <span className="flex min-w-0 items-center gap-1 overflow-hidden">
                                              <span className="truncate font-medium text-foreground/85">
                                                {linkName}
                                              </span>
                                              {statusBadge ? (
                                                <span className={statusBadge.className}>
                                                  <statusBadge.icon className="h-2.5 w-2.5" />
                                                  <span>{statusBadge.label}</span>
                                                </span>
                                              ) : null}
                                              {counterpartLinkName ? (
                                                <span className="truncate text-muted-foreground">
                                                  peer {counterpartLinkName}
                                                </span>
                                              ) : null}
                                            </span>
                                            {resultSummary && resultMetrics ? (
                                              <span className="mt-0.5 block truncate text-[8px] text-muted-foreground">
                                                {resultSummary} • {resultMetrics}
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
                {repeatedInertiaSymmetryChainViewStates.map((chainState) => {
                  const { chain } = chainState;
                  return (
                    <div
                      key={`radial-summary:${chainState.chainKey}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded border border-border/20 bg-background/10 px-2 py-1 text-[9px]"
                      onMouseEnter={() =>
                        onPreviewInertiaVisualizationScope?.(
                          chainState.scopeKey,
                          chainState.visualizationLinkNames,
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
                              chainState.isVisualizationActive
                                ? VISUALIZATION_TOGGLE_BUTTON_ACTIVE_CLASS
                                : VISUALIZATION_TOGGLE_BUTTON_INACTIVE_CLASS
                            }`}
                            onClick={() =>
                              onToggleInertiaVisualizationScope(
                                chainState.scopeKey,
                                chainState.visualizationLinkNames,
                                chain
                              )
                            }
                            aria-label={`${
                              chainState.isVisualizationActive ? "Hide" : "Show"
                            } symmetry guide for ${chain.outlierBranchRootLinkName}`}
                            title={`${
                              chainState.isVisualizationActive ? "Hide" : "Show"
                            } symmetry guide and all branch inertia boxes in the viewer`}
                          >
                            {chainState.isVisualizationActive ? (
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
                              (isAnySimulationPrepFixBusy && !chainState.isActing) ||
                              chainState.isActing ||
                              !chainState.isAutoAlignAvailable
                            }
                            aria-label={`Auto-align symmetry branch ${chain.outlierBranchRootLinkName}`}
                          >
                            {chainState.isActing ? (
                              <LoaderCircle className="h-3 w-3 animate-spin" />
                            ) : (
                              <Wrench className="h-3 w-3" />
                            )}
                            <span>
                              {formatRepeatedInertiaSymmetryAutoAlignButtonLabel({
                                completedProgress: chainState.completedProgress,
                                isActing: chainState.isActing,
                                progress: chainState.progress,
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
                {repeatedInertiaSymmetryChainViewStates.map((chainState) => {
                  const { chain } = chainState;
                  return (
                      <div
                        key={chainState.chainKey}
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
                                  chainState.isVisualizationActive
                                    ? VISUALIZATION_TOGGLE_BUTTON_ACTIVE_CLASS
                                    : VISUALIZATION_TOGGLE_BUTTON_INACTIVE_CLASS
                                }`}
                                onClick={() =>
                                  onToggleInertiaVisualizationScope(
                                    chainState.scopeKey,
                                    chainState.visualizationLinkNames,
                                    chain
                                  )
                                }
                                aria-label={`${
                                  chainState.isVisualizationActive ? "Hide" : "Show"
                                } symmetry guide for ${chain.outlierBranchRootLinkName}`}
                                title={`${
                                  chainState.isVisualizationActive ? "Hide" : "Show"
                                } symmetry guide and all branch inertia boxes in the viewer`}
                              >
                                {chainState.isVisualizationActive ? (
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
                                    {chainState.repairText.summary}
                                  </div>
                                  <div className="mt-0.5 truncate">
                                    {chainState.repairText.detail}
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className={`h-6 shrink-0 gap-1 px-2 text-[10px] ${SIMULATION_PREP_DISABLED_ACTION_BUTTON_CLASS}`}
                                  onClick={() => onFixRepeatedInertiaSymmetryChain(chain)}
                                  disabled={
                                    (isAnySimulationPrepFixBusy && !chainState.isActing) ||
                                    chainState.isActing ||
                                    !chainState.isAutoAlignAvailable
                                  }
                                  aria-label={`Auto-align symmetry branch ${chain.outlierBranchRootLinkName}`}
                                >
                                  {chainState.isActing ? (
                                    <LoaderCircle className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Wrench className="h-3 w-3" />
                                  )}
                                  <span>
                                    {formatRepeatedInertiaSymmetryAutoAlignButtonLabel({
                                      completedProgress: chainState.completedProgress,
                                      isActing: chainState.isActing,
                                      progress: chainState.progress,
                                    })}
                                  </span>
                                </Button>
                              </div>
                            ) : null}
                            {chainState.outcome ? (
                              <div
                                className={`mt-2 rounded border px-2 py-1.5 text-[10px] ${
                                  chainState.outcome.tone === "success"
                                    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                                    : "border-amber-400/30 bg-amber-500/10 text-amber-100"
                                }`}
                              >
                                {chainState.outcome.message}
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
                              {chainState.branchRows.map((rowState) => {
                                return (
                                  <div
                                    key={rowState.key}
                                    className={`border-t border-border/20 px-2 py-1 text-[10px] ${rowState.rowToneClass}`}
                                  >
                                    <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1.1fr)_auto_auto_auto_auto] gap-x-3">
                                      <div className="truncate">{rowState.representativeLinkName}</div>
                                      <div
                                        className="truncate"
                                        title={rowState.branchTitle}
                                      >
                                        {rowState.branchSummary}
                                      </div>
                                      <div>{rowState.radiusText}</div>
                                      <div>{rowState.angleText}</div>
                                      <div>{rowState.offsetText}</div>
                                      <div className="flex items-center gap-1">
                                        <span
                                          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.04em] ${rowState.statusBadgeClass}`}
                                        >
                                          {rowState.statusText}
                                        </span>
                                        {rowState.showTopologyBadge ? (
                                          <span className="inline-flex items-center rounded-full border border-border/30 bg-background/30 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
                                            Topology
                                          </span>
                                        ) : null}
                                      </div>
                                    </div>
                                    <div className="mt-1 truncate text-[9px] text-muted-foreground/90">
                                      Offsets: {rowState.offsetsText}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                })}
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
                    {geometryDiagnosis.headline}
                  </div>
                  {geometryDiagnosis.hasExcludedLinks ? (
                    <div className="space-y-1.5">
                      {geometryDiagnosis.note ? (
                        <div className="text-[10px] text-muted-foreground">
                          {geometryDiagnosis.note}
                        </div>
                      ) : null}
                      <div className="text-[10px]">
                        <span className="font-medium text-foreground">Why</span>
                        <span className="ml-2 text-muted-foreground">
                          {geometryDiagnosis.reasonSummaryText}
                        </span>
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
                        {geometryDiagnosis.groups.map((group) => {
                          return (
                            <div key={group.key} className={DIAGNOSIS_GROUP_CLASS}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 font-medium text-foreground">{group.summary}</div>
                                <div className="flex items-center gap-1">
                                  {group.preparationVisualizationScope && onToggleInertiaVisualizationScope ? (
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      className={`${VISUALIZATION_TOGGLE_BUTTON_BASE_CLASS} ${
                                        group.isPreparationScopeActive
                                          ? VISUALIZATION_TOGGLE_BUTTON_ACTIVE_CLASS
                                          : VISUALIZATION_TOGGLE_BUTTON_INACTIVE_CLASS
                                      }`}
                                      onClick={() =>
                                        onToggleInertiaVisualizationScope(
                                          group.preparationVisualizationScope.scopeKey,
                                          group.preparationVisualizationScope.linkNames
                                        )
                                      }
                                      aria-label={`${
                                        group.isPreparationScopeActive ? "Hide" : "Show"
                                      } ${group.preparationVisualizationScope.label} inertia boxes`}
                                      title={`${
                                        group.isPreparationScopeActive ? "Hide" : "Show"
                                      } ${group.preparationVisualizationScope.label} inertia boxes in the viewer`}
                                    >
                                      {group.isPreparationScopeActive ? (
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
