import {
  applyJointLimitCorrectionsToFrames,
  buildDatasetTreatmentAdditionalFields,
  createEpisode,
  resolveEpisodeSourceDescriptor,
  resolveEpisodeJointNames,
  resolvePersistedEpisodeIndex,
  renumberEpisodes,
  serializeEpisodeJson,
  summarizeJointLimitCorrections,
  RECORDING_INTERVAL_MS,
  type Episode,
  type EpisodeMetadata,
  type RecordedFrame,
} from "@/features/dataset";
import { EPISODE_FPS_MISMATCH_TOLERANCE } from "@/features/dataset/episodeReviewParams";
import {
  computeEpisodeDurationSecFromFrames,
  isRecord,
} from "@/features/layout/sidebar/sidebarHelpers";
import {
  cloneRobotBasePose,
  interpolateRobotBasePose,
} from "@/shared/lib/robotBasePose";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { JointLimitMode } from "@/shared/types/feature";

const EDITED_EPISODE_SOURCE_TYPE = "edited";
const EPISODE_JOINT_SCAN_ID = "episode-joint-name-scan";
const EPISODE_JOINT_SCAN_NUMBER = 1;
const EPISODE_JOINT_SCAN_CREATED_AT = 0;

type SaveEpisodeParams = {
  previousEpisodes: Episode[];
  episodeToSave: Episode;
  saveAsNew: boolean;
  newName?: string;
  now: number;
  createEpisodeId?: () => string;
};

type ExportEpisodeParams = {
  episode: Episode;
  robotBaseName: string;
  getJointOrderForFrames: (frames: RecordedFrame[]) => string[];
};

type ApplyTargetFpsParams = {
  episodes: Episode[];
  targetFps: number;
};

export type SaveEpisodeResult = {
  episodes: Episode[];
  savedEpisode: Episode | null;
  errorMessage: string | null;
};

const cloneEpisodeFrames = (frames: readonly RecordedFrame[]) =>
  frames.map((frame) => ({
    timestamp: frame.timestamp,
    jointPositions: { ...frame.jointPositions },
    basePose: cloneRobotBasePose(frame.basePose),
  }));

const createEditedEpisodeId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `episode-${crypto.randomUUID()}`;
  }
  return `episode-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const sanitizeEpisodeAdditional = (additional: unknown) => {
  if (!isRecord(additional)) {
    return {};
  }
  const { hfLazy: _discardedHfLazy, ...sanitizedAdditional } = additional;
  return sanitizedAdditional;
};

const resolveEditedEpisodeAdditional = ({
  episode,
  baseAdditional,
  fallbackName,
  now,
}: {
  episode: Episode;
  baseAdditional: Record<string, unknown>;
  fallbackName: string;
  now: number;
}) => {
  const sourceDescriptor = resolveEpisodeSourceDescriptor(episode, fallbackName);
  return buildDatasetTreatmentAdditionalFields({
    sourceType: sourceDescriptor.sourceType ?? EDITED_EPISODE_SOURCE_TYPE,
    sourceName: sourceDescriptor.sourceName ?? fallbackName,
    baseAdditional,
    extraAdditional: {
      parentEpisodeId: episode.id,
      isEdited: true,
      lastEditedAt: now,
    },
    hfDatasetRepo: sourceDescriptor.hfDatasetRepo,
    canonicalSource: sourceDescriptor.canonicalSource,
    sourceId: sourceDescriptor.sourceId,
    sourceKind: sourceDescriptor.sourceKind,
    treatmentAdditional: sourceDescriptor.datasetTreatment,
    treatmentManifest: sourceDescriptor.datasetTreatmentManifest,
  });
};

const resolveEpisodeReviewJointNames = (
  metadata: EpisodeMetadata | undefined,
  frames: RecordedFrame[]
) => {
  const resolvedNames = resolveEpisodeJointNames({
    id: EPISODE_JOINT_SCAN_ID,
    number: EPISODE_JOINT_SCAN_NUMBER,
    createdAt: EPISODE_JOINT_SCAN_CREATED_AT,
    frames,
    metadata,
  });
  const metadataJointNames = Array.isArray(metadata?.joint_names)
    ? metadata.joint_names.filter(
        (name): name is string =>
          typeof name === "string" && name.trim().length > 0
      )
    : [];
  if (metadataJointNames.length === 0) {
    return resolvedNames;
  }
  const mergedNames = new Set(metadataJointNames.map((name) => name.trim()));
  resolvedNames.forEach((name) => {
    mergedNames.add(name);
  });
  return Array.from(mergedNames);
};

export const computeEpisodeFps = (episode: Episode) => {
  if (!episode || episode.frames.length < 2) return 0;
  const first = episode.frames[0]?.timestamp ?? 0;
  const last = episode.frames[episode.frames.length - 1]?.timestamp ?? first;
  const durationMs = last - first;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return (episode.frames.length - 1) / (durationMs / 1000);
};

export const resampleEpisodeToFps = (episode: Episode, targetFps: number) => {
  if (!episode || episode.frames.length < 2) return episode;
  if (!Number.isFinite(targetFps) || targetFps <= 0) return episode;

  const frames = episode.frames;
  const baseTime = frames[0]?.timestamp ?? 0;
  const sourceTimes = frames.map((frame) => frame.timestamp - baseTime);
  const duration = sourceTimes[sourceTimes.length - 1];
  if (!Number.isFinite(duration) || duration <= 0) return episode;

  const targetCount = Math.max(
    2,
    Math.round((duration / 1000) * targetFps) + 1
  );
  const nextMetadata = episode.metadata
    ? {
        ...episode.metadata,
        fps: targetFps,
        num_frames: targetCount,
        episode_length_sec: duration / 1000,
      }
    : episode.metadata;
  if (targetCount === frames.length) {
    return {
      ...episode,
      metadata: nextMetadata,
    };
  }

  const jointNames = resolveEpisodeReviewJointNames(episode.metadata, frames);
  const lastSourceIndex = frames.length - 1;
  let sourceIndex = 0;

  const nextFrames = Array.from({ length: targetCount }, (_, idx) => {
    const nextTime = (duration * idx) / (targetCount - 1);

    while (
      sourceIndex < lastSourceIndex - 1 &&
      (sourceTimes[sourceIndex + 1] ?? 0) < nextTime
    ) {
      sourceIndex += 1;
    }

    const startTime = sourceTimes[sourceIndex] ?? 0;
    const endTime = sourceTimes[sourceIndex + 1] ?? startTime;
    const alpha =
      endTime > startTime ? (nextTime - startTime) / (endTime - startTime) : 0;
    const fromFrame = frames[sourceIndex];
    const toFrame = frames[sourceIndex + 1] ?? fromFrame;

    const jointPositions: Record<string, number> = {};
    jointNames.forEach((jointName) => {
      const fromValue = fromFrame.jointPositions[jointName];
      const toValue = toFrame.jointPositions[jointName] ?? fromValue;
      if (!Number.isFinite(fromValue) || !Number.isFinite(toValue)) {
        jointPositions[jointName] = Number.isFinite(fromValue)
          ? fromValue
          : toValue ?? 0;
      } else {
        jointPositions[jointName] = fromValue + (toValue - fromValue) * alpha;
      }
    });

    return {
      timestamp: baseTime + nextTime,
      jointPositions,
      basePose: interpolateRobotBasePose(
        fromFrame.basePose,
        toFrame.basePose,
        alpha
      ),
    };
  });

  return {
    ...episode,
    frames: nextFrames,
    metadata: nextMetadata,
  };
};

export const applyTargetFpsToEpisodes = ({
  episodes,
  targetFps,
}: ApplyTargetFpsParams) => {
  let updatedCount = 0;
  const nextEpisodes = episodes.map((episode) => {
    const fps = computeEpisodeFps(episode);
    if (fps <= 0) {
      return episode;
    }
    const mismatch =
      Math.abs(fps - targetFps) > EPISODE_FPS_MISMATCH_TOLERANCE;
    if (!mismatch) {
      return episode;
    }
    updatedCount += 1;
    return resampleEpisodeToFps(episode, targetFps);
  });

  return {
    episodes: updatedCount > 0 ? nextEpisodes : episodes,
    updatedCount,
  };
};

const buildSaveAsNewEpisode = ({
  previousEpisodes,
  episodeToSave,
  trimmedName,
  now,
  createId,
}: {
  previousEpisodes: Episode[];
  episodeToSave: Episode;
  trimmedName?: string;
  now: number;
  createId: () => string;
}) => {
  const newEpisodeNumber = previousEpisodes.length + 1;
  const sourceAdditional = sanitizeEpisodeAdditional(
    episodeToSave.metadata?.additional
  );
  const newEpisode = createEpisode(
    createId(),
    newEpisodeNumber,
    cloneEpisodeFrames(episodeToSave.frames),
    {
      ...episodeToSave.metadata,
      episodeNumber: newEpisodeNumber,
      episode_index: resolvePersistedEpisodeIndex(
        episodeToSave.metadata,
        newEpisodeNumber - 1
      ),
      joint_names: resolveEpisodeReviewJointNames(
        episodeToSave.metadata,
        episodeToSave.frames
      ),
      num_frames: episodeToSave.frames.length,
      episode_length_sec: computeEpisodeDurationSecFromFrames(
        episodeToSave.frames
      ),
      createdAt: now,
      additional: resolveEditedEpisodeAdditional({
        episode: episodeToSave,
        baseAdditional: sourceAdditional,
        fallbackName: trimmedName || `Episode ${newEpisodeNumber} (edited)`,
        now,
      }),
    }
  );
  const nextEpisodes = renumberEpisodes([...previousEpisodes, newEpisode]);
  return {
    episodes: nextEpisodes,
    savedEpisode:
      nextEpisodes.find((episode) => episode.id === newEpisode.id) ?? newEpisode,
  };
};

const buildOverwriteEpisode = ({
  previousEpisodes,
  episodeToSave,
  trimmedName,
  now,
}: {
  previousEpisodes: Episode[];
  episodeToSave: Episode;
  trimmedName?: string;
  now: number;
}) => {
  const targetIndex = previousEpisodes.findIndex(
    (episode) => episode.id === episodeToSave.id
  );
  if (targetIndex === -1) {
    return {
      episodes: previousEpisodes,
      savedEpisode: null,
      errorMessage: "Episode no longer exists",
    };
  }

  const existingEpisode = previousEpisodes[targetIndex];
  const existingAdditional = sanitizeEpisodeAdditional(
    existingEpisode.metadata?.additional
  );
  const updatedAdditional = sanitizeEpisodeAdditional(
    episodeToSave.metadata?.additional
  );
  const updatedEpisode = createEpisode(
    existingEpisode.id,
    existingEpisode.number,
    cloneEpisodeFrames(episodeToSave.frames),
    {
      ...existingEpisode.metadata,
      ...episodeToSave.metadata,
      episodeNumber: existingEpisode.number,
      episode_index: resolvePersistedEpisodeIndex(
        episodeToSave.metadata ?? existingEpisode.metadata,
        existingEpisode.number - 1
      ),
      joint_names: resolveEpisodeReviewJointNames(
        episodeToSave.metadata ?? existingEpisode.metadata,
        episodeToSave.frames
      ),
      num_frames: episodeToSave.frames.length,
      episode_length_sec: computeEpisodeDurationSecFromFrames(
        episodeToSave.frames
      ),
      createdAt: existingEpisode.metadata?.createdAt ?? existingEpisode.createdAt,
      additional: {
        ...resolveEditedEpisodeAdditional({
          episode: {
            ...episodeToSave,
            metadata: {
              ...(existingEpisode.metadata ?? {}),
              ...(episodeToSave.metadata ?? {}),
              additional: {
                ...existingAdditional,
                ...updatedAdditional,
              },
            },
          },
          baseAdditional: {
            ...existingAdditional,
            ...updatedAdditional,
          },
          fallbackName:
            trimmedName || `Episode ${existingEpisode.number} (edited)`,
          now,
        }),
        parentEpisodeId:
          existingEpisode.metadata?.additional?.parentEpisodeId ??
          episodeToSave.id,
      },
    }
  );

  const nextEpisodes = [...previousEpisodes];
  nextEpisodes[targetIndex] = updatedEpisode;
  return {
    episodes: nextEpisodes,
    savedEpisode: updatedEpisode,
    errorMessage: null,
  };
};

export const buildEpisodeSaveResult = ({
  previousEpisodes,
  episodeToSave,
  saveAsNew,
  newName,
  now,
  createEpisodeId = createEditedEpisodeId,
}: SaveEpisodeParams): SaveEpisodeResult => {
  const trimmedName = newName?.trim();
  if (saveAsNew) {
    const result = buildSaveAsNewEpisode({
      previousEpisodes,
      episodeToSave,
      trimmedName,
      now,
      createId: createEpisodeId,
    });
    return {
      episodes: result.episodes,
      savedEpisode: result.savedEpisode,
      errorMessage: null,
    };
  }

  return buildOverwriteEpisode({
    previousEpisodes,
    episodeToSave,
    trimmedName,
    now,
  });
};

export const applyEpisodeLimitCorrections = (
  frames: RecordedFrame[],
  jointLimits: JointLimits,
  modeByJoint: Record<string, JointLimitMode | undefined> = {},
  limitsOverride?: JointLimits
) => {
  const activeLimits = limitsOverride ?? jointLimits;
  if (!activeLimits || Object.keys(activeLimits).length === 0) {
    return { frames, report: null };
  }
  const { frames: correctedFrames, summaries, violations } =
    applyJointLimitCorrectionsToFrames(frames, activeLimits, modeByJoint);
  const report = summarizeJointLimitCorrections(summaries, violations);
  if (report.totalViolations === 0 && report.totalClamped === 0) {
    return { frames: correctedFrames, report: null };
  }
  return { frames: correctedFrames, report };
};

export const buildEpisodeDataExport = ({
  episode,
  robotBaseName,
  getJointOrderForFrames,
}: ExportEpisodeParams) => {
  const joints =
    Array.isArray(episode.metadata?.joint_names) &&
    episode.metadata.joint_names.length > 0
      ? (episode.metadata.joint_names as string[])
      : getJointOrderForFrames(episode.frames);
  const computedFps = computeEpisodeFps(episode);
  const metadata: EpisodeMetadata = {
    ...(episode.metadata ?? {}),
    episodeNumber: episode.number,
    episode_index: episode.metadata?.episode_index ?? episode.number - 1,
    task_index: episode.metadata?.task_index ?? 0,
    robot_type: episode.metadata?.robot_type ?? robotBaseName,
    fps:
      episode.metadata?.fps ??
      (computedFps > 0 ? computedFps : 1000 / RECORDING_INTERVAL_MS),
    joint_names: joints,
    videos: episode.metadata?.videos ?? {},
    recorded_at:
      episode.metadata?.recorded_at ??
      new Date(episode.createdAt).toISOString(),
    episode_length_sec:
      episode.metadata?.episode_length_sec ??
      computeEpisodeDurationSecFromFrames(episode.frames),
    codebase_version: episode.metadata?.codebase_version ?? "v3-compatible",
    createdAt: episode.metadata?.createdAt ?? episode.createdAt,
  };

  return {
    filename: `${robotBaseName}_episode_${String(episode.number).padStart(3, "0")}.json`,
    content: serializeEpisodeJson(
      episode.frames.map((frame) => ({
        timestamp: frame.timestamp,
        joints: frame.jointPositions,
        base_pose: cloneRobotBasePose(frame.basePose),
      })),
      joints,
      metadata
    ),
  };
};
