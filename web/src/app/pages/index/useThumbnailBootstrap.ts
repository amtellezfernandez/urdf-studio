import { useEffect, useRef, useState } from "react";

import { loadThumbnailGitHubRobot } from "@/app/pages/index/thumbnailBootstrap";
import { writeThumbnailRenderState } from "@/app/pages/index/thumbnailRenderState";
import { readUnknownErrorMessage } from "@/shared/lib/errorMessages";

type ThumbnailBootstrapParams = {
  hasLoadedFiles: boolean;
  loadBundledDemoRobot: () => Promise<void>;
  loadFilesFromFolderWithFreshCameras: (
    files: FileList,
    options?: { preserveCameras?: boolean }
  ) => void | Promise<void>;
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
  thumbnailMode,
  thumbnailParams,
}: ThumbnailBootstrapParams) => {
  const thumbnailLoadRef = useRef<string | null>(null);
  const latestActionsRef = useRef({
    loadBundledDemoRobot,
    loadFilesFromFolderWithFreshCameras,
  });
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    latestActionsRef.current = {
      loadBundledDemoRobot,
      loadFilesFromFolderWithFreshCameras,
    };
  }, [loadBundledDemoRobot, loadFilesFromFolderWithFreshCameras]);

  useEffect(() => {
    if (!thumbnailMode) {
      thumbnailLoadRef.current = null;
      setLoadError(null);
      return;
    }
    if (hasLoadedFiles) {
      setLoadError(null);
      return;
    }

    let cancelled = false;
    const reportThumbnailError = (error: unknown) => {
      const message = readUnknownErrorMessage(error, String(error));
      console.error("[thumbnail] Failed to load robot:", error);
      if (!cancelled) {
        setLoadError(message);
      }
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
      "thumb",
      thumbnailParams.demo ? "demo" : thumbnailParams.repoUrl,
      thumbnailParams.urdfTarget,
      "backend-auth",
    ].join("|");

    if (
      thumbnailLoadRef.current === loadSignature
    ) {
      return;
    }
    thumbnailLoadRef.current = loadSignature;
    setLoadError(null);

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
    const loadRobot = thumbnailParams.demo
      ? latestActionsRef.current.loadBundledDemoRobot()
      : loadThumbnailGitHubRobot({
          loadFilesFromFolderWithFreshCameras:
            latestActionsRef.current.loadFilesFromFolderWithFreshCameras,
          repoUrl: thumbnailParams.repoUrl,
          urdfTarget: thumbnailParams.urdfTarget,
        });
    loadRobot
      .then(() => {
        if (!cancelled) {
          setLoadError(null);
        }
      })
      .catch(reportThumbnailError);

    return () => {
      cancelled = true;
    };
  }, [
    hasLoadedFiles,
    thumbnailMode,
    thumbnailParams.demo,
    thumbnailParams.repoUrl,
    thumbnailParams.urdfTarget,
  ]);

  return {
    loadError,
  };
};
