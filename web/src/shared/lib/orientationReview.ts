import type { RobotOrientationCard } from "@/shared/lib/urdfCore";

type OrientationSuggestion = NonNullable<RobotOrientationCard["suggestedApplyOrientation"]>;
export type OrientationStatus = {
  upLabel: string;
  forwardLabel: string;
  basisLabel: string;
  summary: string;
};

const formatAxisDirectionLabel = (
  direction: string,
  suffix: "up" | "forward"
): string => {
  const trimmed = direction.trim();
  if (!trimmed) {
    return `Unknown ${suffix}`;
  }
  const sign = trimmed.startsWith("-") ? "-" : "";
  const axisToken = trimmed.replace(/^[-+]/, "").toUpperCase();
  return `${sign}${axisToken}-${suffix}`;
};

const hasCompleteOrientationSuggestion = (
  suggestion: RobotOrientationCard["suggestedApplyOrientation"]
): suggestion is OrientationSuggestion =>
  Boolean(
    suggestion?.sourceUpAxis &&
      suggestion.sourceForwardAxis &&
      suggestion.targetUpAxis &&
      suggestion.targetForwardAxis
  );

export const getActionableOrientationSuggestion = (
  orientationCard: RobotOrientationCard | null | undefined
): OrientationSuggestion | null => {
  if (!orientationCard?.isValid) {
    return null;
  }

  const suggestion = orientationCard.suggestedApplyOrientation;
  if (!hasCompleteOrientationSuggestion(suggestion)) {
    return null;
  }

  if (
    suggestion.sourceUpAxis === suggestion.targetUpAxis &&
    suggestion.sourceForwardAxis === suggestion.targetForwardAxis
  ) {
    return null;
  }

  return suggestion;
};

export const buildOrientationReviewSummary = (
  orientationCard: RobotOrientationCard | null | undefined
): string | null => {
  if (!orientationCard?.isValid) {
    return null;
  }

  const up = orientationCard.summary.likelyUpDirection;
  const forward = orientationCard.summary.likelyForwardDirection;
  if (!up || !forward) {
    return "Orientation is underconstrained. Load the robot in the viewer and confirm it looks upright.";
  }

  const currentBasis = `${up} up / ${forward} forward`;
  const suggestion = getActionableOrientationSuggestion(orientationCard);
  if (!suggestion) {
    return `Likely ${currentBasis}. This already matches the default Z-up / X-forward basis.`;
  }

  return `Likely ${currentBasis}. Align to ${suggestion.targetUpAxis} up / ${suggestion.targetForwardAxis} forward before export.`;
};

export const buildOrientationStatus = (
  orientationCard: RobotOrientationCard | null | undefined
): OrientationStatus | null => {
  if (!orientationCard?.isValid) {
    return null;
  }

  const upDirection = orientationCard.summary.likelyUpDirection;
  const forwardDirection = orientationCard.summary.likelyForwardDirection;
  const summary = buildOrientationReviewSummary(orientationCard);
  if (!upDirection || !forwardDirection || !summary) {
    return null;
  }

  const upLabel = formatAxisDirectionLabel(upDirection, "up");
  const forwardLabel = formatAxisDirectionLabel(forwardDirection, "forward");

  return {
    upLabel,
    forwardLabel,
    basisLabel: `${upLabel} / ${forwardLabel}`,
    summary,
  };
};
