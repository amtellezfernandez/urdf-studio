import type { Episode } from "@/features/dataset/episodes";
import type { EpisodeMetadata } from "@/features/dataset/io/episodeTypes";
import type { RobotBasePose } from "@/shared/types/feature";

export type DatasetSessionSourceKind =
  | "hf"
  | "local"
  | "recorded"
  | "derived"
  | "mixed"
  | "unknown";

export type DatasetSessionReviewReason =
  | "short_duration"
  | "long_duration"
  | "low_motion"
  | "timing_irregularity"
  | "fps_mismatch"
  | "unnamed_joints"
  | "unmapped_signals"
  | "high_loss"
  | "sensor_gap"
  | "action_outlier"
  | "language_mismatch"
  | "failed_demo"
  | "duplicate_episode";

export type DatasetSessionFrame = {
  timestamp: number;
  joint_positions: Record<string, number>;
  base_pose?: RobotBasePose;
};

export type DatasetSessionHfSourceDescriptor = {
  dataset: string;
  config: string;
  split: string;
  dataset_label?: string;
  source_name?: string;
};

export type DatasetSessionEpisodeCreateRequest = {
  episode_id?: string;
  episode_number?: number;
  source_kind?: DatasetSessionSourceKind;
  source_name?: string;
  frames: DatasetSessionFrame[];
  metadata?: EpisodeMetadata;
};

export type DatasetSessionCreateRequest = {
  schema_version: string;
  dataset_label?: string;
  source_kind: DatasetSessionSourceKind;
  source_name?: string;
  dataset_metadata?: Record<string, unknown>;
  episodes: DatasetSessionEpisodeCreateRequest[];
  hf_source?: DatasetSessionHfSourceDescriptor;
};

export type DatasetSessionReviewCount = {
  reason: DatasetSessionReviewReason;
  episode_count: number;
};

export type DatasetSessionSummary = {
  schema_version: string;
  session_id: string;
  dataset_label?: string;
  source_kind: DatasetSessionSourceKind;
  source_name?: string;
  robot_type?: string;
  episode_count: number;
  total_frame_count: number;
  total_duration_sec: number;
  flagged_episode_count: number;
  review_counts: DatasetSessionReviewCount[];
  created_at_ns: number;
  updated_at_ns: number;
};

export type DatasetSessionEpisodeLineage = {
  source_id?: string;
  canonical_source?: string;
  content_fingerprint?: string;
};

export type DatasetSessionEpisodeSummary = DatasetSessionEpisodeLineage & {
  episode_id: string;
  episode_number: number;
  frame_count: number;
  duration_sec: number;
  fps: number;
  flagged: boolean;
  detected_reasons: DatasetSessionReviewReason[];
  manual_reasons: DatasetSessionReviewReason[];
  review_reasons: DatasetSessionReviewReason[];
  review_note?: string;
  source_kind: DatasetSessionSourceKind;
  source_name?: string;
  recorded_video_camera_count?: number;
  recorded_video_stream_count?: number;
  robot_type?: string;
  naming_status?: string;
};

export type DatasetSessionEpisodeListResponse = {
  schema_version: string;
  session_id: string;
  total: number;
  offset: number;
  limit: number;
  episodes: DatasetSessionEpisodeSummary[];
};

export type DatasetSessionEpisodeListOptions = {
  flaggedOnly?: boolean;
  limit?: number;
  offset?: number;
  reason?: DatasetSessionReviewReason;
};

export type DatasetSessionEpisodeDetailResponse = {
  schema_version: string;
  session_id: string;
  episode: DatasetSessionEpisodeSummary;
  frames: DatasetSessionFrame[];
  metadata?: EpisodeMetadata;
};

export type DatasetSessionReviewResponse = {
  schema_version: string;
  session_id: string;
  flagged_episode_ids: string[];
  review_counts: DatasetSessionReviewCount[];
  summary: DatasetSessionSummary;
};

export type DatasetSessionFlagUpdate = {
  episode_id: string;
  flagged: boolean;
  reasons?: DatasetSessionReviewReason[];
  note?: string;
};

export type DatasetSessionFlagEpisodesRequest = {
  schema_version: string;
  updates: DatasetSessionFlagUpdate[];
};

export type DatasetSessionFlagEpisodesResponse = {
  schema_version: string;
  session_id: string;
  flagged_episode_count: number;
  review_counts: DatasetSessionReviewCount[];
  updated_episode_ids: string[];
};

export type DatasetSessionDeleteEpisodesRequest = {
  schema_version: string;
  episode_ids: string[];
};

export type DatasetSessionDeleteEpisodesResponse = {
  schema_version: string;
  session_id: string;
  deleted_episode_ids: string[];
  remaining_episode_count: number;
};

export type DatasetSessionSyncState = {
  summary: DatasetSessionSummary | null;
  sessionId: string | null;
  status: "idle" | "syncing" | "ready" | "error";
  error: string | null;
};

export type DatasetSessionBridgeInput = {
  episodes: readonly Episode[];
  datasetSources: readonly { type: string; name: string; timestamp: number }[];
};
