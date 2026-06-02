import type {
  InertialMassDeltaSummary,
  InertialPlausibilitySummary,
  InertialSynthesisSummary,
} from "@/features/urdf/inertia/inertialSynthesis";
import type { RobotFrameLintResult } from "@/features/urdf/lint/robotFrameLinter";

export type SimulationPrepStatusTone = "safe" | "warning" | "danger";
const SIMULATION_PREP_PHYSICS_ACTION_KEYS = [
  "repair-missing-invalid",
  "replace-all",
  "voxel-recovery",
  "psd-regularize",
] as const;
export type SimulationPrepPhysicsActionKey =
  (typeof SIMULATION_PREP_PHYSICS_ACTION_KEYS)[number];
export type SimulationPrepPhysicsActionStatus = "idle" | "queued" | "running";
export type SimulationPrepChecklistRefreshResult =
  | "success"
  | "failed"
  | "superseded"
  | "skipped"
  | "pending";
const SIMULATION_PREP_DIAGNOSIS_QUEUEABLE_ACTION_KEYS = [
  "voxel-recovery",
  "psd-regularize",
] as const satisfies readonly SimulationPrepPhysicsActionKey[];

export type SimulationPrepStatus = {
  tone: SimulationPrepStatusTone;
  label: string;
  summary: string | null;
};

const SIMULATION_PREP_FINGERPRINT_EMPTY = "none";

const formatFingerprintNumber = (value: number | null | undefined, digits = 3): string =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : SIMULATION_PREP_FINGERPRINT_EMPTY;

export const buildSimulationPrepDraftFingerprint = (
  parts: Array<string | number | boolean | null | undefined>
): string =>
  parts
    .map((part) => {
      if (typeof part === "number") {
        return Number.isFinite(part) ? String(part) : SIMULATION_PREP_FINGERPRINT_EMPTY;
      }
      if (typeof part === "boolean") {
        return part ? "true" : "false";
      }
      return part == null || part === "" ? SIMULATION_PREP_FINGERPRINT_EMPTY : String(part);
    })
    .join("|");

export const resolveSimulationPrepPhysicsSourceContent = ({
  stagedDraftContent,
  baseContent,
}: {
  stagedDraftContent?: string | null;
  baseContent: string;
}): string => {
  const trimmedStagedDraftContent = stagedDraftContent?.trim() ?? "";
  return trimmedStagedDraftContent.length > 0 ? stagedDraftContent! : baseContent;
};

export const buildSimulationPrepPhysicsActionStatusMap = ({
  runningActionKey,
  queuedActionKeys,
}: {
  runningActionKey: SimulationPrepPhysicsActionKey | null;
  queuedActionKeys: SimulationPrepPhysicsActionKey[];
}): Record<SimulationPrepPhysicsActionKey, SimulationPrepPhysicsActionStatus> => {
  const statusMap = Object.fromEntries(
    SIMULATION_PREP_PHYSICS_ACTION_KEYS.map((actionKey) => [actionKey, "idle"])
  ) as Record<SimulationPrepPhysicsActionKey, SimulationPrepPhysicsActionStatus>;
  queuedActionKeys.forEach((actionKey) => {
    statusMap[actionKey] = "queued";
  });
  if (runningActionKey) {
    statusMap[runningActionKey] = "running";
  }
  return statusMap;
};

export const hasSimulationPrepPhysicsActionPending = (
  statusByKey: Partial<Record<SimulationPrepPhysicsActionKey, SimulationPrepPhysicsActionStatus>>
): boolean => Object.values(statusByKey).some((status) => status === "queued" || status === "running");

export const resolveSimulationPrepPreflightRequestDecision = ({
  force,
  matchesCurrentSession,
  isSameSourceInFlight,
}: {
  force: boolean;
  matchesCurrentSession: boolean;
  isSameSourceInFlight: boolean;
}): "start" | "skipped" | "pending" => {
  if (!force && matchesCurrentSession) {
    return "skipped";
  }
  if (isSameSourceInFlight) {
    return "pending";
  }
  return "start";
};

export const resolveSimulationPrepChecklistRefreshStatus = ({
  frameResult,
  physicsResult,
}: {
  frameResult: SimulationPrepChecklistRefreshResult;
  physicsResult: SimulationPrepChecklistRefreshResult;
}): {
  status: "complete" | "failed" | "pending";
  ok: boolean;
} => {
  const results = [frameResult, physicsResult];
  if (results.includes("failed")) {
    return {
      status: "failed",
      ok: false,
    };
  }
  if (results.includes("superseded") || results.includes("pending")) {
    return {
      status: "pending",
      ok: false,
    };
  }
  return {
    status: "complete",
    ok: true,
  };
};

export const buildSimulationPrepChecklistRefreshMessage = ({
  status,
}: {
  status: "complete" | "failed" | "pending";
}): string | null => {
  if (status === "failed") {
    return "Checklist refresh failed. Previous review is still shown until the next successful check.";
  }
  if (status === "pending") {
    return "Checklist refresh is still running. Previous review will stay visible until the new check completes.";
  }
  return null;
};

export const buildSimulationPrepUpdateToastPlan = ({
  successMessage,
  checklistRefreshStatus,
}: {
  successMessage: string;
  checklistRefreshStatus: "complete" | "failed" | "pending";
}): {
  successMessage: string;
  followupMessage: string | null;
} => ({
  successMessage,
  followupMessage: buildSimulationPrepChecklistRefreshMessage({
    status: checklistRefreshStatus,
  }),
});

export const canQueueSimulationPrepPhysicsAction = ({
  runningActionKey,
  queuedActionKeys,
  nextActionKey,
}: {
  runningActionKey: SimulationPrepPhysicsActionKey | null;
  queuedActionKeys: SimulationPrepPhysicsActionKey[];
  nextActionKey: SimulationPrepPhysicsActionKey;
}): boolean => {
  const pendingActionKeys = [
    ...(runningActionKey ? [runningActionKey] : []),
    ...queuedActionKeys,
  ];
  if (pendingActionKeys.length === 0) {
    return true;
  }
  if (pendingActionKeys.includes(nextActionKey)) {
    return false;
  }
  const diagnosisQueueableKeys = new Set<SimulationPrepPhysicsActionKey>(
    SIMULATION_PREP_DIAGNOSIS_QUEUEABLE_ACTION_KEYS
  );
  return pendingActionKeys.every((actionKey) => diagnosisQueueableKeys.has(actionKey)) &&
    diagnosisQueueableKeys.has(nextActionKey);
};

export const buildSimulationPrepVisibilityKey = ({
  frameVerdict,
  missingInertialCount,
  invalidMassCount,
  invalidTensorCount,
  plausibilityVerdict,
  comparableLinkCount,
  excludedLinkCount,
  totalMassKg,
  plausibilityWarning,
  physicsDraftKey,
  bakeDraftKey,
  canonicalDraftKey,
}: {
  frameVerdict: RobotFrameLintResult["verdict"] | "none";
  missingInertialCount: number;
  invalidMassCount: number;
  invalidTensorCount: number;
  plausibilityVerdict: InertialPlausibilitySummary["verdict"] | "none";
  comparableLinkCount: number;
  excludedLinkCount: number;
  totalMassKg: number;
  plausibilityWarning: string | null;
  physicsDraftKey: string;
  bakeDraftKey: string;
  canonicalDraftKey: string;
}): string =>
  [
    frameVerdict,
    missingInertialCount,
    invalidMassCount,
    invalidTensorCount,
    plausibilityVerdict,
    comparableLinkCount,
    excludedLinkCount,
    formatFingerprintNumber(totalMassKg),
    plausibilityWarning ?? "no-warning",
    physicsDraftKey,
    bakeDraftKey,
    canonicalDraftKey,
  ].join("|");

export const buildPhysicsIssueSummary = ({
  missingInertialCount,
  invalidMassCount,
  invalidTensorCount,
  inertialPlausibilitySummary,
}: {
  missingInertialCount: number;
  invalidMassCount: number;
  invalidTensorCount: number;
  inertialPlausibilitySummary: InertialPlausibilitySummary | null;
}): string | null => {
  const parts: string[] = [];
  if (missingInertialCount > 0) {
    parts.push(`${missingInertialCount} missing inertial link${missingInertialCount === 1 ? "" : "s"}`);
  }
  const invalidCount = invalidMassCount + invalidTensorCount;
  if (invalidCount > 0) {
    parts.push(`${invalidCount} invalid inertial link${invalidCount === 1 ? "" : "s"}`);
  }
  if (inertialPlausibilitySummary?.warning) {
    parts.push(inertialPlausibilitySummary.warning);
  }
  return parts.length > 0 ? parts.join(" • ") : null;
};

const SIMULATION_PREP_STATUS_LABELS = {
  danger: "Non-Physical (Simulation will crash)",
  warning: "Physics Warning (Orientation / Inertia Issues)",
  safe: "Simulation Ready (Z-Up / Valid Physics)",
} as const;

type BuildSimulationPrepStatusParams = {
  robotFrameLint: RobotFrameLintResult | null;
  missingInertialCount: number;
  invalidMassCount: number;
  invalidTensorCount: number;
  inertialPlausibilitySummary: InertialPlausibilitySummary | null;
  orientationSummary: string | null;
};

const buildSimulationPrepStatusSummary = ({
  orientationSummary,
  inertialPlausibilitySummary,
}: Pick<
  BuildSimulationPrepStatusParams,
  "orientationSummary" | "inertialPlausibilitySummary"
>): string | null => {
  if (!inertialPlausibilitySummary?.warning) {
    return orientationSummary;
  }
  if (!orientationSummary) {
    return inertialPlausibilitySummary.warning;
  }
  return `${orientationSummary} ${inertialPlausibilitySummary.warning}`;
};

export const buildSimulationPrepStatus = ({
  robotFrameLint,
  missingInertialCount,
  invalidMassCount,
  invalidTensorCount,
  inertialPlausibilitySummary,
  orientationSummary,
}: BuildSimulationPrepStatusParams): SimulationPrepStatus => {
  const hasInvalidPhysics = invalidMassCount > 0 || invalidTensorCount > 0;
  const hasWarnings =
    missingInertialCount > 0 ||
    robotFrameLint?.verdict !== "canonical" ||
    inertialPlausibilitySummary?.verdict === "mass-too-high" ||
    inertialPlausibilitySummary?.verdict === "mass-too-low";
  const tone: SimulationPrepStatusTone = hasInvalidPhysics
    ? "danger"
    : hasWarnings
      ? "warning"
      : "safe";

  return {
    tone,
    label: SIMULATION_PREP_STATUS_LABELS[tone],
    summary: buildSimulationPrepStatusSummary({
      orientationSummary,
      inertialPlausibilitySummary,
    }),
  };
};

export const buildPhysicsDraftSummaryText = ({
  inertialSynthesisSummary,
  inertialMassDeltaSummary,
}: {
  inertialSynthesisSummary: InertialSynthesisSummary | null;
  inertialMassDeltaSummary: InertialMassDeltaSummary | null;
}): string | null => {
  if (!inertialSynthesisSummary) {
    return null;
  }

  const deltaSummary = inertialMassDeltaSummary
    ? ` Total mass ${inertialMassDeltaSummary.totalMassBeforeKg.toFixed(3)} -> ${inertialMassDeltaSummary.totalMassAfterKg.toFixed(3)} kg (${inertialMassDeltaSummary.totalMassDeltaKg >= 0 ? "+" : ""}${inertialMassDeltaSummary.totalMassDeltaKg.toFixed(3)}).`
    : "";

  const parts = [
    `Physics draft staged for ${inertialSynthesisSummary.synthesizedLinkCount} of ${inertialSynthesisSummary.targetedLinkCount} targeted links using ${inertialSynthesisSummary.densityLabel}.`,
    `Collision-first: ${inertialSynthesisSummary.collisionSourceLinkCount}.`,
    `Visual fallback: ${inertialSynthesisSummary.visualFallbackLinkCount}.`,
  ];
  if (inertialSynthesisSummary.voxelFallbackLinkCount > 0) {
    parts.push(`Voxel-derived: ${inertialSynthesisSummary.voxelFallbackLinkCount}.`);
  }
  if (inertialSynthesisSummary.psdRegularizedLinkCount > 0) {
    parts.push(`PSD-regularized: ${inertialSynthesisSummary.psdRegularizedLinkCount}.`);
  }
  if (inertialSynthesisSummary.repeatedMeshCanonicalizationGroupCount > 0) {
    parts.push(
      `Repeated mesh groups unified: ${inertialSynthesisSummary.repeatedMeshCanonicalizationGroupCount}.`
    );
  }
  if (inertialSynthesisSummary.skippedLinkCount > 0) {
    parts.push(`Still unresolved: ${inertialSynthesisSummary.skippedLinkCount}.`);
  }
  return `${parts.join(" ")}${deltaSummary}`;
};
