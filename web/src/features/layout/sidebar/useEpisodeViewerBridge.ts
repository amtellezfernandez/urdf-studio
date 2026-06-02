import { useEffect, type Dispatch, type SetStateAction } from "react";

import type { Episode } from "@/features/dataset";
import { VIEWER3D_FRAME_UPDATE_EVENT_NAME } from "@/features/layout/sidebar/episodeViewerBridgeParams";

export type ViewerFrameUpdateDetail = {
  frame: number;
  episodeIndex: number;
  totalFrames?: number;
};

type UseEpisodeViewerBridgeParams = {
  episodes: readonly Episode[];
  currentPlayingEpisodeIndex: number | null;
  currentFrame?: number;
  totalFrames?: number;
  onViewerEpisodeChange?: (episode: Episode | null) => void;
  onViewerOpenChange?: (open: boolean) => void;
  onViewerSplitViewChange?: (splitView: boolean) => void;
  stopReplayPlaybackState: (options?: { clearLoadedEpisode?: boolean }) => void;
  resetReplayFrameToStart: () => void;
  setCurrentPlayingEpisodeIndex: Dispatch<SetStateAction<number | null>>;
};

export const resolveViewerFrameUpdateDetail = ({
  currentFrame,
  currentPlayingEpisodeIndex,
  totalFrames,
}: {
  currentFrame?: number;
  currentPlayingEpisodeIndex: number | null;
  totalFrames?: number;
}): ViewerFrameUpdateDetail | null => {
  if (
    currentFrame === undefined ||
    currentPlayingEpisodeIndex === null ||
    !Number.isFinite(currentPlayingEpisodeIndex)
  ) {
    return null;
  }
  return {
    frame: currentFrame,
    episodeIndex: currentPlayingEpisodeIndex,
    totalFrames,
  };
};

export const resolveViewerEpisodeForPlaybackIndex = ({
  episodes,
  currentPlayingEpisodeIndex,
}: {
  episodes: readonly Episode[];
  currentPlayingEpisodeIndex: number | null;
}) => {
  if (
    currentPlayingEpisodeIndex === null ||
    currentPlayingEpisodeIndex < 0 ||
    currentPlayingEpisodeIndex >= episodes.length
  ) {
    return null;
  }
  return episodes[currentPlayingEpisodeIndex] ?? null;
};

export const useEpisodeViewerBridge = ({
  episodes,
  currentPlayingEpisodeIndex,
  currentFrame,
  totalFrames,
  onViewerEpisodeChange,
  onViewerOpenChange,
  onViewerSplitViewChange,
  stopReplayPlaybackState,
  resetReplayFrameToStart,
  setCurrentPlayingEpisodeIndex,
}: UseEpisodeViewerBridgeParams) => {
  useEffect(() => {
    const detail = resolveViewerFrameUpdateDetail({
      currentFrame,
      currentPlayingEpisodeIndex,
      totalFrames,
    });
    if (!detail) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent(VIEWER3D_FRAME_UPDATE_EVENT_NAME, {
        detail,
      })
    );
  }, [currentFrame, currentPlayingEpisodeIndex, totalFrames]);

  useEffect(() => {
    const currentEpisode = resolveViewerEpisodeForPlaybackIndex({
      episodes,
      currentPlayingEpisodeIndex,
    });
    if (!currentEpisode) {
      onViewerEpisodeChange?.(null);
      return;
    }
    onViewerSplitViewChange?.(true);
    onViewerOpenChange?.(true);
    onViewerEpisodeChange?.(currentEpisode);
  }, [
    currentPlayingEpisodeIndex,
    episodes,
    onViewerEpisodeChange,
    onViewerOpenChange,
    onViewerSplitViewChange,
  ]);

  useEffect(() => {
    if (episodes.length > 0) {
      return;
    }
    stopReplayPlaybackState({ clearLoadedEpisode: true });
    setCurrentPlayingEpisodeIndex(null);
    resetReplayFrameToStart();
  }, [
    episodes.length,
    resetReplayFrameToStart,
    setCurrentPlayingEpisodeIndex,
    stopReplayPlaybackState,
  ]);
};
