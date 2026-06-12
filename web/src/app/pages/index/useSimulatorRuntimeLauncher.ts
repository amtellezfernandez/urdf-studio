import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type {
  HealthActionPanelSimulatorRuntimeState,
  SimulatorRuntimeTargetState,
} from "@/features/layout/page/HealthActionPanelSimulatorRuntime";
import {
  fetchSimulatorRuntimes,
  prepareSimulatorWorkspace,
  type SimulatorRuntimeDescriptor,
} from "@/features/world-share/simulatorRuntimeApi";
import {
  canOpenSimulatorWorkspace,
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

const resolveSimulatorRuntimeDetail = (descriptor: SimulatorRuntimeDescriptor): string => {
  const assetFormat = formatSimulatorAssetFormat(descriptor.transferPolicy.robotAssetFormat);
  if (!canOpenSimulatorWorkspace(descriptor)) return `${assetFormat} support planned`;
  if (descriptor.capabilities.motionValidation) return `${assetFormat} open and validation`;
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

  useEffect(() => {
    let cancelled = false;
    void fetchSimulatorRuntimes()
      .then((descriptors) => {
        if (cancelled) return;
        setRuntimeDescriptors(descriptors);
      })
      .catch((error) => {
        if (cancelled) return;
        setRuntimeDescriptors([]);
        toast.error(error instanceof Error ? error.message : "Simulator runtimes unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenSimulator = useCallback(
    async (descriptor: SimulatorRuntimeDescriptor) => {
      if (loadingSimulatorId !== null) return;
      if (!canOpenSimulatorWorkspace(descriptor)) {
        toast.message(`${descriptor.label} support is planned.`);
        return;
      }
      if (!vizUrdfContent && !originalUrdfContent) {
        toast.error(`Load a robot before opening ${descriptor.label}.`);
        return;
      }
      setLoadingSimulatorId(descriptor.simulatorId);
      try {
        const worldPackage = await buildCurrentWorldScenePackageManifest();
        const prepared = await prepareSimulatorWorkspace({
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
      vizUrdfContent,
    ]
  );

  const simulatorRuntime: HealthActionPanelSimulatorRuntimeState = useMemo(() => {
    const targets = runtimeDescriptors.map((descriptor): SimulatorRuntimeTargetState => {
      const isBusy = loadingSimulatorId === descriptor.simulatorId;
      const isActive = lastLoadedSimulatorId === descriptor.simulatorId;
      const canOpen = canOpenSimulatorWorkspace(descriptor);
      return {
        id: descriptor.simulatorId,
        label: descriptor.label,
        detail: resolveSimulatorRuntimeDetail(descriptor),
        openLabel: `Open ${descriptor.label}`,
        openingLabel: `Opening ${descriptor.label}`,
        isBusy,
        isActive,
        canOpen,
        plannedLabel: `${descriptor.label} support planned`,
        onAction: () => handleOpenSimulator(descriptor),
      };
    });
    return { targets };
  }, [handleOpenSimulator, lastLoadedSimulatorId, loadingSimulatorId, runtimeDescriptors]);

  return {
    simulatorRuntime,
  };
};
