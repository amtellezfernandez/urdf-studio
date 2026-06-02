import { createEpisode, type Episode, type RecordedFrame } from "@/features/dataset/episodes";
import type {
  DatasetSessionEpisodeDetailResponse,
  DatasetSessionEpisodeSummary,
} from "@/features/dataset/datasetSessionTypes";
import type { EpisodeMetadata } from "@/features/dataset/io/episodeTypes";

const withDefinedField = (
  target: Record<string, unknown>,
  key: string,
  value: unknown
) => {
  if (value !== undefined && value !== null) {
    target[key] = value;
  }
};

const resolveHydratedNamingStatus = (
  value: DatasetSessionEpisodeSummary["naming_status"]
): EpisodeMetadata["naming_status"] =>
  value === "named" || value === "unnamed" ? value : undefined;

const buildHydratedEpisodeMetadata = ({
  episode,
  metadata,
}: {
  episode: DatasetSessionEpisodeSummary;
  metadata: EpisodeMetadata | undefined;
}): EpisodeMetadata => {
  const additional: Record<string, unknown> = {
    ...(metadata?.additional ?? {}),
  };
  withDefinedField(additional, "sourceType", episode.source_kind);
  withDefinedField(additional, "sourceName", episode.source_name);
  withDefinedField(additional, "sourceId", episode.source_id);
  withDefinedField(additional, "canonicalSource", episode.canonical_source);
  withDefinedField(additional, "contentFingerprint", episode.content_fingerprint);

  return {
    ...metadata,
    episode_id: episode.episode_id,
    episodeNumber: episode.episode_number,
    fps: metadata?.fps ?? episode.fps,
    robot_type: metadata?.robot_type ?? episode.robot_type,
    naming_status: metadata?.naming_status ?? resolveHydratedNamingStatus(episode.naming_status),
    episode_length_sec: metadata?.episode_length_sec ?? episode.duration_sec,
    num_frames: metadata?.num_frames ?? episode.frame_count,
    additional,
  };
};

export const hydrateDatasetSessionEpisode = (
  detail: DatasetSessionEpisodeDetailResponse
): Episode => {
  const frames: RecordedFrame[] = detail.frames.map((frame) => ({
    timestamp: frame.timestamp,
    jointPositions: frame.joint_positions,
    ...(frame.base_pose ? { basePose: frame.base_pose } : {}),
  }));

  return createEpisode(
    detail.episode.episode_id,
    detail.episode.episode_number,
    frames,
    buildHydratedEpisodeMetadata({
      episode: detail.episode,
      metadata: detail.metadata,
    })
  );
};
