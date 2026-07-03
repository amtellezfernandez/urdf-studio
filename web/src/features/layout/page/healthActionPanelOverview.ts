import type { HealthActionPanelProps } from "@/features/layout/page/healthActionPanelTypes";

export type HealthActionOverviewRow = {
  label: string;
  value: string;
  emphasis?: "result";
};

export const buildPlausibilityHeading = ({
  verdict,
  comparableLinkCount,
  presentLinkCount,
}: {
  verdict: "plausible" | "mass-too-high" | "mass-too-low" | "insufficient-data";
  comparableLinkCount: number;
  presentLinkCount: number;
}): string => {
  const partialCoverage = comparableLinkCount < presentLinkCount;
  if (verdict === "insufficient-data") {
    return "Plausibility could not be verified";
  }
  if (partialCoverage) {
    return verdict === "plausible" ? "Partial plausibility check" : "Partial plausibility warning";
  }
  return verdict === "plausible" ? "Plausibility looks reasonable" : "Plausibility warning";
};

export const buildCompactPlausibilityRange = (
  plausibility: NonNullable<HealthActionPanelProps["physicsPlausibilitySummary"]>
): string => `${plausibility.lightEstimateMassKg.toFixed(3)}-${plausibility.heavyEstimateMassKg.toFixed(3)} kg`;

export const buildPanelSubtitle = ({
  audit,
  excludedCount,
}: {
  audit: HealthActionPanelProps["physicsAuditSummary"];
  excludedCount: number;
}): string => {
  if (!audit) {
    return "Checking robot readiness.";
  }
  if (audit.repairableLinkCount > 0) {
    return `${audit.repairableLinkCount} physics issue${audit.repairableLinkCount === 1 ? "" : "s"} ready to fix.`;
  }
  if (excludedCount > 0) {
    return `${excludedCount} skipped link${excludedCount === 1 ? "" : "s"} need attention.`;
  }
  const issueCount = audit.missingLinkCount + audit.invalidLinkCount;
  if (issueCount > 0) {
    return `${issueCount} inertial issue${issueCount === 1 ? "" : "s"} found.`;
  }
  return "Physics check ready.";
};

export const buildGeneratePhysicsDialogDescription = ({
  audit,
  voxelRecoveryCount,
  nearMissCount,
  skippedLinkCount,
}: {
  audit: HealthActionPanelProps["physicsAuditSummary"];
  voxelRecoveryCount: number;
  nearMissCount: number;
  skippedLinkCount: number;
}): string => {
  if (!audit) {
    return "Run the physics check, then choose how to recalculate the selected links.";
  }
  if (audit.repairableLinkCount > 0) {
    return `Recalculate ${audit.repairableLinkCount} missing or invalid inertial link${audit.repairableLinkCount === 1 ? "" : "s"} with one material assumption.`;
  }
  if (voxelRecoveryCount > 0) {
    return `${skippedLinkCount} link${skippedLinkCount === 1 ? "" : "s"} were skipped in check. ${voxelRecoveryCount} passed voxel recovery precheck${nearMissCount > 0 ? ` and ${nearMissCount} can use PSD regularization` : ""}.`;
  }
  if (nearMissCount > 0) {
    return `${skippedLinkCount} link${skippedLinkCount === 1 ? "" : "s"} were skipped in check. ${nearMissCount} can use PSD regularization.`;
  }
  if (skippedLinkCount > 0) {
    return `${skippedLinkCount} link${skippedLinkCount === 1 ? "" : "s"} were skipped in check. None passed voxel recovery precheck.`;
  }
  return "No missing or invalid inertials were found.";
};

export type PhysicsActionSummary = {
  isDisabled: boolean;
  summary: string;
};

export const buildPhysicsActionSummary = ({
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
}): PhysicsActionSummary => {
  if (onOpenGeneratePhysicsDialog && !physicsAuditSummary) {
    return {
      summary: physicsPreflightLoading
        ? "Analyzing physics now. Wait for the audit before clicking."
        : "Run the physics check before repairing masses.",
      isDisabled: physicsPreflightLoading,
    };
  }
  if (physicsAuditSummary && physicsAuditSummary.repairableLinkCount > 0 && onOpenGeneratePhysicsDialog) {
    return {
      summary: `Repair ${physicsAuditSummary.repairableLinkCount} missing or invalid inertial link${physicsAuditSummary.repairableLinkCount === 1 ? "" : "s"}.`,
      isDisabled: false,
    };
  }
  if (voxelRecoveryCount > 0 && onOpenGeneratePhysicsDialog) {
    return {
      summary:
        nearMissCount > 0
          ? `${voxelRecoveryCount} skipped link${voxelRecoveryCount === 1 ? "" : "s"} passed voxel precheck. ${nearMissCount} near-miss link${nearMissCount === 1 ? "" : "s"} can use PSD regularization.`
          : `${voxelRecoveryCount} skipped link${voxelRecoveryCount === 1 ? "" : "s"} passed voxel precheck.`,
      isDisabled: false,
    };
  }
  return {
    summary: "Physics check ready.",
    isDisabled: false,
  };
};

export const buildPhysicsActionLabel = ({
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

export const buildOverviewLabelValueRows = ({
  statusLabel,
  physicsIssueSummary,
  frameIssueSummary,
  physicsAuditSummary,
  physicsPlausibilitySummary,
}: {
  statusLabel: string | null;
  physicsIssueSummary: string | null;
  frameIssueSummary: string | null;
  physicsAuditSummary: HealthActionPanelProps["physicsAuditSummary"];
  physicsPlausibilitySummary: HealthActionPanelProps["physicsPlausibilitySummary"];
}): HealthActionOverviewRow[] => {
  const rows: HealthActionOverviewRow[] = [];
  if (statusLabel) {
    rows.push({ label: "Status", value: statusLabel });
  }
  if (physicsIssueSummary) {
    rows.push({ label: "Physics", value: physicsIssueSummary });
  }
  if (frameIssueSummary) {
    rows.push({ label: "Frame", value: frameIssueSummary, emphasis: "result" });
  }
  if (physicsAuditSummary) {
    rows.push({
      label: "Inertials",
      value: `${physicsAuditSummary.presentLinkCount}/${physicsAuditSummary.totalLinkCount} present`,
    });
    rows.push({
      label: "Missing / Invalid",
      value: `${physicsAuditSummary.missingLinkCount} missing • ${physicsAuditSummary.invalidLinkCount} invalid`,
    });
    rows.push({
      label: "Authored Mass",
      value: `${physicsAuditSummary.totalMassKg.toFixed(3)} kg`,
    });
  }
  if (physicsPlausibilitySummary && physicsAuditSummary) {
    const plausibilityHeading = buildPlausibilityHeading({
      verdict: physicsPlausibilitySummary.verdict,
      comparableLinkCount: physicsPlausibilitySummary.comparableLinkCount,
      presentLinkCount: physicsAuditSummary.presentLinkCount,
    });
    rows.push({
      label: "Plausibility",
      value: `${plausibilityHeading} • ${physicsPlausibilitySummary.comparableLinkCount}/${physicsAuditSummary.presentLinkCount} comparable • ${buildCompactPlausibilityRange(physicsPlausibilitySummary)} estimated`,
      emphasis: "result",
    });
  }
  return rows;
};

export const buildOverviewExtraNotes = ({
  statusSummary,
  physicsPlausibilityWarning,
  overviewRowValues,
}: {
  statusSummary: string | null;
  physicsPlausibilityWarning: string | null;
  overviewRowValues: string[];
}): string[] => {
  const normalizedOverviewValues = overviewRowValues.map((value) => value.trim().toLowerCase());
  const notes: string[] = [];
  const appendIfDistinct = (note: string | null) => {
    if (!note) {
      return;
    }
    const normalizedNote = note.trim().toLowerCase();
    if (!normalizedNote) {
      return;
    }
    if (
      normalizedOverviewValues.some((value) => value.includes(normalizedNote) || normalizedNote.includes(value))
    ) {
      return;
    }
    if (notes.some((existing) => existing.trim().toLowerCase() === normalizedNote)) {
      return;
    }
    notes.push(note);
  };
  appendIfDistinct(statusSummary);
  appendIfDistinct(physicsPlausibilityWarning);
  return notes;
};
