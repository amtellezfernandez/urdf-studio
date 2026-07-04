import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import type {
  InertialSynthesisSession,
  PhysicsActionRequest,
  PhysicsPreflightSession,
} from "@/app/pages/index/indexPageRuntimeHelpers";
import {
  collectSynthesizedPhysicsLinkNames,
} from "@/app/pages/index/indexPageRuntimeHelpers";
import type { UseSimulationPrepPreflightResult } from "@/app/pages/index/useSimulationPrepPreflight";
import {
  buildSimulationPrepPhysicsActionStatusMap,
  canQueueSimulationPrepPhysicsAction,
  type SimulationPrepPhysicsActionKey,
} from "@/features/layout/page/simulationPrepState";
import type { UrdfViewMode } from "@/shared/types/feature";
import type { InertialRepairMode } from "@/features/urdf/inertia/inertialSynthesis";
import type { InertialDensityPresetId } from "@/features/urdf/inertia/inertialSynthesisParams";
import { generatePhysicsDraftViaBackend } from "@/features/urdf/inertia/robotMasteringApi";

type UseSimulationPrepPhysicsActionsOptions = {
  externalActionInFlight: boolean;
  inertialDraftBaseContent: string;
  loadPhysicsPreflight: UseSimulationPrepPreflightResult["loadPhysicsPreflight"];
  meshFiles: Record<string, Blob>;
  packageRoots?: Record<string, string[]>;
  physicsGenerationSourceContent: string;
  physicsPreflightSession: PhysicsPreflightSession | null;
  setInertialSynthesisSession: Dispatch<SetStateAction<InertialSynthesisSession | null>>;
  setUrdfViewMode: Dispatch<SetStateAction<UrdfViewMode>>;
  showUrdfEditor: boolean;
  urdfBasePath?: string;
  vizUrdfContent: string;
};

export type UseSimulationPrepPhysicsActionsResult = {
  handleGenerateInertialDraft: (
    linkName: string,
    densityPresetId: InertialDensityPresetId
  ) => Promise<void>;
  handleGeneratePhysicsDraft: (
    densityPresetId: InertialDensityPresetId,
    repairMode: InertialRepairMode
  ) => void;
  handleGenerateRegularizedPhysicsDraft: (densityPresetId: InertialDensityPresetId) => void;
  handleGenerateVoxelPhysicsDraft: (densityPresetId: InertialDensityPresetId) => void;
  isPhysicsActionInFlight: boolean;
  physicsActionStatusByKey: ReturnType<typeof buildSimulationPrepPhysicsActionStatusMap>;
};

const buildUnknownPhysicsActionErrorMessage = (
  actionKey: SimulationPrepPhysicsActionKey
): string => {
  if (actionKey === "voxel-recovery") {
    return "Failed to run volumetric voxelization.";
  }
  if (actionKey === "psd-regularize") {
    return "Failed to regularize near-miss inertials.";
  }
  return "Failed to generate physics draft.";
};

type GeneratePhysicsDraftOptions = Omit<
  Parameters<typeof generatePhysicsDraftViaBackend>[0],
  "canonicalizeRepeatedMeshes" | "meshFiles" | "packageRoots" | "sourceUrdf" | "urdfBasePath"
>;

export const useSimulationPrepPhysicsActions = ({
  externalActionInFlight,
  inertialDraftBaseContent,
  loadPhysicsPreflight,
  meshFiles,
  packageRoots,
  physicsGenerationSourceContent,
  physicsPreflightSession,
  setInertialSynthesisSession,
  setUrdfViewMode,
  showUrdfEditor,
  urdfBasePath,
  vizUrdfContent,
}: UseSimulationPrepPhysicsActionsOptions): UseSimulationPrepPhysicsActionsResult => {
  const [runningPhysicsActionKey, setRunningPhysicsActionKey] =
    useState<SimulationPrepPhysicsActionKey | null>(null);
  const [queuedPhysicsActions, setQueuedPhysicsActions] = useState<PhysicsActionRequest[]>([]);
  const runningPhysicsActionKeyRef = useRef<SimulationPrepPhysicsActionKey | null>(null);
  const queuedPhysicsActionsRef = useRef<PhysicsActionRequest[]>([]);

  const setRunningActionKey = useCallback((actionKey: SimulationPrepPhysicsActionKey | null) => {
    runningPhysicsActionKeyRef.current = actionKey;
    setRunningPhysicsActionKey(actionKey);
  }, []);

  const setQueuedActions = useCallback((actions: PhysicsActionRequest[]) => {
    queuedPhysicsActionsRef.current = actions;
    setQueuedPhysicsActions(actions);
  }, []);

  const queuedPhysicsActionKeys = useMemo(
    () => queuedPhysicsActions.map((request) => request.key),
    [queuedPhysicsActions]
  );
  const physicsActionStatusByKey = useMemo(
    () =>
      buildSimulationPrepPhysicsActionStatusMap({
        runningActionKey: runningPhysicsActionKey,
        queuedActionKeys: queuedPhysicsActionKeys,
      }),
    [queuedPhysicsActionKeys, runningPhysicsActionKey]
  );
  const isPhysicsActionInFlight =
    runningPhysicsActionKey !== null || queuedPhysicsActions.length > 0;

  const stageGeneratedPhysicsDraft = useCallback(
    ({
      jobId,
      auditSummary,
      synthesisResult,
      draftUrdfContent,
    }: {
      jobId?: string | null;
      auditSummary: InertialSynthesisSession["audit"];
      synthesisResult: InertialSynthesisSession["synthesis"];
      draftUrdfContent: string;
    }): string[] => {
      const synthesizedNames = collectSynthesizedPhysicsLinkNames(synthesisResult);
      setInertialSynthesisSession({
        jobId: jobId ?? null,
        sourceContent: vizUrdfContent,
        baseContent: inertialDraftBaseContent,
        audit: auditSummary,
        synthesis: synthesisResult,
        draftContent: draftUrdfContent,
      });
      if (showUrdfEditor) {
        setUrdfViewMode("modified");
      }
      return synthesizedNames;
    },
    [
      inertialDraftBaseContent,
      setInertialSynthesisSession,
      setUrdfViewMode,
      showUrdfEditor,
      vizUrdfContent,
    ]
  );

  const generateAndStagePhysicsDraft = useCallback(
    async (options: GeneratePhysicsDraftOptions) => {
      const result = await generatePhysicsDraftViaBackend({
        sourceUrdf: physicsGenerationSourceContent,
        meshFiles,
        urdfBasePath,
        packageRoots,
        ...options,
        canonicalizeRepeatedMeshes: true,
      });
      const synthesizedNames = stageGeneratedPhysicsDraft({
        jobId: result.jobId,
        auditSummary: result.auditSummary,
        synthesisResult: result.synthesisResult,
        draftUrdfContent: result.draftUrdfContent,
      });
      await loadPhysicsPreflight({ sourceUrdf: result.draftUrdfContent });
      return {
        result,
        synthesizedNames,
      };
    },
    [
      loadPhysicsPreflight,
      meshFiles,
      packageRoots,
      physicsGenerationSourceContent,
      stageGeneratedPhysicsDraft,
      urdfBasePath,
    ]
  );

  const handleGenerateInertialDraft = useCallback(
    async (linkName: string, densityPresetId: InertialDensityPresetId) => {
      try {
        const { synthesizedNames } = await generateAndStagePhysicsDraft({
          densityPresetId,
          repairMode: "replace-all",
          linkNames: [linkName],
        });
        toast.success(`Generated inertial draft for ${synthesizedNames.join(", ")}.`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to generate an inertial draft.");
      }
    },
    [generateAndStagePhysicsDraft]
  );

  const executePhysicsAction = useCallback(
    async (request: PhysicsActionRequest) => {
      try {
        if (request.key === "repair-missing-invalid" || request.key === "replace-all") {
          const { synthesizedNames } = await generateAndStagePhysicsDraft({
            densityPresetId: request.densityPresetId,
            repairMode: request.repairMode,
          });
          toast.success(
            `Physics generated for ${synthesizedNames.length} link${synthesizedNames.length === 1 ? "" : "s"}. Review in Modified view when ready.`
          );
          return;
        }

        if (request.key === "voxel-recovery") {
          const voxelRecoveryLinkNames =
            physicsPreflightSession?.plausibilitySummary.excludedLinks
              .filter((entry) => entry.recoveryDisposition === "recover")
              .map((entry) => entry.linkName) ?? [];
          if (voxelRecoveryLinkNames.length === 0) {
            toast.error("No links currently need volumetric voxel recovery.");
            return;
          }
          const { result, synthesizedNames } = await generateAndStagePhysicsDraft({
            densityPresetId: request.densityPresetId,
            repairMode: "replace-all",
            linkNames: voxelRecoveryLinkNames,
            meshSolveMode: "voxel-only",
          });
          const skippedCount = physicsPreflightSession?.plausibilitySummary.excludedLinks.length ?? 0;
          const targetedCount = result.synthesisResult.results.length;
          const unresolvedCount = result.synthesisResult.results.filter((entry) => entry.status === "skipped").length;
          toast.success(
            `Voxel recovery targeted ${targetedCount} of ${skippedCount} skipped link${skippedCount === 1 ? "" : "s"}, synthesized ${synthesizedNames.length}, and left ${unresolvedCount} unresolved. Review in Modified view when ready.`
          );
          return;
        }

        const regularizableLinkNames =
          physicsPreflightSession?.plausibilitySummary.excludedLinks
            .filter((entry) => entry.recoveryDisposition === "regularize")
            .map((entry) => entry.linkName) ?? [];
        if (regularizableLinkNames.length === 0) {
          toast.error("No near-miss links are currently available for PSD regularization.");
          return;
        }
        const { result, synthesizedNames } = await generateAndStagePhysicsDraft({
          densityPresetId: request.densityPresetId,
          repairMode: "replace-all",
          linkNames: regularizableLinkNames,
          meshSolveMode: "voxel-only",
          regularizeNearMissTensors: true,
        });
        const targetedCount = result.synthesisResult.results.length;
        const unresolvedCount = result.synthesisResult.results.filter((entry) => entry.status === "skipped").length;
        toast.success(
          `PSD regularization targeted ${targetedCount} near-miss link${targetedCount === 1 ? "" : "s"}, synthesized ${synthesizedNames.length}, and left ${unresolvedCount} unresolved. Review in Modified view when ready.`
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : buildUnknownPhysicsActionErrorMessage(request.key)
        );
      }
    },
    [
      generateAndStagePhysicsDraft,
      physicsPreflightSession?.plausibilitySummary.excludedLinks,
    ]
  );

  const startPhysicsAction = useCallback(
    (request: PhysicsActionRequest) => {
      setRunningActionKey(request.key);
      void executePhysicsAction(request).finally(() => {
        setRunningPhysicsActionKey((current) => {
          const nextActionKey = current === request.key ? null : current;
          runningPhysicsActionKeyRef.current = nextActionKey;
          return nextActionKey;
        });
      });
    },
    [executePhysicsAction, setRunningActionKey]
  );

  const queuePhysicsAction = useCallback(
    (request: PhysicsActionRequest) => {
      if (externalActionInFlight) {
        return;
      }
      const runningActionKey = runningPhysicsActionKeyRef.current;
      const queuedActions = queuedPhysicsActionsRef.current;
      const queuedActionKeys = queuedActions.map((queuedRequest) => queuedRequest.key);
      if (runningActionKey === null && queuedActions.length === 0) {
        startPhysicsAction(request);
        return;
      }
      if (
        !canQueueSimulationPrepPhysicsAction({
          runningActionKey,
          queuedActionKeys,
          nextActionKey: request.key,
        })
      ) {
        return;
      }
      if (
        runningActionKey === request.key ||
        queuedActions.some((queuedRequest) => queuedRequest.key === request.key)
      ) {
        return;
      }
      setQueuedActions([...queuedActions, request]);
    },
    [externalActionInFlight, setQueuedActions, startPhysicsAction]
  );

  const handleGeneratePhysicsDraft = useCallback(
    (densityPresetId: InertialDensityPresetId, repairMode: InertialRepairMode) => {
      queuePhysicsAction({
        key: repairMode === "replace-all" ? "replace-all" : "repair-missing-invalid",
        densityPresetId,
        repairMode,
      });
    },
    [queuePhysicsAction]
  );

  const handleGenerateVoxelPhysicsDraft = useCallback(
    (densityPresetId: InertialDensityPresetId) => {
      queuePhysicsAction({
        key: "voxel-recovery",
        densityPresetId,
      });
    },
    [queuePhysicsAction]
  );

  const handleGenerateRegularizedPhysicsDraft = useCallback(
    (densityPresetId: InertialDensityPresetId) => {
      queuePhysicsAction({
        key: "psd-regularize",
        densityPresetId,
      });
    },
    [queuePhysicsAction]
  );

  useEffect(() => {
    if (
      externalActionInFlight ||
      runningPhysicsActionKey !== null ||
      queuedPhysicsActions.length === 0
    ) {
      return;
    }
    const [nextAction, ...remainingActions] = queuedPhysicsActions;
    setQueuedActions(remainingActions);
    startPhysicsAction(nextAction);
  }, [
    externalActionInFlight,
    queuedPhysicsActions,
    runningPhysicsActionKey,
    setQueuedActions,
    startPhysicsAction,
  ]);

  return {
    handleGenerateInertialDraft,
    handleGeneratePhysicsDraft,
    handleGenerateRegularizedPhysicsDraft,
    handleGenerateVoxelPhysicsDraft,
    isPhysicsActionInFlight,
    physicsActionStatusByKey,
  };
};
