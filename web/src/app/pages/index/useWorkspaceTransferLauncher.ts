import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type {
  HealthActionPanelWorkspaceTransferState,
  WorkspaceTransferTargetState,
} from "@/features/layout/page/HealthActionPanelWorkspaceTransfer";
import {
  fetchWorkspaceTransferTargets,
  fetchWorkspaceTransferTargetStatus,
  openWorkspaceTransferTarget,
  type WorkspaceTransferTargetDescriptor,
  type WorkspaceTransferTargetStatus,
} from "@/features/world-share/workspaceTransferApi";
import {
  canOpenWorkspaceTarget,
  type WorkspaceTransferTargetId,
} from "@/features/world-share/workspaceTransferParams";
import type { WorldScenePackageManifest } from "@/features/world-share/worldScenePackageTypes";

type UseWorkspaceTransferLauncherParams = {
  activeUrdfPath: string | null;
  attachedIluSessionId: string;
  buildCurrentWorldScenePackageManifest: () => Promise<WorldScenePackageManifest>;
  ensureWorldLayoutForTransfer?: () => Promise<void>;
  getWorldObjectCountForTransfer?: () => number;
  meshFiles: Record<string, Blob>;
  originalUrdfContent: string;
  packageRoots: Record<string, string[]>;
  vizUrdfContent: string;
  worldCameraCount: number;
  worldObjectCount: number;
};

const WORKSPACE_TRANSFER_ASSET_FORMAT_LABELS = new Map<string, string>([
  ["urdf", "URDF"],
  ["mjcf", "MJCF"],
  ["mjx_mjcf", "MJX MJCF"],
  ["usd", "USD"],
  ["native", "native"],
]);

const formatWorkspaceAssetFormat = (format: string): string =>
  WORKSPACE_TRANSFER_ASSET_FORMAT_LABELS.get(format) ?? format.toUpperCase();

const formatSceneTransferSummary = (objectCount: number, cameraCount: number): string =>
  `${objectCount} obj · ${cameraCount} cam`;

const assertWorkspacePackageCarriesSceneObjects = (
  worldPackage: WorldScenePackageManifest,
  studioWorldObjectCount: number
): void => {
  if (studioWorldObjectCount <= 0 || worldPackage.world_snapshot.objects.length > 0) return;
  throw new Error(
    "Workspace transfer blocked: Studio has world objects, but the generated scene package is empty."
  );
};

const resolveWorkspaceTransferTargetDetail = (
  descriptor: WorkspaceTransferTargetDescriptor,
  sceneSummary: string,
  status?: WorkspaceTransferTargetStatus
): string => {
  const assetFormat = formatWorkspaceAssetFormat(descriptor.transferPolicy.robotAssetFormat);
  const baseDetail = (() => {
    if (!canOpenWorkspaceTarget(descriptor)) return `${assetFormat} soon`;
    if (status && !status.available) return `${assetFormat} target unavailable: ${status.status}`;
    if (descriptor.capabilities.layoutRoundTrip) return `${assetFormat} layout round trip`;
    if (descriptor.capabilities.motionValidation) return `${assetFormat} validation workspace`;
    if (descriptor.targetKind === "physics_simulator") return `${assetFormat} simulation workspace`;
    if (descriptor.targetKind === "renderer") return `${assetFormat} visual workspace`;
    return `${assetFormat} open`;
  })();
  return `${baseDetail} · ${sceneSummary}`;
};

export const useWorkspaceTransferLauncher = ({
  activeUrdfPath,
  attachedIluSessionId,
  buildCurrentWorldScenePackageManifest,
  ensureWorldLayoutForTransfer,
  getWorldObjectCountForTransfer,
  meshFiles,
  originalUrdfContent,
  packageRoots,
  vizUrdfContent,
  worldCameraCount,
  worldObjectCount,
}: UseWorkspaceTransferLauncherParams) => {
  const [loadingTargetId, setLoadingTargetId] = useState<WorkspaceTransferTargetId | null>(null);
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
        toast.error(error instanceof Error ? error.message : "Workspace targets unavailable.");
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
              status: error instanceof Error ? error.message : "target status unavailable",
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

  const handleOpenTarget = useCallback(
    async (descriptor: WorkspaceTransferTargetDescriptor) => {
      if (loadingTargetId !== null) return;
      const status = targetStatuses[descriptor.targetId];
      if (!canOpenWorkspaceTarget(descriptor) || status?.available === false) {
        toast.message(status?.status || `${descriptor.label} soon.`);
        return;
      }
      if (!vizUrdfContent && !originalUrdfContent) {
        toast.error(`Load a robot before opening ${descriptor.label}.`);
        return;
      }
      setLoadingTargetId(descriptor.targetId);
      try {
        await ensureWorldLayoutForTransfer?.();
        const liveWorldObjectCount = getWorldObjectCountForTransfer?.() ?? worldObjectCount;
        const worldPackage = await buildCurrentWorldScenePackageManifest();
        assertWorkspacePackageCarriesSceneObjects(worldPackage, liveWorldObjectCount);
        const prepared = await openWorkspaceTransferTarget({
          targetId: descriptor.targetId,
          worldPackage,
          urdfAssetPath: activeUrdfPath ?? undefined,
          meshFiles,
          packageRoots,
          iluSessionId: attachedIluSessionId || undefined,
          targetLabel: descriptor.label,
        });
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
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Failed to open ${descriptor.label}`);
      } finally {
        setLoadingTargetId(null);
      }
    },
    [
      activeUrdfPath,
      attachedIluSessionId,
      buildCurrentWorldScenePackageManifest,
      ensureWorldLayoutForTransfer,
      getWorldObjectCountForTransfer,
      meshFiles,
      loadingTargetId,
      originalUrdfContent,
      packageRoots,
      targetStatuses,
      vizUrdfContent,
      worldObjectCount,
    ]
  );

  const workspaceTransfer: HealthActionPanelWorkspaceTransferState = useMemo(() => {
    const targets = targetDescriptors.map((descriptor): WorkspaceTransferTargetState => {
      const isBusy = loadingTargetId === descriptor.targetId;
      const isActive = lastOpenedTargetId === descriptor.targetId;
      const status = targetStatuses[descriptor.targetId];
      const canOpen = canOpenWorkspaceTarget(descriptor) && status?.available !== false;
      const disabledLabel = canOpenWorkspaceTarget(descriptor)
        ? `${descriptor.label} target unavailable`
        : `${descriptor.label} soon`;
      return {
        id: descriptor.targetId,
        label: descriptor.label,
        detail: resolveWorkspaceTransferTargetDetail(descriptor, sceneSummary, status),
        openLabel: `Open in ${descriptor.label}`,
        openingLabel: `Opening ${descriptor.label}`,
        isBusy,
        isActive,
        canOpen,
        disabledLabel: status?.available === false ? status.status : disabledLabel,
        onAction: () => handleOpenTarget(descriptor),
      };
    });
    return { sceneSummary, targets };
  }, [
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
