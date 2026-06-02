import type { EpisodeMetadata } from "./io/episodeTypes";
import {
  DEFAULT_SEMANTIC_REPRESENTATION_ID,
  NAMING_STATUS_NAMED,
  NAMING_STATUS_UNNAMED,
} from "./datasetAlignmentParams";
import type { ViewerEpisode } from "@/shared/types/feature";
import type { AnimationFrame } from "@/features/viewer/viewer-types";
import { cloneRobotBasePose } from "@/shared/lib/robotBasePose";
import { collectDerivedBasePoseSignalNames } from "@/features/dataset/episode-viewer/basePoseSignals";
import { EPISODE_PARAMS } from "@/features/dataset/episodeParams";

export type Episode = ViewerEpisode & { metadata?: EpisodeMetadata };
export type RecordedFrame = Episode["frames"][number];

export const RECORDING_INTERVAL_MS = EPISODE_PARAMS.recordingIntervalMs;
const FALLBACK_JOINTS = EPISODE_PARAMS.fallbackJoints;
const AUTO_EMBODIMENT_PREFIX = EPISODE_PARAMS.autoEmbodiment.prefix;
const AUTO_EMBODIMENT_VERSION = EPISODE_PARAMS.autoEmbodiment.version;
const UNKNOWN_ROBOT_TYPE = EPISODE_PARAMS.autoEmbodiment.unknownRobotType;
const AUTO_EMBODIMENT_BASE_FRAME = EPISODE_PARAMS.autoEmbodiment.baseFrame;
const AUTO_EMBODIMENT_EE_FRAME = EPISODE_PARAMS.autoEmbodiment.eeFrame;
const animationFrameCache = new WeakMap<
  Episode,
  { framesRef: Episode["frames"]; frames: AnimationFrame[] }
>();

const resolveMetadataJointNames = (metadata: EpisodeMetadata | undefined) =>
  Array.isArray(metadata?.joint_names)
    ? metadata.joint_names
        .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
        .map((name) => name.trim())
    : [];

const toEmbodimentSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

const deriveEmbodimentRefFromMetadata = (metadata: EpisodeMetadata | undefined) => {
  if (!metadata) return undefined;
  if (metadata.embodiment_ref?.embodiment_id) {
    return metadata.embodiment_ref;
  }
  const robotType = metadata.robot_type;
  if (
    typeof robotType !== "string" ||
    robotType.trim().length === 0 ||
    robotType.trim().toLowerCase() === UNKNOWN_ROBOT_TYPE
  ) {
    return undefined;
  }
  const slug = toEmbodimentSlug(robotType);
  if (!slug) return undefined;
  return {
    embodiment_id: `${AUTO_EMBODIMENT_PREFIX}:${slug}:${AUTO_EMBODIMENT_VERSION}`,
    robot_type: robotType,
    base_frame: AUTO_EMBODIMENT_BASE_FRAME,
    ee_frame: AUTO_EMBODIMENT_EE_FRAME,
  };
};

export const normalizeInsertIndex = (length: number, insertPosition?: number) =>
  Math.max(0, Math.min(insertPosition ?? length, length));

export const resolveActiveReplayEpisode = ({
  episodes,
  currentPlayingEpisodeIndex,
  playbackEpisode,
}: {
  episodes: readonly Episode[];
  currentPlayingEpisodeIndex: number | null | undefined;
  playbackEpisode?: Episode | null;
}) => {
  if (
    currentPlayingEpisodeIndex === null ||
    currentPlayingEpisodeIndex === undefined ||
    currentPlayingEpisodeIndex < 0 ||
    currentPlayingEpisodeIndex >= episodes.length
  ) {
    return null;
  }
  const selectedEpisode = episodes[currentPlayingEpisodeIndex] ?? null;
  if (!selectedEpisode) {
    return null;
  }
  if (playbackEpisode && playbackEpisode.id === selectedEpisode.id) {
    return playbackEpisode;
  }
  return selectedEpisode;
};

export const resolvePersistedEpisodeIndex = (
  metadata: EpisodeMetadata | undefined,
  fallbackIndex: number
) => {
  const explicitIndex = metadata?.episode_index;
  if (typeof explicitIndex === "number" && Number.isFinite(explicitIndex)) {
    return Math.max(0, Math.trunc(explicitIndex));
  }
  return Math.max(0, Math.trunc(fallbackIndex));
};

export const resolveEpisodeJointNames = (
  episode: Episode | null | undefined
): string[] => {
  if (!episode) return [];

  const names = new Set<string>();
  resolveMetadataJointNames(episode.metadata).forEach((name) => names.add(name));
  episode.frames.forEach((frame) => {
    Object.keys(frame.jointPositions ?? {}).forEach((jointName) => {
      const normalizedName = jointName.trim();
      if (normalizedName.length > 0) {
        names.add(normalizedName);
      }
    });
  });
  collectDerivedBasePoseSignalNames(episode.frames).forEach((signalName) => {
    names.add(signalName);
  });
  return Array.from(names).sort();
};

export const resolveEpisodeSignalCatalogNames = ({
  activeEpisode,
  allEpisodes,
}: {
  activeEpisode: Episode | null | undefined;
  allEpisodes?: readonly Episode[] | null;
}) => {
  const catalog = new Set<string>();
  const sourceEpisodes =
    Array.isArray(allEpisodes) && allEpisodes.length > 0
      ? allEpisodes
      : activeEpisode
        ? [activeEpisode]
        : [];
  sourceEpisodes.forEach((episode) => {
    resolveEpisodeJointNames(episode).forEach((name) => {
      catalog.add(name);
    });
  });
  return Array.from(catalog).sort((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
};

export const renumberEpisodes = (episodes: Episode[]) =>
  episodes.map((episode, index) => ({
    ...episode,
    number: index + 1,
    metadata: episode.metadata
      ? {
          ...episode.metadata,
          episodeNumber: index + 1,
          episode_index: resolvePersistedEpisodeIndex(episode.metadata, index),
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
          new Set([
            ...frames.flatMap((frame) => Object.keys(frame.jointPositions)),
            ...collectDerivedBasePoseSignalNames(frames),
          ])
        );

  const normalizedMetadata = metadata
    ? {
        ...metadata,
        episodeNumber: number,
        episode_index: resolvePersistedEpisodeIndex(metadata, number - 1),
        joint_names: jointNames,
        representation_id:
          metadata.representation_id ?? DEFAULT_SEMANTIC_REPRESENTATION_ID,
        naming_status:
          metadata.naming_status ??
          (jointNames.length > 0 ? NAMING_STATUS_NAMED : NAMING_STATUS_UNNAMED),
        embodiment_ref: deriveEmbodimentRefFromMetadata(metadata),
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

export const toAnimationFrames = (episode: Episode) => {
  const cached = animationFrameCache.get(episode);
  if (cached && cached.framesRef === episode.frames) {
    return cached.frames;
  }

  const frames = episode.frames.map((frame) => ({
    timestamp: frame.timestamp,
    joints: frame.jointPositions,
    basePose: cloneRobotBasePose(frame.basePose),
  }));
  animationFrameCache.set(episode, { framesRef: episode.frames, frames });
  return frames;
};

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
