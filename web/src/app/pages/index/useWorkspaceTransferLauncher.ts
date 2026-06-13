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
  meshFiles: Record<string, Blob>;
  originalUrdfContent: string;
  packageRoots: Record<string, string[]>;
  vizUrdfContent: string;
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

const resolveWorkspaceTransferTargetDetail = (
  descriptor: WorkspaceTransferTargetDescriptor,
  status?: WorkspaceTransferTargetStatus
): string => {
  const assetFormat = formatWorkspaceAssetFormat(descriptor.transferPolicy.robotAssetFormat);
  if (!canOpenWorkspaceTarget(descriptor)) return `${assetFormat} support planned`;
  if (status && !status.available) return `${assetFormat} target unavailable: ${status.status}`;
  if (descriptor.capabilities.layoutRoundTrip) return `${assetFormat} layout round trip`;
  if (descriptor.capabilities.motionValidation) return `${assetFormat} validation workspace`;
  if (descriptor.targetKind === "physics_simulator") return `${assetFormat} simulation workspace`;
  if (descriptor.targetKind === "renderer") return `${assetFormat} visual workspace`;
  return `${assetFormat} open`;
};

export const useWorkspaceTransferLauncher = ({
  activeUrdfPath,
  attachedIluSessionId,
  buildCurrentWorldScenePackageManifest,
  meshFiles,
  originalUrdfContent,
  packageRoots,
  vizUrdfContent,
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
        toast.message(status?.status || `${descriptor.label} support is planned.`);
        return;
      }
      if (!vizUrdfContent && !originalUrdfContent) {
        toast.error(`Load a robot before opening ${descriptor.label}.`);
        return;
      }
      setLoadingTargetId(descriptor.targetId);
      try {
        const worldPackage = await buildCurrentWorldScenePackageManifest();
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
        const meshSummary =
          prepared.bundledMeshCount > 0
            ? `, ${prepared.bundledMeshCount} mesh asset${
                prepared.bundledMeshCount === 1 ? "" : "s"
              }`
            : "";
        toast.success(`${descriptor.label} opened (pid ${prepared.pid}${meshSummary}).`);
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
      meshFiles,
      loadingTargetId,
      originalUrdfContent,
      packageRoots,
      targetStatuses,
      vizUrdfContent,
    ]
  );

  const workspaceTransfer: HealthActionPanelWorkspaceTransferState = useMemo(() => {
    const targets = targetDescriptors.map((descriptor): WorkspaceTransferTargetState => {
      const isBusy = loadingTargetId === descriptor.targetId;
      const isActive = lastOpenedTargetId === descriptor.targetId;
      const status = targetStatuses[descriptor.targetId];
      const canOpen = canOpenWorkspaceTarget(descriptor) && status?.available !== false;
      const plannedLabel = canOpenWorkspaceTarget(descriptor)
        ? `${descriptor.label} target unavailable`
        : `${descriptor.label} support planned`;
      return {
        id: descriptor.targetId,
        label: descriptor.label,
        detail: resolveWorkspaceTransferTargetDetail(descriptor, status),
        openLabel: `Open ${descriptor.label}`,
        openingLabel: `Opening ${descriptor.label}`,
        isBusy,
        isActive,
        canOpen,
        plannedLabel: status?.available === false ? status.status : plannedLabel,
        onAction: () => handleOpenTarget(descriptor),
      };
    });
    return { targets };
  }, [
    handleOpenTarget,
    lastOpenedTargetId,
    loadingTargetId,
    targetDescriptors,
    targetStatuses,
  ]);

  return {
    workspaceTransfer,
  };
};
