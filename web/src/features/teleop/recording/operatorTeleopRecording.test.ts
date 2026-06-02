import { describe, expect, it } from "vitest";

import {
  appendOperatorTeleopRecordingSample,
  buildOperatorTeleopRecordingContext,
  createOperatorTeleopRecordingSession,
  finalizeOperatorTeleopRecordingEpisode,
  type OperatorTeleopRecordingCommandMetadata,
  type OperatorTeleopRecordingSample,
} from "@/features/teleop/recording/operatorTeleopRecording";
import {
  OPERATOR_TELEOP_RECORDING_DEFAULT_TASK_LANGUAGE,
  OPERATOR_TELEOP_RECORDING_MAX_SAMPLES,
  OPERATOR_TELEOP_RECORDING_SCHEMA_VERSION,
} from "@/features/teleop/recording/operatorTeleopRecordingParams";
import type {
  OperatorCameraStream,
  OperatorPointCloudFrame,
} from "@/features/teleop/transport/operatorHelperApi";
import type { OperatorLiveJointTelemetry } from "@/features/teleop/perception/operatorPerceptionStore";

const TEST_RECORDING_ID = "teleop-recording-test";
const TEST_STARTED_AT_MS = 1_000;
const TEST_RECORDED_AT_MS = 1_050;
const TEST_ENDED_AT_MS = 1_250;
const TEST_SEQUENCE = 7;
const TEST_SOURCE_TS_MS = 1_040;
const TEST_CAMERA_SEQUENCE = 3;
const TEST_CAMERA_SOURCE_TS_MS = 1_030;
const TEST_CAMERA_ID = "front";
const TEST_CAMERA_LABEL = "Front camera";
const TEST_CAMERA_FRAME_ID = "front_optical";
const TEST_JOINT_NAME = "openarm_left_joint1";
const TEST_OPERATOR_ID = "operator-a";
const TEST_PROVIDER_ID = "provider-a";
const TEST_PROFILE_ID = "openarm_dual_arm_joint_jog";
const TEST_PROFILE_LABEL = "OpenArm dual-arm joint jog";
const TEST_ROBOT_ID = "openarm";
const TEST_SESSION_ID = "session-a";
const TEST_COMMAND_TRANSPORT_KIND = "datagram";
const TEST_TELEOPERATION_MODE = "simulated";
const TEST_INPUT_SOURCE = "joint_jog";
const TEST_PHYSICS_SOURCE = "gateway_proxy";
const TEST_REPLAY_GUARANTEE = "gateway_deterministic";
const TEST_POSITION_RAD = 0.1;
const TEST_VELOCITY_RAD_PER_SEC = 0.2;
const TEST_TORQUE_NM = 0.3;
const TEST_GATEWAY_SEQUENCE = 11;
const TEST_PRE_POSITION_RAD = 0.05;

const TEST_METADATA: OperatorTeleopRecordingCommandMetadata = {
  command_kind: "joint_jog",
  sequence: TEST_SEQUENCE,
  source_ts_ms: TEST_SOURCE_TS_MS,
};

const TEST_PRE_COMMAND_STATE = {
  robotId: TEST_ROBOT_ID,
  adapterId: "fake_openarm",
  profileId: TEST_PROFILE_ID,
  sequence: TEST_GATEWAY_SEQUENCE,
  sourceTsMs: TEST_SOURCE_TS_MS,
  mode: "manual" as const,
  estop: false,
  heartbeatOk: true,
  jointPositionsRad: {
    [TEST_JOINT_NAME]: TEST_PRE_POSITION_RAD,
  },
  gripperPositionsRad: {},
  jointTelemetry: {},
  hardwareMotionSafety: {
    motionReady: true,
    authoritativeJointFeedbackReady: true,
    jointRotationCalibrationReady: true,
    jointRotationCalibrationRequired: false,
    jointRotationCalibrationId: "test-calibration",
    selfCollisionPreflightReady: true,
    gripperMotionEnabled: false,
    lastRejectReason: null,
  },
};

const TEST_POST_COMMAND_STATE = {
  ...TEST_PRE_COMMAND_STATE,
  sequence: TEST_GATEWAY_SEQUENCE + 1,
  jointPositionsRad: {
    [TEST_JOINT_NAME]: TEST_PRE_POSITION_RAD + TEST_POSITION_RAD,
  },
};

const TEST_CAMERA: OperatorCameraStream = {
  id: TEST_CAMERA_ID,
  label: TEST_CAMERA_LABEL,
  kind: "rgbd",
  frameId: TEST_CAMERA_FRAME_ID,
  coordinateFrame: "robot_world",
  intrinsics: {
    width: 640,
    height: 480,
    fx: 430,
    fy: 431,
    ppx: 320,
    ppy: 240,
  },
  capabilities: {
    color: true,
    depth: true,
    pointCloud: true,
  },
  cameraPose: {
    position: [0.4, 0, 0.7],
    rotationRpyDeg: [180, 0, -90],
    scale: 0.001,
    worldFrame: "urdf_z_up",
  },
};

const TEST_POINT_CLOUD_FRAME: OperatorPointCloudFrame = {
  cameraId: TEST_CAMERA_ID,
  frameId: TEST_CAMERA_FRAME_ID,
  coordinateFrame: "robot_world",
  sequence: TEST_CAMERA_SEQUENCE,
  sourceTsMs: TEST_CAMERA_SOURCE_TS_MS,
  intrinsics: TEST_CAMERA.intrinsics,
  pointsXyz: [],
  colorsRgb: [],
};

const TEST_JOINT_TELEMETRY: OperatorLiveJointTelemetry = {
  positionRad: TEST_POSITION_RAD,
  velocityRadPerSec: TEST_VELOCITY_RAD_PER_SEC,
  torqueNm: TEST_TORQUE_NM,
  tempMos: 30,
  tempRotor: 31,
  sourceId: "can-left",
  sourceLabel: "left arm CAN",
  sourceTsMs: TEST_SOURCE_TS_MS,
};

const buildTestContext = () =>
  buildOperatorTeleopRecordingContext({
    cameras: [TEST_CAMERA],
    commandTransportKind: TEST_COMMAND_TRANSPORT_KIND,
    jointTelemetryByName: {
      [TEST_JOINT_NAME]: TEST_JOINT_TELEMETRY,
    },
    operatorId: TEST_OPERATOR_ID,
    pointCloudFrames: [TEST_POINT_CLOUD_FRAME],
    profileId: TEST_PROFILE_ID,
    profileLabel: TEST_PROFILE_LABEL,
    providerId: TEST_PROVIDER_ID,
    robotId: TEST_ROBOT_ID,
    sessionId: TEST_SESSION_ID,
    teleoperationMode: TEST_TELEOPERATION_MODE,
    inputSource: TEST_INPUT_SOURCE,
    physicsSource: TEST_PHYSICS_SOURCE,
    replayGuarantee: TEST_REPLAY_GUARANTEE,
  });

describe("operator teleop recording", () => {
  it("creates sessions with stable schema metadata and fallback task language", () => {
    const session = createOperatorTeleopRecordingSession({
      recordingId: TEST_RECORDING_ID,
      startedAtMs: TEST_STARTED_AT_MS,
      taskLanguage: "",
    });

    expect(session).toMatchObject({
      schemaVersion: OPERATOR_TELEOP_RECORDING_SCHEMA_VERSION,
      recordingId: TEST_RECORDING_ID,
      taskLanguage: OPERATOR_TELEOP_RECORDING_DEFAULT_TASK_LANGUAGE,
      startedAtMs: TEST_STARTED_AT_MS,
      endedAtMs: null,
      droppedSampleCount: 0,
    });
    expect(session.samples).toHaveLength(0);
  });

  it("captures command, camera calibration, point-cloud timing, and joint telemetry", () => {
    const session = createOperatorTeleopRecordingSession({
      recordingId: TEST_RECORDING_ID,
      startedAtMs: TEST_STARTED_AT_MS,
      taskLanguage: TEST_PROFILE_LABEL,
    });
    const updated = appendOperatorTeleopRecordingSample(session, {
      command: {
        kind: "joint_jog",
        jointJog: {
          joint_name: TEST_JOINT_NAME,
          delta_rad: TEST_POSITION_RAD,
        },
      },
      context: buildTestContext(),
      metadata: TEST_METADATA,
      preCommandState: TEST_PRE_COMMAND_STATE,
      postCommandState: TEST_POST_COMMAND_STATE,
      recordedAtMs: TEST_RECORDED_AT_MS,
    });

    expect(updated.samples).toHaveLength(1);
    expect(updated.samples[0]).toMatchObject({
      schemaVersion: OPERATOR_TELEOP_RECORDING_SCHEMA_VERSION,
      sampleIndex: 0,
      metadata: TEST_METADATA,
      recordedAtMs: TEST_RECORDED_AT_MS,
      stateCaptureStatus: "captured",
      preCommandState: TEST_PRE_COMMAND_STATE,
      postCommandState: TEST_POST_COMMAND_STATE,
      context: {
        operatorId: TEST_OPERATOR_ID,
        providerId: TEST_PROVIDER_ID,
        profileId: TEST_PROFILE_ID,
        robotId: TEST_ROBOT_ID,
        sessionId: TEST_SESSION_ID,
        teleoperationMode: TEST_TELEOPERATION_MODE,
        inputSource: TEST_INPUT_SOURCE,
        physicsSource: TEST_PHYSICS_SOURCE,
        replayGuarantee: TEST_REPLAY_GUARANTEE,
        commandTransportKind: TEST_COMMAND_TRANSPORT_KIND,
      },
    });
    expect(updated.samples[0].context.cameras[0]).toMatchObject({
      cameraId: TEST_CAMERA_ID,
      label: TEST_CAMERA_LABEL,
      frameId: TEST_CAMERA_FRAME_ID,
      intrinsics: TEST_CAMERA.intrinsics,
      extrinsics: TEST_CAMERA.cameraPose,
      pointCloudSequence: TEST_CAMERA_SEQUENCE,
      pointCloudSourceTsMs: TEST_CAMERA_SOURCE_TS_MS,
    });
    expect(updated.samples[0].context.joints[0]).toMatchObject({
      jointName: TEST_JOINT_NAME,
      positionRad: TEST_POSITION_RAD,
      velocityRadPerSec: TEST_VELOCITY_RAD_PER_SEC,
      torqueNm: TEST_TORQUE_NM,
      sourceTsMs: TEST_SOURCE_TS_MS,
    });
  });

  it("tracks dropped samples after the recording cap", () => {
    const baseSession = createOperatorTeleopRecordingSession({
      recordingId: TEST_RECORDING_ID,
      startedAtMs: TEST_STARTED_AT_MS,
      taskLanguage: TEST_PROFILE_LABEL,
    });
    const cappedSession = {
      ...baseSession,
      samples: Array.from(
        { length: OPERATOR_TELEOP_RECORDING_MAX_SAMPLES },
        (_, sampleIndex): OperatorTeleopRecordingSample => ({
          schemaVersion: OPERATOR_TELEOP_RECORDING_SCHEMA_VERSION,
          sampleIndex,
          command: { kind: "estop" as const },
          metadata: {
            command_kind: "estop" as const,
            sequence: sampleIndex,
            source_ts_ms: TEST_SOURCE_TS_MS,
          },
          recordedAtMs: TEST_RECORDED_AT_MS,
          context: buildTestContext(),
          stateCaptureStatus: "captured",
          preCommandState: TEST_PRE_COMMAND_STATE,
          postCommandState: TEST_POST_COMMAND_STATE,
        }),
      ),
    };

    const updated = appendOperatorTeleopRecordingSample(cappedSession, {
      command: { kind: "estop" },
      context: buildTestContext(),
      metadata: {
        command_kind: "estop",
        sequence: OPERATOR_TELEOP_RECORDING_MAX_SAMPLES,
        source_ts_ms: TEST_SOURCE_TS_MS,
      },
      preCommandState: TEST_PRE_COMMAND_STATE,
      postCommandState: TEST_POST_COMMAND_STATE,
      recordedAtMs: TEST_RECORDED_AT_MS,
    });

    expect(updated.samples).toHaveLength(OPERATOR_TELEOP_RECORDING_MAX_SAMPLES);
    expect(updated.droppedSampleCount).toBe(1);
  });

  it("finalizes replayable episode metadata", () => {
    const session = appendOperatorTeleopRecordingSample(
      createOperatorTeleopRecordingSession({
        recordingId: TEST_RECORDING_ID,
        startedAtMs: TEST_STARTED_AT_MS,
        taskLanguage: TEST_PROFILE_LABEL,
      }),
      {
        command: { kind: "estop" },
        context: buildTestContext(),
        metadata: {
          command_kind: "estop",
          sequence: TEST_SEQUENCE,
          source_ts_ms: TEST_SOURCE_TS_MS,
        },
        preCommandState: TEST_PRE_COMMAND_STATE,
        postCommandState: TEST_POST_COMMAND_STATE,
        recordedAtMs: TEST_RECORDED_AT_MS,
      },
    );

    const episode = finalizeOperatorTeleopRecordingEpisode(session, TEST_ENDED_AT_MS);

    expect(episode.endedAtMs).toBe(TEST_ENDED_AT_MS);
    expect(episode.durationMs).toBe(TEST_ENDED_AT_MS - TEST_STARTED_AT_MS);
    expect(episode.sampleCount).toBe(1);
  });
});
