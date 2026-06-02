import { afterEach, describe, expect, it } from "vitest";

import {
  type OperatorLiveJointTelemetry,
  useOperatorPerceptionStore,
} from "@/features/teleop/perception/operatorPerceptionStore";
import {
  OPERATOR_LEADER_TELEMETRY_SOURCE_PREFIX,
  OPERATOR_POINT_CLOUD_AUTOCALIBRATION_DURATION_MS,
} from "@/features/teleop/params/operatorTeleopParams";
import type { OperatorPointCloudFrame } from "@/features/teleop/transport/operatorHelperApi";

const TEST_INTRINSICS = {
  width: 1,
  height: 1,
  fx: 1,
  fy: 1,
  ppx: 0,
  ppy: 0,
};
const TEST_AUTOCALIBRATION_REVIEW = {
  cameraCount: 2,
} as const;
const TEST_JOINT_FIXTURE = {
  followerPositionRad: 2,
  telemetry: {
    positionRad: 1,
    velocityRadPerSec: 0,
    torqueNm: 0,
    tempMos: 0,
    tempRotor: 0,
    sourceId: "hardware-a",
    sourceLabel: "Hardware A",
    sourceTsMs: 1,
  },
} as const;

const buildFrame = (cameraId: string): OperatorPointCloudFrame => ({
  cameraId,
  frameId: cameraId,
  coordinateFrame: "camera",
  sequence: 0,
  sourceTsMs: 0,
  intrinsics: TEST_INTRINSICS,
  pointsXyz: [],
  colorsRgb: [],
});

const buildJointTelemetry = (
  overrides: Partial<OperatorLiveJointTelemetry> = {},
): OperatorLiveJointTelemetry => ({
  ...TEST_JOINT_FIXTURE.telemetry,
  ...overrides,
});

describe("operatorPerceptionStore", () => {
  afterEach(() => {
    useOperatorPerceptionStore.getState().clearOpenArmHfLiveObserveRequest();
  });

  it("removes only the requested point-cloud and camera video sources", () => {
    const directPointCloudFrame = buildFrame("direct-camera");
    const gatewayPointCloudFrame = buildFrame("gateway-camera");
    const directVideoFrame = {
      sourceId: "direct-video",
      label: "Direct video",
      stream: {} as MediaStream,
      mode: "live" as const,
    };
    const gatewayVideoFrame = {
      sourceId: "gateway-video",
      label: "Gateway video",
      stream: {} as MediaStream,
      mode: "live" as const,
    };
    const store = useOperatorPerceptionStore.getState();

    store.upsertActivePointCloudFrame(directPointCloudFrame);
    store.upsertActivePointCloudFrame(gatewayPointCloudFrame);
    store.upsertActiveCameraVideoFrame(directVideoFrame);
    store.upsertActiveCameraVideoFrame(gatewayVideoFrame);

    store.removeActivePointCloudFrame(gatewayPointCloudFrame.cameraId);
    store.removeActiveCameraVideoFrame(gatewayVideoFrame.sourceId);

    const state = useOperatorPerceptionStore.getState();
    expect(state.activePointCloudFrames).toEqual([directPointCloudFrame]);
    expect(state.activePointCloudFrame).toBe(directPointCloudFrame);
    expect(state.activeCameraVideoFrames).toEqual([directVideoFrame]);
    expect(state.activeCameraVideoFrame).toBe(directVideoFrame);
  });

  it("tracks one active point-cloud autocalibration request", () => {
    const store = useOperatorPerceptionStore.getState();

    store.requestPointCloudAutocalibration();
    const firstRequest =
      useOperatorPerceptionStore.getState().pointCloudAutocalibrationRequest;
    store.requestPointCloudAutocalibration();
    const secondRequest =
      useOperatorPerceptionStore.getState().pointCloudAutocalibrationRequest;

    expect(firstRequest?.durationMs).toBe(
      OPERATOR_POINT_CLOUD_AUTOCALIBRATION_DURATION_MS,
    );
    expect(secondRequest?.requestId).toBe((firstRequest?.requestId ?? 0) + 1);

    store.clearPointCloudAutocalibrationRequest();

    expect(
      useOperatorPerceptionStore.getState().pointCloudAutocalibrationRequest,
    ).toBeNull();
  });

  it("clears live joint telemetry independently from camera and cloud state", () => {
    const store = useOperatorPerceptionStore.getState();
    const pointCloudFrame = buildFrame("camera-a");
    const videoFrame = {
      sourceId: "video-a",
      label: "Video A",
      stream: {} as MediaStream,
      mode: "live" as const,
    };

    store.upsertActivePointCloudFrame(pointCloudFrame);
    store.upsertActiveCameraVideoFrame(videoFrame);
    store.upsertActiveJointTelemetry({
      openarm_left_joint1: buildJointTelemetry(),
    });

    store.clearActiveJointTelemetry();

    const state = useOperatorPerceptionStore.getState();
    expect(state.activeJointTelemetryByName).toEqual({});
    expect(state.activeLeaderJointTelemetryByName).toEqual({});
    expect(state.activeFollowerJointTelemetryByName).toEqual({});
    expect(state.activePointCloudFrame).toBe(pointCloudFrame);
    expect(state.activeCameraVideoFrame).toBe(videoFrame);
  });

  it("clears leader telemetry without dropping follower telemetry", () => {
    const store = useOperatorPerceptionStore.getState();
    const leaderTelemetry = buildJointTelemetry({
      sourceId: `${OPERATOR_LEADER_TELEMETRY_SOURCE_PREFIX}serial-a`,
      sourceLabel: "Leader A",
    });
    const followerTelemetry = {
      ...leaderTelemetry,
      positionRad: TEST_JOINT_FIXTURE.followerPositionRad,
      sourceId: "follower-a",
      sourceLabel: "Follower A",
    };

    store.upsertActiveJointTelemetry({
      openarm_left_joint1: leaderTelemetry,
      openarm_right_joint1: followerTelemetry,
    });
    store.upsertActiveLeaderJointTelemetry({
      openarm_left_joint1: leaderTelemetry,
    });

    store.clearActiveLeaderJointTelemetry();

    const state = useOperatorPerceptionStore.getState();
    expect(state.activeLeaderJointTelemetryByName).toEqual({});
    expect(state.activeJointTelemetryByName).toEqual({
      openarm_right_joint1: followerTelemetry,
    });
  });

  it("clears follower telemetry from the active stream without dropping leader telemetry", () => {
    const store = useOperatorPerceptionStore.getState();
    const leaderTelemetry = buildJointTelemetry({
      sourceId: `${OPERATOR_LEADER_TELEMETRY_SOURCE_PREFIX}serial-a`,
      sourceLabel: "Leader A",
    });
    const followerTelemetry = buildJointTelemetry({
      positionRad: TEST_JOINT_FIXTURE.followerPositionRad,
      sourceId: "follower-a",
      sourceLabel: "Follower A",
    });
    const followerGripperTelemetry = buildJointTelemetry({
      positionRad: TEST_JOINT_FIXTURE.followerPositionRad,
      sourceId: "follower-a",
      sourceLabel: "Follower A",
    });

    store.upsertActiveJointTelemetry({
      openarm_left_joint1: leaderTelemetry,
      openarm_right_joint1: followerTelemetry,
      openarm_right_gripper: followerGripperTelemetry,
    });
    store.upsertActiveLeaderJointTelemetry({
      openarm_left_joint1: leaderTelemetry,
    });
    store.upsertActiveFollowerJointTelemetry({
      openarm_right_joint1: followerTelemetry,
      openarm_right_gripper: followerGripperTelemetry,
    });

    store.clearActiveFollowerJointTelemetry();

    const state = useOperatorPerceptionStore.getState();
    expect(state.activeFollowerJointTelemetryByName).toEqual({});
    expect(state.activeLeaderJointTelemetryByName).toEqual({
      openarm_left_joint1: leaderTelemetry,
    });
    expect(state.activeJointTelemetryByName).toEqual({
      openarm_left_joint1: leaderTelemetry,
    });
  });

  it("keeps autocalibration review pending until an explicit decision", () => {
    const store = useOperatorPerceptionStore.getState();

    store.requestPointCloudAutocalibration();
    const requestId =
      useOperatorPerceptionStore.getState().pointCloudAutocalibrationRequest
        ?.requestId ?? 0;
    store.markPointCloudAutocalibrationReady(
      requestId,
      TEST_AUTOCALIBRATION_REVIEW.cameraCount,
    );

    expect(
      useOperatorPerceptionStore.getState().pointCloudAutocalibrationReview,
    ).toMatchObject({
      requestId,
      cameraCount: TEST_AUTOCALIBRATION_REVIEW.cameraCount,
    });

    store.acceptPointCloudAutocalibration();

    expect(
      useOperatorPerceptionStore.getState().pointCloudAutocalibrationDecision,
    ).toMatchObject({
      requestId,
      action: "accept",
    });
  });

  it("tracks scene mesh requests and status independently from autocalibration", () => {
    const store = useOperatorPerceptionStore.getState();

    store.requestPointCloudAutocalibration();
    store.requestPointCloudSceneMeshes();

    const state = useOperatorPerceptionStore.getState();
    expect(state.pointCloudAutocalibrationRequest).not.toBeNull();
    expect(state.pointCloudSceneMeshRequest).toMatchObject({
      requestId: 1,
    });
    expect(state.pointCloudSceneMeshStatus).toBe(
      "Creating scene meshes from cloud.",
    );

    store.setPointCloudSceneMeshStatus("Created 2 cloud scene meshes.");
    store.clearPointCloudSceneMeshRequest();

    const nextState = useOperatorPerceptionStore.getState();
    expect(nextState.pointCloudSceneMeshRequest).toBeNull();
    expect(nextState.pointCloudSceneMeshStatus).toBe(
      "Created 2 cloud scene meshes.",
    );
    expect(nextState.pointCloudAutocalibrationRequest).not.toBeNull();
  });
});
