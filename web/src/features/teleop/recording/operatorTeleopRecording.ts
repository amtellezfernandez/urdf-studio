import type {
  OperatorJointJogCommand,
  OperatorTwistCommand,
} from "@/features/teleop/contracts/operatorControlTypes";
import type {
  OperatorCameraStream,
  OperatorGatewayStateFrame,
  OperatorPointCloudFrame,
} from "@/features/teleop/transport/operatorHelperApi";
import type { OperatorLiveJointTelemetry } from "@/features/teleop/perception/operatorPerceptionStore";
import type { OperatorTeleoperationMode } from "@/features/teleop/profiles/operatorTeleopProfiles";
import type {
  OperatorTeleopRecordingInputSource,
  OperatorTeleopRecordingPhysicsSource,
  OperatorTeleopRecordingReplayGuarantee,
} from "@/features/teleop/recording/operatorTeleopProvenance";
import {
  OPERATOR_TELEOP_RECORDING_DEFAULT_TASK_LANGUAGE,
  OPERATOR_TELEOP_RECORDING_DROPPED_SAMPLE_COUNT_INITIAL,
  OPERATOR_TELEOP_RECORDING_MAX_CAMERAS_PER_SAMPLE,
  OPERATOR_TELEOP_RECORDING_MAX_JOINTS_PER_SAMPLE,
  OPERATOR_TELEOP_RECORDING_MAX_SAMPLES,
  OPERATOR_TELEOP_RECORDING_SAMPLE_COUNT_INITIAL,
  OPERATOR_TELEOP_RECORDING_SCHEMA_VERSION,
} from "@/features/teleop/recording/operatorTeleopRecordingParams";

export type OperatorTeleopRecordingCommand =
  | {
      kind: "twist";
      twist: OperatorTwistCommand;
    }
  | {
      kind: "stop";
      twist: OperatorTwistCommand;
    }
  | {
      kind: "estop";
    }
  | {
      kind: "joint_jog";
      jointJog: OperatorJointJogCommand;
    }
  | {
      kind: "joint_targets";
      jointTargets: Record<string, number>;
    };

export type OperatorTeleopRecordingCommandKind =
  OperatorTeleopRecordingCommand["kind"];

export type OperatorTeleopRecordingCommandMetadata = {
  command_kind: OperatorTeleopRecordingCommandKind;
  sequence: number;
  source_ts_ms: number;
};

export type OperatorTeleopRecordingCameraSnapshot = {
  cameraId: string;
  label: string;
  frameId: string;
  coordinateFrame: OperatorCameraStream["coordinateFrame"];
  intrinsics: OperatorCameraStream["intrinsics"];
  extrinsics: OperatorCameraStream["cameraPose"] | null;
  pointCloudSequence: number | null;
  pointCloudSourceTsMs: number | null;
};

export type OperatorTeleopRecordingJointSnapshot = {
  jointName: string;
  positionRad: number;
  velocityRadPerSec: number;
  torqueNm: number;
  sourceId: string;
  sourceLabel: string;
  sourceTsMs: number;
};

export type OperatorTeleopRecordingContext = {
  operatorId: string;
  providerId: string | null;
  profileId: string | null;
  profileLabel: string | null;
  robotId: string | null;
  sessionId: string | null;
  teleoperationMode: OperatorTeleoperationMode | null;
  inputSource: OperatorTeleopRecordingInputSource | null;
  physicsSource: OperatorTeleopRecordingPhysicsSource;
  replayGuarantee: OperatorTeleopRecordingReplayGuarantee;
  commandTransportKind: string;
  cameras: OperatorTeleopRecordingCameraSnapshot[];
  joints: OperatorTeleopRecordingJointSnapshot[];
};

export type OperatorTeleopRecordingStateCaptureStatus =
  | "captured"
  | "state_unavailable";

export type OperatorTeleopRecordingGatewayStateSnapshot = {
  robotId: string;
  adapterId: string;
  profileId: string;
  sequence: number;
  sourceTsMs: number;
  mode: OperatorGatewayStateFrame["mode"];
  estop: boolean;
  heartbeatOk: boolean;
  jointPositionsRad: Record<string, number>;
  gripperPositionsRad: Record<string, number>;
  jointTelemetry: OperatorGatewayStateFrame["jointTelemetry"];
  hardwareMotionSafety: OperatorGatewayStateFrame["hardwareMotionSafety"];
};

export type OperatorTeleopRecordingSample = {
  schemaVersion: typeof OPERATOR_TELEOP_RECORDING_SCHEMA_VERSION;
  sampleIndex: number;
  command: OperatorTeleopRecordingCommand;
  metadata: OperatorTeleopRecordingCommandMetadata;
  recordedAtMs: number;
  context: OperatorTeleopRecordingContext;
  stateCaptureStatus: OperatorTeleopRecordingStateCaptureStatus;
  preCommandState: OperatorTeleopRecordingGatewayStateSnapshot | null;
  postCommandState: OperatorTeleopRecordingGatewayStateSnapshot | null;
};

export type OperatorTeleopRecordingSession = {
  schemaVersion: typeof OPERATOR_TELEOP_RECORDING_SCHEMA_VERSION;
  recordingId: string;
  taskLanguage: string;
  startedAtMs: number;
  endedAtMs: number | null;
  samples: OperatorTeleopRecordingSample[];
  droppedSampleCount: number;
};

export type OperatorTeleopRecordingEpisode = OperatorTeleopRecordingSession & {
  endedAtMs: number;
  durationMs: number;
  sampleCount: number;
};

type CreateOperatorTeleopRecordingSessionParams = {
  recordingId: string;
  startedAtMs: number;
  taskLanguage?: string | null;
};

type AppendOperatorTeleopRecordingSampleParams = {
  command: OperatorTeleopRecordingCommand;
  context: OperatorTeleopRecordingContext;
  metadata: OperatorTeleopRecordingCommandMetadata;
  preCommandState: OperatorGatewayStateFrame | null;
  postCommandState: OperatorGatewayStateFrame | null;
  recordedAtMs: number;
};

type BuildOperatorTeleopRecordingContextParams = {
  cameras: readonly OperatorCameraStream[];
  commandTransportKind: string;
  jointTelemetryByName: Record<string, OperatorLiveJointTelemetry>;
  operatorId: string;
  pointCloudFrames: readonly OperatorPointCloudFrame[];
  profileId: string | null;
  profileLabel: string | null;
  providerId: string | null;
  robotId: string | null;
  sessionId: string | null;
  teleoperationMode: OperatorTeleoperationMode | null;
  inputSource?: OperatorTeleopRecordingInputSource | null;
  physicsSource: OperatorTeleopRecordingPhysicsSource;
  replayGuarantee: OperatorTeleopRecordingReplayGuarantee;
};

const normalizeTaskLanguage = (taskLanguage: string | null | undefined): string => {
  const normalized = taskLanguage?.trim() ?? "";
  return normalized.length > 0
    ? normalized
    : OPERATOR_TELEOP_RECORDING_DEFAULT_TASK_LANGUAGE;
};

const buildPointCloudFrameByCameraId = (
  pointCloudFrames: readonly OperatorPointCloudFrame[],
): Map<string, OperatorPointCloudFrame> =>
  new Map(pointCloudFrames.map((frame) => [frame.cameraId, frame]));

const snapshotGatewayState = (
  state: OperatorGatewayStateFrame | null,
): OperatorTeleopRecordingGatewayStateSnapshot | null =>
  state
    ? {
        robotId: state.robotId,
        adapterId: state.adapterId,
        profileId: state.profileId,
        sequence: state.sequence,
        sourceTsMs: state.sourceTsMs,
        mode: state.mode,
        estop: state.estop,
        heartbeatOk: state.heartbeatOk,
        jointPositionsRad: { ...state.jointPositionsRad },
        gripperPositionsRad: { ...state.gripperPositionsRad },
        jointTelemetry: { ...state.jointTelemetry },
        hardwareMotionSafety: { ...state.hardwareMotionSafety },
      }
    : null;

export const createOperatorTeleopRecordingSession = ({
  recordingId,
  startedAtMs,
  taskLanguage,
}: CreateOperatorTeleopRecordingSessionParams): OperatorTeleopRecordingSession => ({
  schemaVersion: OPERATOR_TELEOP_RECORDING_SCHEMA_VERSION,
  recordingId,
  taskLanguage: normalizeTaskLanguage(taskLanguage),
  startedAtMs,
  endedAtMs: null,
  samples: [],
  droppedSampleCount: OPERATOR_TELEOP_RECORDING_DROPPED_SAMPLE_COUNT_INITIAL,
});

export const buildOperatorTeleopRecordingContext = ({
  cameras,
  commandTransportKind,
  jointTelemetryByName,
  operatorId,
  pointCloudFrames,
  profileId,
  profileLabel,
  providerId,
  robotId,
  sessionId,
  teleoperationMode,
  inputSource = null,
  physicsSource,
  replayGuarantee,
}: BuildOperatorTeleopRecordingContextParams): OperatorTeleopRecordingContext => {
  const pointCloudFrameByCameraId = buildPointCloudFrameByCameraId(pointCloudFrames);
  const cameraSnapshots = cameras
    .slice(0, OPERATOR_TELEOP_RECORDING_MAX_CAMERAS_PER_SAMPLE)
    .map((camera): OperatorTeleopRecordingCameraSnapshot => {
      const pointCloudFrame = pointCloudFrameByCameraId.get(camera.id) ?? null;
      return {
        cameraId: camera.id,
        label: camera.label,
        frameId: camera.frameId,
        coordinateFrame: camera.coordinateFrame,
        intrinsics: { ...camera.intrinsics },
        extrinsics: camera.cameraPose ? { ...camera.cameraPose } : null,
        pointCloudSequence: pointCloudFrame?.sequence ?? null,
        pointCloudSourceTsMs: pointCloudFrame?.sourceTsMs ?? null,
      };
    });
  const jointSnapshots = Object.entries(jointTelemetryByName)
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .slice(0, OPERATOR_TELEOP_RECORDING_MAX_JOINTS_PER_SAMPLE)
    .map(([jointName, telemetry]): OperatorTeleopRecordingJointSnapshot => ({
      jointName,
      positionRad: telemetry.positionRad,
      velocityRadPerSec: telemetry.velocityRadPerSec,
      torqueNm: telemetry.torqueNm,
      sourceId: telemetry.sourceId,
      sourceLabel: telemetry.sourceLabel,
      sourceTsMs: telemetry.sourceTsMs,
    }));

  return {
    operatorId,
    providerId,
    profileId,
    profileLabel,
    robotId,
    sessionId,
    teleoperationMode,
    inputSource,
    physicsSource,
    replayGuarantee,
    commandTransportKind,
    cameras: cameraSnapshots,
    joints: jointSnapshots,
  };
};

export const appendOperatorTeleopRecordingSample = (
  session: OperatorTeleopRecordingSession,
  params: AppendOperatorTeleopRecordingSampleParams,
): OperatorTeleopRecordingSession => {
  if (session.samples.length >= OPERATOR_TELEOP_RECORDING_MAX_SAMPLES) {
    return {
      ...session,
      droppedSampleCount: session.droppedSampleCount + 1,
    };
  }
  const sample: OperatorTeleopRecordingSample = {
    schemaVersion: OPERATOR_TELEOP_RECORDING_SCHEMA_VERSION,
    sampleIndex:
      OPERATOR_TELEOP_RECORDING_SAMPLE_COUNT_INITIAL + session.samples.length,
    command: params.command,
    metadata: { ...params.metadata },
    recordedAtMs: params.recordedAtMs,
    context: params.context,
    stateCaptureStatus: params.postCommandState
      ? "captured"
      : "state_unavailable",
    preCommandState: snapshotGatewayState(params.preCommandState),
    postCommandState: snapshotGatewayState(params.postCommandState),
  };
  return {
    ...session,
    samples: [...session.samples, sample],
  };
};

export const finalizeOperatorTeleopRecordingEpisode = (
  session: OperatorTeleopRecordingSession,
  endedAtMs: number,
): OperatorTeleopRecordingEpisode => ({
  ...session,
  endedAtMs,
  durationMs: Math.max(0, endedAtMs - session.startedAtMs),
  sampleCount: session.samples.length,
});
