import {
  createEpisode,
  normalizeInsertIndex,
  renumberEpisodes,
  type Episode,
  type EpisodeMetadata,
  type RecordedFrame,
} from "@/features/dataset";
import {
  RECORDING_DEFAULT_FPS,
  RECORDING_IDLE_BASE_ROTATION_STEP_EPSILON_RAD,
  RECORDING_IDLE_BASE_ROTATION_TOTAL_DRIFT_EPSILON_RAD,
  RECORDING_IDLE_BASE_TRANSLATION_STEP_EPSILON_METERS,
  RECORDING_IDLE_BASE_TRANSLATION_TOTAL_DRIFT_EPSILON_METERS,
  RECORDING_IDLE_JOINT_STEP_EPSILON,
  RECORDING_IDLE_JOINT_TOTAL_DRIFT_EPSILON,
  RECORDING_IDLE_MIN_DURATION_MS,
  RECORDING_IDLE_MIN_FRAMES,
  RECORDING_STRICT_MOTION_TOLERANCE,
} from "@/features/layout/sidebar/recordingParams";
import {
  computeEpisodeDurationSecFromFrames,
  computeMotionLimitStatusForFrames,
  computeTimestampGapStatusForFrames,
  normalizeRecordedFrameTimestampsForMjlab,
  type EpisodeMotionLimitStatus,
  type EpisodeTimestampGapStatus,
} from "@/features/layout/sidebar/sidebarHelpers";
import { OPERATOR_TELEOP_MJLAB_MOTION_LIMITS } from "@/features/teleop/recording/operatorTeleopMotionSafetyParams";
import { quaternionAngularDistanceRad } from "@/shared/lib/robotBasePose";
import type { JointLimits } from "@/shared/lib/urdfBrowser";

type RecordingMetadataSnapshot = {
  episodeId: string;
  episodeNumber?: number;
  insertPosition?: number;
  metadata?: EpisodeMetadata;
};

type TrimResult = {
  frames: RecordedFrame[];
  trimmedCount: number;
  keepUntil: number;
};

type PreparedRecordedFramesBase = {
  frames: RecordedFrame[];
  trimmedCount: number;
};

export type PreparedRecordedFramesForPersistence =
  | (PreparedRecordedFramesBase & {
      status: "ok";
      motionStatus: EpisodeMotionLimitStatus;
      timestampGapStatus: EpisodeTimestampGapStatus;
    })
  | (PreparedRecordedFramesBase & {
      status: "too-short";
    })
  | (PreparedRecordedFramesBase & {
      status: "motion-limit-exceeded";
      motionStatus: EpisodeMotionLimitStatus;
    })
  | (PreparedRecordedFramesBase & {
      status: "timestamp-gap-exceeded";
      timestampGapStatus: EpisodeTimestampGapStatus;
    });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const createRecordingEpisodeId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `episode-${crypto.randomUUID()}`;
  }
  return `episode-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const formatRecordingSourceName = (episodeNumber: number) =>
  `Recording ${episodeNumber}`;

export const computeRecordedEpisodeFps = (frames: readonly RecordedFrame[]) => {
  if (frames.length < 2) {
    return 0;
  }
  const start = frames[0]?.timestamp ?? 0;
  const end = frames[frames.length - 1]?.timestamp ?? start;
  if (end <= start) {
    return 0;
  }
  return (frames.length - 1) / ((end - start) / 1000);
};

const resolveMaxJointStepDelta = (
  previousFrame: RecordedFrame,
  currentFrame: RecordedFrame
) => {
  let maxDelta = 0;
  const jointNames = new Set([
    ...Object.keys(previousFrame.jointPositions),
    ...Object.keys(currentFrame.jointPositions),
  ]);
  jointNames.forEach((jointName) => {
    const previousValue = previousFrame.jointPositions[jointName] ?? 0;
    const currentValue = currentFrame.jointPositions[jointName] ?? 0;
    const delta = Math.abs(currentValue - previousValue);
    if (delta > maxDelta) {
      maxDelta = delta;
    }
  });
  return maxDelta;
};

const resolveBasePoseStepDelta = (
  previousFrame: RecordedFrame,
  currentFrame: RecordedFrame
) => {
  const previousPose = previousFrame.basePose;
  const currentPose = currentFrame.basePose;
  if (!previousPose && !currentPose) {
    return { translation: 0, rotation: 0, comparable: true };
  }
  if (!previousPose || !currentPose) {
    return {
      translation: Number.POSITIVE_INFINITY,
      rotation: Number.POSITIVE_INFINITY,
      comparable: false,
    };
  }
  const dx = currentPose.position.x - previousPose.position.x;
  const dy = currentPose.position.y - previousPose.position.y;
  const dz = currentPose.position.z - previousPose.position.z;
  return {
    translation: Math.hypot(dx, dy, dz),
    rotation: quaternionAngularDistanceRad(
      previousPose.quaternion,
      currentPose.quaternion
    ),
    comparable: true,
  };
};

export const trimTrailingIdleFrames = (
  frames: readonly RecordedFrame[]
): TrimResult => {
  if (frames.length < 2) {
    return {
      frames: [...frames],
      trimmedCount: 0,
      keepUntil: Math.max(0, frames.length - 1),
    };
  }

  let firstIdleIndex = frames.length - 1;
  for (let index = frames.length - 1; index >= 1; index -= 1) {
    const jointStepDelta = resolveMaxJointStepDelta(
      frames[index - 1],
      frames[index]
    );
    const baseStepDelta = resolveBasePoseStepDelta(
      frames[index - 1],
      frames[index]
    );
    const isJointIdle = jointStepDelta <= RECORDING_IDLE_JOINT_STEP_EPSILON;
    const isBaseIdle =
      baseStepDelta.comparable &&
      baseStepDelta.translation <=
        RECORDING_IDLE_BASE_TRANSLATION_STEP_EPSILON_METERS &&
      baseStepDelta.rotation <= RECORDING_IDLE_BASE_ROTATION_STEP_EPSILON_RAD;
    if (isJointIdle && isBaseIdle) {
      firstIdleIndex = index - 1;
    } else {
      break;
    }
  }

  const idleFrameCount = frames.length - firstIdleIndex;
  if (idleFrameCount < RECORDING_IDLE_MIN_FRAMES) {
    return { frames: [...frames], trimmedCount: 0, keepUntil: frames.length - 1 };
  }

  const idleDurationMs =
    (frames[frames.length - 1]?.timestamp ?? 0) -
    (frames[firstIdleIndex]?.timestamp ?? 0);
  if (idleDurationMs < RECORDING_IDLE_MIN_DURATION_MS) {
    return { frames: [...frames], trimmedCount: 0, keepUntil: frames.length - 1 };
  }

  const idleStart = frames[firstIdleIndex];
  const idleEnd = frames[frames.length - 1];
  const driftJointNames = new Set([
    ...Object.keys(idleStart.jointPositions),
    ...Object.keys(idleEnd.jointPositions),
  ]);
  let maxJointDrift = 0;
  driftJointNames.forEach((jointName) => {
    const startValue = idleStart.jointPositions[jointName] ?? 0;
    const endValue = idleEnd.jointPositions[jointName] ?? 0;
    const drift = Math.abs(endValue - startValue);
    if (drift > maxJointDrift) {
      maxJointDrift = drift;
    }
  });
  if (maxJointDrift > RECORDING_IDLE_JOINT_TOTAL_DRIFT_EPSILON) {
    return { frames: [...frames], trimmedCount: 0, keepUntil: frames.length - 1 };
  }

  const startBasePose = idleStart.basePose;
  const endBasePose = idleEnd.basePose;
  if (Boolean(startBasePose) !== Boolean(endBasePose)) {
    return { frames: [...frames], trimmedCount: 0, keepUntil: frames.length - 1 };
  }
  if (startBasePose && endBasePose) {
    const dx = endBasePose.position.x - startBasePose.position.x;
    const dy = endBasePose.position.y - startBasePose.position.y;
    const dz = endBasePose.position.z - startBasePose.position.z;
    const translationDrift = Math.hypot(dx, dy, dz);
    const rotationDrift = quaternionAngularDistanceRad(
      startBasePose.quaternion,
      endBasePose.quaternion
    );
    if (
      translationDrift >
        RECORDING_IDLE_BASE_TRANSLATION_TOTAL_DRIFT_EPSILON_METERS ||
      rotationDrift > RECORDING_IDLE_BASE_ROTATION_TOTAL_DRIFT_EPSILON_RAD
    ) {
      return { frames: [...frames], trimmedCount: 0, keepUntil: frames.length - 1 };
    }
  }

  const keepUntil = Math.min(frames.length - 1, firstIdleIndex + 1);
  const trimmedFrames = frames.slice(0, keepUntil + 1);
  return {
    frames: trimmedFrames,
    trimmedCount: frames.length - trimmedFrames.length,
    keepUntil,
  };
};

export const prepareRecordedFramesForPersistence = ({
  frames,
  jointLimits,
  strictMotionTolerance = RECORDING_STRICT_MOTION_TOLERANCE,
  minTrajectorySampleCount =
    OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.minTrajectorySampleCount,
}: {
  frames: readonly RecordedFrame[];
  jointLimits: JointLimits;
  strictMotionTolerance?: number;
  minTrajectorySampleCount?: number;
}): PreparedRecordedFramesForPersistence => {
  const { keepUntil, trimmedCount } = trimTrailingIdleFrames(frames);
  const persistedFrames = normalizeRecordedFrameTimestampsForMjlab(
    frames.slice(0, keepUntil + 1)
  );
  const baseResult: PreparedRecordedFramesBase = {
    frames: persistedFrames,
    trimmedCount,
  };

  if (persistedFrames.length < minTrajectorySampleCount) {
    return {
      ...baseResult,
      status: "too-short",
    };
  }

  const motionStatus = computeMotionLimitStatusForFrames(
    persistedFrames,
    jointLimits,
    strictMotionTolerance
  );
  if (motionStatus.overCount > 0) {
    return {
      ...baseResult,
      status: "motion-limit-exceeded",
      motionStatus,
    };
  }

  const timestampGapStatus = computeTimestampGapStatusForFrames(persistedFrames);
  if (timestampGapStatus.overCount > 0) {
    return {
      ...baseResult,
      status: "timestamp-gap-exceeded",
      timestampGapStatus,
    };
  }

  return {
    ...baseResult,
    status: "ok",
    motionStatus,
    timestampGapStatus,
  };
};

export const buildRecordedEpisodeInsertResult = ({
  previousEpisodes,
  episodeId,
  frames,
  metadataSnapshot,
  robotBaseName,
  recordingFps = RECORDING_DEFAULT_FPS,
  getJointOrderForFrames,
  now = Date.now(),
}: {
  previousEpisodes: readonly Episode[];
  episodeId: string;
  frames: RecordedFrame[];
  metadataSnapshot?: RecordingMetadataSnapshot | null;
  robotBaseName: string;
  recordingFps?: number;
  getJointOrderForFrames: (frames: RecordedFrame[]) => string[];
  now?: number;
}) => {
  const insertIndex = normalizeInsertIndex(
    previousEpisodes.length,
    metadataSnapshot?.insertPosition
  );
  const episodeNumber = insertIndex + 1;
  const existingMetadata = metadataSnapshot?.metadata;
  const jointNames =
    Array.isArray(existingMetadata?.joint_names) &&
    existingMetadata.joint_names.length > 0
      ? (existingMetadata.joint_names as string[])
      : getJointOrderForFrames(frames);
  const computedFps = computeRecordedEpisodeFps(frames);
  const fps =
    existingMetadata?.fps ??
    (computedFps > 0 ? computedFps : recordingFps);
  const existingAdditional = isRecord(existingMetadata?.additional)
    ? existingMetadata.additional
    : undefined;
  const { hfLazy: _discardedHfLazy, ...sanitizedAdditional } =
    existingAdditional ?? {};
  const sourceName = formatRecordingSourceName(episodeNumber);

  const episodeMetadata: EpisodeMetadata = {
    ...existingMetadata,
    episodeNumber,
    episode_index: existingMetadata?.episode_index ?? episodeNumber - 1,
    joint_names: jointNames,
    tasks:
      Array.isArray(existingMetadata?.tasks) &&
      existingMetadata.tasks.length > 0
        ? existingMetadata.tasks
        : [],
    fps,
    robot_type: existingMetadata?.robot_type ?? robotBaseName,
    task_index: existingMetadata?.task_index ?? 0,
    videos: existingMetadata?.videos ?? {},
    recorded_at: existingMetadata?.recorded_at ?? new Date(now).toISOString(),
    episode_length_sec: computeEpisodeDurationSecFromFrames(frames),
    codebase_version: existingMetadata?.codebase_version ?? "v3-compatible",
    createdAt: existingMetadata?.createdAt ?? now,
    num_frames: frames.length,
    additional: {
      ...sanitizedAdditional,
      isRecorded: true,
      sourceType: "recorded",
      sourceName,
      sourceId: episodeId,
    },
  };

  const nextEpisodes = [...previousEpisodes];
  nextEpisodes.splice(
    insertIndex,
    0,
    createEpisode(episodeId, episodeNumber, frames, episodeMetadata)
  );

  return {
    episodes: renumberEpisodes(nextEpisodes),
    recordedEpisodeNumber: episodeNumber,
    sourceName,
  };
};
