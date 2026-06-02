import { describe, expect, it } from "vitest";
import type { RobotOrientationCard } from "@/shared/lib/urdfCore";
import {
  buildOrientationStatus,
  buildOrientationReviewSummary,
  getActionableOrientationSuggestion,
} from "@/shared/lib/orientationReview";

const createOrientationCard = (
  suggestion: RobotOrientationCard["suggestedApplyOrientation"]
): RobotOrientationCard =>
  ({
    schema: "i-love-urdf/robot-orientation-card",
    schemaVersion: 1,
    isValid: true,
    robotName: "demo",
    summary: {
      classification: "z-up",
      confidence: 0.91,
      likelyUpAxis: "z",
      likelyUpDirection: "+z",
      likelyForwardAxis: "x",
      likelyForwardDirection: "+x",
      likelyLateralAxis: "y",
      likelyLateralDirection: "+y",
    },
    targetBasis: {
      up: "+z",
      forward: "+x",
    },
    spans: { x: 1, y: 1, z: 1 },
    jointAxisVotes: { x: 0, y: 0, z: 0 },
    wheelAxisVotes: { x: 0, y: 0, z: 0 },
    wheelJointNames: [],
    signals: [],
    report: { evidence: [], conflicts: [] },
    assumptions: [],
    suggestedRotate90: null,
    suggestedApplyOrientation: suggestion,
  }) as unknown as RobotOrientationCard;

describe("orientationReview", () => {
  it("treats identical source and target orientation as already aligned", () => {
    const card = createOrientationCard({
      sourceUpAxis: "+z",
      sourceForwardAxis: "+x",
      targetUpAxis: "+z",
      targetForwardAxis: "+x",
      command: "ilu apply-orientation ...",
    });

    expect(getActionableOrientationSuggestion(card)).toBeNull();
    expect(buildOrientationReviewSummary(card)).toContain("already matches");
  });

  it("keeps actionable orientation suggestions when axes still differ", () => {
    const card = createOrientationCard({
      sourceUpAxis: "+z",
      sourceForwardAxis: "-y",
      targetUpAxis: "+z",
      targetForwardAxis: "+x",
      command: "ilu apply-orientation ...",
    });

    expect(getActionableOrientationSuggestion(card)).toMatchObject({
      sourceUpAxis: "+z",
      sourceForwardAxis: "-y",
      targetUpAxis: "+z",
      targetForwardAxis: "+x",
    });
    expect(buildOrientationReviewSummary(card)).toContain("Align to +z up / +x forward");
  });

  it("formats a persistent orientation status for UI surfaces", () => {
    const card = createOrientationCard({
      sourceUpAxis: "+y",
      sourceForwardAxis: "+x",
      targetUpAxis: "+z",
      targetForwardAxis: "+x",
      command: "ilu apply-orientation ...",
    });
    card.summary.likelyUpDirection = "+y";
    card.summary.likelyForwardDirection = "-x";

    expect(buildOrientationStatus(card)).toEqual({
      upLabel: "Y-up",
      forwardLabel: "-X-forward",
      basisLabel: "Y-up / -X-forward",
      summary: "Likely +y up / -x forward. Align to +z up / +x forward before export.",
    });
  });
});
