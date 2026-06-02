import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { loadDemoFileListFromManifestUrl } from "@/app/pages/index/demoBootstrap";
import {
  fetchIluAssemblyManifest,
  getIluAssemblyManifestUrl,
} from "@/features/urdf/loader/iluAssemblyApi";
import type { AssemblyRobotInstance } from "@/features/assembly/store/useAssemblyStore";
import type { WorkspaceMode } from "@/features/workspace/types";

type UseIluAssemblyBridgeOptions = {
  iluAssemblyParam: string;
  loadFilesFromFolder: (files: FileList, options?: { preserveCameras?: boolean }) => void | Promise<void>;
  clearGitHubSource: () => void;
  clearAssemblySelection: () => void;
  clearAssemblyPlacement: () => void;
  setAssemblySelectedUrdfPaths: (
    paths: string[],
    namesByPath?: Record<string, string>,
    sourceByPath?: Record<string, AssemblyRobotInstance["source"]>
  ) => void;
  onWorkspaceModeChange?: (mode: WorkspaceMode) => void;
};

export const useIluAssemblyBridge = ({
  iluAssemblyParam,
  loadFilesFromFolder,
  clearGitHubSource,
  clearAssemblySelection,
  clearAssemblyPlacement,
  setAssemblySelectedUrdfPaths,
  onWorkspaceModeChange,
}: UseIluAssemblyBridgeOptions) => {
  const [isAttachingIluAssembly, setIsAttachingIluAssembly] = useState(false);
  const lastBootstrappedIluAssemblyIdRef = useRef("");

  useEffect(() => {
    if (!iluAssemblyParam || lastBootstrappedIluAssemblyIdRef.current === iluAssemblyParam) {
      return;
    }

    lastBootstrappedIluAssemblyIdRef.current = iluAssemblyParam;
    let cancelled = false;

    const attachIluAssembly = async () => {
      setIsAttachingIluAssembly(true);
      try {
        const manifest = await fetchIluAssemblyManifest(iluAssemblyParam);
        if (cancelled) {
          return;
        }

        const fileList = await loadDemoFileListFromManifestUrl(
          getIluAssemblyManifestUrl(iluAssemblyParam)
        );
        if (cancelled) {
          return;
        }

        clearGitHubSource();
        clearAssemblySelection();
        clearAssemblyPlacement();
        await loadFilesFromFolder(fileList, { preserveCameras: false });

        const sourceByPath = Object.fromEntries(
          Object.entries(manifest.sourceByPath || {}).map(([key, value]) => [
            key,
            value.type === "local" ? { type: "local" as const, folder: value.folder || undefined } : undefined,
          ])
        ) as Record<string, AssemblyRobotInstance["source"]>;

        setAssemblySelectedUrdfPaths(manifest.selectedPaths, manifest.namesByPath, sourceByPath);
        toast.success(
          `Attached ilu assembly with ${manifest.selectedPaths.length} robot${manifest.selectedPaths.length === 1 ? "" : "s"}`
        );
      } catch (error) {
        if (cancelled) {
          return;
        }
        const detail =
          error instanceof Error ? error.message : "Failed to attach the ilu assembly.";
        toast.error(detail);
      } finally {
        if (!cancelled) {
          setIsAttachingIluAssembly(false);
        }
      }
    };

    void attachIluAssembly();
    return () => {
      cancelled = true;
    };
  }, [
    clearAssemblyPlacement,
    clearAssemblySelection,
    clearGitHubSource,
    iluAssemblyParam,
    loadFilesFromFolder,
    onWorkspaceModeChange,
    setAssemblySelectedUrdfPaths,
  ]);

  return {
    isAttachingIluAssembly,
  };
};
