import { useMemo } from "react";

import type { EpisodeMetadata } from "@/features/dataset";
import type { Episode } from "@/features/dataset/episodes";
import { resolveEpisodePreviewState } from "@/features/layout/sidebar/episodePreviewHelpers";

type UseEpisodePreviewStateParams = {
  episodes: readonly Episode[];
  currentPlayingEpisodeIndex: number | null | undefined;
  playbackEpisode?: Episode | null;
  currentFrame?: number;
  activeWorldSnapshotRef?: EpisodeMetadata["world_snapshot_ref"] | null;
};

export const useEpisodePreviewState = ({
  episodes,
  currentPlayingEpisodeIndex,
  playbackEpisode,
  currentFrame,
  activeWorldSnapshotRef,
}: UseEpisodePreviewStateParams) =>
  useMemo(
    () =>
      resolveEpisodePreviewState({
        episodes,
        currentPlayingEpisodeIndex,
        playbackEpisode,
        currentFrame,
        activeWorldSnapshotRef,
      }),
    [
      activeWorldSnapshotRef,
      currentFrame,
      currentPlayingEpisodeIndex,
      episodes,
      playbackEpisode,
    ]
  );
