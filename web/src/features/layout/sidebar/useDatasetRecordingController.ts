import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import {
  type Episode,
  type EpisodeMetadata,
  type RecordedFrame,
} from "@/features/dataset";
import {
  appendDatasetSourceRecord,
  type DatasetSourceRecord,
} from "@/features/layout/sidebar/datasetSourceHelpers";
import {
  buildRecordedEpisodeInsertResult,
  createRecordingEpisodeId,
  prepareRecordedFramesForPersistence,
  type PreparedRecordedFramesForPersistence,
} from "@/features/layout/sidebar/recordingHelpers";
import {
  RECORDING_ARM_BASE_TRANSLATION_START_THRESHOLD_METERS,
  RECORDING_ARM_BASE_ROTATION_START_THRESHOLD_RAD,
  RECORDING_ARM_JOINT_START_THRESHOLD,
  RECORDING_DEFAULT_FPS,
} from "@/features/layout/sidebar/recordingParams";
import {
  buildDatasetEpisodeMjlabRecording,
  upsertDatasetEpisodeMjlabValidation,
  type DatasetMjlabValidationStatus,
} from "@/features/layout/sidebar/datasetMjlabValidation";
import { validateTeleopMjlabMotion } from "@/features/teleop/recording/operatorTeleopReplayApi";
import type {
  OperatorTeleopMjlabMotionIssue,
  OperatorTeleopMjlabRobotModel,
  OperatorTeleopMjlabValidationResult,
} from "@/features/teleop/recording/operatorTeleopReplayApi";
import {
  OPERATOR_TELEOP_VALIDATION_REQUEST_SEQUENCE_INITIAL,
  OPERATOR_TELEOP_VALIDATION_REQUEST_SEQUENCE_STEP,
} from "@/features/teleop/recording/operatorTeleopRecordingParams";
import { cloneRobotBasePose, hasMeaningfulRobotBasePoseDelta } from "@/shared/lib/robotBasePose";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import { useJointStore } from "@/shared/store/useJointStore";
import { removeJointDataZeroOffset } from "@/shared/lib/jointDataZero";
import { useRobotPoseStore } from "@/shared/store/useRobotPoseStore";
import type { RobotBasePose } from "@/shared/types/feature";

type RecordingStats = {
  frames: number;
  seconds: number;
};

type RecordingMetadataSnapshot = {
  episodeId: string;
  episodeNumber?: number;
  insertPosition?: number;
  metadata?: EpisodeMetadata;
};

type UseDatasetRecordingControllerParams = {
  getCurrentEpisodes: () => readonly Episode[];
  jointLimits: JointLimits;
  buildMjlabRobotModel?: () =>
    | OperatorTeleopMjlabRobotModel
    | null
    | Promise<OperatorTeleopMjlabRobotModel | null>;
  robotBaseName: string;
  setEpisodes: Dispatch<SetStateAction<Episode[]>>;
  setDatasetSources: Dispatch<SetStateAction<DatasetSourceRecord[]>>;
  getJointOrderForFrames: (frames: RecordedFrame[]) => string[];
  stopReplayPlaybackState: (options?: { clearLoadedEpisode?: boolean }) => void;
  resetReplayFrameToStart: () => void;
  setCurrentPlayingEpisodeIndex: Dispatch<SetStateAction<number | null>>;
  setIsAnimating: (value: boolean) => void;
};

type BeginRecordingOptions = {
  episodeNumber?: number;
  insertPosition?: number;
  metadata?: EpisodeMetadata;
  fps?: number;
};

const INITIAL_RECORDING_STATS: RecordingStats = {
  frames: 0,
  seconds: 0,
};

const cloneRecordedFrames = (frames: readonly RecordedFrame[]) =>
  frames.map((frame) => ({
    timestamp: frame.timestamp,
    jointPositions: { ...frame.jointPositions },
    basePose: cloneRobotBasePose(frame.basePose),
  }));

const formatMjlabIssueSummary = (
  issue: OperatorTeleopMjlabMotionIssue,
): string => {
  const location = [
    issue.jointName ? `joint ${issue.jointName}` : "",
    typeof issue.sampleIndex === "number" ? `sample ${issue.sampleIndex}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const measurement =
    issue.code === "self_collision" && typeof issue.value === "number"
      ? ` penetration ${issue.value.toFixed(3)} m`
      : typeof issue.value === "number" && typeof issue.limit === "number"
      ? ` value ${issue.value.toFixed(3)} > limit ${issue.limit.toFixed(3)}`
      : "";
  const links = issue.linkNames?.length
    ? `links ${issue.linkNames.join(" <-> ")}`
    : "";
  const locationSuffix = location ? ` (${location})` : "";
  const linkSuffix = links ? `${locationSuffix ? ", " : " ("}${links}${locationSuffix ? "" : ")"}` : "";
  return `${issue.code}${locationSuffix}${linkSuffix}: ${issue.reason}${measurement}`;
};

const countMjlabWarnings = (issues: readonly OperatorTeleopMjlabMotionIssue[]) =>
  issues.filter((issue) => issue.severity === "warning").length;

const formatMjlabValidationMessage = (
  result: OperatorTeleopMjlabValidationResult,
  episodeNumber: number
): string => {
  const warningCount = countMjlabWarnings(result.issues);
  if (result.success) {
    const warningSuffix =
      warningCount > 0
        ? ` with ${warningCount} warning${warningCount === 1 ? "" : "s"}`
        : "";
    const collisionSuffix =
      result.selfCollisionCount > 0
        ? `, self-collision contacts ${result.selfCollisionCount}`
        : "";
    return `Episode ${episodeNumber} passed MJLab${warningSuffix} at ${result.maxJointVelocityRadPerSec.toFixed(2)} rad/s max${collisionSuffix}.`;
  }
  return `Episode ${episodeNumber} rejected by MJLab with ${result.issues.length} issue(s): max velocity ${result.maxJointVelocityRadPerSec.toFixed(2)} rad/s, max acceleration ${result.maxJointAccelerationRadPerSec2.toFixed(2)} rad/s^2.`;
};

const formatRecordingPersistenceWarning = (
  result: PreparedRecordedFramesForPersistence
): string | null => {
  if (result.status === "motion-limit-exceeded") {
    const limitLabel =
      result.motionStatus.worstKind === "acceleration"
        ? "acceleration limit"
        : "velocity limit";
    return `Recording saved exactly as captured, but MJLab may reject it: ${limitLabel} exceeded (${result.motionStatus.worstJoint ?? "unknown joint"}, ${(result.motionStatus.maxRatio * 100).toFixed(1)}%).`;
  }
  if (result.status === "timestamp-gap-exceeded") {
    return `Recording saved exactly as captured, but MJLab may reject it: timestamp gap ${result.timestampGapStatus.maxGapMs.toFixed(0)} ms.`;
  }
  return null;
};

const clearRecordingRuntimeState = ({
  recordingMetadataRef,
  recordingArmedRef,
  recordingArmJointSnapshotRef,
  recordingArmBasePoseSnapshotRef,
  recordingFrameIndexRef,
}: {
  recordingMetadataRef: MutableRefObject<RecordingMetadataSnapshot | null>;
  recordingArmedRef: MutableRefObject<boolean>;
  recordingArmJointSnapshotRef: MutableRefObject<Record<string, number> | null>;
  recordingArmBasePoseSnapshotRef: MutableRefObject<RobotBasePose | null>;
  recordingFrameIndexRef: MutableRefObject<number>;
}) => {
  recordingMetadataRef.current = null;
  recordingArmedRef.current = false;
  recordingArmJointSnapshotRef.current = null;
  recordingArmBasePoseSnapshotRef.current = null;
  recordingFrameIndexRef.current = 0;
};

export const useDatasetRecordingController = ({
  getCurrentEpisodes,
  jointLimits,
  buildMjlabRobotModel,
  robotBaseName,
  setEpisodes,
  setDatasetSources,
  getJointOrderForFrames,
  stopReplayPlaybackState,
  resetReplayFrameToStart,
  setCurrentPlayingEpisodeIndex,
  setIsAnimating,
}: UseDatasetRecordingControllerParams) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingFps, setRecordingFps] =
    useState<number>(RECORDING_DEFAULT_FPS);
  const [recordingStats, setRecordingStats] =
    useState<RecordingStats>(INITIAL_RECORDING_STATS);
  const [currentRecordingEpisodeId, setCurrentRecordingEpisodeId] =
    useState<string | null>(null);
  const recordingFramesRef = useRef<RecordedFrame[]>([]);
  const recordingMetadataRef = useRef<RecordingMetadataSnapshot | null>(null);
  const recordingFrameIndexRef = useRef<number>(0);
  const recordingIntervalMsRef = useRef<number>(0);
  const recordingIntervalRef = useRef<number | null>(null);
  const recordingArmedRef = useRef<boolean>(false);
  const recordingArmJointSnapshotRef = useRef<Record<string, number> | null>(
    null
  );
  const recordingArmBasePoseSnapshotRef = useRef<RobotBasePose | null>(null);
  const mjlabValidationRequestSequenceRef = useRef(
    OPERATOR_TELEOP_VALIDATION_REQUEST_SEQUENCE_INITIAL,
  );
  const mjlabValidationRequestSequenceByEpisodeRef = useRef<
    Record<string, number>
  >({});

  const validateRecordedEpisodeWithMjlab = useCallback(async (episode: Episode) => {
    mjlabValidationRequestSequenceRef.current +=
      OPERATOR_TELEOP_VALIDATION_REQUEST_SEQUENCE_STEP;
    const requestSequence = mjlabValidationRequestSequenceRef.current;
    mjlabValidationRequestSequenceByEpisodeRef.current[episode.id] =
      requestSequence;
    const pendingStatus: DatasetMjlabValidationStatus = {
      phase: "pending",
      episodeId: episode.id,
      message: `Sending episode ${episode.number} to MJLab.`,
    };
    setEpisodes((previousEpisodes) =>
      upsertDatasetEpisodeMjlabValidation(
        previousEpisodes,
        episode.id,
        pendingStatus,
      ),
    );

    try {
      let mjlabRobotModel: OperatorTeleopMjlabRobotModel | null = null;
      try {
        mjlabRobotModel = (await buildMjlabRobotModel?.()) ?? null;
      } catch (error) {
        console.warn("Failed to prepare MJLab robot model payload:", error);
      }
      const result = await validateTeleopMjlabMotion(
        buildDatasetEpisodeMjlabRecording(episode),
        mjlabRobotModel ? { robotModel: mjlabRobotModel } : {},
      );
      if (
        mjlabValidationRequestSequenceByEpisodeRef.current[episode.id] !==
        requestSequence
      ) {
        return;
      }
      const completedStatus: DatasetMjlabValidationStatus = {
        phase: result.success ? "passed" : "rejected",
        episodeId: episode.id,
        message: formatMjlabValidationMessage(result, episode.number),
        issueSummaries: result.issues.map(formatMjlabIssueSummary),
        issues: result.issues,
      };
      setEpisodes((previousEpisodes) =>
        upsertDatasetEpisodeMjlabValidation(
          previousEpisodes,
          episode.id,
          completedStatus,
        ),
      );
    } catch (error) {
      if (
        mjlabValidationRequestSequenceByEpisodeRef.current[episode.id] !==
        requestSequence
      ) {
        return;
      }
      const unavailableStatus: DatasetMjlabValidationStatus = {
        phase: "unavailable",
        episodeId: episode.id,
        message:
          error instanceof Error
            ? error.message
            : "MJLab validation is unavailable.",
      };
      setEpisodes((previousEpisodes) =>
        upsertDatasetEpisodeMjlabValidation(
          previousEpisodes,
          episode.id,
          unavailableStatus,
        ),
      );
    }
  }, [buildMjlabRobotModel, setEpisodes]);

  const clearRecordingInterval = useCallback(() => {
    if (recordingIntervalRef.current !== null) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  }, []);

  const captureFrame = useCallback(() => {
    const jointStoreState = useJointStore.getState();
    const currentJointValues = jointStoreState.jointValues;
    const recordedJointValues = removeJointDataZeroOffset({
      jointValues: currentJointValues,
      dataZeroJointValues: jointStoreState.dataZeroJointValues,
    });
    const currentBasePose = cloneRobotBasePose(useRobotPoseStore.getState().pose);

    if (recordingArmedRef.current) {
      const baselineJoints = recordingArmJointSnapshotRef.current;
      if (!baselineJoints) {
        recordingArmJointSnapshotRef.current = { ...currentJointValues };
        recordingArmBasePoseSnapshotRef.current =
          cloneRobotBasePose(currentBasePose) ?? null;
        return;
      }

      const hasJointMovement = Object.keys(currentJointValues).some(
        (jointName) => {
          const currentValue = currentJointValues[jointName] ?? 0;
          const baselineValue = baselineJoints[jointName] ?? 0;
          return (
            Math.abs(currentValue - baselineValue) >
            RECORDING_ARM_JOINT_START_THRESHOLD
          );
        }
      );
      const hasBaseMovement = hasMeaningfulRobotBasePoseDelta(
        recordingArmBasePoseSnapshotRef.current,
        currentBasePose,
        RECORDING_ARM_BASE_TRANSLATION_START_THRESHOLD_METERS,
        RECORDING_ARM_BASE_ROTATION_START_THRESHOLD_RAD
      );

      if (!hasJointMovement && !hasBaseMovement) {
        return;
      }

      recordingArmedRef.current = false;
      recordingFramesRef.current = [];
      recordingFrameIndexRef.current = 0;
    }

    const timestamp =
      recordingFrameIndexRef.current * recordingIntervalMsRef.current;
    recordingFrameIndexRef.current += 1;
    recordingFramesRef.current.push({
      timestamp,
      jointPositions: recordedJointValues,
      basePose: cloneRobotBasePose(currentBasePose),
    });
    setRecordingStats({
      frames: recordingFramesRef.current.length,
      seconds: timestamp / 1000,
    });
  }, []);

  const beginRecording = useCallback(
    (options: BeginRecordingOptions = {}) => {
      clearRecordingInterval();
      const episodeId = createRecordingEpisodeId();
      const fps = options.fps ?? recordingFps;
      const intervalMs = fps > 0 ? 1000 / fps : 1000 / RECORDING_DEFAULT_FPS;

      recordingMetadataRef.current = {
        episodeId,
        ...options,
        metadata: {
          ...options.metadata,
          fps,
        },
      };
      recordingFramesRef.current = [];
      recordingArmedRef.current = true;
      recordingArmJointSnapshotRef.current = {
        ...useJointStore.getState().jointValues,
      };
      recordingArmBasePoseSnapshotRef.current =
        cloneRobotBasePose(useRobotPoseStore.getState().pose) ?? null;
      recordingFrameIndexRef.current = 0;
      recordingIntervalMsRef.current = intervalMs;
      setIsRecording(true);
      setCurrentRecordingEpisodeId(episodeId);
      setRecordingStats(INITIAL_RECORDING_STATS);
      recordingIntervalRef.current = window.setInterval(captureFrame, intervalMs);
      return episodeId;
    },
    [captureFrame, clearRecordingInterval, recordingFps]
  );

  const startRecording = useCallback(() => {
    stopReplayPlaybackState({ clearLoadedEpisode: true });
    setCurrentPlayingEpisodeIndex(null);
    resetReplayFrameToStart();
    setIsAnimating(false);
    beginRecording({ fps: recordingFps });
    toast.success(
      `Recording armed at ${recordingFps} FPS. Capturing starts on first robot movement.`
    );
  }, [
    beginRecording,
    recordingFps,
    resetReplayFrameToStart,
    setCurrentPlayingEpisodeIndex,
    setIsAnimating,
    stopReplayPlaybackState,
  ]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    clearRecordingInterval();
    setRecordingStats(INITIAL_RECORDING_STATS);

    const metadataSnapshot = recordingMetadataRef.current;
    clearRecordingRuntimeState({
      recordingMetadataRef,
      recordingArmedRef,
      recordingArmJointSnapshotRef,
      recordingArmBasePoseSnapshotRef,
      recordingFrameIndexRef,
    });

    const rawRecordedFrames = cloneRecordedFrames(recordingFramesRef.current);
    recordingFramesRef.current = [];

    if (rawRecordedFrames.length === 0) {
      setCurrentRecordingEpisodeId(null);
      toast.info("Recording cancelled - no movement captured");
      return;
    }

    const persistenceResult = prepareRecordedFramesForPersistence({
      frames: rawRecordedFrames,
      jointLimits,
    });
    const persistedFrames = persistenceResult.frames;

    if (persistedFrames.length === 0) {
      setCurrentRecordingEpisodeId(null);
      toast.info("Recording cancelled - no movement captured");
      return;
    }
    if (persistenceResult.status === "too-short") {
      setCurrentRecordingEpisodeId(null);
      toast.error("Recording rejected: MJLab requires at least two motion samples");
      return;
    }
    const persistenceWarning =
      formatRecordingPersistenceWarning(persistenceResult);
    const episodeId =
      metadataSnapshot?.episodeId ??
      currentRecordingEpisodeId ??
      createRecordingEpisodeId();
    const result = buildRecordedEpisodeInsertResult({
      previousEpisodes: getCurrentEpisodes(),
      episodeId,
      frames: persistedFrames,
      metadataSnapshot,
      robotBaseName,
      recordingFps,
      getJointOrderForFrames,
    });
    const recordedEpisodeForValidation =
      result.episodes.find((episode) => episode.id === episodeId) ?? null;
    setEpisodes(result.episodes);
    setCurrentRecordingEpisodeId(null);
    setDatasetSources((previousSources) =>
      appendDatasetSourceRecord(previousSources, "recorded", result.sourceName)
    );

    const recordingAdjustments: string[] = [];
    if (persistenceResult.trimmedCount > 0) {
      recordingAdjustments.push(
        `auto-trimmed ${persistenceResult.trimmedCount} idle frame${persistenceResult.trimmedCount === 1 ? "" : "s"}`
      );
    }
    const adjustmentMessage =
      recordingAdjustments.length > 0
        ? ` (${recordingAdjustments.join(", ")})`
        : "";
    toast.success(
      `Stopped recording. Episode ${result.recordedEpisodeNumber} saved with ${persistedFrames.length} frames${adjustmentMessage}`
    );
    if (persistenceWarning) {
      toast.warning(persistenceWarning);
    }
    if (recordedEpisodeForValidation) {
      void validateRecordedEpisodeWithMjlab(recordedEpisodeForValidation);
    } else {
      const unavailableStatus: DatasetMjlabValidationStatus = {
        phase: "unavailable",
        episodeId,
        message: "MJLab validation could not find the saved episode.",
      };
      setEpisodes((previousEpisodes) =>
        upsertDatasetEpisodeMjlabValidation(
          previousEpisodes,
          episodeId,
          unavailableStatus,
        ),
      );
    }
  }, [
    clearRecordingInterval,
    currentRecordingEpisodeId,
    getCurrentEpisodes,
    getJointOrderForFrames,
    jointLimits,
    recordingFps,
    robotBaseName,
    setDatasetSources,
    setEpisodes,
    validateRecordedEpisodeWithMjlab,
  ]);

  useEffect(() => clearRecordingInterval, [clearRecordingInterval]);

  return {
    beginRecording,
    isRecording,
    recordingFps,
    recordingStats,
    setRecordingFps,
    startRecording,
    stopRecording,
  };
};
