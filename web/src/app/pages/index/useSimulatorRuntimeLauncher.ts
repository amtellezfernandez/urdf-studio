import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type {
  HealthActionPanelSimulatorRuntimeState,
  SimulatorRuntimeTargetState,
} from "@/features/layout/page/HealthActionPanelSimulatorRuntime";
import {
  fetchWorkspaceTransferTargets,
  fetchWorkspaceTransferTargetStatus,
  openWorkspaceTransferTarget,
  type SimulatorRuntimeDescriptor,
  type SimulatorRuntimeStatus,
} from "@/features/world-share/simulatorRuntimeApi";
import {
  canOpenWorkspaceTarget,
  type SimulatorId,
} from "@/features/world-share/simulatorRuntimeParams";
import type { WorldScenePackageManifest } from "@/features/world-share/worldScenePackageTypes";

type UseSimulatorRuntimeLauncherParams = {
  activeUrdfPath: string | null;
  attachedIluSessionId: string;
  buildCurrentWorldScenePackageManifest: () => Promise<WorldScenePackageManifest>;
  meshFiles: Record<string, Blob>;
  originalUrdfContent: string;
  packageRoots: Record<string, string[]>;
  vizUrdfContent: string;
};

const SIMULATOR_ASSET_FORMAT_LABELS = new Map<string, string>([
  ["urdf", "URDF"],
  ["mjcf", "MJCF"],
  ["mjx_mjcf", "MJX MJCF"],
  ["usd", "USD"],
  ["native", "native"],
]);

const formatSimulatorAssetFormat = (format: string): string =>
  SIMULATOR_ASSET_FORMAT_LABELS.get(format) ?? format.toUpperCase();

const resolveSimulatorRuntimeDetail = (
  descriptor: SimulatorRuntimeDescriptor,
  status?: SimulatorRuntimeStatus
): string => {
  const assetFormat = formatSimulatorAssetFormat(descriptor.transferPolicy.robotAssetFormat);
  if (!canOpenWorkspaceTarget(descriptor)) return `${assetFormat} support planned`;
  if (status && !status.available) return `${assetFormat} runtime unavailable: ${status.status}`;
  if (descriptor.capabilities.layoutRoundTrip) return `${assetFormat} layout round trip`;
  if (descriptor.capabilities.motionValidation) return `${assetFormat} validation workspace`;
  if (descriptor.targetKind === "physics_simulator") return `${assetFormat} simulation workspace`;
  if (descriptor.targetKind === "renderer") return `${assetFormat} visual workspace`;
  return `${assetFormat} open`;
};

export const useSimulatorRuntimeLauncher = ({
  activeUrdfPath,
  attachedIluSessionId,
  buildCurrentWorldScenePackageManifest,
  meshFiles,
  originalUrdfContent,
  packageRoots,
  vizUrdfContent,
}: UseSimulatorRuntimeLauncherParams) => {
  const [loadingSimulatorId, setLoadingSimulatorId] = useState<SimulatorId | null>(null);
  const [lastLoadedSimulatorId, setLastLoadedSimulatorId] = useState<SimulatorId | null>(null);
  const [runtimeDescriptors, setRuntimeDescriptors] = useState<SimulatorRuntimeDescriptor[]>([]);
  const [runtimeStatuses, setRuntimeStatuses] = useState<
    Partial<Record<SimulatorId, SimulatorRuntimeStatus>>
  >({});

  useEffect(() => {
    let cancelled = false;
    void fetchWorkspaceTransferTargets()
      .then((descriptors) => {
        if (cancelled) return;
        setRuntimeDescriptors(descriptors);
      })
      .catch((error) => {
        if (cancelled) return;
        setRuntimeDescriptors([]);
        toast.error(error instanceof Error ? error.message : "Workspace targets unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (runtimeDescriptors.length === 0) {
      setRuntimeStatuses({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      runtimeDescriptors.map(async (descriptor) => {
        try {
          return [
            descriptor.simulatorId,
            await fetchWorkspaceTransferTargetStatus(descriptor.simulatorId),
          ] as const;
        } catch (error) {
          return [
            descriptor.simulatorId,
            {
              runtimeName: descriptor.simulatorId,
              available: false,
              status: error instanceof Error ? error.message : "runtime status unavailable",
              dependencies: [],
            },
          ] as const;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setRuntimeStatuses(
        Object.fromEntries(entries) as Partial<Record<SimulatorId, SimulatorRuntimeStatus>>
      );
    });
    return () => {
      cancelled = true;
    };
  }, [runtimeDescriptors]);

  const handleOpenSimulator = useCallback(
    async (descriptor: SimulatorRuntimeDescriptor) => {
      if (loadingSimulatorId !== null) return;
      const status = runtimeStatuses[descriptor.simulatorId];
      if (!canOpenWorkspaceTarget(descriptor) || status?.available === false) {
        toast.message(status?.status || `${descriptor.label} support is planned.`);
        return;
      }
      if (!vizUrdfContent && !originalUrdfContent) {
        toast.error(`Load a robot before opening ${descriptor.label}.`);
        return;
      }
      setLoadingSimulatorId(descriptor.simulatorId);
      try {
        const worldPackage = await buildCurrentWorldScenePackageManifest();
        const prepared = await openWorkspaceTransferTarget({
          simulatorId: descriptor.simulatorId,
          worldPackage,
          urdfAssetPath: activeUrdfPath ?? undefined,
          meshFiles,
          packageRoots,
          iluSessionId: attachedIluSessionId || undefined,
          simulatorLabel: descriptor.label,
        });
        setLastLoadedSimulatorId(descriptor.simulatorId);
        const meshSummary =
          prepared.bundled_mesh_count > 0
            ? `, ${prepared.bundled_mesh_count} mesh asset${
                prepared.bundled_mesh_count === 1 ? "" : "s"
              }`
            : "";
        toast.success(`${descriptor.label} opened (pid ${prepared.pid}${meshSummary}).`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Failed to open ${descriptor.label}`);
      } finally {
        setLoadingSimulatorId(null);
      }
    },
    [
      activeUrdfPath,
      attachedIluSessionId,
      buildCurrentWorldScenePackageManifest,
      meshFiles,
      loadingSimulatorId,
      originalUrdfContent,
      packageRoots,
      runtimeStatuses,
      vizUrdfContent,
    ]
  );

  const simulatorRuntime: HealthActionPanelSimulatorRuntimeState = useMemo(() => {
    const targets = runtimeDescriptors.map((descriptor): SimulatorRuntimeTargetState => {
      const isBusy = loadingSimulatorId === descriptor.simulatorId;
      const isActive = lastLoadedSimulatorId === descriptor.simulatorId;
      const status = runtimeStatuses[descriptor.simulatorId];
      const canOpen = canOpenWorkspaceTarget(descriptor) && status?.available !== false;
      const plannedLabel = canOpenWorkspaceTarget(descriptor)
        ? `${descriptor.label} runtime unavailable`
        : `${descriptor.label} support planned`;
      return {
        id: descriptor.simulatorId,
        label: descriptor.label,
        detail: resolveSimulatorRuntimeDetail(descriptor, status),
        openLabel: `Open ${descriptor.label}`,
        openingLabel: `Opening ${descriptor.label}`,
        isBusy,
        isActive,
        canOpen,
        plannedLabel: status?.available === false ? status.status : plannedLabel,
        onAction: () => handleOpenSimulator(descriptor),
      };
    });
    return { targets };
  }, [
    handleOpenSimulator,
    lastLoadedSimulatorId,
    loadingSimulatorId,
    runtimeDescriptors,
    runtimeStatuses,
  ]);

  return {
    simulatorRuntime,
  };
};
