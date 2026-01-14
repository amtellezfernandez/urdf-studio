import type { EpisodeMetadata } from "./io/episodeTypes";
import type { ViewerEpisode } from "@/shared/types/feature";

export type Episode = ViewerEpisode & { metadata?: EpisodeMetadata };
export type RecordedFrame = Episode["frames"][number];

export const RECORDING_INTERVAL_MS = 20;
const FALLBACK_JOINTS = ["1", "2", "3", "4", "5"];

export const normalizeInsertIndex = (length: number, insertPosition?: number) =>
  Math.max(0, Math.min(insertPosition ?? length, length));

export const renumberEpisodes = (episodes: Episode[]) =>
  episodes.map((episode, index) => ({
    ...episode,
    number: index + 1,
    metadata: episode.metadata
      ? {
          ...episode.metadata,
          episodeNumber: index + 1,
          episode_index:
            episode.metadata.episode_index !== undefined
              ? episode.metadata.episode_index
              : index,
        }
      : undefined,
  }));

export const createEpisode = (
  id: string,
  number: number,
  frames: RecordedFrame[],
  metadata?: EpisodeMetadata
): Episode => {
  const jointNames =
    Array.isArray(metadata?.joint_names) && metadata.joint_names.length > 0
      ? (metadata.joint_names as string[])
      : Array.from(
          new Set(frames.flatMap((frame) => Object.keys(frame.jointPositions)))
        );

  const normalizedMetadata = metadata
    ? {
        ...metadata,
        episodeNumber: number,
        episode_index:
          metadata.episode_index !== undefined
            ? metadata.episode_index
            : number - 1,
        joint_names: jointNames,
        createdAt: metadata.createdAt ?? Date.now(),
        num_frames: metadata.num_frames ?? frames.length,
      }
    : undefined;

  return {
    id,
    number,
    frames,
    createdAt: normalizedMetadata?.createdAt ?? Date.now(),
    metadata: normalizedMetadata,
  };
};

export const toAnimationFrames = (episode: Episode) =>
  episode.frames.map((frame) => ({
    timestamp: frame.timestamp,
    joints: frame.jointPositions,
  }));

export const getSortedJointList = (availableJoints: string[]) => {
  if (!availableJoints || availableJoints.length === 0) {
    return FALLBACK_JOINTS;
  }

  return [...availableJoints].sort((a, b) => {
    const aNum = Number(a);
    const bNum = Number(b);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
      return aNum - bNum;
    }
    return a.localeCompare(b);
  });
};
