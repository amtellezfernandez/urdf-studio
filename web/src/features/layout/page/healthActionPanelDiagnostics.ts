import {
  SIMULATION_PREP_PSD_REGULARIZE_SCOPE_KEY,
  SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY,
} from "@/features/layout/page/simulationPrepViewerState";
import type { HealthActionPanelProps } from "@/features/layout/page/healthActionPanelTypes";

export type ExcludedLinkEntry = NonNullable<
  HealthActionPanelProps["physicsPlausibilitySummary"]
>["excludedLinks"][number];

export type ExcludedLinkBucketKey =
  | "voxel-ready"
  | "near-miss"
  | "ghost-geometry"
  | "proxy-review"
  | "missing-authored-mass"
  | "unresolved-mesh-reference"
  | "unsupported-mesh-format"
  | "excessive-cleanup"
  | "degenerate-geometry"
  | "missing-geometry"
  | "invalid-scale"
  | "invalid-inertia"
  | "other";

export type ExcludedLinkGroup = {
  key: ExcludedLinkBucketKey;
  label: string;
  summary: string;
  guidance: string | null;
  linkEntries: ExcludedLinkEntry[];
};

export type PreparationVisualizationScope = {
  scopeKey: string;
  linkNames: string[];
  label: string;
};

export type SanitizationSummary = {
  status: "ok" | "needs-review";
  sanitizedLinkCount: number;
  blockedLinkCount: number;
  maxPhysicsImpactRatio: number;
};

export const formatDiagnosticNumber = (value: number): string =>
  Number.isFinite(value) ? value.toExponential(2) : "n/a";

export const formatExclusionReasonLabel = (
  reason:
    | "missing-authored-mass"
    | "unresolved-mesh-reference"
    | "unsupported-mesh-format"
    | "excessive-cleanup"
    | "degenerate-geometry"
    | "missing-geometry"
    | "invalid-scale"
    | "invalid-inertia"
    | "other"
): string => {
  switch (reason) {
    case "missing-authored-mass":
      return "missing authored mass";
    case "unresolved-mesh-reference":
      return "unresolved mesh reference";
    case "unsupported-mesh-format":
      return "unsupported mesh format";
    case "excessive-cleanup":
      return "cleanup blocked";
    case "degenerate-geometry":
      return "open or degenerate geometry";
    case "missing-geometry":
      return "missing geometry";
    case "invalid-scale":
      return "invalid mesh scale";
    case "invalid-inertia":
      return "invalid synthesized inertia";
    default:
      return "excluded";
  }
};

export const buildExcludedLinkBucketKey = (entry: ExcludedLinkEntry): ExcludedLinkBucketKey => {
  if (entry.recoveryDisposition === "recover") {
    return "voxel-ready";
  }
  if (entry.recoveryDisposition === "regularize") {
    return "near-miss";
  }
  if (entry.recoveryDisposition === "auto-exclude-ghost") {
    return "ghost-geometry";
  }
  if (entry.recoveryDisposition === "manual-review-proxy") {
    return "proxy-review";
  }
  return entry.reason;
};

export const getExcludedLinkGroupMeta = (
  key: ExcludedLinkBucketKey,
  count: number
): { label: string; summary: string; guidance: string | null } => {
  switch (key) {
    case "voxel-ready":
      return {
        label: "Voxel-ready",
        summary: `${count} rescued and now voxel-ready`,
        guidance: "In URDF Studio, click Recover, then choose a material.",
      };
    case "near-miss":
      return {
        label: "Near-miss",
        summary: `${count} can use PSD regularization`,
        guidance: "In URDF Studio, click Regularize, then choose a material.",
      };
    case "ghost-geometry":
      return {
        label: "Ghost geometry",
        summary: `${count} removed as ghost geometry`,
        guidance: "No action needed in URDF Studio for these links.",
      };
    case "proxy-review":
      return {
        label: "Manual attention",
        summary: `${count} need geometry attention`,
        guidance:
          "In URDF Studio, inspect the mesh first. Use a box or cylinder proxy only if the source mesh cannot be repaired.",
      };
    default: {
      const label = formatExclusionReasonLabel(key);
      return {
        label: label.charAt(0).toUpperCase() + label.slice(1),
        summary: `${count} ${label}`,
        guidance: "Inspect this link in URDF Studio before recalculating physics.",
      };
    }
  }
};

const EXCLUDED_LINK_GROUP_ORDER: Record<ExcludedLinkBucketKey, number> = {
  "voxel-ready": 0,
  "near-miss": 1,
  "proxy-review": 2,
  "ghost-geometry": 3,
  "missing-authored-mass": 4,
  "unresolved-mesh-reference": 5,
  "unsupported-mesh-format": 6,
  "excessive-cleanup": 7,
  "degenerate-geometry": 8,
  "missing-geometry": 9,
  "invalid-scale": 10,
  "invalid-inertia": 11,
  "other": 12,
};

export const buildExclusionReasonSummary = (
  excludedLinks: ExcludedLinkEntry[]
): string[] => {
  const counts = new Map<ExcludedLinkBucketKey, number>();
  for (const entry of excludedLinks) {
    const key = buildExcludedLinkBucketKey(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(
      (left, right) =>
        EXCLUDED_LINK_GROUP_ORDER[left[0]] - EXCLUDED_LINK_GROUP_ORDER[right[0]] || right[1] - left[1]
    )
    .map(([key, count]) => getExcludedLinkGroupMeta(key, count).summary);
};

export const buildExcludedLinkGroups = (excludedLinks: ExcludedLinkEntry[]): ExcludedLinkGroup[] => {
  const groups = new Map<ExcludedLinkBucketKey, ExcludedLinkEntry[]>();
  for (const entry of excludedLinks) {
    const key = buildExcludedLinkBucketKey(entry);
    const bucketEntries = groups.get(key) ?? [];
    bucketEntries.push(entry);
    groups.set(key, bucketEntries);
  }
  return Array.from(groups.entries())
    .map(([key, linkEntries]) => ({
      key,
      ...getExcludedLinkGroupMeta(key, linkEntries.length),
      linkEntries,
    }))
    .sort(
      (left, right) =>
        EXCLUDED_LINK_GROUP_ORDER[left.key] - EXCLUDED_LINK_GROUP_ORDER[right.key] ||
        right.linkEntries.length - left.linkEntries.length
    );
};

export const getPreparationVisualizationScope = (
  group: ExcludedLinkGroup
): PreparationVisualizationScope | null => {
  switch (group.key) {
    case "voxel-ready":
      return {
        scopeKey: SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY,
        linkNames: group.linkEntries.map((entry) => entry.linkName),
        label: "voxel-recovery",
      };
    case "near-miss":
      return {
        scopeKey: SIMULATION_PREP_PSD_REGULARIZE_SCOPE_KEY,
        linkNames: group.linkEntries.map((entry) => entry.linkName),
        label: "PSD-regularization",
      };
    default:
      return null;
  }
};

export const buildSanitizationSummary = (
  excludedLinks: ExcludedLinkEntry[]
): SanitizationSummary => {
  const sanitizedEntries = excludedLinks
    .flatMap((entry) => entry.meshSanitization ?? [])
    .filter((entry) => entry.status === "sanitized" && entry.removedComponents > 0);
  const manualAttentionSanitizationCount = excludedLinks
    .flatMap((entry) => entry.meshSanitization ?? [])
    .filter((entry) => entry.deletionSafetyReport.status === "manual-review").length;
  const blockedLinkCount = excludedLinks.filter(
    (entry) => entry.recoveryDisposition === "manual-review-proxy"
  ).length;
  if (sanitizedEntries.length === 0 && blockedLinkCount === 0 && manualAttentionSanitizationCount === 0) {
    return {
      status: "ok",
      sanitizedLinkCount: 0,
      blockedLinkCount: 0,
      maxPhysicsImpactRatio: 0,
    };
  }
  const maxPhysicsImpactRatio = sanitizedEntries.reduce(
    (maxImpact, entry) => Math.max(maxImpact, entry.deletionSafetyReport.metrics.physicsImpactRatio),
    0
  );

  return {
    status: blockedLinkCount > 0 || manualAttentionSanitizationCount > 0 ? "needs-review" : "ok",
    sanitizedLinkCount: sanitizedEntries.length,
    blockedLinkCount: blockedLinkCount + manualAttentionSanitizationCount,
    maxPhysicsImpactRatio,
  };
};

export const countGeometryDiagnosisAttentionLinks = (excludedLinks: ExcludedLinkEntry[]): number =>
  excludedLinks.filter((entry) => entry.recoveryDisposition !== "auto-exclude-ghost").length;

export const buildGeometryDiagnosisHeadline = ({
  excludedCount,
  attentionCount,
}: {
  excludedCount: number;
  attentionCount: number;
}): string => {
  if (excludedCount === 0) {
    return "Geometry diagnosis";
  }
  if (attentionCount === excludedCount) {
    return `Geometry diagnosis • ${excludedCount} flagged link${excludedCount === 1 ? "" : "s"}`;
  }
  return `Geometry diagnosis • ${excludedCount} flagged, ${attentionCount} need attention`;
};

export const buildGeometryDiagnosisNote = ({
  sanitizationSummary,
}: {
  sanitizationSummary: SanitizationSummary;
}): string | null => {
  if (sanitizationSummary.status === "needs-review") {
    return "Precheck flagged geometry: disconnected parts may be physically important.";
  }
  if (sanitizationSummary.sanitizedLinkCount > 0) {
    return `Precheck found removable disconnected geometry on ${sanitizationSummary.sanitizedLinkCount} link${sanitizationSummary.sanitizedLinkCount === 1 ? "" : "s"} (< ${(sanitizationSummary.maxPhysicsImpactRatio * 100).toFixed(1)}% estimated physics impact).`;
  }
  return null;
};
