import {
  renumberEpisodes,
  type Episode,
  type EpisodeMetadata,
} from "@/features/dataset";
import { resolveReplaySelectionIndexAfterEpisodeMutation } from "@/features/layout/sidebar/replaySelection";

export type EpisodeMoveDirection = "up" | "down";

export type RetakeEpisodeRecordingRequest = {
  episodeNumber: number;
  insertPosition: number;
  metadata: EpisodeMetadata | undefined;
};

type EpisodeMutationBaseResult = {
  nextEpisodes: Episode[];
  nextSelectionIndex: number | null;
};

export type DeleteEpisodeMutationResult = EpisodeMutationBaseResult & {
  shouldStopPlayback: boolean;
  shouldResetFrame: boolean;
  shouldNotifyPlaybackStopped: boolean;
};

export type RetakeEpisodeMutationResult = EpisodeMutationBaseResult & {
  shouldStopPlayback: boolean;
  recordingRequest: RetakeEpisodeRecordingRequest;
};

export type MoveEpisodeMutationResult = EpisodeMutationBaseResult & {
  shouldStopPlayback: boolean;
  shouldNotifyPlaybackStopped: boolean;
};

const findEpisodeIndex = (
  episodes: readonly Episode[],
  episodeId: string
) => episodes.findIndex((episode) => episode.id === episodeId);

const swapEpisodes = (
  episodes: readonly Episode[],
  fromIndex: number,
  toIndex: number
) => {
  const nextEpisodes = [...episodes];
  [nextEpisodes[fromIndex], nextEpisodes[toIndex]] = [
    nextEpisodes[toIndex],
    nextEpisodes[fromIndex],
  ];
  return nextEpisodes;
};

export const buildDeleteEpisodeMutation = ({
  episodes,
  episodeId,
  selectedEpisodeId,
  isPlayingAll,
}: {
  episodes: readonly Episode[];
  episodeId: string;
  selectedEpisodeId: string | null | undefined;
  isPlayingAll: boolean;
}): DeleteEpisodeMutationResult | null => {
  const episodeIndex = findEpisodeIndex(episodes, episodeId);
  if (episodeIndex < 0) {
    return null;
  }

  const willBeEmpty = episodes.length === 1;
  const nextEpisodes = renumberEpisodes(
    episodes.filter((episode) => episode.id !== episodeId)
  );
  const nextSelectionIndex = resolveReplaySelectionIndexAfterEpisodeMutation({
    episodes: nextEpisodes,
    selectedEpisodeId,
    removedEpisodeId: episodeId,
  });
  const isSelectedEpisode = selectedEpisodeId === episodeId;

  return {
    nextEpisodes,
    nextSelectionIndex,
    shouldStopPlayback: isSelectedEpisode || isPlayingAll || willBeEmpty,
    shouldResetFrame: willBeEmpty,
    shouldNotifyPlaybackStopped: isSelectedEpisode,
  };
};

export const buildRetakeEpisodeMutation = ({
  episodes,
  episodeId,
  selectedEpisodeId,
  isPlayingAll,
}: {
  episodes: readonly Episode[];
  episodeId: string;
  selectedEpisodeId: string | null | undefined;
  isPlayingAll: boolean;
}): RetakeEpisodeMutationResult | null => {
  const episodeIndex = findEpisodeIndex(episodes, episodeId);
  if (episodeIndex < 0) {
    return null;
  }

  const episode = episodes[episodeIndex];
  const nextEpisodes = renumberEpisodes(
    episodes.filter((candidate) => candidate.id !== episodeId)
  );
  const nextSelectionIndex = resolveReplaySelectionIndexAfterEpisodeMutation({
    episodes: nextEpisodes,
    selectedEpisodeId,
    removedEpisodeId: episodeId,
  });
  const isSelectedEpisode = selectedEpisodeId === episodeId;

  return {
    nextEpisodes,
    nextSelectionIndex,
    shouldStopPlayback: isSelectedEpisode || isPlayingAll,
    recordingRequest: {
      episodeNumber: episode.number,
      insertPosition: episodeIndex,
      metadata: episode.metadata,
    },
  };
};

export const buildMoveEpisodeMutation = ({
  episodes,
  episodeId,
  direction,
  selectedEpisodeId,
  isPlayingAll,
}: {
  episodes: readonly Episode[];
  episodeId: string;
  direction: EpisodeMoveDirection;
  selectedEpisodeId: string | null | undefined;
  isPlayingAll: boolean;
}): MoveEpisodeMutationResult | null => {
  const currentIndex = findEpisodeIndex(episodes, episodeId);
  if (currentIndex < 0) {
    return null;
  }

  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= episodes.length) {
    return null;
  }

  const nextEpisodes = renumberEpisodes(
    swapEpisodes(episodes, currentIndex, nextIndex)
  );
  const nextSelectionIndex = resolveReplaySelectionIndexAfterEpisodeMutation({
    episodes: nextEpisodes,
    selectedEpisodeId,
  });

  return {
    nextEpisodes,
    nextSelectionIndex,
    shouldStopPlayback: isPlayingAll,
    shouldNotifyPlaybackStopped: isPlayingAll,
  };
};
