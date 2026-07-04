import { useCallback, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import type {
  RepeatedInertiaGroupActionState,
  RepeatedInertiaGroupOutcome,
} from "@/app/pages/index/indexPageRuntimeHelpers";
import type { SimulationPrepAcceptedUrdfReviewState } from "@/app/pages/index/useSimulationPrepReviewState";
import type { UseRobotMirrorSelectionControllerResult } from "@/app/pages/index/useRobotMirrorSelectionController";
import {
  buildRepeatedInertiaSymmetryChainKey,
  type RepeatedInertiaSymmetryChain,
} from "@/features/layout/page/repeatedInertiaSymmetry";
import type { RepeatedInertiaDiagnosticGroup } from "@/features/layout/page/repeatedInertiaDiagnostics";
import type { RepeatedInertiaSymmetryLinkCentersLocal } from "@/features/layout/page/repeatedInertiaSymmetryRobot";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import {
  applyRobotMirrorParallelFix,
  applyRobotMirrorSymmetryFix,
  type RobotMirrorFixMode,
  type RobotMirrorOutcome,
} from "@/features/layout/page/robotMirrorSymmetryFix";
import type { RobotMirrorSelectionLink } from "@/features/layout/page/robotMirrorSymmetrySelection";
import {
  buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey,
  collectRepeatedInertiaSymmetryFamilyLinkNames,
} from "@/features/layout/page/simulationPrepViewerState";
import { applyRepeatedInertiaSymmetryFix } from "@/features/layout/page/repeatedInertiaSymmetryFix";
import {
  applyRepeatedInertiaGroupManualFix,
  REPEATED_INERTIA_MANUAL_FIX_ALREADY_CONSISTENT_ERROR,
  REPEATED_INERTIA_MANUAL_FIX_DIFFERS_TOO_MUCH_ERROR,
  REPEATED_INERTIA_MANUAL_FIX_LOW_CONFIDENCE_ERROR,
  REPEATED_INERTIA_MANUAL_FIX_POSTWRITE_MISMATCH_ERROR,
} from "@/features/urdf/inertia/repeatedInertiaManualFix";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import type { MeshFiles } from "@/shared/types/feature";

type ApplySimulationPrepUrdfUpdate = (
  update: {
    nextUrdfContent: string;
    successMessage: string;
  } & SimulationPrepAcceptedUrdfReviewState
) => Promise<void>;

export type UseSimulationPrepRepairActionsOptions = {
  applySimulationPrepUrdfUpdate: ApplySimulationPrepUrdfUpdate;
  enableSimulationPrepViewerHighlights: (linkNames: string[]) => void;
  hasSimulationPrepFixActionInFlight: boolean;
  meshFiles: MeshFiles;
  packageRoots?: Record<string, string[]>;
  repeatedInertiaDiagnostics: readonly RepeatedInertiaDiagnosticGroup[];
  repeatedInertiaDiagnosticsByKey: ReadonlyMap<string, RepeatedInertiaDiagnosticGroup>;
  repeatedInertiaSymmetryLinkCentersLocal: RepeatedInertiaSymmetryLinkCentersLocal;
  robotMirrorFixAvailability: UseRobotMirrorSelectionControllerResult["robotMirrorFixAvailability"];
  robotMirrorScopeKey: string | null;
  robotMirrorSelectionLinks: readonly RobotMirrorSelectionLink[];
  robotMirrorSymmetryCheck: RobotMirrorSymmetryCheck | null;
  robotMirrorVisualizationLinkNames: readonly string[];
  selectedRobotMirrorLinkNames: readonly string[];
  setActiveInertiaVisualizationScopeKey: Dispatch<SetStateAction<string | null>>;
  setActiveRobotMirrorAction: Dispatch<SetStateAction<RobotMirrorFixMode | null>>;
  setIsRobotMirrorActing: Dispatch<SetStateAction<boolean>>;
  setRepeatedInertiaGroupAction: Dispatch<SetStateAction<RepeatedInertiaGroupActionState | null>>;
  setRepeatedInertiaOutcomeByGroupKey: Dispatch<
    SetStateAction<Record<string, RepeatedInertiaGroupOutcome>>
  >;
  setRepeatedInertiaResolvedGroupKeys: Dispatch<SetStateAction<string[]>>;
  setRepeatedInertiaSymmetryActingChainKey: Dispatch<SetStateAction<string | null>>;
  setRepeatedInertiaSymmetryActingProgress: Dispatch<
    SetStateAction<{
      chainKey: string;
      appliedStepCount: number;
      totalStepCount: number;
    } | null>
  >;
  setRobotMirrorOutcome: Dispatch<SetStateAction<RobotMirrorOutcome | null>>;
  setShowHealthActionPanel: Dispatch<SetStateAction<boolean>>;
  urdfAnalysis: UrdfAnalysis | null;
  urdfBasePath?: string;
  vizUrdfContent: string;
};

export type UseSimulationPrepRepairActionsResult = {
  handleAlignRobotMirrorOrientation: () => Promise<void>;
  handleFixRepeatedInertiaGroup: (groupKey: string) => Promise<void>;
  handleFixRepeatedInertiaSymmetryChain: (
    chain: RepeatedInertiaSymmetryChain
  ) => Promise<void>;
  handleFixRobotMirrorSymmetry: () => Promise<void>;
};

const rejectedRepeatedInertiaFixErrors = new Set<string>([
  REPEATED_INERTIA_MANUAL_FIX_LOW_CONFIDENCE_ERROR,
  REPEATED_INERTIA_MANUAL_FIX_POSTWRITE_MISMATCH_ERROR,
  REPEATED_INERTIA_MANUAL_FIX_DIFFERS_TOO_MUCH_ERROR,
]);

const waitForViewerPaint = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
};

export const useSimulationPrepRepairActions = ({
  applySimulationPrepUrdfUpdate,
  enableSimulationPrepViewerHighlights,
  hasSimulationPrepFixActionInFlight,
  meshFiles,
  packageRoots,
  repeatedInertiaDiagnostics,
  repeatedInertiaDiagnosticsByKey,
  repeatedInertiaSymmetryLinkCentersLocal,
  robotMirrorFixAvailability,
  robotMirrorScopeKey,
  robotMirrorSelectionLinks,
  robotMirrorSymmetryCheck,
  robotMirrorVisualizationLinkNames,
  selectedRobotMirrorLinkNames,
  setActiveInertiaVisualizationScopeKey,
  setActiveRobotMirrorAction,
  setIsRobotMirrorActing,
  setRepeatedInertiaGroupAction,
  setRepeatedInertiaOutcomeByGroupKey,
  setRepeatedInertiaResolvedGroupKeys,
  setRepeatedInertiaSymmetryActingChainKey,
  setRepeatedInertiaSymmetryActingProgress,
  setRobotMirrorOutcome,
  setShowHealthActionPanel,
  urdfAnalysis,
  urdfBasePath,
  vizUrdfContent,
}: UseSimulationPrepRepairActionsOptions): UseSimulationPrepRepairActionsResult => {
  useEffect(() => {
    setRepeatedInertiaResolvedGroupKeys((current) =>
      current.filter((groupKey) => repeatedInertiaDiagnosticsByKey.has(groupKey))
    );
  }, [repeatedInertiaDiagnosticsByKey, setRepeatedInertiaResolvedGroupKeys]);

  useEffect(() => {
    setRepeatedInertiaOutcomeByGroupKey((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([groupKey]) => repeatedInertiaDiagnosticsByKey.has(groupKey))
      )
    );
  }, [repeatedInertiaDiagnosticsByKey, setRepeatedInertiaOutcomeByGroupKey]);

  const handleFixRepeatedInertiaGroup = useCallback(
    async (groupKey: string) => {
      if (hasSimulationPrepFixActionInFlight) {
        return;
      }

      setRepeatedInertiaGroupAction({ groupKey });
      try {
        const result = await applyRepeatedInertiaGroupManualFix({
          urdfContent: vizUrdfContent,
          urdfAnalysis,
          groupKey,
          meshFiles,
          urdfBasePath,
          packageRoots,
        });

        if (result.ok === false) {
          if (result.error === REPEATED_INERTIA_MANUAL_FIX_ALREADY_CONSISTENT_ERROR) {
            setRepeatedInertiaResolvedGroupKeys((current) =>
              current.includes(groupKey) ? current : [...current, groupKey]
            );
            setRepeatedInertiaOutcomeByGroupKey((current) => ({
              ...current,
              [groupKey]: {
                tone: "resolved",
                message: "No changes applied. Group is already consistent.",
              },
            }));
          } else if (rejectedRepeatedInertiaFixErrors.has(result.error)) {
            setRepeatedInertiaOutcomeByGroupKey((current) => ({
              ...current,
              [groupKey]: {
                tone: "warning",
                message:
                  "No changes applied. Fix was rejected because it would worsen the result. Manual review required.",
              },
            }));
          } else {
            setRepeatedInertiaOutcomeByGroupKey((current) => ({
              ...current,
              [groupKey]: {
                tone: "warning",
                message: "No changes applied. This repeated group needs manual review.",
              },
            }));
          }
          toast.error(result.error);
          return;
        }

        await applySimulationPrepUrdfUpdate({
          nextUrdfContent: result.draftUrdfContent,
          successMessage: `Unified repeated group for ${result.linkNames.length} link${result.linkNames.length === 1 ? "" : "s"} (${result.meshReference}).`,
        });
        setRepeatedInertiaOutcomeByGroupKey((current) => ({
          ...current,
          [groupKey]: {
            tone: "success",
            message: "Direct fix applied to this repeated group.",
          },
        }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to fix the repeated mesh group.");
      } finally {
        setRepeatedInertiaGroupAction(null);
      }
    },
    [
      applySimulationPrepUrdfUpdate,
      hasSimulationPrepFixActionInFlight,
      meshFiles,
      packageRoots,
      setRepeatedInertiaGroupAction,
      setRepeatedInertiaOutcomeByGroupKey,
      setRepeatedInertiaResolvedGroupKeys,
      urdfAnalysis,
      urdfBasePath,
      vizUrdfContent,
    ]
  );

  const handleFixRepeatedInertiaSymmetryChain = useCallback(
    async (chain: RepeatedInertiaSymmetryChain) => {
      const chainKey = buildRepeatedInertiaSymmetryChainKey({
        symmetryRootLinkName: chain.symmetryRootLinkName,
        outlierBranchRootLinkName: chain.outlierBranchRootLinkName,
      });
      const symmetryScopeKey = buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey(chain);
      const symmetryScopedLinkNames = collectRepeatedInertiaSymmetryFamilyLinkNames(chain);
      if (hasSimulationPrepFixActionInFlight) {
        return;
      }

      enableSimulationPrepViewerHighlights(symmetryScopedLinkNames);
      setActiveInertiaVisualizationScopeKey(symmetryScopeKey);
      setShowHealthActionPanel(true);
      setRepeatedInertiaSymmetryActingChainKey(chainKey);
      setRepeatedInertiaSymmetryActingProgress({
        chainKey,
        appliedStepCount: 0,
        totalStepCount: chain.recommendedRepair?.stepCount ?? 0,
      });
      try {
        const result = await applyRepeatedInertiaSymmetryFix({
          chain,
          linkCentersLocal: repeatedInertiaSymmetryLinkCentersLocal,
          repeatedInertiaDiagnostics,
          urdfContent: vizUrdfContent,
          onProgress: async ({ appliedStepCount, totalStepCount }) => {
            setRepeatedInertiaSymmetryActingProgress({
              chainKey,
              appliedStepCount,
              totalStepCount,
            });
            await waitForViewerPaint();
          },
        });
        if (result.ok === false) {
          toast.error(result.error);
          return;
        }
        await applySimulationPrepUrdfUpdate({
          nextUrdfContent: result.draftUrdfContent,
          pinnedSymmetryChain: chain,
          pinnedSymmetryOutcome: {
            completedProgress: {
              appliedStepCount: result.appliedStepCount,
              totalStepCount: chain.recommendedRepair?.stepCount ?? result.appliedStepCount,
            },
            tone: "success",
            message: "Alignment applied. Keep the eye on to verify the result.",
          },
          successMessage: result.summary,
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to auto-align the symmetry branch."
        );
      } finally {
        setRepeatedInertiaSymmetryActingChainKey(null);
        setRepeatedInertiaSymmetryActingProgress(null);
      }
    },
    [
      applySimulationPrepUrdfUpdate,
      enableSimulationPrepViewerHighlights,
      hasSimulationPrepFixActionInFlight,
      repeatedInertiaDiagnostics,
      repeatedInertiaSymmetryLinkCentersLocal,
      setActiveInertiaVisualizationScopeKey,
      setRepeatedInertiaSymmetryActingChainKey,
      setRepeatedInertiaSymmetryActingProgress,
      setShowHealthActionPanel,
      vizUrdfContent,
    ]
  );

  const runRobotMirrorFix = useCallback(
    async (fixMode: RobotMirrorFixMode) => {
      if (hasSimulationPrepFixActionInFlight || robotMirrorFixAvailability.isLoading) {
        return;
      }
      if (
        fixMode === "orientation-only" &&
        !robotMirrorFixAvailability.value.orientationOnlyAvailable
      ) {
        return;
      }
      if (fixMode === "center-only" && !robotMirrorFixAvailability.value.centerOnlyAvailable) {
        return;
      }

      if (robotMirrorScopeKey) {
        enableSimulationPrepViewerHighlights([...robotMirrorVisualizationLinkNames]);
        setActiveInertiaVisualizationScopeKey(robotMirrorScopeKey);
      }
      setShowHealthActionPanel(true);
      setRobotMirrorOutcome(null);
      setActiveRobotMirrorAction(fixMode);
      setIsRobotMirrorActing(true);
      try {
        const result =
          fixMode === "orientation-only"
            ? await applyRobotMirrorParallelFix({
                meshFiles,
                packageRoots,
                robotMirrorSymmetryCheck,
                selectedLinkNames: selectedRobotMirrorLinkNames,
                selectionLinks: robotMirrorSelectionLinks,
                urdfBasePath,
                urdfContent: vizUrdfContent,
              })
            : applyRobotMirrorSymmetryFix({
                fixMode,
                linkCentersLocal: repeatedInertiaSymmetryLinkCentersLocal,
                orientationMode: "conservative",
                robotMirrorSymmetryCheck,
                selectedLinkNames: selectedRobotMirrorLinkNames,
                selectionLinks: robotMirrorSelectionLinks,
                urdfContent: vizUrdfContent,
              });
        if (result.ok === false) {
          setRobotMirrorOutcome({
            tone: "warning",
            message: result.error,
          });
          toast.error(result.error);
          return;
        }
        await applySimulationPrepUrdfUpdate({
          nextUrdfContent: result.draftUrdfContent,
          robotMirrorOutcome: {
            linkResults: result.linkResults,
            message: result.summary,
            tone: "success",
          },
          successMessage: result.summary,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to auto-align the mirror selection.";
        setRobotMirrorOutcome({
          tone: "warning",
          message,
        });
        toast.error(message);
      } finally {
        setIsRobotMirrorActing(false);
        setActiveRobotMirrorAction(null);
      }
    },
    [
      applySimulationPrepUrdfUpdate,
      enableSimulationPrepViewerHighlights,
      hasSimulationPrepFixActionInFlight,
      meshFiles,
      packageRoots,
      repeatedInertiaSymmetryLinkCentersLocal,
      robotMirrorFixAvailability,
      robotMirrorScopeKey,
      robotMirrorSelectionLinks,
      robotMirrorSymmetryCheck,
      robotMirrorVisualizationLinkNames,
      selectedRobotMirrorLinkNames,
      setActiveInertiaVisualizationScopeKey,
      setActiveRobotMirrorAction,
      setIsRobotMirrorActing,
      setRobotMirrorOutcome,
      setShowHealthActionPanel,
      urdfBasePath,
      vizUrdfContent,
    ]
  );

  const handleFixRobotMirrorSymmetry = useCallback(
    async () => runRobotMirrorFix("center-only"),
    [runRobotMirrorFix]
  );
  const handleAlignRobotMirrorOrientation = useCallback(
    async () => runRobotMirrorFix("orientation-only"),
    [runRobotMirrorFix]
  );

  return {
    handleAlignRobotMirrorOrientation,
    handleFixRepeatedInertiaGroup,
    handleFixRepeatedInertiaSymmetryChain,
    handleFixRobotMirrorSymmetry,
  };
};
