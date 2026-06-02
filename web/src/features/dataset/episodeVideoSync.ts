import { EPISODE_VIDEO_SYNC_PARAMS } from "@/features/dataset/episodeVideoSyncParams";
import type { Episode } from "@/features/dataset/episodes";
import type { EpisodeMetadata } from "@/features/dataset/io/episodeTypes";

const EPISODE_RECORDED_VIDEO_SYNC_STATUS_ALIGNED =
  EPISODE_VIDEO_SYNC_PARAMS.statuses.aligned;
export const EPISODE_RECORDED_VIDEO_SYNC_STATUS_CLIP_ALIGNED =
  EPISODE_VIDEO_SYNC_PARAMS.statuses.clipAligned;
export const EPISODE_RECORDED_VIDEO_SYNC_STATUS_REFERENCE_ONLY =
  EPISODE_VIDEO_SYNC_PARAMS.statuses.referenceOnly;

export const EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_OUTSIDE =
  EPISODE_VIDEO_SYNC_PARAMS.reasons.deleteOutside;
export const EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_INSIDE =
  EPISODE_VIDEO_SYNC_PARAMS.reasons.deleteInside;
export const EPISODE_RECORDED_VIDEO_SYNC_REASON_RETIME =
  EPISODE_VIDEO_SYNC_PARAMS.reasons.retime;
export const EPISODE_RECORDED_VIDEO_SYNC_REASON_RESAMPLE_FPS =
  EPISODE_VIDEO_SYNC_PARAMS.reasons.resampleFps;
export const EPISODE_RECORDED_VIDEO_SYNC_REASON_TRAJECTORY_EDIT =
  EPISODE_VIDEO_SYNC_PARAMS.reasons.trajectoryEdit;
export const EPISODE_RECORDED_VIDEO_SYNC_REASON_SMOOTH =
  EPISODE_VIDEO_SYNC_PARAMS.reasons.smooth;
export const EPISODE_RECORDED_VIDEO_SYNC_REASON_LIMIT_FIX =
  EPISODE_VIDEO_SYNC_PARAMS.reasons.limitFix;

export type EpisodeRecordedVideoSyncStatus =
  | typeof EPISODE_RECORDED_VIDEO_SYNC_STATUS_ALIGNED
  | typeof EPISODE_RECORDED_VIDEO_SYNC_STATUS_CLIP_ALIGNED
  | typeof EPISODE_RECORDED_VIDEO_SYNC_STATUS_REFERENCE_ONLY;

export type EpisodeRecordedVideoSyncReason =
  | typeof EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_OUTSIDE
  | typeof EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_INSIDE
  | typeof EPISODE_RECORDED_VIDEO_SYNC_REASON_RETIME
  | typeof EPISODE_RECORDED_VIDEO_SYNC_REASON_RESAMPLE_FPS
  | typeof EPISODE_RECORDED_VIDEO_SYNC_REASON_TRAJECTORY_EDIT
  | typeof EPISODE_RECORDED_VIDEO_SYNC_REASON_SMOOTH
  | typeof EPISODE_RECORDED_VIDEO_SYNC_REASON_LIMIT_FIX;

export type EpisodeRecordedVideoSyncInfo = {
  hasRecordedVideo: boolean;
  status: EpisodeRecordedVideoSyncStatus | null;
  reason: EpisodeRecordedVideoSyncReason | null;
  note: string | null;
  autoSyncEnabled: boolean;
};

const RECORDED_VIDEO_SYNC_STATUS_SET = new Set<EpisodeRecordedVideoSyncStatus>([
  EPISODE_RECORDED_VIDEO_SYNC_STATUS_ALIGNED,
  EPISODE_RECORDED_VIDEO_SYNC_STATUS_CLIP_ALIGNED,
  EPISODE_RECORDED_VIDEO_SYNC_STATUS_REFERENCE_ONLY,
]);

const RECORDED_VIDEO_SYNC_REASON_SET = new Set<EpisodeRecordedVideoSyncReason>([
  EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_OUTSIDE,
  EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_INSIDE,
  EPISODE_RECORDED_VIDEO_SYNC_REASON_RETIME,
  EPISODE_RECORDED_VIDEO_SYNC_REASON_RESAMPLE_FPS,
  EPISODE_RECORDED_VIDEO_SYNC_REASON_TRAJECTORY_EDIT,
  EPISODE_RECORDED_VIDEO_SYNC_REASON_SMOOTH,
  EPISODE_RECORDED_VIDEO_SYNC_REASON_LIMIT_FIX,
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const resolveMetadata = (
  episodeOrMetadata: Episode | EpisodeMetadata | null | undefined
): EpisodeMetadata | undefined => {
  if (!episodeOrMetadata) return undefined;
  const episodeCandidate = episodeOrMetadata as Episode;
  if (
    typeof episodeOrMetadata === "object" &&
    Array.isArray(episodeCandidate.frames)
  ) {
    return episodeCandidate.metadata;
  }
  return episodeOrMetadata;
};

const metadataHasRecordedVideo = (metadata: EpisodeMetadata | undefined) => {
  if (!metadata) return false;
  const videos = metadata.videos;
  return (
    isRecord(videos) &&
    Object.keys(videos).some((cameraName) => cameraName.trim().length > 0)
  );
};

const withRecordedVideoSyncMetadata = (
  metadata: EpisodeMetadata | undefined,
  {
    status,
    reason,
    note,
  }: {
    status: EpisodeRecordedVideoSyncStatus;
    reason?: EpisodeRecordedVideoSyncReason | null;
    note?: string | null;
  }
) => {
  if (!metadataHasRecordedVideo(metadata)) {
    return metadata;
  }

  const nextMetadata: EpisodeMetadata = { ...(metadata ?? {}) };
  const additional = isRecord(nextMetadata.additional)
    ? nextMetadata.additional
    : {};
  const nextAdditional: Record<string, unknown> = {
    ...additional,
    recorded_video_sync_status: status,
  };

  if (reason) {
    nextAdditional.recorded_video_sync_reason = reason;
  } else {
    delete nextAdditional.recorded_video_sync_reason;
  }

  if (typeof note === "string" && note.trim().length > 0) {
    nextAdditional.recorded_video_sync_note = note.trim();
  } else {
    delete nextAdditional.recorded_video_sync_note;
  }

  nextMetadata.additional = nextAdditional;
  return nextMetadata;
};

export const resolveEpisodeRecordedVideoSyncInfo = (
  episodeOrMetadata: Episode | EpisodeMetadata | null | undefined
): EpisodeRecordedVideoSyncInfo => {
  const metadata = resolveMetadata(episodeOrMetadata);
  const hasRecordedVideo = metadataHasRecordedVideo(metadata);
  if (!hasRecordedVideo) {
    return {
      hasRecordedVideo: false,
      status: null,
      reason: null,
      note: null,
      autoSyncEnabled: false,
    };
  }

  const additional = isRecord(metadata?.additional)
    ? metadata.additional
    : {};
  const rawStatus = additional.recorded_video_sync_status;
  const rawReason = additional.recorded_video_sync_reason;
  const rawNote = additional.recorded_video_sync_note;
  const status = RECORDED_VIDEO_SYNC_STATUS_SET.has(
    rawStatus as EpisodeRecordedVideoSyncStatus
  )
    ? (rawStatus as EpisodeRecordedVideoSyncStatus)
    : EPISODE_RECORDED_VIDEO_SYNC_STATUS_ALIGNED;
  const reason = RECORDED_VIDEO_SYNC_REASON_SET.has(
    rawReason as EpisodeRecordedVideoSyncReason
  )
    ? (rawReason as EpisodeRecordedVideoSyncReason)
    : null;
  const note =
    typeof rawNote === "string" && rawNote.trim().length > 0
      ? rawNote.trim()
      : null;

  return {
    hasRecordedVideo: true,
    status,
    reason,
    note,
    autoSyncEnabled:
      status === EPISODE_RECORDED_VIDEO_SYNC_STATUS_ALIGNED ||
      status === EPISODE_RECORDED_VIDEO_SYNC_STATUS_CLIP_ALIGNED,
  };
};

export const markEpisodeRecordedVideoSyncAligned = (
  metadata: EpisodeMetadata | undefined,
  {
    status = EPISODE_RECORDED_VIDEO_SYNC_STATUS_ALIGNED,
    reason = null,
    note = null,
  }: {
    status?:
      | typeof EPISODE_RECORDED_VIDEO_SYNC_STATUS_ALIGNED
      | typeof EPISODE_RECORDED_VIDEO_SYNC_STATUS_CLIP_ALIGNED;
    reason?: EpisodeRecordedVideoSyncReason | null;
    note?: string | null;
  } = {}
) =>
  withRecordedVideoSyncMetadata(metadata, {
    status,
    reason,
    note,
  });

export const markEpisodeRecordedVideoReferenceOnly = (
  metadata: EpisodeMetadata | undefined,
  {
    reason,
    note = null,
  }: {
    reason: EpisodeRecordedVideoSyncReason;
    note?: string | null;
  }
) =>
  withRecordedVideoSyncMetadata(metadata, {
    status: EPISODE_RECORDED_VIDEO_SYNC_STATUS_REFERENCE_ONLY,
    reason,
    note,
  });

export const resolveEpisodeRecordedVideoSyncMessage = (
  info: EpisodeRecordedVideoSyncInfo
) => {
  if (!info.hasRecordedVideo) return null;
  if (info.note) return info.note;
  if (info.autoSyncEnabled) {
    if (info.status === EPISODE_RECORDED_VIDEO_SYNC_STATUS_CLIP_ALIGNED) {
      return "Recorded video remains aligned to this trimmed clip.";
    }
    return "Recorded video is synchronized to the active episode timeline.";
  }
  switch (info.reason) {
    case EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_INSIDE:
      return "Recorded video is reference only after stitched trims removed interior time.";
    case EPISODE_RECORDED_VIDEO_SYNC_REASON_RETIME:
      return "Recorded video is reference only after retiming changed the episode timeline.";
    case EPISODE_RECORDED_VIDEO_SYNC_REASON_RESAMPLE_FPS:
      return "Recorded video is reference only after FPS resampling changed replay samples.";
    case EPISODE_RECORDED_VIDEO_SYNC_REASON_SMOOTH:
      return "Recorded video is reference only after smoothing changed the recorded motion.";
    case EPISODE_RECORDED_VIDEO_SYNC_REASON_LIMIT_FIX:
      return "Recorded video is reference only after limit correction changed the recorded motion.";
    case EPISODE_RECORDED_VIDEO_SYNC_REASON_TRAJECTORY_EDIT:
      return "Recorded video is reference only after trajectory edits changed the recorded motion.";
    case EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_OUTSIDE:
      return "Recorded video remains aligned to this trimmed clip.";
    default:
      return "Recorded video is reference only for this edited episode.";
  }
};
