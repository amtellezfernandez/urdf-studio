import type { Episode } from "@/features/dataset";

const normalizeEpisodeId = (episodeId: string | null | undefined) => {
  if (typeof episodeId !== "string") {
    return null;
  }
  const trimmed = episodeId.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const resolveSelectedReplayEpisodeId = ({
  episodes,
  currentPlayingEpisodeIndex,
  loadedEpisodeId,
}: {
  episodes: readonly Episode[];
  currentPlayingEpisodeIndex: number | null | undefined;
  loadedEpisodeId?: string | null;
}) => {
  const normalizedLoadedEpisodeId = normalizeEpisodeId(loadedEpisodeId);
  if (normalizedLoadedEpisodeId) {
    return normalizedLoadedEpisodeId;
  }
  if (
    currentPlayingEpisodeIndex === null ||
    currentPlayingEpisodeIndex === undefined ||
    currentPlayingEpisodeIndex < 0 ||
    currentPlayingEpisodeIndex >= episodes.length
  ) {
    return null;
  }
  return normalizeEpisodeId(episodes[currentPlayingEpisodeIndex]?.id ?? null);
};

export const resolveReplaySelectionIndexAfterEpisodeMutation = ({
  episodes,
  selectedEpisodeId,
  removedEpisodeId = null,
}: {
  episodes: readonly Episode[];
  selectedEpisodeId: string | null | undefined;
  removedEpisodeId?: string | null;
}) => {
  const normalizedSelectedEpisodeId = normalizeEpisodeId(selectedEpisodeId);
  if (!normalizedSelectedEpisodeId) {
    return null;
  }
  const normalizedRemovedEpisodeId = normalizeEpisodeId(removedEpisodeId);
  if (
    normalizedRemovedEpisodeId &&
    normalizedRemovedEpisodeId === normalizedSelectedEpisodeId
  ) {
    return null;
  }
  const nextSelectionIndex = episodes.findIndex(
    (episode) => episode.id === normalizedSelectedEpisodeId
  );
  return nextSelectionIndex >= 0 ? nextSelectionIndex : null;
};
