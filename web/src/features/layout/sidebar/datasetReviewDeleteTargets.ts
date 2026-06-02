import type { DatasetReviewDeleteTarget } from "@/features/dataset/datasetActions";
import type { Episode } from "@/features/dataset/episodes";

const readEpisodeAdditionalString = (
  episode: Episode,
  key: string
): string | null => {
  const value = episode.metadata?.additional?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
};

export const resolveLiveEpisodeIdsForReviewDelete = ({
  episodes,
  reviewEpisodes,
}: {
  episodes: readonly Episode[];
  reviewEpisodes: readonly DatasetReviewDeleteTarget[];
}): string[] => {
  const episodeIds = new Set<string>();
  const sourceIds = new Set<string>();
  const contentFingerprints = new Set<string>();
  reviewEpisodes.forEach((episode) => {
    if (episode.episode_id.trim().length > 0) {
      episodeIds.add(episode.episode_id);
    }
    if (episode.source_id?.trim()) {
      sourceIds.add(episode.source_id.trim());
    }
    if (episode.content_fingerprint?.trim()) {
      contentFingerprints.add(episode.content_fingerprint.trim());
    }
  });

  return episodes
    .filter((episode) => {
      if (episodeIds.has(episode.id)) {
        return true;
      }
      const sourceId = readEpisodeAdditionalString(episode, "sourceId");
      if (sourceId && sourceIds.has(sourceId)) {
        return true;
      }
      const contentFingerprint = readEpisodeAdditionalString(
        episode,
        "contentFingerprint"
      );
      return Boolean(
        contentFingerprint && contentFingerprints.has(contentFingerprint)
      );
    })
    .map((episode) => episode.id);
};
