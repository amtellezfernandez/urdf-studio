import { useEffect, useRef } from "react";

import { loadThumbnailGitHubRobot } from "@/app/pages/index/thumbnailBootstrap";
import { writeThumbnailRenderState } from "@/app/pages/index/thumbnailRenderState";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";

type ThumbnailBootstrapParams = {
  hasLoadedFiles: boolean;
  loadBundledDemoRobot: () => Promise<void>;
  loadFilesFromFolderWithFreshCameras: (
    files: FileList,
    options?: { preserveCameras?: boolean }
  ) => void | Promise<void>;
  runtimePreviewMode: boolean;
  setGPUMode: (mode: GPUMode) => void;
  thumbnailMode: boolean;
  thumbnailParams: {
    demo: boolean;
    repoUrl: string;
    urdfTarget: string;
  };
};

export const useThumbnailBootstrap = ({
  hasLoadedFiles,
  loadBundledDemoRobot,
  loadFilesFromFolderWithFreshCameras,
  runtimePreviewMode,
  setGPUMode,
  thumbnailMode,
  thumbnailParams,
}: ThumbnailBootstrapParams) => {
  const thumbnailLoadRef = useRef<string | null>(null);

  useEffect(() => {
    const reportThumbnailError = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[thumbnail] Failed to load robot:", error);
      if (typeof window === "undefined") {
        return;
      }
      writeThumbnailRenderState(
        {
          phase: "error",
          ready: false,
          hasBoundingBox: false,
          cameraApplied: false,
          error: message,
          cameraPosition: null,
          cameraTarget: null,
        },
        { reset: true }
      );
    };

    const loadSignature = [
      thumbnailMode ? "thumb" : "runtime-preview",
      thumbnailParams.demo ? "demo" : thumbnailParams.repoUrl,
      thumbnailParams.urdfTarget,
      "backend-auth",
    ].join("|");

    if (
      (!thumbnailMode && !runtimePreviewMode) ||
      hasLoadedFiles ||
      thumbnailLoadRef.current === loadSignature
    ) {
      return;
    }
    thumbnailLoadRef.current = loadSignature;

    if (typeof window !== "undefined") {
      writeThumbnailRenderState(
        {
          phase: "loading",
          ready: false,
          hasBoundingBox: false,
          cameraApplied: false,
          error: null,
          cameraPosition: null,
          cameraTarget: null,
        },
        { reset: true }
      );
    }
    if (thumbnailMode) {
      setGPUMode("low");
    }
    if (runtimePreviewMode) {
      setGPUMode("low");
    }

    if (thumbnailParams.demo) {
      loadBundledDemoRobot().catch(reportThumbnailError);
      return;
    }

    loadThumbnailGitHubRobot({
      loadFilesFromFolderWithFreshCameras,
      repoUrl: thumbnailParams.repoUrl,
      urdfTarget: thumbnailParams.urdfTarget,
    }).catch(reportThumbnailError);
  }, [
    hasLoadedFiles,
    loadBundledDemoRobot,
    loadFilesFromFolderWithFreshCameras,
    runtimePreviewMode,
    setGPUMode,
    thumbnailMode,
    thumbnailParams.demo,
    thumbnailParams.repoUrl,
    thumbnailParams.urdfTarget,
  ]);
};
