import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OPERATOR_HELPER_COLLABORATION_SESSION_HEADER,
  OPERATOR_HELPER_COLLABORATION_TELEOP_CAPABILITY_HEADER,
  fetchOperatorGatewayEnvConfig,
  fetchOperatorLeRobotCalibrationCatalog,
  fetchOperatorProviderManifest,
  fetchOperatorPointCloud,
  fetchOperatorSession,
  fetchOperatorStats,
  fetchOperatorState,
  openOperatorLeRobotCalibrationFile,
  openOperatorGatewayEnvConfigFile,
  prepareOperatorJointJogCanDryRun,
  releaseOperatorControlLease,
  releaseOperatorFollowerHardware,
  releaseOperatorFollowerHardwareKeepalive,
  requestOperatorControlLease,
  saveOperatorGatewayEnvConfig,
  sendOperatorOpenArmCalibrationJogCommand,
  startOperatorFollowerCalibration,
  startOperatorLeaderCalibration,
  syncOperatorLeRobotCalibrationFile,
} from "@/features/teleop/transport/operatorHelperApi";
import { COLLABORATION_SESSION_TOKEN_HEADER } from "@/features/collaboration/collaborationTransport";
import {
  OPERATOR_HELPER_AUTHORIZED_PROVIDER_MANIFEST_PATH,
  OPERATOR_HELPER_FOLLOWER_PATHS,
  OPERATOR_HELPER_FOLLOWER_RELEASE_PATH,
  OPERATOR_HELPER_JOINT_JOG_CAN_DRY_RUN_PATH,
  OPERATOR_HELPER_LEADER_PATHS,
  OPERATOR_HELPER_LEROBOT_CALIBRATION_OPEN_PATH,
  OPERATOR_HELPER_LEROBOT_CALIBRATION_SYNC_PATH,
  OPERATOR_HELPER_LEROBOT_CALIBRATIONS_PATH,
  OPERATOR_HELPER_OPENARM_CALIBRATION_JOG_PATH,
} from "@/features/teleop/params/operatorTeleopParams";

const TEST_BASE_URL = "http://127.0.0.1:8091";
const TEST_DIRECT_RTT_BUDGET_MS = 20;
const TEST_PROVIDER_MAX_LINEAR_SPEED_MPS = 1;
const TEST_PROVIDER_MAX_YAW_SPEED_RPS = 3.14;
const TEST_PROVIDER_COMMAND_TICK_MS = 100;
const TEST_PROVIDER_DEADMAN_TIMEOUT_MS = 300;
const TEST_POINT_CLOUD_FIXTURE = {
  cameraWidthPx: 64,
  cameraHeightPx: 48,
  cameraFocalPx: 42,
  cameraPrincipalPointPx: 24,
  sequence: 3,
  sourceTsMs: 1234,
  points: [
    [0.1, 0.2, 0.3],
    [0.4, 0.5, 0.6],
  ],
  colors: [
    [1, 0, 0],
    [0, 1, 0],
  ],
  cameraPose: {
    position: [0.1, 0.2, 0.3],
    rotationRpyDeg: [90, -2, -44],
    scale: 0.001,
  },
} as const;
const TEST_PROVIDER_JOINT_JOG_LIMITS = {
  defaultStepRad: 0.01,
  deltaRad: 0.01,
  maxDeltaRad: 0.05,
  maxVelocityRadPerSec: 0.5,
  sequence: 9,
} as const;
const TEST_OPENARM_CAN_DRY_RUN_FRAME = {
  jointName: "openarm_right_joint3",
  armSide: "right",
  logicalBus: "right_arm",
  motorType: "DM4310",
  protocol: "damiao_mit_control",
  sendCanId: 3,
  recvCanId: 19,
  sendCanIdHex: "0x003",
  recvCanIdHex: "0x013",
  dlc: 8,
  dataBytes: [128, 10, 127, 248, 16, 51, 55, 255],
  dataHex: "800A7FF8103337FF",
  kp: 2,
  kd: 1,
  dq: 0,
  tau: 0,
  transmissionState: "dry_run_not_sent",
} as const;
describe("operatorHelperApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails closed when the provider session route is absent", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () => new Response("not found", { status: 404 }),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchOperatorSession(TEST_BASE_URL)).rejects.toThrow(
      "Operator session failed: 404",
    );
    expect(String(vi.mocked(fetchMock).mock.calls[0][0])).toBe(
      `${TEST_BASE_URL}/session`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes provider-owned teleop profiles from the manifest endpoint", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            contract_version: "urdf-studio.teleop.v1",
            provider_id: "teleop-studio.operator-helper",
            provider_display_name: "Teleop Studio Operator Helper",
            connection_modes: [
              {
                id: "direct_low_latency",
                label: "Direct low-latency",
                summary: "nearby only",
                max_operator_rtt_ms: TEST_DIRECT_RTT_BUDGET_MS,
                config_ref: "/workspace/.env.robot.local",
              },
            ],
            capabilities: {
              observe: true,
              telemetry: true,
              video: false,
              record: false,
              control: true,
              estop: true,
            },
            profiles: [
              {
                id: "teleop_studio_base_twist",
                label: "Teleop Studio base twist",
                summary: "Provider-owned base velocity control.",
                control_target_label: "teleop-studio robot gateway",
                transport: "robot_gateway",
                control_inputs: [
                  {
                    id: "leader_left_arm",
                    kind: "leader_arm",
                    label: "Leader left arm",
                    summary: "Joint mirror source supplied by the provider.",
                  },
                  {
                    id: "operator_joystick",
                    kind: "joystick",
                    label: "Operator joystick",
                    summary: "Joystick source supplied by the provider.",
                  },
                ],
                capabilities: {
                  base_twist: true,
                  lateral_strafe: true,
                  arm_joint_state: false,
                  arm_joint_command: false,
                  state_mirroring: true,
                  joint_jog: true,
                  gripper: true,
                },
                robot_family: "unsupported_family",
                robot_id: "teleop-studio-robot",
                adapter_id: "ros2",
                teleoperation_mode: "real_hardware",
                controlled_joint_names: ["shoulder_pan"],
                topics: {
                  twist: "provider:/control/twist",
                  odom: "provider:/telemetry/robot_state",
                  joint_states: ["provider:/telemetry/joint_states"],
                  joint_jog: "provider:/control/joint-jog",
                },
                limits: {
                  max_linear_speed_mps: TEST_PROVIDER_MAX_LINEAR_SPEED_MPS,
                  max_yaw_speed_rps: TEST_PROVIDER_MAX_YAW_SPEED_RPS,
                  command_tick_ms: TEST_PROVIDER_COMMAND_TICK_MS,
                  deadman_timeout_ms: TEST_PROVIDER_DEADMAN_TIMEOUT_MS,
                  max_joint_jog_delta_rad:
                    TEST_PROVIDER_JOINT_JOG_LIMITS.maxDeltaRad,
                  default_joint_jog_step_rad:
                    TEST_PROVIDER_JOINT_JOG_LIMITS.defaultStepRad,
                  max_joint_velocity_rad_per_s:
                    TEST_PROVIDER_JOINT_JOG_LIMITS.maxVelocityRadPerSec,
                },
              },
            ],
            camera_streams: [
              {
                id: "openarm_depth_camera",
                label: "OpenArm depth camera",
                kind: "rgbd",
                frame_id: "openarm_depth_camera",
                coordinate_frame: "robot_world",
                intrinsics: {
                  width: TEST_POINT_CLOUD_FIXTURE.cameraWidthPx,
                  height: TEST_POINT_CLOUD_FIXTURE.cameraHeightPx,
                  fx: TEST_POINT_CLOUD_FIXTURE.cameraFocalPx,
                  fy: TEST_POINT_CLOUD_FIXTURE.cameraFocalPx,
                  ppx: TEST_POINT_CLOUD_FIXTURE.cameraPrincipalPointPx,
                  ppy: TEST_POINT_CLOUD_FIXTURE.cameraPrincipalPointPx,
                },
                capabilities: {
                  color: true,
                  depth: true,
                  point_cloud: true,
                },
                point_cloud_path:
                  "/perception/cameras/openarm_depth_camera/point-cloud",
                camera_pose: {
                  position: TEST_POINT_CLOUD_FIXTURE.cameraPose.position,
                  rotation_rpy_deg:
                    TEST_POINT_CLOUD_FIXTURE.cameraPose.rotationRpyDeg,
                  scale: TEST_POINT_CLOUD_FIXTURE.cameraPose.scale,
                  world_frame: "urdf_z_up",
                },
              },
            ],
            live_transport: {
              type: "moq",
              relay_url: "https://localhost:4443",
              namespace: "robot-gateway/openarm",
              connect_module_path:
                "/robot-gateway/openarm-hf/connect-module.js",
              tracks: [
                {
                  id: "openarm_depth_camera-video",
                  kind: "video",
                  track_name: "camera/openarm_depth_camera/video",
                  encoding: "h264",
                  camera_id: "openarm_depth_camera",
                },
                {
                  id: "openarm_depth_camera-point-cloud",
                  kind: "pointCloud",
                  track_name: "camera/openarm_depth_camera/point-cloud",
                  encoding: "pointcloud-f32-rgb-f32",
                  camera_id: "openarm_depth_camera",
                },
                {
                  id: "unknown",
                  kind: "unknown",
                  track_name: "camera/openarm_depth_camera/unknown",
                  encoding: "json",
                },
              ],
            },
            control_transport: {
              type: "teleop_sidecar",
              manifest_path: "/teleop/manifest",
              stats_path: "/teleop/stats",
              webtransport_url: "https://127.0.0.1:8092/teleop",
              native_quic_address: "127.0.0.1:8093",
              native_quic_alpn: "urdf-teleop-quic-v1",
              requires_lease: true,
              requires_teleop_capability: true,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchOperatorProviderManifest(TEST_BASE_URL),
    ).resolves.toMatchObject({
      contractVersion: "urdf-studio.teleop.v1",
      providerId: "teleop-studio.operator-helper",
      capabilities: { control: true, video: false },
      connectionModes: [
        {
          id: "direct_low_latency",
          maxOperatorRttMs: TEST_DIRECT_RTT_BUDGET_MS,
          configRef: "/workspace/.env.robot.local",
        },
      ],
      profiles: [
        {
          id: "teleop_studio_base_twist",
          controlTargetLabel: "teleop-studio robot gateway",
          capabilities: {
            lateralStrafe: true,
            stateMirroring: true,
            jointJog: true,
            gripper: true,
          },
          robotFamily: "manipulator",
          robotId: "teleop-studio-robot",
          adapterId: "ros2",
          teleoperationMode: "real_hardware",
          controlledJointNames: ["shoulder_pan"],
          controlInputs: [
            {
              id: "leader_left_arm",
              kind: "leader_arm",
              label: "Leader left arm",
            },
            {
              id: "operator_joystick",
              kind: "joystick",
              label: "Operator joystick",
            },
          ],
          topics: { jointJog: "provider:/control/joint-jog" },
          limits: {
            commandTickMs: TEST_PROVIDER_COMMAND_TICK_MS,
            deadmanTimeoutMs: TEST_PROVIDER_DEADMAN_TIMEOUT_MS,
            maxJointJogDeltaRad: TEST_PROVIDER_JOINT_JOG_LIMITS.maxDeltaRad,
            defaultJointJogStepRad:
              TEST_PROVIDER_JOINT_JOG_LIMITS.defaultStepRad,
          },
        },
      ],
      cameraStreams: [
        {
          id: "openarm_depth_camera",
          label: "OpenArm depth camera",
          coordinateFrame: "robot_world",
          intrinsics: { width: TEST_POINT_CLOUD_FIXTURE.cameraWidthPx },
          capabilities: { pointCloud: true },
          pointCloudPath:
            "/perception/cameras/openarm_depth_camera/point-cloud",
          cameraPose: {
            ...TEST_POINT_CLOUD_FIXTURE.cameraPose,
            worldFrame: "urdf_z_up",
          },
        },
      ],
      liveTransport: {
        type: "moq",
        relayUrl: "https://localhost:4443",
        namespace: "robot-gateway/openarm",
        connectModulePath: "/robot-gateway/openarm-hf/connect-module.js",
        tracks: [
          {
            id: "openarm_depth_camera-video",
            kind: "video",
            trackName: "camera/openarm_depth_camera/video",
            encoding: "h264",
            sourceId: null,
            cameraId: "openarm_depth_camera",
            busId: null,
          },
          {
            id: "openarm_depth_camera-point-cloud",
            kind: "pointCloud",
            trackName: "camera/openarm_depth_camera/point-cloud",
            encoding: "pointcloud-f32-rgb-f32",
            sourceId: null,
            cameraId: "openarm_depth_camera",
            busId: null,
          },
        ],
      },
      controlTransport: null,
    });
    expect(String(vi.mocked(fetchMock).mock.calls[0][0])).toBe(
      `${TEST_BASE_URL}${OPERATOR_HELPER_AUTHORIZED_PROVIDER_MANIFEST_PATH}`,
    );
  });

  it("falls back to the public manifest when authorized discovery is unavailable", async () => {
    const fetchMock: typeof fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(OPERATOR_HELPER_AUTHORIZED_PROVIDER_MANIFEST_PATH)) {
        return new Response("unauthorized", { status: 401 });
      }
      return new Response(
        JSON.stringify({
          contract_version: "urdf-studio.teleop.v1",
          provider_id: "teleop-studio.operator-helper",
          provider_display_name: "Teleop Studio Operator Helper",
          capabilities: {
            observe: true,
            telemetry: true,
            control: false,
            estop: false,
          },
          profiles: [],
          camera_streams: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchOperatorProviderManifest(
        TEST_BASE_URL,
        {
          sessionId: "collab-session",
          teleopCapabilityToken: "teleop-token",
          ownerToken: "owner-token",
        },
        "browser-token",
      ),
    ).resolves.toMatchObject({
      providerId: "teleop-studio.operator-helper",
      liveTransport: null,
    });

    const authorizedRequest = vi.mocked(fetchMock).mock.calls[0];
    expect(String(authorizedRequest[0])).toBe(
      `${TEST_BASE_URL}${OPERATOR_HELPER_AUTHORIZED_PROVIDER_MANIFEST_PATH}`,
    );
    expect(
      (authorizedRequest[1]?.headers as Headers).get("X-Operator-Helper-Token"),
    ).toBe("browser-token");
    expect(
      (authorizedRequest[1]?.headers as Headers).get(
        OPERATOR_HELPER_COLLABORATION_SESSION_HEADER,
      ),
    ).toBe("collab-session");
    expect(
      (authorizedRequest[1]?.headers as Headers).get(
        OPERATOR_HELPER_COLLABORATION_TELEOP_CAPABILITY_HEADER,
      ),
    ).toBe("teleop-token");
    expect(
      (authorizedRequest[1]?.headers as Headers).get(
        COLLABORATION_SESSION_TOKEN_HEADER,
      ),
    ).toBe("owner-token");
    expect(String(vi.mocked(fetchMock).mock.calls[1][0])).toBe(
      `${TEST_BASE_URL}/.well-known/urdf-studio-teleop.json`,
    );
  });

  it("fails closed when the provider stats route is absent", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () => new Response("not found", { status: 404 }),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchOperatorStats(TEST_BASE_URL)).rejects.toThrow(
      "Operator stats failed: 404",
    );
    expect(String(vi.mocked(fetchMock).mock.calls[0][0])).toBe(
      `${TEST_BASE_URL}/stats`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens and saves the robot gateway env config", async () => {
    const fetchMock: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/config/env/open")) {
        return new Response(
          JSON.stringify({
            path: "/workspace/.env.robot.local",
            exists: true,
            opened: true,
            message: "Opened robot gateway env file.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/config/env") && init?.method === "PUT") {
        return new Response(
          JSON.stringify({
            path: "/workspace/.env.robot.local",
            content: JSON.parse(String(init.body)).content,
            exists: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          path: "/workspace/.env.robot.local",
          content: "URDF_ROBOT_GATEWAY_RUNTIME_MODE=control\n",
          exists: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchOperatorGatewayEnvConfig(TEST_BASE_URL)).resolves.toEqual({
      path: "/workspace/.env.robot.local",
      content: "URDF_ROBOT_GATEWAY_RUNTIME_MODE=control\n",
      exists: true,
    });
    await expect(
      saveOperatorGatewayEnvConfig(
        "URDF_BUTTERCLAW_ROBOT_USE_SSH_TUNNEL=true\n",
        TEST_BASE_URL,
      ),
    ).resolves.toMatchObject({
      path: "/workspace/.env.robot.local",
      exists: true,
      content: "URDF_BUTTERCLAW_ROBOT_USE_SSH_TUNNEL=true\n",
    });
    await expect(
      openOperatorGatewayEnvConfigFile(TEST_BASE_URL),
    ).resolves.toMatchObject({
      path: "/workspace/.env.robot.local",
      exists: true,
      opened: true,
    });

    expect(String(vi.mocked(fetchMock).mock.calls[0][0])).toBe(
      `${TEST_BASE_URL}/config/env`,
    );
    expect(String(vi.mocked(fetchMock).mock.calls[1][0])).toBe(
      `${TEST_BASE_URL}/config/env`,
    );
    expect(vi.mocked(fetchMock).mock.calls[1][1]?.method).toBe("PUT");
    expect(String(vi.mocked(fetchMock).mock.calls[2][0])).toBe(
      `${TEST_BASE_URL}/config/env/open`,
    );
    expect(vi.mocked(fetchMock).mock.calls[2][1]?.method).toBe("POST");
  });

  it("normalizes gateway state snapshots for replay recording", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            robot_id: "openarm",
            adapter_id: "fake_openarm",
            profile_id: "openarm_dual_arm_joint_jog",
            sequence: TEST_PROVIDER_JOINT_JOG_LIMITS.sequence,
            source_ts_ms: TEST_POINT_CLOUD_FIXTURE.sourceTsMs,
            mode: "manual",
            estop: false,
            heartbeat_ok: true,
            joint_positions_rad: {
              shoulder_pan: TEST_PROVIDER_JOINT_JOG_LIMITS.deltaRad,
            },
            gripper_positions_rad: {},
            joint_telemetry: {
              shoulder_pan: {
                position_rad: TEST_PROVIDER_JOINT_JOG_LIMITS.deltaRad,
                velocity_rad_per_sec: 0.12,
                torque_nm: -0.4,
                temp_mos_c: 37,
                temp_rotor_c: 38,
                fault_code: null,
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchOperatorState(TEST_BASE_URL)).resolves.toMatchObject({
      robotId: "openarm",
      adapterId: "fake_openarm",
      profileId: "openarm_dual_arm_joint_jog",
      sequence: TEST_PROVIDER_JOINT_JOG_LIMITS.sequence,
      sourceTsMs: TEST_POINT_CLOUD_FIXTURE.sourceTsMs,
      heartbeatOk: true,
      jointPositionsRad: {
        shoulder_pan: TEST_PROVIDER_JOINT_JOG_LIMITS.deltaRad,
      },
      jointTelemetry: {
        shoulder_pan: {
          positionRad: TEST_PROVIDER_JOINT_JOG_LIMITS.deltaRad,
          velocityRadPerSec: 0.12,
          torqueNm: -0.4,
          tempMosC: 37,
          tempRotorC: 38,
          faultCode: null,
        },
      },
    });
    expect(String(vi.mocked(fetchMock).mock.calls[0][0])).toBe(
      `${TEST_BASE_URL}/telemetry/state`,
    );
  });

  it("normalizes operator point-cloud frames from the gateway", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            camera_id: "openarm_depth_camera",
            frame_id: "openarm_depth_camera",
            coordinate_frame: "robot_world",
            sequence: TEST_POINT_CLOUD_FIXTURE.sequence,
            source_ts_ms: TEST_POINT_CLOUD_FIXTURE.sourceTsMs,
            intrinsics: {
              width: TEST_POINT_CLOUD_FIXTURE.cameraWidthPx,
              height: TEST_POINT_CLOUD_FIXTURE.cameraHeightPx,
              fx: TEST_POINT_CLOUD_FIXTURE.cameraFocalPx,
              fy: TEST_POINT_CLOUD_FIXTURE.cameraFocalPx,
              ppx: TEST_POINT_CLOUD_FIXTURE.cameraPrincipalPointPx,
              ppy: TEST_POINT_CLOUD_FIXTURE.cameraPrincipalPointPx,
            },
            points_xyz: TEST_POINT_CLOUD_FIXTURE.points,
            colors_rgb: TEST_POINT_CLOUD_FIXTURE.colors,
            camera_pose: {
              position: TEST_POINT_CLOUD_FIXTURE.cameraPose.position,
              rotation_rpy_deg:
                TEST_POINT_CLOUD_FIXTURE.cameraPose.rotationRpyDeg,
              scale: TEST_POINT_CLOUD_FIXTURE.cameraPose.scale,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchOperatorPointCloud("openarm_depth_camera", undefined, TEST_BASE_URL),
    ).resolves.toMatchObject({
      cameraId: "openarm_depth_camera",
      coordinateFrame: "robot_world",
      sequence: TEST_POINT_CLOUD_FIXTURE.sequence,
      pointsXyz: TEST_POINT_CLOUD_FIXTURE.points,
      colorsRgb: TEST_POINT_CLOUD_FIXTURE.colors,
      cameraPose: TEST_POINT_CLOUD_FIXTURE.cameraPose,
    });
    expect(String(vi.mocked(fetchMock).mock.calls[0][0])).toBe(
      `${TEST_BASE_URL}/perception/cameras/openarm_depth_camera/point-cloud`,
    );
  });

  it("prepares OpenArm CAN joint jog dry-runs without calling the send endpoint", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            accepted: true,
            sequence: TEST_PROVIDER_JOINT_JOG_LIMITS.sequence,
            applied_joint_name: TEST_OPENARM_CAN_DRY_RUN_FRAME.jointName,
            applied_delta_rad: TEST_PROVIDER_JOINT_JOG_LIMITS.deltaRad,
            frame: {
              joint_name: TEST_OPENARM_CAN_DRY_RUN_FRAME.jointName,
              arm_side: TEST_OPENARM_CAN_DRY_RUN_FRAME.armSide,
              logical_bus: TEST_OPENARM_CAN_DRY_RUN_FRAME.logicalBus,
              motor_type: TEST_OPENARM_CAN_DRY_RUN_FRAME.motorType,
              protocol: TEST_OPENARM_CAN_DRY_RUN_FRAME.protocol,
              send_can_id: TEST_OPENARM_CAN_DRY_RUN_FRAME.sendCanId,
              recv_can_id: TEST_OPENARM_CAN_DRY_RUN_FRAME.recvCanId,
              send_can_id_hex: TEST_OPENARM_CAN_DRY_RUN_FRAME.sendCanIdHex,
              recv_can_id_hex: TEST_OPENARM_CAN_DRY_RUN_FRAME.recvCanIdHex,
              dlc: TEST_OPENARM_CAN_DRY_RUN_FRAME.dlc,
              data_bytes: TEST_OPENARM_CAN_DRY_RUN_FRAME.dataBytes,
              data_hex: TEST_OPENARM_CAN_DRY_RUN_FRAME.dataHex,
              mit_param: {
                kp: TEST_OPENARM_CAN_DRY_RUN_FRAME.kp,
                kd: TEST_OPENARM_CAN_DRY_RUN_FRAME.kd,
                q: TEST_PROVIDER_JOINT_JOG_LIMITS.deltaRad,
                dq: TEST_OPENARM_CAN_DRY_RUN_FRAME.dq,
                tau: TEST_OPENARM_CAN_DRY_RUN_FRAME.tau,
              },
              transmission_state:
                TEST_OPENARM_CAN_DRY_RUN_FRAME.transmissionState,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const plan = await prepareOperatorJointJogCanDryRun(
      {
        joint_name: TEST_OPENARM_CAN_DRY_RUN_FRAME.jointName,
        current_position_rad: TEST_PROVIDER_JOINT_JOG_LIMITS.deltaRad,
        delta_rad: TEST_PROVIDER_JOINT_JOG_LIMITS.deltaRad,
      },
      TEST_BASE_URL,
      "token-123",
      {
        command_kind: "joint_jog",
        sequence: TEST_PROVIDER_JOINT_JOG_LIMITS.sequence,
        source_ts_ms: TEST_PROVIDER_JOINT_JOG_LIMITS.sequence,
      },
      null,
      "operator-a",
    );

    const [url, init] = vi.mocked(fetchMock).mock.calls[0];
    expect(String(url)).toBe(
      `${TEST_BASE_URL}${OPERATOR_HELPER_JOINT_JOG_CAN_DRY_RUN_PATH}`,
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      ack_requested: true,
      command_kind: "joint_jog",
      current_position_rad: TEST_PROVIDER_JOINT_JOG_LIMITS.deltaRad,
      delta_rad: TEST_PROVIDER_JOINT_JOG_LIMITS.deltaRad,
      joint_name: TEST_OPENARM_CAN_DRY_RUN_FRAME.jointName,
      operator_id: "operator-a",
      sequence: TEST_PROVIDER_JOINT_JOG_LIMITS.sequence,
    });
    expect(plan.accepted).toBe(true);
    expect(plan.frame?.transmission_state).toBe(
      TEST_OPENARM_CAN_DRY_RUN_FRAME.transmissionState,
    );
  });

  it("sends OpenArm calibration jogs to the dedicated raw jog endpoint", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            accepted: true,
            command_kind: "openarm_calibration_jog",
            sequence: TEST_PROVIDER_JOINT_JOG_LIMITS.sequence,
            applied_joint_name: TEST_OPENARM_CAN_DRY_RUN_FRAME.jointName,
            applied_delta_rad: TEST_PROVIDER_JOINT_JOG_LIMITS.deltaRad,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await sendOperatorOpenArmCalibrationJogCommand(
      {
        joint_name: TEST_OPENARM_CAN_DRY_RUN_FRAME.jointName,
        delta_rad: TEST_PROVIDER_JOINT_JOG_LIMITS.deltaRad,
      },
      {
        command_kind: "openarm_calibration_jog",
        sequence: TEST_PROVIDER_JOINT_JOG_LIMITS.sequence,
        source_ts_ms: TEST_PROVIDER_JOINT_JOG_LIMITS.sequence,
      },
      TEST_BASE_URL,
      "",
      null,
      "operator-a",
    );

    const [url, init] = vi.mocked(fetchMock).mock.calls[0];
    expect(String(url)).toBe(
      `${TEST_BASE_URL}${OPERATOR_HELPER_OPENARM_CALIBRATION_JOG_PATH}`,
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      ack_requested: true,
      command_kind: "openarm_calibration_jog",
      delta_rad: TEST_PROVIDER_JOINT_JOG_LIMITS.deltaRad,
      joint_name: TEST_OPENARM_CAN_DRY_RUN_FRAME.jointName,
      operator_id: "operator-a",
      sequence: TEST_PROVIDER_JOINT_JOG_LIMITS.sequence,
    });
  });

  it("requests and releases robot-gateway control leases", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            accepted: true,
            operator_id: "operator-a",
            profile_id: "openarm_dual_arm_joint_jog",
            reason: "Control lease granted.",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestOperatorControlLease(
        "operator-a",
        "openarm_dual_arm_joint_jog",
        TEST_BASE_URL,
        "token-123",
        {
          sessionId: "collab-lease-session",
          teleopCapabilityToken: "teleop-capability-token",
          ownerToken: "owner-token",
        },
      ),
    ).resolves.toMatchObject({
      accepted: true,
      reason: "Control lease granted.",
    });
    await expect(
      releaseOperatorControlLease(
        "operator-a",
        "openarm_dual_arm_joint_jog",
        TEST_BASE_URL,
        "token-123",
      ),
    ).resolves.toMatchObject({
      accepted: true,
      reason: "Control lease granted.",
    });

    expect(String(vi.mocked(fetchMock).mock.calls[0][0])).toBe(
      `${TEST_BASE_URL}/lease/request`,
    );
    expect(String(vi.mocked(fetchMock).mock.calls[1][0])).toBe(
      `${TEST_BASE_URL}/lease/release`,
    );
    const firstRequest = vi.mocked(fetchMock).mock.calls[0][1];
    expect(
      (firstRequest?.headers as Headers).get("X-Operator-Helper-Token"),
    ).toBe("token-123");
    expect(
      (firstRequest?.headers as Headers).get(OPERATOR_HELPER_COLLABORATION_SESSION_HEADER),
    ).toBe("collab-lease-session");
    expect(
      (firstRequest?.headers as Headers).get(
        OPERATOR_HELPER_COLLABORATION_TELEOP_CAPABILITY_HEADER,
      ),
    ).toBe("teleop-capability-token");
    expect(
      (firstRequest?.headers as Headers).get(COLLABORATION_SESSION_TOKEN_HEADER),
    ).toBe("owner-token");
    expect(JSON.parse(String(firstRequest?.body))).toEqual({
      operator_id: "operator-a",
      profile_id: "openarm_dual_arm_joint_jog",
    });
  });

  it("releases follower hardware through the protected gateway route", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ released: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      releaseOperatorFollowerHardware(TEST_BASE_URL, "token-123", {
        sessionId: "collab-release-session",
        teleopCapabilityToken: "teleop-capability-token",
        ownerToken: "owner-token",
      }),
    ).resolves.toEqual({ released: 1 });

    const [url, init] = vi.mocked(fetchMock).mock.calls[0];
    expect(String(url)).toBe(
      `${TEST_BASE_URL}${OPERATOR_HELPER_FOLLOWER_RELEASE_PATH}`,
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({});
    expect((init?.headers as Headers).get("X-Operator-Helper-Token")).toBe(
      "token-123",
    );
    expect(
      (init?.headers as Headers).get(OPERATOR_HELPER_COLLABORATION_SESSION_HEADER),
    ).toBe("collab-release-session");
    expect(
      (init?.headers as Headers).get(
        OPERATOR_HELPER_COLLABORATION_TELEOP_CAPABILITY_HEADER,
      ),
    ).toBe("teleop-capability-token");
    expect((init?.headers as Headers).get(COLLABORATION_SESSION_TOKEN_HEADER)).toBe(
      "owner-token",
    );

    releaseOperatorFollowerHardwareKeepalive(TEST_BASE_URL, "token-123", {
      sessionId: "collab-release-session",
      teleopCapabilityToken: "teleop-capability-token",
      ownerToken: "owner-token",
    });

    const [keepaliveUrl, keepaliveInit] = vi.mocked(fetchMock).mock.calls[1];
    expect(String(keepaliveUrl)).toBe(
      `${TEST_BASE_URL}${OPERATOR_HELPER_FOLLOWER_RELEASE_PATH}`,
    );
    expect(keepaliveInit?.method).toBe("POST");
    expect(keepaliveInit?.keepalive).toBe(true);
    expect(JSON.parse(String(keepaliveInit?.body))).toEqual({});
  });

  it("starts follower calibration through the local gateway route", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            started: false,
            command: ["lerobot-calibrate", "--robot.type=so100_follower"],
            display_command: "lerobot-calibrate --robot.type=so100_follower",
            message: "Open a terminal.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(startOperatorFollowerCalibration(TEST_BASE_URL)).resolves.toEqual({
      started: false,
      command: ["lerobot-calibrate", "--robot.type=so100_follower"],
      displayCommand: "lerobot-calibrate --robot.type=so100_follower",
      message: "Open a terminal.",
    });

    const [url, init] = vi.mocked(fetchMock).mock.calls[0];
    expect(String(url)).toBe(
      `${TEST_BASE_URL}${OPERATOR_HELPER_FOLLOWER_PATHS.calibrationStart}`,
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({});
  });

  it("starts follower calibration with a selected calibration source", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            started: false,
            command: ["lerobot-calibrate", "--robot.id=shared_arm"],
            display_command: "lerobot-calibrate --robot.id=shared_arm",
            message: "Open a terminal.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await startOperatorFollowerCalibration(TEST_BASE_URL, {
      category: "teleoperators",
      profileId: "so100_leader",
      calibrationId: "shared_arm",
      calibrationDir: "/home/am/.cache/lerobot/teleoperators/so100_leader",
      groupId: "all",
    });

    const [, init] = vi.mocked(fetchMock).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      calibration_source: {
        category: "teleoperators",
        profile_id: "so100_leader",
        calibration_id: "shared_arm",
        calibration_dir: "/home/am/.cache/lerobot/teleoperators/so100_leader",
        group_id: "all",
      },
    });
  });

  it("fetches the LeRobot calibration catalog", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            active_source: {
              category: "robots",
              profile_id: "so100_follower",
              calibration_id: "so100-left-1",
              calibration_dir: "/calibrations/robots/so100_follower",
              group_id: "all",
            },
            entries: [
              {
                id: "robots:so100_follower:so100-left-1:all",
                category: "robots",
                profile_id: "so100_follower",
                calibration_id: "so100-left-1",
                calibration_dir: "/calibrations/robots/so100_follower",
                group_id: "all",
                path: "/calibrations/robots/so100_follower/so100-left-1.json",
                joint_names: ["shoulder_pan"],
                motor_ids: [1],
                zero_positions_rad: { shoulder_pan: 0 },
                actuator_count: 1,
                mtime_ns: 123456789,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchOperatorLeRobotCalibrationCatalog(TEST_BASE_URL),
    ).resolves.toEqual({
      activeSource: {
        category: "robots",
        profileId: "so100_follower",
        calibrationId: "so100-left-1",
        calibrationDir: "/calibrations/robots/so100_follower",
        groupId: "all",
      },
      entries: [
        {
          id: "robots:so100_follower:so100-left-1:all",
          category: "robots",
          profileId: "so100_follower",
          calibrationId: "so100-left-1",
          calibrationDir: "/calibrations/robots/so100_follower",
          groupId: "all",
          path: "/calibrations/robots/so100_follower/so100-left-1.json",
          jointNames: ["shoulder_pan"],
          motorIds: [1],
          zeroPositionsRad: { shoulder_pan: 0 },
          actuatorCount: 1,
          mtimeNs: 123456789,
        },
      ],
    });
    expect(String(vi.mocked(fetchMock).mock.calls[0][0])).toBe(
      `${TEST_BASE_URL}${OPERATOR_HELPER_LEROBOT_CALIBRATIONS_PATH}`,
    );
  });

  it("opens the selected LeRobot calibration file", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            path: "/calibrations/robots/so100_follower/shared_arm.json",
            exists: true,
            opened: true,
            message: "Opened LeRobot calibration file.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      openOperatorLeRobotCalibrationFile(
        {
          category: "robots",
          profileId: "so100_follower",
          calibrationId: "shared_arm",
          calibrationDir: "/calibrations/robots/so100_follower",
          groupId: "all",
        },
        TEST_BASE_URL,
      ),
    ).resolves.toEqual({
      path: "/calibrations/robots/so100_follower/shared_arm.json",
      exists: true,
      opened: true,
      message: "Opened LeRobot calibration file.",
    });

    const [url, init] = vi.mocked(fetchMock).mock.calls[0];
    expect(String(url)).toBe(
      `${TEST_BASE_URL}${OPERATOR_HELPER_LEROBOT_CALIBRATION_OPEN_PATH}`,
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      calibration_source: {
        category: "robots",
        profile_id: "so100_follower",
        calibration_id: "shared_arm",
        calibration_dir: "/calibrations/robots/so100_follower",
        group_id: "all",
      },
    });
  });

  it("syncs only the selected LeRobot calibration target", async () => {
    const shoulderMotorId = 2;
    const elbowMotorId = 1;
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            path: "/calibrations/teleoperators/openarm_mini/bimanual.json",
            exists: true,
            mtime_ns: 42,
            joint_names: ["shoulder_pan", "elbow_flex"],
            motor_ids: [shoulderMotorId, elbowMotorId],
            zero_positions_rad: {
              shoulder_pan: 0,
              elbow_flex: 0,
            },
            changed: true,
            applied: true,
            message: "Reloaded selected leader calibration.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncOperatorLeRobotCalibrationFile(
        {
          role: "leader",
          calibrationSource: {
            category: "teleoperators",
            profileId: "openarm_mini",
            calibrationId: "bimanual",
            calibrationDir: "/calibrations/teleoperators/openarm_mini",
            groupId: "right",
          },
          lastMtimeNs: 21,
          leaderPort: "/dev/serial/by-id/openarm-right",
          leaderMotorIds: [1, 2, 3, 4, 5, 6, 7, 8],
          leaderMotorModel: "sts3215",
        },
        TEST_BASE_URL,
      ),
    ).resolves.toEqual({
      path: "/calibrations/teleoperators/openarm_mini/bimanual.json",
      exists: true,
      mtimeNs: 42,
      jointNames: ["shoulder_pan", "elbow_flex"],
      motorIds: [shoulderMotorId, elbowMotorId],
      zeroPositionsRad: {
        shoulder_pan: 0,
        elbow_flex: 0,
      },
      changed: true,
      applied: true,
      message: "Reloaded selected leader calibration.",
    });

    const [url, init] = vi.mocked(fetchMock).mock.calls[0];
    expect(String(url)).toBe(
      `${TEST_BASE_URL}${OPERATOR_HELPER_LEROBOT_CALIBRATION_SYNC_PATH}`,
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      role: "leader",
      calibration_source: {
        category: "teleoperators",
        profile_id: "openarm_mini",
        calibration_id: "bimanual",
        calibration_dir: "/calibrations/teleoperators/openarm_mini",
        group_id: "right",
      },
      last_mtime_ns: 21,
      leader_port: "/dev/serial/by-id/openarm-right",
      leader_motor_ids: [1, 2, 3, 4, 5, 6, 7, 8],
      leader_motor_model: "sts3215",
    });
  });

  it("starts leader calibration with the selected target identity", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            started: false,
            command: ["lerobot-calibrate", "--teleop.type=so100_leader"],
            display_command: "lerobot-calibrate --teleop.type=so100_leader",
            message: "Open a terminal.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startOperatorLeaderCalibration(
        {
          port: "/dev/serial/by-id/so100-arm",
          portLeft: "/dev/serial/by-id/openarm-left",
          portRight: "/dev/serial/by-id/openarm-right",
          motorIds: [1, 2, 3, 4, 5, 6],
          motorModel: "sts3215",
          calibrationCategory: "robots",
          calibrationProfile: "so100_follower",
          calibrationId: "shared_arm",
          calibrationGroup: "all",
        },
        TEST_BASE_URL,
      ),
    ).resolves.toEqual({
      started: false,
      command: ["lerobot-calibrate", "--teleop.type=so100_leader"],
      displayCommand: "lerobot-calibrate --teleop.type=so100_leader",
      message: "Open a terminal.",
    });

    const [url, init] = vi.mocked(fetchMock).mock.calls[0];
    expect(String(url)).toBe(
      `${TEST_BASE_URL}${OPERATOR_HELPER_LEADER_PATHS.calibrationStart}`,
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      port: "/dev/serial/by-id/so100-arm",
      port_left: "/dev/serial/by-id/openarm-left",
      port_right: "/dev/serial/by-id/openarm-right",
      motor_ids: [1, 2, 3, 4, 5, 6],
      motor_model: "sts3215",
      calibration_category: "robots",
      calibration_profile: "so100_follower",
      calibration_id: "shared_arm",
      calibration_group: "all",
    });
  });

});
