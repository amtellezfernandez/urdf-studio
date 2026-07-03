import {
  buildOrientationReviewSummary,
  buildOrientationStatus,
  getActionableOrientationSuggestion,
  type OrientationStatus,
} from "@/shared/lib/orientationReview";
import type { RobotOrientationCard } from "@/shared/lib/urdfCore";
import {
  buildRobotFramePolicySummary,
  type RobotFrameLintResult,
} from "@/features/urdf/lint/robotFrameLinter";
import { buildSimulationPrepDraftFingerprint } from "@/features/layout/page/simulationPrepState";
import type { UrdfBakePreviewSession } from "@/features/urdf/bake/virtualBake";
import type {
  InertialMassDeltaSummary,
  InertialSynthesisSummary,
} from "@/features/urdf/inertia/inertialSynthesis";
import type { CanonicalSynthesisPreviewSession } from "@/app/pages/index/indexPageRuntimeHelpers";

type OrientationSuggestion = ReturnType<typeof getActionableOrientationSuggestion>;

export type OrientationReviewState = {
  canAlignOrientation: boolean;
  canPreviewBakeVisualTransforms: boolean;
  needsAttention: boolean;
  status: OrientationStatus | null;
  suggestion: OrientationSuggestion;
  summary: string | null;
};

export const buildOrientationReviewState = ({
  orientationCard,
  robotFrameLint,
}: {
  orientationCard: RobotOrientationCard | null | undefined;
  robotFrameLint: RobotFrameLintResult | null | undefined;
}): OrientationReviewState => {
  const suggestion = getActionableOrientationSuggestion(orientationCard);
  const orientationReviewSummary = buildOrientationReviewSummary(orientationCard);
  const framePolicySummary = buildRobotFramePolicySummary(robotFrameLint);
  const summary = (() => {
    if (!orientationReviewSummary) {
      return framePolicySummary;
    }
    if (!framePolicySummary || robotFrameLint?.verdict === "canonical") {
      return orientationReviewSummary;
    }
    return `${orientationReviewSummary} ${framePolicySummary}`;
  })();
  const status = buildOrientationStatus(orientationCard);

  return {
    canAlignOrientation: Boolean(suggestion && robotFrameLint?.rewriteSafe),
    canPreviewBakeVisualTransforms: robotFrameLint?.verdict === "unsafe-to-rewrite",
    needsAttention: Boolean(
      suggestion || (robotFrameLint && robotFrameLint.verdict !== "canonical")
    ),
    status: status
      ? {
          ...status,
          summary: summary ?? status.summary,
        }
      : null,
    suggestion,
    summary,
  };
};

export const buildPhysicsDraftFingerprint = ({
  inertialMassDeltaSummary,
  inertialSynthesisSummary,
}: {
  inertialMassDeltaSummary: InertialMassDeltaSummary | null;
  inertialSynthesisSummary: InertialSynthesisSummary | null;
}): string =>
  inertialSynthesisSummary
    ? buildSimulationPrepDraftFingerprint([
        inertialSynthesisSummary.densityPresetId,
        inertialSynthesisSummary.repairMode,
        inertialSynthesisSummary.synthesizedLinkCount,
        inertialSynthesisSummary.voxelFallbackLinkCount,
        inertialMassDeltaSummary?.changedLinkCount ?? 0,
        inertialMassDeltaSummary?.totalMassAfterKg?.toFixed(3) ?? "none",
      ])
    : "no-physics-draft";

export const buildBakeDraftFingerprint = ({
  bakePreviewSession,
  entryCount,
  linkCount,
  meshBackedEntryCount,
}: {
  bakePreviewSession: UrdfBakePreviewSession | null;
  entryCount: number;
  linkCount: number;
  meshBackedEntryCount: number;
}): string =>
  bakePreviewSession
    ? buildSimulationPrepDraftFingerprint([
        entryCount,
        meshBackedEntryCount,
        linkCount,
        bakePreviewSession.stagedContent.length,
      ])
    : "no-bake-draft";

export const buildCanonicalDraftFingerprint = (
  canonicalSynthesisPreview: CanonicalSynthesisPreviewSession | null
): string =>
  canonicalSynthesisPreview
    ? buildSimulationPrepDraftFingerprint([
        canonicalSynthesisPreview.preview.robotName,
        canonicalSynthesisPreview.preview.rootLinkName,
        canonicalSynthesisPreview.preview.linkCount,
        canonicalSynthesisPreview.preview.jointCount,
        canonicalSynthesisPreview.preview.supportPlane.confidence?.toFixed(2) ?? "none",
        canonicalSynthesisPreview.draftContent.length,
      ])
    : "no-canonical-draft";
