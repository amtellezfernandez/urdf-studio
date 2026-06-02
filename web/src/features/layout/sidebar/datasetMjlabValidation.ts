import type { Episode } from "@/features/dataset";
import type { OperatorTeleopMjlabMotionIssue } from "@/features/teleop/recording/operatorTeleopReplayApi";
import {
  OPERATOR_HELPER_DEFAULT_OPERATOR_ID,
  OPERATOR_TELEOPERATION_MODE_STUDIO_KINEMATIC,
  OPERATOR_TELEOP_PHYSICS_SOURCE_NONE,
  OPERATOR_TELEOP_REPLAY_GUARANTEE_KINEMATIC,
} from "@/features/teleop/params/operatorTeleopParams";
import type { OperatorTeleopRecordingEpisode } from "@/features/teleop/recording/operatorTeleopRecording";
import {
  OPERATOR_TELEOP_RECORDING_DEFAULT_TASK_LANGUAGE,
  OPERATOR_TELEOP_RECORDING_DROPPED_SAMPLE_COUNT_INITIAL,
  OPERATOR_TELEOP_RECORDING_SAMPLE_COUNT_INITIAL,
  OPERATOR_TELEOP_RECORDING_SCHEMA_VERSION,
  OPERATOR_TELEOP_VALIDATION_REQUEST_SEQUENCE_STEP,
} from "@/features/teleop/recording/operatorTeleopRecordingParams";

export type DatasetMjlabValidationPhase =
  | "idle"
  | "pending"
  | "passed"
  | "rejected"
  | "unavailable";

export type DatasetMjlabValidationStatus = {
  phase: DatasetMjlabValidationPhase;
  episodeId: string | null;
  message: string;
  issueSummaries?: string[];
  issues?: OperatorTeleopMjlabMotionIssue[];
};

const DATASET_MJLAB_RECORDING_CONTEXT = {
  commandTransportKind: "dataset_frame_recorder",
  providerId: null,
  profileId: null,
  profileLabel: null,
  robotId: null,
  sessionId: null,
  inputSource: null,
} as const;

const DATASET_MJLAB_METADATA = {
  validationKey: "mjlabValidation",
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const isDatasetMjlabValidationPhase = (
  value: unknown,
): value is DatasetMjlabValidationPhase =>
  value === "idle" ||
  value === "pending" ||
  value === "passed" ||
  value === "rejected" ||
  value === "unavailable";

const isDatasetMjlabMotionIssue = (
  value: unknown,
): value is OperatorTeleopMjlabMotionIssue => {
  if (!isRecord(value)) return false;
  if (value.severity !== "error" && value.severity !== "warning") return false;
  if (typeof value.code !== "string") return false;
  if (typeof value.reason !== "string") return false;
  if (
    value.sampleIndex !== undefined &&
    value.sampleIndex !== null &&
    typeof value.sampleIndex !== "number"
  ) {
    return false;
  }
  if (
    value.jointName !== undefined &&
    value.jointName !== null &&
    typeof value.jointName !== "string"
  ) {
    return false;
  }
  if (
    value.linkNames !== undefined &&
    (!Array.isArray(value.linkNames) ||
      !value.linkNames.every((linkName) => typeof linkName === "string"))
  ) {
    return false;
  }
  if (
    value.value !== undefined &&
    value.value !== null &&
    typeof value.value !== "number"
  ) {
    return false;
  }
  if (
    value.limit !== undefined &&
    value.limit !== null &&
    typeof value.limit !== "number"
  ) {
    return false;
  }
  return true;
};

const isDatasetMjlabValidationStatus = (
  value: unknown,
): value is DatasetMjlabValidationStatus => {
  if (!isRecord(value)) return false;
  if (!isDatasetMjlabValidationPhase(value.phase)) return false;
  if (typeof value.message !== "string") return false;
  if (value.episodeId !== null && typeof value.episodeId !== "string") {
    return false;
  }
  const issueSummariesValid =
    value.issueSummaries === undefined ||
    (Array.isArray(value.issueSummaries) &&
      value.issueSummaries.every((summary) => typeof summary === "string"));
  const issuesValid =
    value.issues === undefined ||
    (Array.isArray(value.issues) &&
      value.issues.every((issue) => isDatasetMjlabMotionIssue(issue)));
  return issueSummariesValid && issuesValid;
};

const MJLAB_ISSUE_SUMMARY_PATTERN =
  /^([^(:]+)(?: \(joint ([^,()]+), sample ([0-9]+)\))?: (.*?)(?: value (-?[0-9]+(?:\.[0-9]+)?) > limit (-?[0-9]+(?:\.[0-9]+)?))?$/;

const parseOptionalIssueNumber = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseMjlabIssueSummary = (
  summary: string,
): OperatorTeleopMjlabMotionIssue | null => {
  const match = summary.match(MJLAB_ISSUE_SUMMARY_PATTERN);
  if (!match) return null;
  const code = match[1]?.trim();
  const reason = match[4]?.trim();
  if (!code || !reason) return null;
  return {
    severity: "error",
    code,
    reason,
    jointName: match[2]?.trim() || null,
    sampleIndex: parseOptionalIssueNumber(match[3]),
    value: parseOptionalIssueNumber(match[5]),
    limit: parseOptionalIssueNumber(match[6]),
  };
};

export const resolveDatasetMjlabValidationIssues = (
  validation: DatasetMjlabValidationStatus | null | undefined,
): OperatorTeleopMjlabMotionIssue[] => {
  if (!validation) return [];
  if (Array.isArray(validation.issues) && validation.issues.length > 0) {
    return validation.issues;
  }
  return (validation.issueSummaries ?? [])
    .map(parseMjlabIssueSummary)
    .filter((issue): issue is OperatorTeleopMjlabMotionIssue => issue !== null);
};

const toNonNegativeTimestampMs = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

const toFiniteJointTargets = (
  jointPositions: Record<string, number>,
): Record<string, number> =>
  Object.fromEntries(
    Object.entries(jointPositions).filter(
      ([jointName, jointValue]) =>
        jointName.trim().length > 0 && Number.isFinite(jointValue),
    ),
  );

export const buildDatasetEpisodeMjlabRecording = (
  episode: Episode,
): OperatorTeleopRecordingEpisode => {
  const startedAtMs = toNonNegativeTimestampMs(episode.frames[0]?.timestamp ?? 0);
  const endedAtMs = toNonNegativeTimestampMs(
    episode.frames[episode.frames.length - 1]?.timestamp ?? startedAtMs,
  );
  const samples: OperatorTeleopRecordingEpisode["samples"] = episode.frames.map((frame, frameIndex) => {
    const timestampMs = toNonNegativeTimestampMs(frame.timestamp);
    const sequence =
      OPERATOR_TELEOP_RECORDING_SAMPLE_COUNT_INITIAL +
      frameIndex +
      OPERATOR_TELEOP_VALIDATION_REQUEST_SEQUENCE_STEP;
    return {
      schemaVersion: OPERATOR_TELEOP_RECORDING_SCHEMA_VERSION,
      sampleIndex: OPERATOR_TELEOP_RECORDING_SAMPLE_COUNT_INITIAL + frameIndex,
      command: {
        kind: "joint_targets" as const,
        jointTargets: toFiniteJointTargets(frame.jointPositions),
      },
      metadata: {
        command_kind: "joint_targets" as const,
        sequence,
        source_ts_ms: timestampMs,
      },
      recordedAtMs: timestampMs,
      context: {
        operatorId: OPERATOR_HELPER_DEFAULT_OPERATOR_ID,
        teleoperationMode: OPERATOR_TELEOPERATION_MODE_STUDIO_KINEMATIC,
        physicsSource: OPERATOR_TELEOP_PHYSICS_SOURCE_NONE,
        replayGuarantee: OPERATOR_TELEOP_REPLAY_GUARANTEE_KINEMATIC,
        cameras: [],
        joints: [],
        ...DATASET_MJLAB_RECORDING_CONTEXT,
      },
      stateCaptureStatus: "state_unavailable" as const,
      preCommandState: null,
      postCommandState: null,
    };
  });

  return {
    schemaVersion: OPERATOR_TELEOP_RECORDING_SCHEMA_VERSION,
    recordingId: episode.id,
    taskLanguage:
      episode.metadata?.tasks?.[0] ?? OPERATOR_TELEOP_RECORDING_DEFAULT_TASK_LANGUAGE,
    startedAtMs,
    endedAtMs,
    durationMs: Math.max(0, endedAtMs - startedAtMs),
    samples,
    droppedSampleCount: OPERATOR_TELEOP_RECORDING_DROPPED_SAMPLE_COUNT_INITIAL,
    sampleCount: samples.length,
  };
};

export const resolveDatasetEpisodeMjlabValidation = (
  episode: Episode,
): DatasetMjlabValidationStatus | null => {
  const additional = episode.metadata?.additional;
  if (!isRecord(additional)) return null;
  const validation = additional[DATASET_MJLAB_METADATA.validationKey];
  return isDatasetMjlabValidationStatus(validation) ? validation : null;
};

export const withDatasetEpisodeMjlabValidation = (
  episode: Episode,
  validation: DatasetMjlabValidationStatus,
): Episode => ({
  ...episode,
  metadata: {
    ...(episode.metadata ?? {}),
    additional: {
      ...(isRecord(episode.metadata?.additional)
        ? episode.metadata.additional
        : {}),
      [DATASET_MJLAB_METADATA.validationKey]: validation,
    },
  },
});

export const upsertDatasetEpisodeMjlabValidation = (
  episodes: readonly Episode[],
  episodeId: string,
  validation: DatasetMjlabValidationStatus,
): Episode[] =>
  episodes.map((episode) =>
    episode.id === episodeId
      ? withDatasetEpisodeMjlabValidation(episode, validation)
      : episode,
  );
