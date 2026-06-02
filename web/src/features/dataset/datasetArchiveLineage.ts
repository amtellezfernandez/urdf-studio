import type { Episode } from "@/features/dataset/episodes";
import {
  buildEpisodeSourceKey,
  buildEpisodeSourceLineageRecord,
} from "@/features/dataset/datasetLineage";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const resolveEpisodeArchiveSourceKey = (
  episode: Episode,
  episodeIndex: number
) => buildEpisodeSourceKey(episode, episodeIndex);

const buildEpisodeArchiveLineageRecord = (
  episode: Episode,
  episodeIndex: number
) => buildEpisodeSourceLineageRecord(episode, episodeIndex) as JsonRecord;

export const collectDatasetArchiveLineage = (episodes: Episode[]) => {
  const episodeIndexToSourceKey = new Map<number, string>();
  const sourceLineageByKey = new Map<string, JsonRecord>();
  let representativeTreatmentManifest: JsonRecord | undefined;

  episodes.forEach((episode) => {
    if (episode.frames.length === 0) {
      return;
    }
    const episodeIndex = episode.number - 1;
    const sourceKey = resolveEpisodeArchiveSourceKey(episode, episodeIndex);
    episodeIndexToSourceKey.set(episodeIndex, sourceKey);

    if (!sourceLineageByKey.has(sourceKey)) {
      sourceLineageByKey.set(
        sourceKey,
        buildEpisodeArchiveLineageRecord(episode, episodeIndex)
      );
    }

    if (
      !representativeTreatmentManifest &&
      isRecord(episode.metadata?.additional) &&
      isRecord(episode.metadata.additional.datasetTreatmentManifest)
    ) {
      representativeTreatmentManifest =
        episode.metadata.additional.datasetTreatmentManifest;
    }
  });

  return {
    episodeIndexToSourceKey,
    representativeTreatmentManifest,
    sourceLineageRecords: Array.from(sourceLineageByKey.values()),
  };
};
