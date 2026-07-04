/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  useSimulationPrepReviewState,
  type SimulationPrepAcceptedUrdfReviewState,
} from "@/app/pages/index/useSimulationPrepReviewState";
import {
  buildRepeatedInertiaSymmetryChainKey,
  type RepeatedInertiaSymmetryChain,
} from "@/features/layout/page/repeatedInertiaSymmetry";
import { REPEATED_INERTIA_SYMMETRY_DEFAULT_CENTER_MODE } from "@/features/layout/page/repeatedInertiaSymmetryCenterMode";
import { buildRepeatedInertiaSymmetryFamilyOutcomeKey } from "@/features/layout/page/simulationPrepViewerState";

type HookResult = ReturnType<typeof useSimulationPrepReviewState>;

type RenderedHarness = {
  getHook: () => HookResult;
  unmount: () => Promise<void>;
};

const flushAsyncWork = async () => {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
};

const createSymmetryChain = (): RepeatedInertiaSymmetryChain => ({
  affectedLinkNames: ["left_tip"],
  branchCount: 2,
  branchLinkGroups: [],
  branchRows: [],
  earliestDivergenceLinkName: "base",
  expectedAngleDegrees: null,
  maxAngularErrorDegrees: null,
  maxDistanceDeltaMeters: 0.02,
  outlierAngularErrorDegrees: null,
  outlierBranchRootLinkName: "left_branch",
  recommendedRepair: {
    articulatedBoundaryJointName: "left_joint",
    blockedTargetLinkNames: [],
    kind: "translation",
    mode: "single-joint",
    stepCount: 2,
    steps: [],
    summary: "Move left branch.",
    targetLinkNames: ["left_tip"],
  },
  repeatedGroupCount: 1,
  repeatedMeshLabels: ["finger.stl"],
  rootMeshCenterPositionMeters: [0, 0, 0],
  siblingBranchRootLinkNames: ["right_branch"],
  symmetryCenterMode: REPEATED_INERTIA_SYMMETRY_DEFAULT_CENTER_MODE,
  symmetryCenterPositionMeters: [0, 0, 0],
  symmetryRootLinkName: "base",
  symmetryType: "mirror",
  topologyMatchingBranchCount: 2,
});

const renderSimulationPrepReviewStateHook = async (): Promise<RenderedHarness> => {
  let hookValue: HookResult | null = null;
  const root: Root = createRoot(document.createElement("div"));

  const Harness = () => {
    hookValue = useSimulationPrepReviewState();
    return null;
  };

  await act(async () => {
    root.render(createElement(Harness));
    await flushAsyncWork();
  });

  return {
    getHook: () => {
      if (!hookValue) {
        throw new Error("Hook did not render.");
      }
      return hookValue;
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
};

describe("useSimulationPrepReviewState", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("resets active review state and increments the reset revision", async () => {
    const harness = await renderSimulationPrepReviewStateHook();

    await act(async () => {
      const hook = harness.getHook();
      hook.setActiveInertiaVisualizationScopeKey("scope-1");
      hook.setActiveRobotMirrorAction("center-only");
      hook.setHoveredInertiaVisualizationPreview({
        scopeKey: "scope-1",
        scopedLinkNames: ["link_a"],
      });
      hook.setIsRobotMirrorActing(true);
      hook.setRepeatedInertiaGroupAction({ groupKey: "group-a" });
      hook.setRepeatedInertiaOutcomeByGroupKey({
        "group-a": { tone: "warning", message: "Needs review." },
      });
      hook.setRepeatedInertiaResolvedGroupKeys(["group-b"]);
      hook.setRepeatedInertiaSymmetryActingChainKey("chain-a");
      hook.setRepeatedInertiaSymmetryActingProgress({
        chainKey: "chain-a",
        appliedStepCount: 1,
        totalStepCount: 2,
      });
      hook.setRobotMirrorOutcome({ tone: "warning", message: "Mirror needs review." });
      hook.setShowHealthActionPanel(true);
      await flushAsyncWork();
    });

    expect(harness.getHook().hasExternalSimulationPrepFixActionInFlight).toBe(true);
    const initialRevision = harness.getHook().simulationPrepReviewResetRevision;

    await act(async () => {
      harness.getHook().resetSimulationPrepReviewState();
      await flushAsyncWork();
    });

    expect(harness.getHook().activeInertiaVisualizationScopeKey).toBeNull();
    expect(harness.getHook().activeRobotMirrorAction).toBeNull();
    expect(harness.getHook().hoveredInertiaVisualizationPreview).toBeNull();
    expect(harness.getHook().isRobotMirrorActing).toBe(false);
    expect(harness.getHook().hasExternalSimulationPrepFixActionInFlight).toBe(false);
    expect(harness.getHook().repeatedInertiaGroupAction).toBeNull();
    expect(harness.getHook().repeatedInertiaOutcomeByGroupKey).toEqual({});
    expect(harness.getHook().repeatedInertiaResolvedGroupKeys).toEqual([]);
    expect(harness.getHook().repeatedInertiaSymmetryActingChainKey).toBeNull();
    expect(harness.getHook().repeatedInertiaSymmetryActingProgress).toBeNull();
    expect(harness.getHook().robotMirrorOutcome).toBeNull();
    expect(harness.getHook().showHealthActionPanel).toBe(false);
    expect(harness.getHook().simulationPrepReviewResetRevision).toBe(initialRevision + 1);

    await harness.unmount();
  });

  it("clears stale drafts and pins accepted symmetry review evidence", async () => {
    const harness = await renderSimulationPrepReviewStateHook();
    const chain = createSymmetryChain();
    const pinnedSymmetryOutcome: SimulationPrepAcceptedUrdfReviewState["pinnedSymmetryOutcome"] = {
      completedProgress: {
        appliedStepCount: 2,
        totalStepCount: 2,
      },
      message: "Alignment applied.",
      tone: "success",
    };

    await act(async () => {
      const hook = harness.getHook();
      hook.setBakePreviewSession({ stagedContent: "<robot />" } as HookResult["bakePreviewSession"]);
      hook.setCanonicalSynthesisPreview({
        draftContent: "<robot />",
      } as HookResult["canonicalSynthesisPreview"]);
      hook.setInertialSynthesisSession({
        draftContent: "<robot />",
      } as HookResult["inertialSynthesisSession"]);
      hook.setRepeatedInertiaOutcomeByGroupKey({
        stale: { tone: "warning", message: "Old result." },
      });
      hook.setRepeatedInertiaResolvedGroupKeys(["stale"]);
      await flushAsyncWork();
    });

    await act(async () => {
      harness.getHook().applyAcceptedUrdfReviewState({
        pinnedSymmetryChain: chain,
        pinnedSymmetryOutcome,
        robotMirrorOutcome: { tone: "success", message: "Mirror aligned." },
      });
      await flushAsyncWork();
    });

    expect(harness.getHook().bakePreviewSession).toBeNull();
    expect(harness.getHook().canonicalSynthesisPreview).toBeNull();
    expect(harness.getHook().inertialSynthesisSession).toBeNull();
    expect(harness.getHook().repeatedInertiaOutcomeByGroupKey).toEqual({});
    expect(harness.getHook().repeatedInertiaResolvedGroupKeys).toEqual([]);
    expect(harness.getHook().pinnedRepeatedInertiaSymmetryChains).toEqual([
      {
        ...chain,
        recommendedRepair: null,
      },
    ]);
    expect(harness.getHook().repeatedInertiaSymmetryOutcomeByChainKey).toEqual({
      [buildRepeatedInertiaSymmetryFamilyOutcomeKey(chain)]: pinnedSymmetryOutcome,
      [buildRepeatedInertiaSymmetryChainKey(chain)]: pinnedSymmetryOutcome,
    });
    expect(harness.getHook().robotMirrorOutcome).toEqual({
      tone: "success",
      message: "Mirror aligned.",
    });

    await harness.unmount();
  });
});
