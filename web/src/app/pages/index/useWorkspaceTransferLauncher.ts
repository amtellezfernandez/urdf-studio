import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { WorkspaceTransferState } from "@/features/layout/page/workspaceTransferState";
import {
  cancelWorkspaceTransferTargetLaunch,
  fetchWorkspaceTransferTargets,
  fetchWorkspaceTransferTargetStatus,
  openWorkspaceTransferTarget,
  type WorkspaceTransferTargetDescriptor,
  type WorkspaceTransferTargetStatus,
} from "@/features/world-share/workspaceTransferApi";
import {
  isWorkspaceTransferAbortError,
  throwIfWorkspaceTransferAborted,
} from "@/features/world-share/workspaceTransferAbort";
import type { WorkspaceTransferTargetId } from "@/features/world-share/workspaceTransferParams";
import type { WorldSceneRegistryEnvelope } from "@/features/world-share/worldScenePackageTypes";
import { readUnknownErrorMessage } from "@/shared/lib/errorMessages";
import { WORKSPACE_TRANSFER_LAUNCHER_PARAMS } from "@/app/pages/index/workspaceTransferLauncherParams";
import {
  assertWorkspacePackageCarriesSceneObjects,
  buildWorkspaceTransferTargetState,
  canLaunchWorkspaceTransferTarget,
  formatSceneTransferSummary,
  resolveWorkspaceTransferTargetStatusLabel,
} from "@/app/pages/index/workspaceTransferLauncherDerivations";

type UseWorkspaceTransferLauncherParams = {
  activeUrdfPath: string | null;
  attachedIluSessionId: string;
  buildCurrentWorldSceneRegistryEnvelope: () => Promise<WorldSceneRegistryEnvelope>;
  getWorldObjectCountForTransfer?: () => number;
  meshFiles: Record<string, Blob>;
  originalUrdfContent: string;
  packageRoots: Record<string, string[]>;
  vizUrdfContent: string;
  worldCameraCount: number;
  worldObjectCount: number;
};

type WorkspaceTransferLaunch = {
  targetId: WorkspaceTransferTargetId;
  targetLabel: string;
  launchId: string;
  controller: AbortController;
};

const createWorkspaceTransferLaunchId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const timestamp = Date.now().toString(36);
  const entropy = Math.random().toString(36).slice(2);
  return `launch-${timestamp}-${entropy}`;
};

const stopWorkspaceTransferLaunch = (launch: WorkspaceTransferLaunch): void => {
  launch.controller.abort();
  void cancelWorkspaceTransferTargetLaunch({
    targetId: launch.targetId,
    launchId: launch.launchId,
    targetLabel: launch.targetLabel,
  }).catch(() => undefined);
};

const toastUnresolvedMeshRefs = (meshRefs: string[] | undefined): void => {
  if (!meshRefs || meshRefs.length === 0) return;
  const toastLimit = WORKSPACE_TRANSFER_LAUNCHER_PARAMS.unresolvedMeshRefToastLimit;
  const listed = meshRefs.slice(0, toastLimit).join(", ");
  const hiddenCount = meshRefs.length - toastLimit;
  const extra = hiddenCount > 0 ? ` +${hiddenCount} more` : "";
  toast.warning(
    `${meshRefs.length} mesh${meshRefs.length === 1 ? "" : "es"} could not be resolved: ${listed}${extra}`
  );
};

const toastWorkspaceWarnings = (warnings: string[] | undefined): void => {
  warnings
    ?.slice(0, WORKSPACE_TRANSFER_LAUNCHER_PARAMS.workspaceWarningToastLimit)
    .forEach((warning) => {
      toast.warning(warning);
    });
};

export const useWorkspaceTransferLauncher = ({
  activeUrdfPath,
  attachedIluSessionId,
  buildCurrentWorldSceneRegistryEnvelope,
  getWorldObjectCountForTransfer,
  meshFiles,
  originalUrdfContent,
  packageRoots,
  vizUrdfContent,
  worldCameraCount,
  worldObjectCount,
}: UseWorkspaceTransferLauncherParams) => {
  const [loadingTargetId, setLoadingTargetId] = useState<WorkspaceTransferTargetId | null>(null);
  const activeLaunchRef = useRef<WorkspaceTransferLaunch | null>(null);
  const [lastOpenedTargetId, setLastOpenedTargetId] =
    useState<WorkspaceTransferTargetId | null>(null);
  const [targetDescriptors, setTargetDescriptors] = useState<WorkspaceTransferTargetDescriptor[]>(
    []
  );
  const [targetStatuses, setTargetStatuses] = useState<
    Partial<Record<WorkspaceTransferTargetId, WorkspaceTransferTargetStatus>>
  >({});
  const sceneSummary = useMemo(
    () => formatSceneTransferSummary(worldObjectCount, worldCameraCount),
    [worldCameraCount, worldObjectCount]
  );

  useEffect(() => {
    let cancelled = false;
    void fetchWorkspaceTransferTargets()
      .then((descriptors) => {
        if (cancelled) return;
        setTargetDescriptors(descriptors);
      })
      .catch((error) => {
        if (cancelled) return;
        setTargetDescriptors([]);
        toast.error(readUnknownErrorMessage(error, "Workspace targets unavailable."));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (targetDescriptors.length === 0) {
      setTargetStatuses({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      targetDescriptors.map(async (descriptor) => {
        try {
          return [
            descriptor.targetId,
            await fetchWorkspaceTransferTargetStatus(descriptor.targetId),
          ] as const;
        } catch (error) {
          return [
            descriptor.targetId,
            {
              targetId: descriptor.targetId,
              available: false,
              status: readUnknownErrorMessage(error, "target status unavailable"),
              dependencies: [],
            },
          ] as const;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setTargetStatuses(
        Object.fromEntries(entries) as Partial<
          Record<WorkspaceTransferTargetId, WorkspaceTransferTargetStatus>
        >
      );
    });
    return () => {
      cancelled = true;
    };
  }, [targetDescriptors]);

  useEffect(() => {
    return () => {
      const activeLaunch = activeLaunchRef.current;
      if (activeLaunch) {
        stopWorkspaceTransferLaunch(activeLaunch);
      }
      activeLaunchRef.current = null;
    };
  }, []);

  const cancelOpenTarget = useCallback((targetId: WorkspaceTransferTargetId) => {
    const activeLaunch = activeLaunchRef.current;
    if (!activeLaunch || activeLaunch.targetId !== targetId) return;
    stopWorkspaceTransferLaunch(activeLaunch);
    activeLaunchRef.current = null;
    setLoadingTargetId(null);
  }, []);

  const handleOpenTarget = useCallback(
    async (descriptor: WorkspaceTransferTargetDescriptor) => {
      if (activeLaunchRef.current !== null) return;
      const status = targetStatuses[descriptor.targetId];
      if (!canLaunchWorkspaceTransferTarget(descriptor, status)) {
        toast.message(
          `${descriptor.label}: ${resolveWorkspaceTransferTargetStatusLabel(descriptor, status)}.`
        );
        return;
      }
      if (!vizUrdfContent && !originalUrdfContent) {
        toast.error(`Load a robot before opening ${descriptor.label}.`);
        return;
      }
      const controller = new AbortController();
      const launchId = createWorkspaceTransferLaunchId();
      activeLaunchRef.current = {
        targetId: descriptor.targetId,
        targetLabel: descriptor.label,
        launchId,
        controller,
      };
      setLoadingTargetId(descriptor.targetId);
      try {
        const liveWorldObjectCount = getWorldObjectCountForTransfer?.() ?? worldObjectCount;
        const worldPackage = await buildCurrentWorldSceneRegistryEnvelope();
        throwIfWorkspaceTransferAborted(controller.signal);
        assertWorkspacePackageCarriesSceneObjects(worldPackage, liveWorldObjectCount);
        const prepared = await openWorkspaceTransferTarget({
          targetId: descriptor.targetId,
          launchId,
          worldPackage,
          urdfAssetPath: activeUrdfPath ?? undefined,
          meshFiles,
          packageRoots,
          iluSessionId: attachedIluSessionId || undefined,
          targetLabel: descriptor.label,
          signal: controller.signal,
        });
        throwIfWorkspaceTransferAborted(controller.signal);
        if (activeLaunchRef.current?.controller !== controller) return;
        setLastOpenedTargetId(descriptor.targetId);
        const openedSceneSummary = formatSceneTransferSummary(
          prepared.worldObjectCount,
          prepared.cameraCount
        );
        const meshSummary =
          prepared.bundledMeshCount > 0
            ? `, ${prepared.bundledMeshCount} mesh asset${
                prepared.bundledMeshCount === 1 ? "" : "s"
              }`
            : "";
        toast.success(
          `${descriptor.label} opened (pid ${prepared.pid}, ${openedSceneSummary}${meshSummary}).`
        );
        toastUnresolvedMeshRefs(prepared.unresolvedMeshRefs);
        toastWorkspaceWarnings(prepared.workspaceWarnings);
      } catch (error) {
        if (controller.signal.aborted || isWorkspaceTransferAbortError(error)) {
          return;
        }
        toast.error(readUnknownErrorMessage(error, `Failed to open ${descriptor.label}`));
      } finally {
        if (activeLaunchRef.current?.controller === controller) {
          activeLaunchRef.current = null;
          setLoadingTargetId(null);
        }
      }
    },
    [
      activeUrdfPath,
      attachedIluSessionId,
      buildCurrentWorldSceneRegistryEnvelope,
      getWorldObjectCountForTransfer,
      meshFiles,
      originalUrdfContent,
      packageRoots,
      targetStatuses,
      vizUrdfContent,
      worldObjectCount,
    ]
  );

  const workspaceTransfer: WorkspaceTransferState = useMemo(() => {
    const targets = targetDescriptors.map((descriptor) =>
      buildWorkspaceTransferTargetState({
        descriptor,
        lastOpenedTargetId,
        loadingTargetId,
        onCancelTarget: cancelOpenTarget,
        onOpenTarget: handleOpenTarget,
        sceneSummary,
        status: targetStatuses[descriptor.targetId],
      })
    );
    return { sceneSummary, targets };
  }, [
    cancelOpenTarget,
    handleOpenTarget,
    lastOpenedTargetId,
    loadingTargetId,
    sceneSummary,
    targetDescriptors,
    targetStatuses,
  ]);

  return {
    workspaceTransfer,
  };
};
