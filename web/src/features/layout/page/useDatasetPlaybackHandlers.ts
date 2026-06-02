import { useCallback, useMemo, useState } from "react";
import { useUrdfViewer } from "@/features/urdf/viewer";
import type {
  EpisodeSaveHandler,
  ViewerEpisode,
} from "@/shared/types/feature";
import { collectDerivedBasePoseSignalNames } from "@/features/dataset/episode-viewer/basePoseSignals";

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

    const names = new Set<string>();
    const metadata = viewerEpisode.metadata as { joint_names?: unknown } | undefined;
    const metadataNames = Array.isArray(metadata?.joint_names)
      ? (metadata.joint_names as unknown[])
          .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
          .map((name) => name.trim())
      : [];
    metadataNames.forEach((name) => names.add(name));

    viewerEpisode.frames.forEach((frame) => {
      Object.keys(frame.jointPositions ?? {}).forEach((jointName) => {
        const normalized = jointName.trim();
        if (normalized.length > 0) {
          names.add(normalized);
        }
      });
    });
    collectDerivedBasePoseSignalNames(viewerEpisode.frames).forEach((signalName) => {
      names.add(signalName);
    });

    return Array.from(names).sort();
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
