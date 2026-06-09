import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type {
  HealthActionPanelSimulatorRuntimeState,
  SimulatorRuntimeTargetState,
} from "@/features/layout/page/HealthActionPanelSimulatorRuntime";
import {
  fetchSimulatorRuntimes,
  openSimulatorWorld,
  type SimulatorRuntimeDescriptor,
} from "@/features/world-share/simulatorRuntimeApi";
import {
  DEFAULT_SIMULATOR_RUNTIME_DESCRIPTORS,
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

type RuntimeUiState = {
  detail: string;
  actionLabel: string;
  busyLabel: string;
  isBusy: boolean;
  isActive?: boolean;
  isAvailable: boolean;
  isReady?: boolean | null;
  unavailableLabel: string;
  onAction: () => void;
};

const defaultRuntimeDescriptors = DEFAULT_SIMULATOR_RUNTIME_DESCRIPTORS.map(
  (descriptor) => descriptor as SimulatorRuntimeDescriptor
);

const resolveSimulatorRuntimeDetail = (descriptor: SimulatorRuntimeDescriptor): string => {
  if (!descriptor.capabilities.worldViewer) return "Not available yet";
  if (descriptor.capabilities.motionValidation) return "World viewer and motion validation";
  return "World viewer";
};

const mergeSimulatorRuntimeDescriptors = (
  descriptors: readonly SimulatorRuntimeDescriptor[]
): SimulatorRuntimeDescriptor[] => {
  const descriptorById = new Map(
    descriptors.map((descriptor) => [descriptor.simulatorId, descriptor])
  );
  return defaultRuntimeDescriptors.map(
    (fallbackDescriptor) => descriptorById.get(fallbackDescriptor.simulatorId) ?? fallbackDescriptor
  );
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
  const [openingSimulatorId, setOpeningSimulatorId] = useState<SimulatorId | null>(null);
  const [lastOpenedSimulatorId, setLastOpenedSimulatorId] = useState<SimulatorId | null>(null);
  const [runtimeDescriptors, setRuntimeDescriptors] = useState<SimulatorRuntimeDescriptor[]>(
    defaultRuntimeDescriptors
  );

  useEffect(() => {
    let cancelled = false;
    void fetchSimulatorRuntimes()
      .then((descriptors) => {
        if (cancelled || descriptors.length === 0) return;
        setRuntimeDescriptors(mergeSimulatorRuntimeDescriptors(descriptors));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenSimulatorWorld = useCallback(
    async (descriptor: SimulatorRuntimeDescriptor) => {
      if (openingSimulatorId !== null) return;
      if (!descriptor.capabilities.worldViewer) {
        toast.message(`${descriptor.label} is not available yet.`);
        return;
      }
      if (!vizUrdfContent && !originalUrdfContent) {
        toast.error(`Load a robot before opening ${descriptor.label}.`);
        return;
      }
      setOpeningSimulatorId(descriptor.simulatorId);
      try {
        const worldPackage = await buildCurrentWorldScenePackageManifest();
        const launched = await openSimulatorWorld({
          simulatorId: descriptor.simulatorId,
          worldPackage,
          urdfAssetPath: activeUrdfPath ?? undefined,
          meshFiles,
          packageRoots,
          iluSessionId: attachedIluSessionId || undefined,
        });
        setLastOpenedSimulatorId(descriptor.simulatorId);
        const meshSummary =
          launched.bundled_mesh_count > 0
            ? `, ${launched.bundled_mesh_count} mesh asset${
                launched.bundled_mesh_count === 1 ? "" : "s"
              }`
            : "";
        toast.success(`${descriptor.label} is open (pid ${launched.pid}${meshSummary}).`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Failed to open ${descriptor.label}`);
      } finally {
        setOpeningSimulatorId(null);
      }
    },
    [
      activeUrdfPath,
      attachedIluSessionId,
      buildCurrentWorldScenePackageManifest,
      meshFiles,
      openingSimulatorId,
      originalUrdfContent,
      packageRoots,
      vizUrdfContent,
    ]
  );

  const simulatorRuntime: HealthActionPanelSimulatorRuntimeState = useMemo(() => {
    const targets = runtimeDescriptors.map((descriptor): SimulatorRuntimeTargetState => {
      const isBusy = openingSimulatorId === descriptor.simulatorId;
      const isActive = lastOpenedSimulatorId === descriptor.simulatorId;
      const isAvailable = descriptor.capabilities.worldViewer;
      const runtimeUi: RuntimeUiState = {
        detail: resolveSimulatorRuntimeDetail(descriptor),
        actionLabel: `Open in ${descriptor.label}`,
        busyLabel: `Opening ${descriptor.label}`,
        isBusy,
        isActive,
        isAvailable,
        isReady: isActive ? true : null,
        unavailableLabel: `${descriptor.label} is not available yet`,
        onAction: () => handleOpenSimulatorWorld(descriptor),
      };
      return {
        id: descriptor.simulatorId,
        label: descriptor.label,
        ...runtimeUi,
      };
    });
    return { targets };
  }, [handleOpenSimulatorWorld, lastOpenedSimulatorId, openingSimulatorId, runtimeDescriptors]);

  return {
    simulatorRuntime,
  };
};
