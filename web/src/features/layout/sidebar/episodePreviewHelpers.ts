import {
  resolveActiveReplayEpisode,
  resolveEpisodeWorldSnapshotWarning,
  type Episode,
  type EpisodeMetadata,
} from "@/features/dataset";
import {
  resolveEpisodeRecordedVideoSyncInfo,
  type EpisodeRecordedVideoSyncInfo,
} from "@/features/dataset/episodeVideoSync";
import {
  extractVideoUrlsFromDescriptor,
  getEpisodeVideoClipBounds,
  isRecord,
} from "@/features/layout/sidebar/sidebarHelpers";

export type RecordedVideoStream = {
  cameraName: string;
  url: string;
  fallbackUrls?: string[];
  episodeNumber?: number;
  episodeId?: string;
  clipStartSec?: number;
  clipEndSec?: number;
};

type ResolveEpisodePreviewStateParams = {
  episodes: readonly Episode[];
  currentPlayingEpisodeIndex: number | null | undefined;
  playbackEpisode?: Episode | null;
  currentFrame?: number;
  activeWorldSnapshotRef?: EpisodeMetadata["world_snapshot_ref"] | null;
};

const sortEpisodeCameraNames = (cameraNames: Iterable<string>) =>
  Array.from(cameraNames).sort((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );

export const resolveEpisodeReplayTimeSec = ({
  episode,
  currentFrame,
}: {
  episode: Episode | null | undefined;
  currentFrame?: number;
}) => {
  if (!episode || episode.frames.length === 0) {
    return null;
  }
  const clampedFrame = Math.max(
    0,
    Math.min(currentFrame ?? 0, episode.frames.length - 1)
  );
  const firstTimestamp = episode.frames[0]?.timestamp ?? 0;
  const currentTimestamp =
    episode.frames[clampedFrame]?.timestamp ?? firstTimestamp;
  if (!Number.isFinite(firstTimestamp) || !Number.isFinite(currentTimestamp)) {
    return null;
  }
  return Math.max(0, (currentTimestamp - firstTimestamp) / 1000);
};

export const collectEpisodeRecordedVideoCameras = (
  episode: Episode | null | undefined
) => {
  if (!episode) {
    return [];
  }
  const videos = episode.metadata?.videos;
  if (!isRecord(videos)) {
    return [];
  }
  const cameraNames = new Set<string>();
  Object.keys(videos).forEach((cameraName) => {
    const trimmed = cameraName.trim();
    if (trimmed.length > 0) {
      cameraNames.add(trimmed);
    }
  });
  return sortEpisodeCameraNames(cameraNames);
};

export const buildEpisodeRecordedVideoStreams = (
  episode: Episode | null | undefined
): RecordedVideoStream[] => {
  if (!episode) {
    return [];
  }

  const videos = episode.metadata?.videos;
  if (!isRecord(videos)) {
    return [];
  }

  const clipBounds = getEpisodeVideoClipBounds(episode);
  const streamByCamera = new Map<string, RecordedVideoStream>();
  Object.entries(videos).forEach(([cameraName, descriptor]) => {
    const trimmedName = cameraName.trim();
    if (!trimmedName || streamByCamera.has(trimmedName)) {
      return;
    }
    const resolvedUrls = extractVideoUrlsFromDescriptor(
      descriptor,
      episode,
      trimmedName
    );
    if (resolvedUrls.length === 0) {
      return;
    }
    streamByCamera.set(trimmedName, {
      cameraName: trimmedName,
      url: resolvedUrls[0],
      fallbackUrls: resolvedUrls.slice(1),
      episodeNumber: episode.number,
      episodeId: episode.id,
      clipStartSec: clipBounds.startSec,
      clipEndSec: clipBounds.endSec ?? undefined,
    });
  });

  return sortEpisodeCameraNames(streamByCamera.keys()).map(
    (cameraName) => streamByCamera.get(cameraName)!
  );
};

export const resolveEpisodePreviewState = ({
  episodes,
  currentPlayingEpisodeIndex,
  playbackEpisode,
  currentFrame,
  activeWorldSnapshotRef,
}: ResolveEpisodePreviewStateParams): {
  activeReplayEpisode: Episode | null;
  activeReplayWorldSnapshotWarning: string | null;
  activeReplayTimeSec: number | null;
  recordedVideoCameras: string[];
  recordedVideoStreams: RecordedVideoStream[];
  activeReplayRecordedVideoSyncInfo: EpisodeRecordedVideoSyncInfo;
} => {
  const activeReplayEpisode = resolveActiveReplayEpisode({
    episodes,
    currentPlayingEpisodeIndex,
    playbackEpisode,
  });

  return {
    activeReplayEpisode,
    activeReplayWorldSnapshotWarning: resolveEpisodeWorldSnapshotWarning({
      episode: activeReplayEpisode,
      activeWorldSnapshotRef,
    }),
    activeReplayTimeSec: resolveEpisodeReplayTimeSec({
      episode: activeReplayEpisode,
      currentFrame,
    }),
    recordedVideoCameras: collectEpisodeRecordedVideoCameras(activeReplayEpisode),
    recordedVideoStreams: buildEpisodeRecordedVideoStreams(activeReplayEpisode),
    activeReplayRecordedVideoSyncInfo:
      resolveEpisodeRecordedVideoSyncInfo(activeReplayEpisode),
  };
};
