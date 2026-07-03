import { describe, expect, it } from "vitest";
import {
  buildBakeDraftFingerprint,
  buildCanonicalDraftFingerprint,
  buildOrientationReviewState,
  buildPhysicsDraftFingerprint,
} from "@/app/pages/index/simulationPrepDerivations";
import type { CanonicalSynthesisPreviewSession } from "@/app/pages/index/indexPageRuntimeHelpers";
import type { RobotFrameLintResult } from "@/features/urdf/lint/robotFrameLinter";
import type { UrdfBakePreviewSession } from "@/features/urdf/bake/virtualBake";
import type {
  InertialMassDeltaSummary,
  InertialSynthesisSummary,
} from "@/features/urdf/inertia/inertialSynthesis";
import type { RobotOrientationCard } from "@/shared/lib/urdfCore";

const createFrameLint = (
  overrides: Partial<RobotFrameLintResult> = {}
): RobotFrameLintResult =>
  ({
    robotName: "robot",
    verdict: "canonical",
    rewriteSafe: true,
    orientationCard: null,
    transformCompensation: {},
    wheelStats: {},
    issues: [],
    ...overrides,
  }) as RobotFrameLintResult;

const createOrientationCard = (
  overrides: Partial<RobotOrientationCard> = {}
): RobotOrientationCard =>
  ({
    schema: "i-love-urdf/robot-orientation-card",
    schemaVersion: 1,
    isValid: true,
    robotName: "robot",
    summary: {
      classification: "z-up",
      confidence: 0.91,
      likelyForwardAxis: "x",
      likelyForwardDirection: "+x",
      likelyLateralAxis: "y",
      likelyLateralDirection: "+y",
      likelyUpAxis: "z",
      likelyUpDirection: "+z",
    },
    targetBasis: {
      forward: "+x",
      up: "+z",
    },
    spans: { x: 1, y: 1, z: 1 },
    jointAxisVotes: { x: 0, y: 0, z: 0 },
    suggestedApplyOrientation: null,
    wheelAxisVotes: { x: 0, y: 0, z: 0 },
    wheelJointNames: [],
    signals: [],
    report: { evidence: [], conflicts: [] },
    assumptions: [],
    suggestedRotate90: null,
    ...overrides,
  }) as unknown as RobotOrientationCard;

describe("simulationPrepDerivations", () => {
  it("combines orientation review and frame lint state", () => {
    const state = buildOrientationReviewState({
      orientationCard: createOrientationCard(),
      robotFrameLint: createFrameLint({
        verdict: "unsafe-to-rewrite",
        rewriteSafe: false,
      }),
    });

    expect(state.needsAttention).toBe(true);
    expect(state.canAlignOrientation).toBe(false);
    expect(state.canPreviewBakeVisualTransforms).toBe(true);
    expect(state.summary).toContain("Likely +z up / +x forward.");
    expect(state.summary).toContain("A global orientation rewrite is unsafe.");
    expect(state.status?.summary).toBe(state.summary);
  });

  it("marks actionable orientation suggestions when frame lint allows rewrite", () => {
    const state = buildOrientationReviewState({
      orientationCard: createOrientationCard({
        suggestedApplyOrientation: {
          command: "ilu apply-orientation ...",
          sourceForwardAxis: "+y",
          sourceUpAxis: "+x",
          targetForwardAxis: "+x",
          targetUpAxis: "+z",
        },
        summary: {
          classification: "x-up",
          confidence: 0.91,
          likelyForwardAxis: "y",
          likelyForwardDirection: "+y",
          likelyLateralAxis: "z",
          likelyLateralDirection: "+z",
          likelyUpAxis: "x",
          likelyUpDirection: "+x",
        },
      }),
      robotFrameLint: createFrameLint({ rewriteSafe: true }),
    });

    expect(state.suggestion).not.toBeNull();
    expect(state.canAlignOrientation).toBe(true);
    expect(state.needsAttention).toBe(true);
  });

  it("builds stable draft fingerprints and empty sentinels", () => {
    expect(
      buildPhysicsDraftFingerprint({
        inertialMassDeltaSummary: null,
        inertialSynthesisSummary: null,
      })
    ).toBe("no-physics-draft");
    expect(
      buildBakeDraftFingerprint({
        bakePreviewSession: null,
        entryCount: 0,
        linkCount: 0,
        meshBackedEntryCount: 0,
      })
    ).toBe("no-bake-draft");
    expect(buildCanonicalDraftFingerprint(null)).toBe("no-canonical-draft");

    const physicsFingerprint = buildPhysicsDraftFingerprint({
      inertialMassDeltaSummary: {
        changedLinkCount: 2,
        totalMassAfterKg: 1.23456,
      } as InertialMassDeltaSummary,
      inertialSynthesisSummary: {
        densityPresetId: "aluminum",
        repairMode: "replace-all",
        synthesizedLinkCount: 3,
        voxelFallbackLinkCount: 1,
      } as InertialSynthesisSummary,
    });
    const bakeFingerprint = buildBakeDraftFingerprint({
      bakePreviewSession: {
        stagedContent: "<robot />",
      } as UrdfBakePreviewSession,
      entryCount: 4,
      linkCount: 2,
      meshBackedEntryCount: 3,
    });
    const canonicalFingerprint = buildCanonicalDraftFingerprint({
      draftContent: "<robot name=\"canonical\" />",
      preview: {
        jointCount: 6,
        linkCount: 7,
        robotName: "canonical",
        rootLinkName: "base",
        supportPlane: {
          confidence: 0.876,
        },
      },
    } as CanonicalSynthesisPreviewSession);

    expect(physicsFingerprint).toBe("aluminum|replace-all|3|1|2|1.235");
    expect(bakeFingerprint).toBe("4|3|2|9");
    expect(canonicalFingerprint).toBe("canonical|base|7|6|0.88|26");
  });
});
