import { useCallback, useMemo, useState } from "react";

import type { RobotMirrorFixMode, RobotMirrorOutcome } from "@/features/layout/page/robotMirrorSymmetryFix";
import {
  buildRepeatedInertiaSymmetryChainKey,
  type RepeatedInertiaSymmetryChain,
} from "@/features/layout/page/repeatedInertiaSymmetry";
import {
  REPEATED_INERTIA_SYMMETRY_DEFAULT_CENTER_MODE,
  type RepeatedInertiaSymmetryCenterMode,
} from "@/features/layout/page/repeatedInertiaSymmetryCenterMode";
import {
  buildRepeatedInertiaSymmetryFamilyOutcomeKey,
  type SimulationPrepVisualizationPreview,
} from "@/features/layout/page/simulationPrepViewerState";
import type { UrdfBakePreviewSession } from "@/features/urdf/bake/virtualBake";
import type {
  CanonicalSynthesisPreviewSession,
  InertialSynthesisSession,
  RepeatedInertiaGroupActionState,
  RepeatedInertiaGroupOutcome,
  RepeatedInertiaSymmetryOutcome,
} from "@/app/pages/index/indexPageRuntimeHelpers";

export type SimulationPrepAcceptedUrdfReviewState = {
  pinnedSymmetryChain?: RepeatedInertiaSymmetryChain | null;
  pinnedSymmetryOutcome?: RepeatedInertiaSymmetryOutcome | null;
  robotMirrorOutcome?: RobotMirrorOutcome | null;
};

const buildPinnedRepeatedInertiaSymmetryChains = (
  pinnedSymmetryChain: RepeatedInertiaSymmetryChain | null | undefined
): RepeatedInertiaSymmetryChain[] =>
  pinnedSymmetryChain
    ? [
        {
          ...pinnedSymmetryChain,
          recommendedRepair: null,
        },
      ]
    : [];

const buildRepeatedInertiaSymmetryOutcomeByChainKey = ({
  pinnedSymmetryChain,
  pinnedSymmetryOutcome,
}: Pick<
  SimulationPrepAcceptedUrdfReviewState,
  "pinnedSymmetryChain" | "pinnedSymmetryOutcome"
>): Record<string, RepeatedInertiaSymmetryOutcome> => {
  if (!pinnedSymmetryChain || !pinnedSymmetryOutcome) {
    return {};
  }

  return {
    [buildRepeatedInertiaSymmetryFamilyOutcomeKey(pinnedSymmetryChain)]: pinnedSymmetryOutcome,
    [buildRepeatedInertiaSymmetryChainKey({
      symmetryRootLinkName: pinnedSymmetryChain.symmetryRootLinkName,
      outlierBranchRootLinkName: pinnedSymmetryChain.outlierBranchRootLinkName,
    })]: pinnedSymmetryOutcome,
  };
};

export const useSimulationPrepReviewState = () => {
  const [activeInertiaVisualizationScopeKey, setActiveInertiaVisualizationScopeKey] =
    useState<string | null>(null);
  const [activeRobotMirrorAction, setActiveRobotMirrorAction] =
    useState<RobotMirrorFixMode | null>(null);
  const [bakePreviewSession, setBakePreviewSession] =
    useState<UrdfBakePreviewSession | null>(null);
  const [canonicalSynthesisPreview, setCanonicalSynthesisPreview] =
    useState<CanonicalSynthesisPreviewSession | null>(null);
  const [hoveredInertiaVisualizationPreview, setHoveredInertiaVisualizationPreview] =
    useState<SimulationPrepVisualizationPreview | null>(null);
  const [inertialSynthesisSession, setInertialSynthesisSession] =
    useState<InertialSynthesisSession | null>(null);
  const [isRobotMirrorActing, setIsRobotMirrorActing] = useState(false);
  const [pinnedRepeatedInertiaSymmetryChains, setPinnedRepeatedInertiaSymmetryChains] = useState<
    RepeatedInertiaSymmetryChain[]
  >([]);
  const [repeatedInertiaGroupAction, setRepeatedInertiaGroupAction] =
    useState<RepeatedInertiaGroupActionState | null>(null);
  const [repeatedInertiaOutcomeByGroupKey, setRepeatedInertiaOutcomeByGroupKey] = useState<
    Record<string, RepeatedInertiaGroupOutcome>
  >({});
  const [repeatedInertiaResolvedGroupKeys, setRepeatedInertiaResolvedGroupKeys] = useState<
    string[]
  >([]);
  const [repeatedInertiaSymmetryActingChainKey, setRepeatedInertiaSymmetryActingChainKey] =
    useState<string | null>(null);
  const [repeatedInertiaSymmetryActingProgress, setRepeatedInertiaSymmetryActingProgress] =
    useState<{
      chainKey: string;
      appliedStepCount: number;
      totalStepCount: number;
    } | null>(null);
  const [repeatedInertiaSymmetryCenterMode, setRepeatedInertiaSymmetryCenterMode] =
    useState<RepeatedInertiaSymmetryCenterMode>(
      REPEATED_INERTIA_SYMMETRY_DEFAULT_CENTER_MODE
    );
  const [repeatedInertiaSymmetryOutcomeByChainKey, setRepeatedInertiaSymmetryOutcomeByChainKey] =
    useState<Record<string, RepeatedInertiaSymmetryOutcome>>({});
  const [robotMirrorOutcome, setRobotMirrorOutcome] = useState<RobotMirrorOutcome | null>(null);
  const [showHealthActionPanel, setShowHealthActionPanel] = useState(false);
  const [simulationPrepResetPoseRequestKey, setSimulationPrepResetPoseRequestKey] = useState<
    string | null
  >(null);
  const [simulationPrepReviewResetRevision, setSimulationPrepReviewResetRevision] = useState(0);

  const hasExternalSimulationPrepFixActionInFlight = useMemo(
    () =>
      repeatedInertiaGroupAction !== null ||
      repeatedInertiaSymmetryActingChainKey !== null ||
      isRobotMirrorActing,
    [
      isRobotMirrorActing,
      repeatedInertiaGroupAction,
      repeatedInertiaSymmetryActingChainKey,
    ]
  );

  const clearDraftSessions = useCallback(() => {
    setBakePreviewSession(null);
    setCanonicalSynthesisPreview(null);
    setInertialSynthesisSession(null);
  }, []);

  const clearRepeatedInertiaReview = useCallback(() => {
    setRepeatedInertiaResolvedGroupKeys([]);
    setRepeatedInertiaOutcomeByGroupKey({});
  }, []);

  const clearSimulationPrepReviewActions = useCallback(() => {
    setRepeatedInertiaGroupAction(null);
    setRepeatedInertiaSymmetryActingChainKey(null);
    setRepeatedInertiaSymmetryActingProgress(null);
    setRobotMirrorOutcome(null);
    setActiveRobotMirrorAction(null);
    setIsRobotMirrorActing(false);
  }, []);

  const resetSimulationPrepReviewState = useCallback(() => {
    setShowHealthActionPanel(false);
    setHoveredInertiaVisualizationPreview(null);
    setActiveInertiaVisualizationScopeKey(null);
    clearRepeatedInertiaReview();
    setPinnedRepeatedInertiaSymmetryChains([]);
    setRepeatedInertiaSymmetryOutcomeByChainKey({});
    clearSimulationPrepReviewActions();
    setSimulationPrepReviewResetRevision((revision) => revision + 1);
  }, [clearRepeatedInertiaReview, clearSimulationPrepReviewActions]);

  const applyAcceptedUrdfReviewState = useCallback(
    ({
      pinnedSymmetryChain,
      pinnedSymmetryOutcome,
      robotMirrorOutcome,
    }: SimulationPrepAcceptedUrdfReviewState) => {
      clearDraftSessions();
      clearRepeatedInertiaReview();
      setPinnedRepeatedInertiaSymmetryChains(
        buildPinnedRepeatedInertiaSymmetryChains(pinnedSymmetryChain)
      );
      setRepeatedInertiaSymmetryOutcomeByChainKey(
        buildRepeatedInertiaSymmetryOutcomeByChainKey({
          pinnedSymmetryChain,
          pinnedSymmetryOutcome,
        })
      );
      setRobotMirrorOutcome(robotMirrorOutcome ?? null);
    },
    [clearDraftSessions, clearRepeatedInertiaReview]
  );

  return {
    activeInertiaVisualizationScopeKey,
    activeRobotMirrorAction,
    applyAcceptedUrdfReviewState,
    bakePreviewSession,
    canonicalSynthesisPreview,
    clearDraftSessions,
    hasExternalSimulationPrepFixActionInFlight,
    hoveredInertiaVisualizationPreview,
    inertialSynthesisSession,
    isRobotMirrorActing,
    pinnedRepeatedInertiaSymmetryChains,
    repeatedInertiaGroupAction,
    repeatedInertiaOutcomeByGroupKey,
    repeatedInertiaResolvedGroupKeys,
    repeatedInertiaSymmetryActingChainKey,
    repeatedInertiaSymmetryActingProgress,
    repeatedInertiaSymmetryCenterMode,
    repeatedInertiaSymmetryOutcomeByChainKey,
    resetSimulationPrepReviewState,
    robotMirrorOutcome,
    setActiveInertiaVisualizationScopeKey,
    setActiveRobotMirrorAction,
    setBakePreviewSession,
    setCanonicalSynthesisPreview,
    setHoveredInertiaVisualizationPreview,
    setInertialSynthesisSession,
    setIsRobotMirrorActing,
    setPinnedRepeatedInertiaSymmetryChains,
    setRepeatedInertiaGroupAction,
    setRepeatedInertiaOutcomeByGroupKey,
    setRepeatedInertiaResolvedGroupKeys,
    setRepeatedInertiaSymmetryActingChainKey,
    setRepeatedInertiaSymmetryActingProgress,
    setRepeatedInertiaSymmetryCenterMode,
    setRobotMirrorOutcome,
    setShowHealthActionPanel,
    setSimulationPrepResetPoseRequestKey,
    showHealthActionPanel,
    simulationPrepResetPoseRequestKey,
    simulationPrepReviewResetRevision,
  };
};
