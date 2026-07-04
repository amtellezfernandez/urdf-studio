import { useCallback, useState } from "react";
import { toast } from "sonner";

import { FEATURE_GATES } from "@/shared/config/featureGates";
import { requireFeatureGate } from "@/shared/lib/backendGuard";
import type {
  WorldScenePackageListEntry,
  WorldScenePackageManifest,
  WorldScenePackageVersionRecord,
} from "@/features/world-share/worldScenePackageTypes";
import { toWorldRegistryRecordKey } from "@/app/pages/index/indexPageHelpers";
import {
  fetchWorldRegistryPackages,
  fetchWorldScenePackageVersion,
} from "@/app/pages/index/worldSceneRuntime";

type UseWorldRegistryControllerParams = {
  applyWorldScenePackage: (manifest: WorldScenePackageManifest) => void;
};

export type UseWorldRegistryControllerResult = {
  handleListWorldScenePackages: () => Promise<void>;
  handleLoadWorldScenePackageFromRegistry: (
    entry: WorldScenePackageListEntry
  ) => Promise<void>;
  refreshWorldRegistry: () => Promise<void>;
  setWorldRegistryFilterText: (value: string) => void;
  setWorldRegistryOpen: (open: boolean) => void;
  worldRegistryEntries: WorldScenePackageListEntry[];
  worldRegistryFilterText: string;
  worldRegistryLoading: boolean;
  worldRegistryOpen: boolean;
};

const requireWorldRegistry = (actionLabel: string): boolean => {
  try {
    requireFeatureGate(FEATURE_GATES.worldsRegistry, actionLabel);
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "World registry unavailable");
    return false;
  }
};

export const useWorldRegistryController = ({
  applyWorldScenePackage,
}: UseWorldRegistryControllerParams): UseWorldRegistryControllerResult => {
  const [worldRegistryOpen, setWorldRegistryOpen] = useState(false);
  const [worldRegistryFilterText, setWorldRegistryFilterText] = useState("");
  const [worldRegistryEntries, setWorldRegistryEntries] = useState<WorldScenePackageListEntry[]>([]);
  const [worldRegistryVersionCache, setWorldRegistryVersionCache] = useState<
    Record<string, WorldScenePackageVersionRecord>
  >({});
  const [worldRegistryLoading, setWorldRegistryLoading] = useState(false);

  const loadWorldRegistryEntries = useCallback(async () => {
    setWorldRegistryLoading(true);
    try {
      const worlds = await fetchWorldRegistryPackages();
      setWorldRegistryEntries(worlds);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh world registry");
    } finally {
      setWorldRegistryLoading(false);
    }
  }, []);

  const refreshWorldRegistry = useCallback(async () => {
    if (!requireWorldRegistry("World registry refresh")) {
      return;
    }
    await loadWorldRegistryEntries();
  }, [loadWorldRegistryEntries]);

  const handleLoadWorldScenePackageFromRegistry = useCallback(
    async (entry: WorldScenePackageListEntry) => {
      if (!requireWorldRegistry("World registry load")) {
        return;
      }
      const cacheKey = toWorldRegistryRecordKey(entry.package_id, entry.latest_version);
      const cached = worldRegistryVersionCache[cacheKey];
      if (cached) {
        applyWorldScenePackage(cached.manifest);
        setWorldRegistryOpen(false);
        return;
      }
      try {
        const record = await fetchWorldScenePackageVersion(entry.package_id, entry.latest_version);
        setWorldRegistryVersionCache((previous) => ({ ...previous, [cacheKey]: record }));
        applyWorldScenePackage(record.manifest);
        setWorldRegistryOpen(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load world package");
      }
    },
    [applyWorldScenePackage, worldRegistryVersionCache]
  );

  const handleListWorldScenePackages = useCallback(async () => {
    if (!requireWorldRegistry("World registry")) {
      return;
    }
    setWorldRegistryOpen(true);
    if (worldRegistryLoading) {
      return;
    }
    await loadWorldRegistryEntries();
  }, [loadWorldRegistryEntries, worldRegistryLoading]);

  return {
    handleListWorldScenePackages,
    handleLoadWorldScenePackageFromRegistry,
    refreshWorldRegistry,
    setWorldRegistryFilterText,
    setWorldRegistryOpen,
    worldRegistryEntries,
    worldRegistryFilterText,
    worldRegistryLoading,
    worldRegistryOpen,
  };
};
