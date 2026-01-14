import { useCallback, useMemo, useState } from "react";
import { useUrdfViewer } from "@/features/urdf-viewer";
import type { EpisodeSaveHandler, ViewerEpisode } from "@/features/types";

export const useDatasetPlaybackHandlers = () => {
  const viewerState = useUrdfViewer();
  const [motionDataFile, setMotionDataFile] = useState<File | null>(null);
  const [viewerEpisode, setViewerEpisode] = useState<ViewerEpisode | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [episodeSaveHandler, setEpisodeSaveHandler] = useState<
    EpisodeSaveHandler | undefined
  >(undefined);

  const episodeJointNames = useMemo(() => {
    if (!viewerEpisode) return [];

    const metadata = viewerEpisode.metadata as { joint_names?: unknown } | undefined;
    const metadataNames = Array.isArray(metadata?.joint_names)
      ? (metadata.joint_names as unknown[])
          .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      : [];

    const frameNames =
      viewerEpisode.frames.length > 0
        ? Object.keys(viewerEpisode.frames[0].jointPositions)
        : [];

    const combined = (metadataNames.length > 0 ? metadataNames : frameNames).filter(
      (name): name is string => typeof name === "string" && name.length > 0
    );

    return Array.from(new Set(combined)).sort();
  }, [viewerEpisode]);

  const handleEpisodeSaveHandlerChange = useCallback((handler?: EpisodeSaveHandler) => {
    setEpisodeSaveHandler(() => handler);
  }, []);

  return {
    ...viewerState,
    motionDataFile,
    setMotionDataFile,
    viewerEpisode,
    setViewerEpisode,
    isViewerOpen,
    setIsViewerOpen,
    episodeSaveHandler,
    handleEpisodeSaveHandlerChange,
    episodeJointNames,
  };
};
