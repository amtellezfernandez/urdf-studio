import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildTeleopMjlabRobotModel,
  exportTeleopKinematicToLeRobot,
  exportTeleopReplayToLeRobot,
  rolloutTeleopMjlabPhysics,
  startTeleopMjlabLiveSession,
  stepTeleopMjlabLiveSession,
  stopTeleopMjlabLiveSession,
  validateTeleopMjlabMotion,
  validateTeleopReplay,
} from "@/features/teleop/recording/operatorTeleopReplayApi";
import type { OperatorTeleopRecordingEpisode } from "@/features/teleop/recording/operatorTeleopRecording";

const TEST_RECORDING: OperatorTeleopRecordingEpisode = {
  schemaVersion: "urdf-studio.teleop-recording.v1",
  recordingId: "fold-shirt-demo",
  taskLanguage: "fold a t-shirt",
  startedAtMs: 1_000,
  endedAtMs: 1_100,
  durationMs: 100,
  sampleCount: 0,
  droppedSampleCount: 0,
  samples: [],
};

const TEST_MESH_URDF = `
<robot name="mesh-check">
  <link name="base">
    <collision>
      <geometry>
        <mesh filename="package://test_robot/meshes/base.obj" />
      </geometry>
    </collision>
  </link>
</robot>
`;
const TEST_ROBOT_MODEL = {
  name: "test-bot",
  urdfXml: "<robot name=\"test-bot\" />",
};
const TEST_WORLD_LAYOUT = {
  world_layout: {
    name: "mjlab-pickup",
    scenario_time_ms: 0,
    scenario_duration_ms: 0,
    objects: [],
  },
};
const TEST_END_EFFECTOR_SAMPLE = {
  sampleIndex: 0,
  timestampMs: 0,
  positionXyz: [0, 0, 0.1] as [number, number, number],
  quatWxyz: [1, 0, 0, 0] as [number, number, number, number],
  gripperOpeningM: 0.04,
};

describe("operatorTeleopReplayApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts recordings to the replay validation endpoint", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            recordingId: TEST_RECORDING.recordingId,
            sampleCount: TEST_RECORDING.sampleCount,
            replayedSampleCount: TEST_RECORDING.sampleCount,
            maxJointErrorRad: 0,
            jointToleranceRad: 0.000001,
            sampleResults: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(validateTeleopReplay(TEST_RECORDING)).resolves.toMatchObject({
      success: true,
      recordingId: TEST_RECORDING.recordingId,
    });
    const [url, init] = vi.mocked(fetchMock).mock.calls[0];
    expect(String(url)).toContain("/teleop/replay/validate");
    expect(JSON.parse(String(init?.body))).toEqual({
      recording: TEST_RECORDING,
    });
  });

  it("posts recordings to the gated LeRobot export endpoint", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            recordingId: TEST_RECORDING.recordingId,
            sampleCount: TEST_RECORDING.sampleCount,
            replayedSampleCount: TEST_RECORDING.sampleCount,
            maxJointErrorRad: 0,
            jointToleranceRad: 0.000001,
            sampleResults: [],
            outputPath: "/tmp/urdf-studio-teleop-replays/fold-shirt-demo",
            datasetPath: "/tmp/urdf-studio-teleop-replays/fold-shirt-demo",
            artifactPaths: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      exportTeleopReplayToLeRobot(TEST_RECORDING, { robotModel: TEST_ROBOT_MODEL }),
    ).resolves.toMatchObject({
      success: true,
      datasetPath: "/tmp/urdf-studio-teleop-replays/fold-shirt-demo",
    });
    const [url, init] = vi.mocked(fetchMock).mock.calls[0];
    expect(String(url)).toContain(
      "/teleop/replay/export/lerobot",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      recording: TEST_RECORDING,
      robotModel: TEST_ROBOT_MODEL,
    });
  });

  it("posts recordings to the kinematic LeRobot export endpoint", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            recordingId: TEST_RECORDING.recordingId,
            sampleCount: TEST_RECORDING.sampleCount,
            replayedSampleCount: 0,
            maxJointErrorRad: 0,
            jointToleranceRad: 0.000001,
            sampleResults: [],
            outputPath: "/tmp/urdf-studio-teleop-replays/fold-shirt-demo",
            datasetPath: "/tmp/urdf-studio-teleop-replays/fold-shirt-demo",
            artifactPaths: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      exportTeleopKinematicToLeRobot(TEST_RECORDING, {
        robotModel: TEST_ROBOT_MODEL,
      }),
    ).resolves.toMatchObject({
      success: true,
      replayedSampleCount: 0,
    });
    const [url, init] = vi.mocked(fetchMock).mock.calls[0];
    expect(String(url)).toContain(
      "/teleop/replay/export/kinematic/lerobot",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      recording: TEST_RECORDING,
      robotModel: TEST_ROBOT_MODEL,
    });
  });

  it("posts recordings to the MJLab motion validation endpoint", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            schemaVersion: "urdf-studio.teleop-mjlab-validation.v1",
            recordingId: TEST_RECORDING.recordingId,
            runtime: {
              runtimeName: "mjlab",
              available: false,
              status: "unavailable",
              dependencies: [],
              acceleratorDependencies: [],
            },
            sampleCount: TEST_RECORDING.sampleCount,
            trajectorySampleCount: TEST_RECORDING.sampleCount,
            jointNames: [],
            durationMs: 0,
            maxJointVelocityRadPerSec: 0,
            maxJointAccelerationRadPerSec2: 0,
            maxTimestampGapMs: 0,
            selfCollisionChecked: false,
            selfCollisionSampleCount: 0,
            selfCollisionCount: 0,
            issues: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(validateTeleopMjlabMotion(TEST_RECORDING)).resolves.toMatchObject({
      success: true,
      recordingId: TEST_RECORDING.recordingId,
    });
    expect(String(vi.mocked(fetchMock).mock.calls[0][0])).toContain(
      "/teleop/mjlab/validate",
    );
    expect(JSON.parse(String(vi.mocked(fetchMock).mock.calls[0][1]?.body))).toEqual({
      recording: TEST_RECORDING,
    });
  });

  it("includes the active robot model in MJLab validation when provided", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            schemaVersion: "urdf-studio.teleop-mjlab-validation.v1",
            recordingId: TEST_RECORDING.recordingId,
            runtime: {
              runtimeName: "mjlab",
              available: false,
              status: "unavailable",
              dependencies: [],
              acceleratorDependencies: [],
            },
            sampleCount: TEST_RECORDING.sampleCount,
            trajectorySampleCount: TEST_RECORDING.sampleCount,
            jointNames: [],
            durationMs: 0,
            maxJointVelocityRadPerSec: 0,
            maxJointAccelerationRadPerSec2: 0,
            maxTimestampGapMs: 0,
            selfCollisionChecked: false,
            selfCollisionSampleCount: 0,
            selfCollisionCount: 0,
            issues: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await validateTeleopMjlabMotion(TEST_RECORDING, { robotModel: TEST_ROBOT_MODEL });

    expect(JSON.parse(String(vi.mocked(fetchMock).mock.calls[0][1]?.body))).toEqual({
      recording: TEST_RECORDING,
      robotModel: TEST_ROBOT_MODEL,
    });
  });

  it("posts recordings and TCP samples to the MJLab physics rollout endpoint", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            schemaVersion: "urdf-studio.teleop-mjlab-rollout.v1",
            recordingId: TEST_RECORDING.recordingId,
            runtime: {
              runtimeName: "mjlab",
              available: true,
              status: "available",
              dependencies: [],
              acceleratorDependencies: [],
            },
            frameCount: 1,
            dynamicObjectCount: 1,
            contactCount: 0,
            frameMap: "identity",
            issues: [],
            frames: [],
            worldWarnings: [],
            mjcfXml: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      rolloutTeleopMjlabPhysics(TEST_RECORDING, {
        worldLayout: TEST_WORLD_LAYOUT,
        endEffectorSamples: [TEST_END_EFFECTOR_SAMPLE],
        frameMap: "identity",
        includeMjcf: true,
        rolloutStepMs: 5,
      }),
    ).resolves.toMatchObject({
      success: true,
      schemaVersion: "urdf-studio.teleop-mjlab-rollout.v1",
    });
    expect(String(vi.mocked(fetchMock).mock.calls[0][0])).toContain(
      "/teleop/mjlab/rollout",
    );
    expect(JSON.parse(String(vi.mocked(fetchMock).mock.calls[0][1]?.body))).toEqual({
      recording: TEST_RECORDING,
      worldLayout: TEST_WORLD_LAYOUT,
      endEffectorSamples: [TEST_END_EFFECTOR_SAMPLE],
      frameMap: "identity",
      includeMjcf: true,
      rolloutStepMs: 5,
    });
  });

  it("starts, steps, and stops MJLab live physics sessions", async () => {
    const responses = [
      {
        success: true,
        schemaVersion: "urdf-studio.teleop-mjlab-live.v1",
        sessionId: "mjlab-live-1",
        runtime: {
          runtimeName: "mjlab",
          available: true,
          status: "available",
          dependencies: [],
          acceleratorDependencies: [],
        },
        frameMap: "identity",
        dynamicObjectCount: 1,
        stepMs: 5,
        issues: [],
        frame: null,
        worldWarnings: [],
        mjcfXml: null,
      },
      {
        success: true,
        schemaVersion: "urdf-studio.teleop-mjlab-live.v1",
        sessionId: "mjlab-live-1",
        frameIndex: 1,
        contactCount: 1,
        simStepCount: 3,
        physicsStepWallMs: 0.25,
        realtimeFactor: 60,
        issues: [],
        frame: null,
      },
      {
        success: true,
        schemaVersion: "urdf-studio.teleop-mjlab-live.v1",
        sessionId: "mjlab-live-1",
        released: true,
      },
    ];
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(responses.shift()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startTeleopMjlabLiveSession({
        worldLayout: TEST_WORLD_LAYOUT,
        initialEndEffectorSample: TEST_END_EFFECTOR_SAMPLE,
        frameMap: "identity",
        stepMs: 5,
      }),
    ).resolves.toMatchObject({ sessionId: "mjlab-live-1" });
    await expect(
      stepTeleopMjlabLiveSession({
        sessionId: "mjlab-live-1",
        endEffectorSample: TEST_END_EFFECTOR_SAMPLE,
      }),
    ).resolves.toMatchObject({ frameIndex: 1, contactCount: 1 });
    await expect(stopTeleopMjlabLiveSession("mjlab-live-1")).resolves.toMatchObject({
      released: true,
    });

    expect(String(vi.mocked(fetchMock).mock.calls[0][0])).toContain(
      "/teleop/mjlab/live/start",
    );
    expect(JSON.parse(String(vi.mocked(fetchMock).mock.calls[0][1]?.body))).toEqual({
      worldLayout: TEST_WORLD_LAYOUT,
      initialEndEffectorSample: TEST_END_EFFECTOR_SAMPLE,
      frameMap: "identity",
      stepMs: 5,
    });
    expect(String(vi.mocked(fetchMock).mock.calls[1][0])).toContain(
      "/teleop/mjlab/live/step",
    );
    expect(JSON.parse(String(vi.mocked(fetchMock).mock.calls[1][1]?.body))).toEqual({
      sessionId: "mjlab-live-1",
      endEffectorSample: TEST_END_EFFECTOR_SAMPLE,
    });
    expect(String(vi.mocked(fetchMock).mock.calls[2][0])).toContain(
      "/teleop/mjlab/live/mjlab-live-1",
    );
    expect(vi.mocked(fetchMock).mock.calls[2][1]?.method).toBe("DELETE");
  });

  it("builds MJLab robot model payloads with resolved mesh assets", async () => {
    const meshBlob = new Blob(["mesh-bytes"], { type: "model/obj" });

    const robotModel = await buildTeleopMjlabRobotModel({
      name: "mesh-check",
      urdfXml: TEST_MESH_URDF,
      meshFiles: {
        "robots/test_robot/meshes/base.obj": meshBlob,
      },
      packageRoots: {
        test_robot: ["robots/test_robot"],
      },
    });

    expect(robotModel).toMatchObject({
      name: "mesh-check",
      urdfXml: TEST_MESH_URDF,
      meshFiles: [
        {
          path: "robots/test_robot/meshes/base.obj",
          mimeType: "model/obj",
        },
      ],
    });
    expect(robotModel.meshFiles?.[0]?.base64Content).toBeTruthy();
  });
});
