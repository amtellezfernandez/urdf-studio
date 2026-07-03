import type {
  SimulationPrepPhysicsActionKey,
  SimulationPrepPhysicsActionStatus,
} from "@/features/layout/page/simulationPrepState";
import type { RepeatedInertiaDiagnosticGroup } from "@/features/layout/page/repeatedInertiaDiagnostics";
import type { RepeatedInertiaSymmetryChain } from "@/features/layout/page/repeatedInertiaSymmetry";
import type { RepeatedInertiaSymmetryCenterMode } from "@/features/layout/page/repeatedInertiaSymmetryCenterMode";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import type {
  RobotMirrorFixMode,
  RobotMirrorOutcome,
} from "@/features/layout/page/robotMirrorSymmetryFix";
import type { RobotMirrorSelectionLink } from "@/features/layout/page/robotMirrorSymmetrySelection";
import type { InertialRepairMode } from "@/features/urdf/inertia/inertialSynthesis";
import type { InertialDiagnosticBucket } from "@/features/urdf/inertia/inertialDiagnostics";
import type { InertialDensityPresetId } from "@/features/urdf/inertia/inertialSynthesisParams";

export type SimStatusTone = "safe" | "warning" | "danger";

export type MeshSanitizationSummary = {
  status: "unchanged" | "sanitized" | "excessive-deletion";
  massSignificance: "not-applicable" | "negligible" | "significant";
  originalVertexCount: number;
  finalVertexCount: number;
  originalTriangleCount: number;
  finalTriangleCount: number;
  totalComponents: number;
  removedComponents: number;
  volumeRetainedRatio: number;
  deletionSafetyReport: {
    status: "safe" | "manual-review" | "not-applicable";
    isSafeToDelete: boolean;
    metrics: {
      comShiftMeters: number;
      normalizedComShiftRatio: number;
      massLossRatio: number;
      inertiaTraceChangeRatio: number;
      physicsImpactRatio: number;
      maxAllowedComShiftMeters: number;
      characteristicLengthMeters: number;
    };
    reasons: string[];
  };
};

export type CompatibilityRobotMirrorSelectionGroup = {
  groupKey: string;
  linkNames?: readonly string[];
  meshLabel?: string | null;
};

export type HealthActionPanelProps = {
  open: boolean;
  onClose?: () => void;
  statusTone?: SimStatusTone;
  statusLabel?: string | null;
  statusSummary?: string | null;
  frameIssueSummary?: string | null;
  physicsIssueSummary?: string | null;
  physicsDraftSummary?: string | null;
  physicsVoxelFallbackLinkNames?: string[];
  physicsRepeatedMeshCanonicalizationSummaries?: Array<{
    groupKey: string;
    meshReference: string;
    linkNames: string[];
  }>;
  robotMirrorSelectionGroups?: readonly CompatibilityRobotMirrorSelectionGroup[];
  selectedRobotMirrorGroupKeys?: readonly string[];
  robotMirrorSelectionLinks?: readonly RobotMirrorSelectionLink[];
  selectedRobotMirrorLinkNames?: readonly string[];
  robotMirrorPlaneTouchingLinkNames?: readonly string[];
  robotMirrorVisualizationLinkNames?: readonly string[];
  robotMirrorSymmetryCheck?: RobotMirrorSymmetryCheck | null;
  robotMirrorOutcome?: RobotMirrorOutcome | null;
  repeatedInertiaSymmetryChains?: RepeatedInertiaSymmetryChain[];
  repeatedInertiaSymmetryCenterMode?: RepeatedInertiaSymmetryCenterMode;
  repeatedInertiaDiagnostics?: RepeatedInertiaDiagnosticGroup[];
  repeatedInertiaSymmetryOutcomeByChainKey?: Record<
    string,
    {
      completedProgress?: {
        appliedStepCount: number;
        totalStepCount: number;
      } | null;
      tone: "success" | "warning";
      message: string;
    }
  >;
  repeatedInertiaOutcomeByGroupKey?: Record<
    string,
    {
      tone: "resolved" | "warning" | "success";
      message: string;
    }
  >;
  repeatedInertiaResolvedGroupKeys?: string[];
  repeatedInertiaActingGroupKey?: string | null;
  repeatedInertiaSymmetryActingChainKey?: string | null;
  repeatedInertiaSymmetryActingProgress?: {
    chainKey: string;
    appliedStepCount: number;
    totalStepCount: number;
  } | null;
  onFixRepeatedInertiaGroup?: (groupKey: string) => void;
  onFixRepeatedInertiaSymmetryChain?: (chain: RepeatedInertiaSymmetryChain) => void;
  onRepeatedInertiaSymmetryCenterModeChange?: (
    centerMode: RepeatedInertiaSymmetryCenterMode
  ) => void;
  activeInertiaVisualizationScopeKey?: string | null;
  onToggleInertiaVisualizationScope?: (
    scopeKey: string,
    linkNames: readonly string[],
    symmetryChain?: RepeatedInertiaSymmetryChain | null
  ) => void;
  onPreviewInertiaVisualizationScope?: (
    scopeKey: string,
    linkNames: readonly string[],
    symmetryChain?: RepeatedInertiaSymmetryChain | null
  ) => void;
  onClearInertiaVisualizationPreview?: () => void;
  onAlignRobotMirrorOrientation?: () => void;
  onFixRobotMirrorSymmetry?: () => void;
  isRobotMirrorActing?: boolean;
  isSimulationPrepFixBusy?: boolean;
  isRobotMirrorAvailabilityLoading?: boolean;
  activeRobotMirrorAction?: RobotMirrorFixMode | null;
  canAlignRobotMirrorOrientation?: boolean;
  canFixRobotMirrorSymmetry?: boolean;
  onToggleRobotMirrorGroupSelection?: (groupKey: string) => void;
  onToggleRobotMirrorSelectionLink?: (linkName: string) => void;
  physicsAuditSummary?: {
    totalLinkCount: number;
    presentLinkCount: number;
    validLinkCount: number;
    missingLinkCount: number;
    invalidLinkCount: number;
    repairableLinkCount: number;
    totalMassKg: number;
  } | null;
  physicsPlausibilitySummary?: {
    verdict: "plausible" | "mass-too-high" | "mass-too-low" | "insufficient-data";
    comparableLinkCount: number;
    excludedLinks: Array<{
      linkName: string;
      reason:
        | "missing-authored-mass"
        | "unresolved-mesh-reference"
        | "unsupported-mesh-format"
        | "excessive-cleanup"
        | "degenerate-geometry"
        | "missing-geometry"
        | "invalid-scale"
        | "invalid-inertia"
        | "other";
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
      meshSanitization?: MeshSanitizationSummary[] | null;
      diagnostics?: {
        bucket: InertialDiagnosticBucket;
        eigenvalues: [number, number, number];
        conditionNumber: number | null;
        triangleInequalityGap: number;
      } | null;
    }>;
    authoredMassKg: number;
    lightEstimateMassKg: number;
    heavyEstimateMassKg: number;
    warning: string | null;
    offenders: Array<{
      linkName: string;
      authoredMassKg: number;
      heavyEstimateMassKg: number;
      ratioToHeavyEstimate: number;
    }>;
  } | null;
  physicsDeltaSummary?: {
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
  } | null;
  physicsPreflightLoading?: boolean;
  physicsActionStatusByKey?: Partial<
    Record<SimulationPrepPhysicsActionKey, SimulationPrepPhysicsActionStatus>
  >;
  onOpenGeneratePhysicsDialog?: () => void | Promise<void>;
  onGeneratePhysics?: (
    densityPresetId: InertialDensityPresetId,
    repairMode: InertialRepairMode
  ) => void;
  onGenerateVoxelPhysics?: (densityPresetId: InertialDensityPresetId) => void;
  onGenerateRegularizedPhysics?: (densityPresetId: InertialDensityPresetId) => void;
  repairOrientationLabel?: string | null;
  repairOrientationSummary?: string | null;
  onRepairOrientation?: () => void;
  repairOrientationDisabled?: boolean;
  advancedOpenByDefault?: boolean;
  advancedPrimaryActionLabel?: string | null;
  onRunAdvancedPrimaryAction?: () => void;
  advancedSecondaryActionLabel?: string | null;
  onRunAdvancedSecondaryAction?: () => void;
  synthesisRootLinkName?: string | null;
  synthesisRobotName?: string | null;
  synthesisLinkCount?: number;
  synthesisJointCount?: number;
  synthesisSupportEvidence?: string | null;
  synthesisInferredUpLabel?: string | null;
  synthesisConfidence?: number | null;
  synthesisFallbackReason?: string | null;
  synthesisSampleJoints?: Array<{
    jointName: string;
    parentLinkName: string;
    childLinkName: string;
    xyz: [number, number, number];
    rpy: [number, number, number];
  }>;
  onClearSynthesisPreview?: () => void;
  stagedEntryCount?: number;
  stagedMeshBackedEntryCount?: number;
  stagedLinkNames?: string[];
  onClearStagedAction?: () => void;
  onClearPhysicsDraft?: () => void;
};
