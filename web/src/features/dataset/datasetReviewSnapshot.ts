import type { Episode } from "@/features/dataset/episodes";
import type {
  DatasetSessionEpisodeSummary,
  DatasetSessionReviewCount,
  DatasetSessionReviewReason,
  DatasetSessionSourceKind,
  DatasetSessionSummary,
} from "@/features/dataset/datasetSessionTypes";
import {
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem,
} from "@/shared/lib/browserStorage";

const DATASET_REVIEW_SNAPSHOT_SCHEMA_VERSION =
  "dataset-review-snapshot/v1";
export const DATASET_REVIEW_SNAPSHOT_STORAGE_KEY =
  "urdfstudio:datasetReview:lastSnapshot";
export const DATASET_REVIEW_SNAPSHOT_SESSION_ID =
  "local-review-snapshot";

const DATASET_REVIEW_SNAPSHOT_MS_PER_SECOND = 1_000;
const DATASET_REVIEW_SNAPSHOT_DEFAULT_FPS = 0;

const DATASET_REVIEW_REASON_VALUES = new Set<DatasetSessionReviewReason>([
  "short_duration",
  "long_duration",
  "low_motion",
  "timing_irregularity",
  "fps_mismatch",
  "unnamed_joints",
  "unmapped_signals",
  "high_loss",
  "sensor_gap",
  "action_outlier",
  "language_mismatch",
  "failed_demo",
  "duplicate_episode",
]);

export type DatasetReviewSnapshot = {
  schema_version: typeof DATASET_REVIEW_SNAPSHOT_SCHEMA_VERSION;
  dataset_label: string;
  source_kind: DatasetSessionSourceKind;
  source_name?: string;
  episodes: DatasetSessionEpisodeSummary[];
  updated_at_ms: number;
};

const resolveEpisodeDurationSec = (episode: Episode): number => {
  const metadataDuration = episode.metadata?.episode_length_sec;
  if (typeof metadataDuration === "number" && Number.isFinite(metadataDuration)) {
    return Math.max(0, metadataDuration);
  }

  const firstTimestamp = episode.frames[0]?.timestamp;
  const lastTimestamp = episode.frames[episode.frames.length - 1]?.timestamp;
  if (
    typeof firstTimestamp === "number" &&
    typeof lastTimestamp === "number" &&
    Number.isFinite(firstTimestamp) &&
    Number.isFinite(lastTimestamp) &&
    lastTimestamp >= firstTimestamp
  ) {
    return (lastTimestamp - firstTimestamp) / DATASET_REVIEW_SNAPSHOT_MS_PER_SECOND;
  }

  return 0;
};

const resolveEpisodeFps = (episode: Episode, durationSec: number): number => {
  const metadataFps = episode.metadata?.fps;
  if (typeof metadataFps === "number" && Number.isFinite(metadataFps)) {
    return Math.max(0, metadataFps);
  }
  if (durationSec > 0 && episode.frames.length > 1) {
    return episode.frames.length / durationSec;
  }
  return DATASET_REVIEW_SNAPSHOT_DEFAULT_FPS;
};

const resolveSnapshotSource = (
  episodes: readonly Episode[]
): {
  datasetLabel: string;
  sourceKind: DatasetSessionSourceKind;
  sourceName?: string;
} => {
  const hasDemoEpisode = episodes.some(
    (episode) =>
      episode.metadata?.source === "demo" ||
      (episode.metadata?.additional as Record<string, unknown> | undefined)?.demoType
  );
  if (hasDemoEpisode) {
    return {
      datasetLabel: "Demo dataset",
      sourceKind: "derived",
      sourceName: "Demo",
    };
  }
  return {
    datasetLabel: "Loaded dataset",
    sourceKind: "recorded",
  };
};

export const buildDatasetReviewSnapshot = (
  episodes: readonly Episode[]
): DatasetReviewSnapshot | null => {
  if (episodes.length === 0) {
    return null;
  }

  const { datasetLabel, sourceKind, sourceName } = resolveSnapshotSource(episodes);
  const updatedAtMs = Date.now();
  const summaries = episodes.map((episode, index) => {
    const durationSec = resolveEpisodeDurationSec(episode);
    return {
      episode_id: episode.id,
      episode_number: episode.number ?? index + 1,
      frame_count: episode.frames.length,
      duration_sec: durationSec,
      fps: resolveEpisodeFps(episode, durationSec),
      flagged: false,
      detected_reasons: [],
      manual_reasons: [],
      review_reasons: [],
      source_kind: sourceKind,
      source_name: sourceName,
      robot_type: episode.metadata?.robot_type,
      naming_status: episode.metadata?.naming_status,
    };
  });

  return {
    schema_version: DATASET_REVIEW_SNAPSHOT_SCHEMA_VERSION,
    dataset_label: datasetLabel,
    source_kind: sourceKind,
    source_name: sourceName,
    episodes: summaries,
    updated_at_ms: updatedAtMs,
  };
};

const isReviewReason = (value: string): value is DatasetSessionReviewReason =>
  DATASET_REVIEW_REASON_VALUES.has(value as DatasetSessionReviewReason);

const normalizeEpisodeSummary = (
  value: unknown
): DatasetSessionEpisodeSummary | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const entry = value as Partial<DatasetSessionEpisodeSummary>;
  if (
    typeof entry.episode_id !== "string" ||
    typeof entry.episode_number !== "number" ||
    typeof entry.frame_count !== "number" ||
    typeof entry.duration_sec !== "number" ||
    typeof entry.fps !== "number"
  ) {
    return null;
  }
  const reviewReasons = Array.isArray(entry.review_reasons)
    ? entry.review_reasons.filter((reason): reason is DatasetSessionReviewReason =>
        typeof reason === "string" && isReviewReason(reason)
      )
    : [];
  return {
    episode_id: entry.episode_id,
    episode_number: entry.episode_number,
    frame_count: entry.frame_count,
    duration_sec: entry.duration_sec,
    fps: entry.fps,
    flagged: entry.flagged === true,
    detected_reasons: Array.isArray(entry.detected_reasons)
      ? entry.detected_reasons.filter((reason): reason is DatasetSessionReviewReason =>
          typeof reason === "string" && isReviewReason(reason)
        )
      : [],
    manual_reasons: Array.isArray(entry.manual_reasons)
      ? entry.manual_reasons.filter((reason): reason is DatasetSessionReviewReason =>
          typeof reason === "string" && isReviewReason(reason)
        )
      : [],
    review_reasons: reviewReasons,
    review_note: entry.review_note,
    source_kind: entry.source_kind ?? "recorded",
    source_name: entry.source_name,
    robot_type: entry.robot_type,
    naming_status: entry.naming_status,
  };
};

export const readDatasetReviewSnapshot = (): DatasetReviewSnapshot | null => {
  const raw = readBrowserStorageItem(DATASET_REVIEW_SNAPSHOT_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DatasetReviewSnapshot>;
    if (
      parsed.schema_version !== DATASET_REVIEW_SNAPSHOT_SCHEMA_VERSION ||
      typeof parsed.dataset_label !== "string" ||
      typeof parsed.source_kind !== "string" ||
      typeof parsed.updated_at_ms !== "number" ||
      !Array.isArray(parsed.episodes)
    ) {
      return null;
    }
    const episodes = parsed.episodes
      .map(normalizeEpisodeSummary)
      .filter((episode): episode is DatasetSessionEpisodeSummary => episode !== null);
    if (episodes.length === 0) {
      return null;
    }
    return {
      schema_version: DATASET_REVIEW_SNAPSHOT_SCHEMA_VERSION,
      dataset_label: parsed.dataset_label,
      source_kind: parsed.source_kind,
      source_name: parsed.source_name,
      episodes,
      updated_at_ms: parsed.updated_at_ms,
    };
  } catch {
    return null;
  }
};

export const writeDatasetReviewSnapshot = (
  snapshot: DatasetReviewSnapshot | null
): void => {
  if (!snapshot) {
    removeBrowserStorageItem(DATASET_REVIEW_SNAPSHOT_STORAGE_KEY);
    return;
  }
  writeBrowserStorageItem(
    DATASET_REVIEW_SNAPSHOT_STORAGE_KEY,
    JSON.stringify(snapshot)
  );
};

export const buildDatasetReviewSnapshotSummary = (
  snapshot: DatasetReviewSnapshot
): DatasetSessionSummary => {
  const reviewCounts = new Map<DatasetSessionReviewReason, number>();
  snapshot.episodes.forEach((episode) => {
    episode.review_reasons.forEach((reason) => {
      reviewCounts.set(reason, (reviewCounts.get(reason) ?? 0) + 1);
    });
  });
  return {
    schema_version: snapshot.schema_version,
    session_id: DATASET_REVIEW_SNAPSHOT_SESSION_ID,
    dataset_label: snapshot.dataset_label,
    source_kind: snapshot.source_kind,
    source_name: snapshot.source_name,
    episode_count: snapshot.episodes.length,
    total_frame_count: snapshot.episodes.reduce(
      (total, episode) => total + episode.frame_count,
      0
    ),
    total_duration_sec: snapshot.episodes.reduce(
      (total, episode) => total + episode.duration_sec,
      0
    ),
    flagged_episode_count: snapshot.episodes.filter((episode) => episode.flagged)
      .length,
    review_counts: Array.from(reviewCounts.entries()).map(
      ([reason, episode_count]): DatasetSessionReviewCount => ({
        reason,
        episode_count,
      })
    ),
    created_at_ns: snapshot.updated_at_ms,
    updated_at_ns: snapshot.updated_at_ms,
  };
};
