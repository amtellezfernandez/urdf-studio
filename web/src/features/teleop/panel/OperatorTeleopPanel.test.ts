// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OperatorTeleopPanel,
  OperatorTeleopPanelShell,
} from "@/features/teleop/panel/OperatorTeleopPanel";
import type { OperatorCalibrationFileEditSession } from "@/features/teleop/panel/useOperatorCalibrationFileEdit";
import { applyCalibrationFileEditLeaderTelemetryOverride } from "@/features/teleop/panel/operatorCalibrationFileEditTelemetry";
import { createOperatorCommandQueue } from "@/features/teleop/operator-control/operatorCommandQueue";
import {
  OPERATOR_LEADER_TELEOP_UNAVAILABLE_STATUS,
  useOperatorLeaderTeleopStore,
} from "@/features/teleop/operator-control/operatorLeaderTeleopStore";
import { isOperatorTeleopEditableKeyboardTarget } from "@/features/teleop/operator-control/operatorTeleopKeyboard";
import {
  OPERATOR_DEVICE_ROLE_ASSIGNMENTS_STORAGE_KEY,
  OPERATOR_HELPER_ENV_CONFIG_PATH,
  OPERATOR_HELPER_LEADER_PATHS,
  OPERATOR_HELPER_LEROBOT_CALIBRATION_OPEN_PATH,
  OPERATOR_HELPER_LEROBOT_CALIBRATION_SYNC_PATH,
  OPERATOR_HELPER_LEROBOT_CALIBRATIONS_PATH,
  OPERATOR_HELPER_OPENARM_CALIBRATION_JOG_PATH,
  OPERATOR_HELPER_STOP_TWIST,
  OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
  OPERATOR_OPENARM_CALIBRATION_JOG,
} from "@/features/teleop/params/operatorTeleopParams";
import { writeOperatorTeleopPanelState } from "@/features/teleop/panel/operatorTeleopPanelPersistence";
import { useOperatorPerceptionStore } from "@/features/teleop/perception/operatorPerceptionStore";
import { OPENARM_HF_LIVE_CAMERA_RPY_RAD } from "@/features/teleop/perception/openArmHfLiveParams";
import { useCameraStore } from "@/shared/store/useCameraStore";
import { useJointStore } from "@/shared/store/useJointStore";
import {
  describeOperatorProfileCapabilities,
  describeOperatorProfileControlInputs,
  describeOperatorProfileTopics,
  getOperatorTeleopProfile,
} from "@/features/teleop/profiles/operatorTeleopProfiles";
import { normalizeOperatorProviderManifest } from "@/features/teleop/transport/operatorHelperApi";
import type { OperatorLeaderTelemetryTarget } from "@/features/teleop/transport/operatorLeaderTelemetry";
import { COLLABORATION_SESSION_TOKEN_HEADER } from "@/features/collaboration/collaborationTransport";
import {
  TEST_CALIBRATION_INITIAL_REVISION,
  TEST_CALIBRATION_REVISION,
  TEST_CALIBRATION_SESSION_ID,
  TEST_CALIBRATION_ZERO_OVERRIDES,
  TEST_CAMERA_CONFIG_POSE,
  TEST_CAMERA_DEPTH_TRACK_NAME,
  TEST_CAMERA_FIXTURE,
  TEST_CAMERA_METADATA_TRACK_NAME,
  TEST_CAMERA_POSE,
  TEST_CAMERA_STREAM,
  TEST_CAMERA_VIDEO_TRACK_NAME,
  TEST_ELBOW_MOTOR_ID,
  TEST_LEADER_TARGET_DIRECTION,
  TEST_LIVE_NAMESPACE,
  TEST_LIVE_RELAY_URL,
  TEST_OPENARM_LEADER_TELEMETRY,
  TEST_OPENARM_LIVE_TRANSPORT,
  TEST_POINT_CLOUD_FRAME,
  TEST_PROVIDER_COMMAND_TICK_MS,
  TEST_PROVIDER_DEADMAN_TIMEOUT_MS,
  TEST_PROVIDER_JOINT_LIMITS,
  TEST_PROVIDER_MANIFEST,
  TEST_PROVIDER_MAX_LINEAR_SPEED_MPS,
  TEST_PROVIDER_MAX_YAW_SPEED_RPS,
  TEST_PROVIDER_PROFILE,
  TEST_SHOULDER_MOTOR_ID,
} from "@/features/teleop/panel/OperatorTeleopPanel.testFixtures";

const { startOpenArmHfLiveObserveMock, stopOpenArmHfLiveObserveMock } = vi.hoisted(() => ({
  startOpenArmHfLiveObserveMock: vi.fn(),
  stopOpenArmHfLiveObserveMock: vi.fn(),
}));

vi.mock("@/features/teleop/perception/openArmHfLiveObserveClient", () => ({
  startOpenArmHfLiveObserve: startOpenArmHfLiveObserveMock,
  stopOpenArmHfLiveObserve: stopOpenArmHfLiveObserveMock,
}));

const FIRST_COMMAND_TS_MS = 100;
const SECOND_COMMAND_TS_MS = 125;
const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const clickOpenArmLeaderScan = async (container: HTMLElement) => {
  const scanButton = Array.from(container.querySelectorAll("button")).find(
    (button) =>
      button.textContent === "Scan" || button.textContent === "Rescan",
  );
  expect(scanButton).toBeTruthy();
  await act(async () => {
    scanButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();
    await flushMicrotasks();
  });
};

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  useOperatorPerceptionStore.getState().clearOpenArmHfLiveObserveRequest();
  useOperatorPerceptionStore.getState().clearActiveJointTelemetry();
  useOperatorLeaderTeleopStore
    .getState()
    .setLeaderTeleopStatus(OPERATOR_LEADER_TELEOP_UNAVAILABLE_STATUS);
  useOperatorLeaderTeleopStore
    .getState()
    .setLeaderTeleopViewerModeActive(false);
  useOperatorLeaderTeleopStore
    .getState()
    .setLocalLeaderAssigned(false);
  useOperatorLeaderTeleopStore
    .getState()
    .setFollowerHardwareConnected(false);
  useCameraStore.getState().clearCameras();
  useJointStore.getState().setJointValues({});
  useJointStore.getState().setInitialJointValues({});
  useJointStore.getState().setDataZeroJointValues({});
  useJointStore.getState().setAvailableJoints([]);
  useJointStore.getState().setJointTopology({});
  window.localStorage.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("applyCalibrationFileEditLeaderTelemetryOverride", () => {
  it("uses the synced calibration mapping for live leader telemetry", () => {
    const target: OperatorLeaderTelemetryTarget = {
      id: "leader-target",
      path: "/dev/serial/by-id/leader",
      identityKey: "leader:/dev/serial/by-id/leader",
      label: "Arm",
      side: "both",
      motorIds: [TEST_ELBOW_MOTOR_ID, TEST_SHOULDER_MOTOR_ID],
      motorModel: "sts3215",
      calibrationCategory: "teleoperators",
      calibrationProfile: "so100_leader",
      calibrationId: "arm",
      calibrationGroup: "all",
      calibrationRevision: TEST_CALIBRATION_INITIAL_REVISION,
      sourceJointNames: ["elbow_flex", "shoulder_pan"],
      targetJointNames: ["arm_elbow_flex", "arm_shoulder_pan"],
      targetJointDirections: [
        TEST_LEADER_TARGET_DIRECTION,
        TEST_LEADER_TARGET_DIRECTION,
      ],
      sourceNeutralPositionsByTargetJointName: {
        arm_elbow_flex: OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
        arm_shoulder_pan: OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
      },
    };
    const session: OperatorCalibrationFileEditSession = {
      sessionId: TEST_CALIBRATION_SESSION_ID,
      role: "leader",
      targetKey: target.identityKey,
      calibrationSource: {
        category: "teleoperators",
        profileId: "so100_leader",
        calibrationId: "arm",
        calibrationDir: "/calibrations/teleoperators/so100_leader",
        groupId: "all",
      },
      jointNames: ["shoulder_pan", "elbow_flex"],
      motorRows: [
        { jointName: "shoulder_pan", motorId: TEST_SHOULDER_MOTOR_ID },
        { jointName: "elbow_flex", motorId: TEST_ELBOW_MOTOR_ID },
      ],
      syncedMapping: {
        jointNames: ["shoulder_pan", "elbow_flex"],
        motorIds: [TEST_SHOULDER_MOTOR_ID, TEST_ELBOW_MOTOR_ID],
      },
      syncedZeroPositionsRad: {
        shoulder_pan: TEST_CALIBRATION_ZERO_OVERRIDES.shoulderPanRad,
        elbow_flex: TEST_CALIBRATION_ZERO_OVERRIDES.elbowFlexRad,
      },
      syncRevision: TEST_CALIBRATION_REVISION,
      lastSyncedMtimeNs: null,
      leaderPort: target.path,
      leaderMotorIds: target.motorIds,
      leaderMotorModel: target.motorModel,
      busy: false,
      message: null,
    };

    expect(
      applyCalibrationFileEditLeaderTelemetryOverride({
        targets: [target],
        session,
      }),
    ).toEqual([
      {
        ...target,
        motorIds: [TEST_SHOULDER_MOTOR_ID, TEST_ELBOW_MOTOR_ID],
        sourceJointNames: ["shoulder_pan", "elbow_flex"],
        targetJointNames: ["arm_shoulder_pan", "arm_elbow_flex"],
        targetJointDirections: [
          TEST_LEADER_TARGET_DIRECTION,
          TEST_LEADER_TARGET_DIRECTION,
        ],
        sourceNeutralPositionsByTargetJointName: {
          arm_shoulder_pan: TEST_CALIBRATION_ZERO_OVERRIDES.shoulderPanRad,
          arm_elbow_flex: TEST_CALIBRATION_ZERO_OVERRIDES.elbowFlexRad,
        },
        calibrationRevision: TEST_CALIBRATION_REVISION,
      },
    ]);
  });
});

describe("isOperatorTeleopEditableKeyboardTarget", () => {
  it("keeps global teleop shortcuts out of editable fields", () => {
    expect(isOperatorTeleopEditableKeyboardTarget(document.createElement("input"))).toBe(true);
    expect(isOperatorTeleopEditableKeyboardTarget(document.createElement("textarea"))).toBe(true);
    expect(isOperatorTeleopEditableKeyboardTarget(document.createElement("select"))).toBe(true);

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(isOperatorTeleopEditableKeyboardTarget(editable)).toBe(true);
    expect(isOperatorTeleopEditableKeyboardTarget(document.createElement("button"))).toBe(false);
    expect(isOperatorTeleopEditableKeyboardTarget(null)).toBe(false);
  });
});

describe("OperatorTeleopPanelShell", () => {
  it("bounds the popup and makes the panel body scrollable", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const fetchMock: typeof fetch = vi.fn(
      async () => new Response("not found", { status: 404 })
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanelShell, {
          studioRobotName: "atlas",
          onClose: vi.fn(),
        })
      );
      await flushMicrotasks();
    });

    const shell = container.firstElementChild as HTMLElement | null;
    expect(shell?.className).toContain("inset-x-2");
    expect(shell?.className).toContain("bottom-2");
    expect(shell?.className).toContain("max-h-[calc(100dvh-3.5rem)]");
    expect(shell?.className).toContain("sm:w-[min(calc(100vw-2rem),420px)]");
    expect(shell?.className).toContain("flex-col");
    expect(shell?.className).toContain("overflow-hidden");
    expect(shell?.children[0]?.children[0]?.className).toContain("min-w-0");
    expect(shell?.children[1]?.className).toContain("overflow-y-auto");
    expect(shell?.children[1]?.className).toContain("overflow-x-hidden");
    expect(shell?.children[1]?.className).toContain("overscroll-contain");
    expect(shell?.children[1]?.className).toContain("flex-1");

    await act(async () => {
      root.unmount();
    });
    expect(useOperatorLeaderTeleopStore.getState()).toMatchObject(
      OPERATOR_LEADER_TELEOP_UNAVAILABLE_STATUS,
    );
    container.remove();
  });

  it("hides the popup without unmounting the teleop panel", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const fetchMock: typeof fetch = vi.fn(
      async () => new Response("not found", { status: 404 })
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanelShell, {
          studioRobotName: "atlas",
          open: false,
          onClose: vi.fn(),
        })
      );
      await flushMicrotasks();
    });

    const shell = container.firstElementChild as HTMLElement | null;
    expect(shell?.className).toContain("hidden");
    expect(shell?.getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).toContain("Robot Hardware");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe("OperatorTeleopPanel persistence", () => {
  it("restores saved operator context and provider details when the gateway is unreachable after reload", async () => {
    const offlineReload = buildOfflineTeleopPanelReloadFixture();

    writeOperatorTeleopPanelState({
      baseUrl: offlineReload.gatewayBaseUrl,
      operatorId: offlineReload.operatorId,
      selectedProfileId: TEST_PROVIDER_PROFILE.id,
      selectedCameraStreamId: TEST_CAMERA_STREAM.id,
      providerManifestBaseUrl: offlineReload.gatewayBaseUrl,
      providerManifest: normalizeOperatorProviderManifest(TEST_PROVIDER_MANIFEST),
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response("not found", {
          status: offlineReload.unavailableStatus,
        }),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "camera",
          studioRobotName: "atlas",
        }),
      );
      await flushMicrotasks();
    });

    const endpointInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.value === offlineReload.gatewayBaseUrl,
    );
    const cameraSelect = container.querySelector("select") as HTMLSelectElement | null;
    expect(endpointInput).toBeTruthy();
    expect(cameraSelect?.value).toBe(TEST_CAMERA_STREAM.id);
    expect(container.textContent).toContain(TEST_CAMERA_STREAM.label);
    expect(container.textContent).not.toContain(
      "No camera stream advertised by this gateway.",
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

function buildOfflineTeleopPanelReloadFixture() {
  return {
    gatewayBaseUrl: "http://offline-gateway.local",
    operatorId: "field-operator",
    unavailableStatus: 404,
  } as const;
}

describe("OperatorTeleopPanel point-cloud scene meshes", () => {
  it("requests scene mesh creation from the live point-cloud action", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const fetchMock: typeof fetch = vi.fn(
      async () => new Response("not found", { status: 404 })
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    useOperatorPerceptionStore.getState().setActivePointCloudFrame({
      cameraId: TEST_CAMERA_STREAM.id,
      frameId: TEST_CAMERA_STREAM.frame_id,
      coordinateFrame: TEST_CAMERA_STREAM.coordinate_frame,
      sequence: TEST_CAMERA_FIXTURE.pointCloudSequence,
      sourceTsMs: TEST_CAMERA_FIXTURE.pointCloudSourceTsMs,
      intrinsics: TEST_CAMERA_STREAM.intrinsics,
      pointsXyz: [[...TEST_CAMERA_FIXTURE.point]],
      colorsRgb: [[...TEST_CAMERA_FIXTURE.color]],
    });

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "camera",
          studioRobotName: "atlas",
        })
      );
      await flushMicrotasks();
    });

    const createMeshesButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Auto-create scene meshes from cloud"
    );
    expect(createMeshesButton?.disabled).toBe(false);

    await act(async () => {
      createMeshesButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });

    expect(
      useOperatorPerceptionStore.getState().pointCloudSceneMeshRequest,
    ).toMatchObject({
      requestId: 1,
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe("operator teleop profiles", () => {
  it("resolves only provider-advertised profiles", () => {
    expect(getOperatorTeleopProfile([], "provider_base_twist")).toBeNull();
    expect(getOperatorTeleopProfile([TEST_PROVIDER_PROFILE], null)).toBeNull();
    expect(getOperatorTeleopProfile([TEST_PROVIDER_PROFILE], "provider_base_twist")).toBe(
      TEST_PROVIDER_PROFILE
    );
  });

  it("describes provider profile capabilities and topics", () => {
    expect(describeOperatorProfileCapabilities(TEST_PROVIDER_PROFILE)).toBe(
      "base twist, strafe, state mirror"
    );
    expect(describeOperatorProfileControlInputs(TEST_PROVIDER_PROFILE)).toBe(
      "Browser keyboard, Field joystick"
    );
    expect(describeOperatorProfileTopics(TEST_PROVIDER_PROFILE)).toBe(
      "provider:/control/twist, provider:/telemetry/robot_state, provider:/telemetry/joint_states"
    );
  });
});

describe("OperatorTeleopPanel input routing", () => {
  it("keeps leader scan state active when switching through the follower panel", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    useJointStore.getState().setAvailableJoints([
      "arm_shoulder_pan",
      "arm_shoulder_lift",
      "arm_elbow_flex",
      "arm_wrist_flex",
      "arm_wrist_roll",
      "arm_gripper",
    ]);
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop")) {
        return new Response(JSON.stringify(TEST_PROVIDER_MANIFEST), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "active",
            current_session_id: "operator-session-1",
            robot_id: "openarm",
            mode: "manual",
            runtime_mode: "observe",
            control_lease_owner: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: 5,
            estimated_end_to_end_latency_ms: 10,
            robot_state: {
              mode: "manual",
              connection_state: "active",
              estop: false,
              control_rtt_ms: 4,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/hardware/leaders")) {
        return new Response(
          JSON.stringify({
            leaders: [
              {
                id: "mini-right",
                path: "/dev/ttyACM0",
                device_path: "/dev/ttyACM0",
                identity_key: "path:ttyACM0",
                identity_stable: false,
                source: "tty_glob",
                available: true,
                leader_type: "serial_leader_candidate",
                motor_bus: "feetech",
                motor_ids: [1, 2, 3, 4, 5, 6],
                motor_count: 6,
                control_parts: [
                  {
                    id: "feetech:1-2-3-4-5-6",
                    kind: "arm",
                    label: "Arm",
                    actuator_count: 6,
                    motor_bus: "feetech",
                    motor_ids: [1, 2, 3, 4, 5, 6],
                    calibration_category: "teleoperators",
                    calibration_profile: "so100_leader",
                    calibration_id: "my_leader",
                    calibration_group: "all",
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "studio",
          studioRobotName: "openarm",
        }),
      );
      await flushMicrotasks();
    });

    await clickOpenArmLeaderScan(container);
    expect(container.textContent).toContain("Arm device");
    expect(container.textContent).toContain("/dev/ttyACM0");

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "hardware",
          studioRobotName: "openarm",
        }),
      );
      await flushMicrotasks();
    });
    expect(container.textContent).toContain("Robot");
    expect(container.textContent).toContain("Detected targets");

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "studio",
          studioRobotName: "openarm",
        }),
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(container.textContent).not.toContain(
      "Click Scan to detect leader targets.",
    );
    expect(container.textContent).toContain("Arm device");
    expect(container.textContent).toContain("/dev/ttyACM0");
    expect(
      vi
        .mocked(fetchMock)
        .mock.calls.filter((call) => String(call[0]).endsWith("/hardware/leaders")),
    ).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("collapses detected OpenArm follower SocketCAN ports into one bimanual robot setup", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const leftPort = "can0";
    const rightPort = "can1";
    let configured = false;
    let savedEnvContent = "";
    const manifest = () => ({
      contract_version: "urdf-studio.teleop.v1",
      provider_id: "test-provider",
      provider_display_name: "Test Provider",
      capabilities: {
        observe: true,
        telemetry: true,
        video: false,
        record: false,
        control: true,
        estop: true,
      },
      profiles: configured
        ? [
            {
              id: "bi_openarm_follower_joint_jog",
              label: "Bi OpenArm follower joint jog",
              control_target_label: "Bi OpenArm follower robot gateway",
              transport: "robot_gateway",
              robot_family: "manipulator",
              robot_id: "openarm",
              adapter_id: "lerobot",
              teleoperation_mode: "real_hardware",
              hardware_device_key: `${leftPort} | ${rightPort}`,
              hardware_device_keys: [leftPort, rightPort],
              controlled_joint_names: ["left_joint_1", "right_joint_1"],
              control_inputs: [],
              capabilities: {
                arm_joint_state: true,
                arm_joint_command: true,
                state_mirroring: true,
                joint_jog: true,
                gripper: true,
              },
              topics: {
                joint_states: ["provider:/telemetry/state"],
                joint_jog: "provider:/control/joint-jog",
                robot_state: "provider:/telemetry/state",
              },
            },
          ]
        : [],
      camera_streams: [TEST_CAMERA_STREAM],
    });
    const openArmPart = (side: "left" | "right") => ({
      id: `damiao:openarm_follower:my_follower_${side}:all:1-2-3-4-5-6-7-8`,
      kind: "arm",
      label: `openarm_follower · my_follower_${side} · all`,
      actuator_count: 8,
      motor_bus: "damiao",
      motor_ids: [1, 2, 3, 4, 5, 6, 7, 8],
      calibration_category: "robots",
      calibration_profile: "openarm_follower",
      calibration_id: `my_follower_${side}`,
      calibration_group: "all",
      configured_port_status: "none",
    });
    const fetchMock: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop") || url.endsWith("/manifest")) {
        return new Response(JSON.stringify(manifest()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "active",
            current_session_id: "operator-session-1",
            robot_id: "openarm",
            mode: "manual",
            runtime_mode: configured ? "control" : "observe",
            control_lease_owner: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: 5,
            estimated_end_to_end_latency_ms: 10,
            robot_state: {
              mode: "manual",
              connection_state: "active",
              estop: false,
              control_rtt_ms: 4,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/hardware/leaders")) {
        return new Response(
          JSON.stringify({
            leaders: [leftPort, rightPort].map((port) => ({
              id: port,
              path: port,
              device_path: port,
              identity_key: `serial-by-id:${port}`,
              identity_stable: true,
              source: "serial_by_id",
              available: true,
              leader_type: "serial_leader_candidate",
              hardware_family: "arm_controller",
              motor_bus: "damiao",
              motor_ids: [1, 2, 3, 4, 5, 6, 7, 8],
              motor_count: 8,
              control_parts: [
                openArmPart("left"),
                openArmPart("right"),
              ],
            })),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith(OPERATOR_HELPER_ENV_CONFIG_PATH)) {
        if (init?.method === "PUT") {
          savedEnvContent = JSON.parse(String(init.body)).content;
          configured = true;
          return new Response(
            JSON.stringify({
              path: "/workspace/.env.robot.local",
              content: savedEnvContent,
              exists: true,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            path: "/workspace/.env.robot.local",
            content:
              "URDF_SIMULATOR_API_TOKEN=keep\nURDF_ROBOT_GATEWAY_LEROBOT_PORT=/old\n",
            exists: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "hardware",
          studioRobotName: "openarm",
        }),
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(container.textContent).toContain("1 detected");
    expect(container.textContent).toContain("bi_openarm_follower · my_follower");
    expect(container.textContent).toContain(`Left: ${leftPort}`);
    expect(container.textContent).toContain(`Right: ${rightPort}`);
    expect(container.textContent).not.toContain("4 detected");
    const targetSelect = container.querySelector(
      'select[aria-label="Robot target"]',
    ) as HTMLSelectElement | null;
    expect(
      Array.from(targetSelect?.options ?? []).map((option) => option.textContent),
    ).toEqual(["bi_openarm_follower · my_follower"]);

    const useButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Use target",
    );
    expect(useButton).toBeTruthy();
    await act(async () => {
      useButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(savedEnvContent).toContain("URDF_SIMULATOR_API_TOKEN=keep");
    expect(savedEnvContent).not.toContain("URDF_ROBOT_GATEWAY_LEROBOT_PORT=/old");
    expect(savedEnvContent).toContain(
      "URDF_ROBOT_GATEWAY_LEROBOT_ROBOT_TYPE=bi_openarm_follower",
    );
    expect(savedEnvContent).toContain("URDF_ROBOT_GATEWAY_LEROBOT_ID=my_follower");
    expect(savedEnvContent).toContain(`"port":"${leftPort}"`);
    expect(savedEnvContent).toContain(`"port":"${rightPort}"`);
    expect(savedEnvContent).toContain('"can_interface":"socketcan"');
    expect(savedEnvContent).toContain('"use_can_fd":true');
    expect(container.textContent).toContain("Bi OpenArm arm");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("does not save serial OpenArm follower detections as LeRobot robot setup", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const leftPort = "/dev/serial/by-id/openarm-left";
    const rightPort = "/dev/serial/by-id/openarm-right";
    let savedEnvContent = "";
    const serialOpenArmPart = (side: "left" | "right") => ({
      id: `damiao:openarm_follower:my_follower_${side}:all:1-2-3-4-5-6-7-8`,
      kind: "arm",
      label: `openarm_follower · my_follower_${side} · all`,
      actuator_count: 8,
      motor_bus: "damiao",
      motor_ids: [1, 2, 3, 4, 5, 6, 7, 8],
      calibration_category: "robots",
      calibration_profile: "openarm_follower",
      calibration_id: `my_follower_${side}`,
      calibration_group: "all",
      configured_port_status: "none",
    });
    const fetchMock: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop") || url.endsWith("/manifest")) {
        return new Response(
          JSON.stringify({
            contract_version: "urdf-studio.teleop.v1",
            provider_id: "test-provider",
            provider_display_name: "Test Provider",
            capabilities: {
              observe: true,
              telemetry: true,
              video: false,
              record: false,
              control: true,
              estop: true,
            },
            profiles: [],
            camera_streams: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "active",
            current_session_id: "operator-session-1",
            robot_id: "openarm",
            mode: "manual",
            runtime_mode: "observe",
            control_lease_owner: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: 5,
            estimated_end_to_end_latency_ms: 10,
            robot_state: {
              mode: "manual",
              connection_state: "idle",
              estop: false,
              control_rtt_ms: 4,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/hardware/leaders")) {
        return new Response(
          JSON.stringify({
            leaders: [leftPort, rightPort].map((port) => ({
              id: port,
              path: port,
              device_path: port,
              identity_key: `serial-by-id:${port}`,
              identity_stable: true,
              source: "serial_by_id",
              available: true,
              leader_type: "serial_leader_candidate",
              hardware_family: "arm_controller",
              motor_bus: "damiao",
              motor_ids: [1, 2, 3, 4, 5, 6, 7, 8],
              motor_count: 8,
              control_parts: [
                serialOpenArmPart("left"),
                serialOpenArmPart("right"),
              ],
            })),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith(OPERATOR_HELPER_ENV_CONFIG_PATH)) {
        if (init?.method === "PUT") {
          savedEnvContent = JSON.parse(String(init.body)).content;
        }
        return new Response(
          JSON.stringify({
            path: "/workspace/.env.robot.local",
            content: "URDF_SIMULATOR_API_TOKEN=keep\n",
            exists: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "hardware",
          studioRobotName: "openarm",
        }),
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(container.textContent).toContain("2 detected");
    expect(container.textContent).toContain("Uncalibrated motor chain");
    expect(container.textContent).not.toContain("bi_openarm_follower · my_follower");
    expect(container.textContent).not.toContain("Use target");
    expect(savedEnvContent).toBe("");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("shows target-aware leader-arm routing without dataset controls", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const leaderWristRollPositionRad = 0;
    const calibrationJointNames = [
      "shoulder_pan",
      "shoulder_lift",
      "elbow_flex",
      "wrist_flex",
      "wrist_roll",
      "gripper",
    ];
    useJointStore.getState().setAvailableJoints([
      "arm_shoulder_pan",
      "arm_shoulder_lift",
      "arm_elbow_flex",
      "arm_wrist_flex",
      "arm_wrist_roll",
      "arm_gripper",
    ]);
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop")) {
        return new Response(JSON.stringify(TEST_PROVIDER_MANIFEST), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "active",
            current_session_id: "operator-session-1",
            robot_id: "openarm",
            mode: "manual",
            runtime_mode: "observe",
            control_lease_owner: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: 5,
            estimated_end_to_end_latency_ms: 10,
            robot_state: {
              mode: "manual",
              connection_state: "active",
              estop: false,
              control_rtt_ms: 4,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/hardware/leaders")) {
        return new Response(
          JSON.stringify({
            available: true,
            leaders: [
              {
                id: "mini-right",
                path: "/dev/ttyACM0",
                device_path: "/dev/ttyACM0",
                identity_key: "path:ttyACM0",
                identity_stable: false,
                source: "tty_glob",
                available: true,
                leader_type: "serial_leader_candidate",
                motor_bus: "feetech",
                motor_ids: [1, 2, 3, 4, 5, 6],
                motor_count: 6,
                control_parts: [
                  {
                    id: "feetech:1-2-3-4-5-6",
                    kind: "arm",
                    label: "Arm",
                    actuator_count: 6,
                    motor_bus: "feetech",
                    motor_ids: [1, 2, 3, 4, 5, 6],
                    joint_names: calibrationJointNames,
                    calibration_category: "teleoperators",
                    calibration_profile: "so100_leader",
                    calibration_id: "my_leader",
                    calibration_group: "all",
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith(OPERATOR_HELPER_LEROBOT_CALIBRATIONS_PATH)) {
        return new Response(
          JSON.stringify({
            entries: [
              {
                id: "teleoperators:so100_leader:my_leader:all",
                category: "teleoperators",
                profile_id: "so100_leader",
                calibration_id: "my_leader",
                calibration_dir: "/calibrations/teleoperators/so100_leader",
                group_id: "all",
                path: "/calibrations/teleoperators/so100_leader/my_leader.json",
                joint_names: calibrationJointNames,
                motor_ids: [1, 2, 3, 4, 5, 6],
                actuator_count: 6,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith(OPERATOR_HELPER_LEROBOT_CALIBRATION_OPEN_PATH)) {
        return new Response(
          JSON.stringify({
            path: "/calibrations/teleoperators/so100_leader/my_leader.json",
            exists: true,
            opened: true,
            message: "Opened LeRobot calibration file.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith(OPERATOR_HELPER_LEROBOT_CALIBRATION_SYNC_PATH)) {
        return new Response(
          JSON.stringify({
            path: "/calibrations/teleoperators/so100_leader/my_leader.json",
            exists: true,
            mtime_ns: 10,
            changed: false,
            applied: false,
            message: "",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith(OPERATOR_HELPER_LEADER_PATHS.calibrationStart)) {
        return new Response(
          JSON.stringify({
            started: true,
            command: ["lerobot-calibrate", "--teleop.type=so100_leader"],
            display_command: "lerobot-calibrate --teleop.type=so100_leader",
            message: "Opened LeRobot calibration in a terminal.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/hardware/leader-state")) {
        return new Response(
          JSON.stringify({
            connected: true,
            port: "/dev/ttyACM0",
            side: "both",
            source_ts_ms: Date.now(),
            joints: {
              shoulder_pan: {
                position_rad: 0,
                motor_id: 1,
              },
              shoulder_lift: { position_rad: 0, motor_id: 2 },
              elbow_flex: { position_rad: 0, motor_id: 3 },
              wrist_flex: { position_rad: 0, motor_id: 4 },
              wrist_roll: {
                position_rad: leaderWristRollPositionRad,
                motor_id: 5,
              },
              gripper: { position_rad: 0, motor_id: 6 },
              openarm_left_joint1: {
                position_rad: TEST_OPENARM_LEADER_TELEMETRY.positionRad,
              },
            },
            error: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "studio",
          studioRobotName: "openarm",
        }),
      );
      await flushMicrotasks();
    });
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(container.textContent).toContain("Click Scan to detect leader targets.");
    expect(
      vi
        .mocked(fetchMock)
        .mock.calls.some((call) =>
          String(call[0]).includes("/hardware/leaders"),
        ),
    ).toBe(false);
    expect(
      vi
        .mocked(fetchMock)
        .mock.calls.some((call) =>
          String(call[0]).includes("/hardware/leader-state"),
        ),
    ).toBe(false);

    await clickOpenArmLeaderScan(container);

    expect(container.textContent).toContain("Detected targets");
    expect(container.textContent).not.toContain("Arm teleop targets");
    expect(container.textContent).not.toContain("Wheels and legs");
    expect(container.textContent).not.toContain("Gripper is controlled");
    expect(container.textContent).not.toContain("Pick a target.");
    expect(container.textContent).toContain("Arm device");
    expect(container.textContent).toContain(
      "LeRobot teleoperator calibration: so100_leader · my_leader · all",
    );
    expect(container.textContent).toContain("6 actuators");
    expect(container.textContent).toContain("/dev/ttyACM0");
    expect(useOperatorLeaderTeleopStore.getState()).toMatchObject({
      available: false,
      connected: false,
      reason: "Configure leader input before using Leader Teleop.",
    });
    expect(
      useOperatorPerceptionStore.getState().activeJointTelemetryByName
        .openarm_left_joint1,
    ).toBeUndefined();
    expect(
      vi
        .mocked(fetchMock)
        .mock.calls.some((call) =>
          String(call[0]).includes("/hardware/leaders"),
        ),
    ).toBe(true);
    expect(
      vi
        .mocked(fetchMock)
        .mock.calls.some((call) =>
          String(call[0]).endsWith("/hardware/leaders/release"),
        ),
    ).toBe(false);
    expect(
      vi
        .mocked(fetchMock)
        .mock.calls.some((call) =>
          String(call[0]).includes("/hardware/leader-state"),
        ),
    ).toBe(false);

    const targetSelect = container.querySelector(
      'select[aria-label="Target"]',
    ) as HTMLSelectElement | null;
    const connectLeaderButtonBeforeSelect = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Connect");
    expect(targetSelect?.value).toBe("arm.primary");
    expect(targetSelect?.disabled).toBe(false);
    expect(connectLeaderButtonBeforeSelect?.disabled).toBe(false);
    const calibrateLeaderButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Calibrate");
    expect(calibrateLeaderButton?.disabled).toBe(false);
    const fixOrderButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Fix order",
    );
    expect(fixOrderButton?.disabled).toBe(false);
    await act(async () => {
      fixOrderButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(container.textContent).toContain("Opened LeRobot calibration file.");
    expect(container.textContent).not.toContain("Capture");
    expect(container.textContent).toContain("OK");
    expect(container.textContent).toContain("ID");
    expect(container.textContent).toContain("Angle");
    expect(container.textContent).toContain("Name");
    expect(container.textContent).toContain("URDF joint");
    expect(container.textContent).not.toContain("move");
    expect(container.textContent).not.toContain("vel");
    expect(container.textContent).toContain("elbow_flex");
    expect(container.textContent).toContain("arm_elbow_flex");
    expect(container.textContent).not.toContain("...");
    expect(container.textContent).toContain("0.000");
    expect(
      container.querySelector('input[aria-label^="Motor ID for"]'),
    ).toBeNull();
    expect(
      container.querySelector('[aria-label="Motor ID for wrist_roll"]')?.textContent,
    ).toBe("5");
    expect(
      container.querySelector('[aria-label="Motor ID for elbow_flex"]')?.textContent,
    ).toBe("3");
    const elbowFlexOkButton = container.querySelector(
      'button[aria-label="Mark elbow_flex as OK"]',
    );
    expect(elbowFlexOkButton?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      elbowFlexOkButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(elbowFlexOkButton?.getAttribute("aria-pressed")).toBe("true");
    const autoConnectedDisconnectButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Disconnect");
    expect(autoConnectedDisconnectButton?.disabled).toBe(false);
    const openCalibrationFileButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Open file");
    expect(openCalibrationFileButton?.disabled).toBe(false);
    const openCalibrationCall = vi
      .mocked(fetchMock)
      .mock.calls.find((call) =>
        String(call[0]).endsWith(OPERATOR_HELPER_LEROBOT_CALIBRATION_OPEN_PATH),
      );
    expect(JSON.parse(String(openCalibrationCall?.[1]?.body))).toEqual({
      calibration_source: {
        category: "teleoperators",
        profile_id: "so100_leader",
        calibration_id: "my_leader",
        calibration_dir: "/calibrations/teleoperators/so100_leader",
        group_id: "all",
      },
    });
    const closeFixOrderButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Close",
    );
    await act(async () => {
      closeFixOrderButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });
    const disconnectAfterFixOrderCloseButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Disconnect");
    await act(async () => {
      disconnectAfterFixOrderCloseButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });
    const calibrateLeaderButtonAfterDisconnect = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Calibrate");
    await act(async () => {
      calibrateLeaderButtonAfterDisconnect?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(container.textContent).toContain(
      "LeRobot calibration opened. Use its prompt, then rescan.",
    );
    expect(container.textContent).toContain(
      "lerobot-calibrate --teleop.type=so100_leader",
    );
    const leaderCalibrationCall = vi
      .mocked(fetchMock)
      .mock.calls.find((call) =>
        String(call[0]).endsWith(OPERATOR_HELPER_LEADER_PATHS.calibrationStart),
      );
    expect(JSON.parse(String(leaderCalibrationCall?.[1]?.body))).toEqual({
      port: "/dev/ttyACM0",
      motor_ids: [1, 2, 3, 4, 5, 6],
      calibration_category: "teleoperators",
      calibration_profile: "so100_leader",
      calibration_id: "my_leader",
      calibration_group: "all",
    });
    const initialViewerModeRequestId =
      useOperatorLeaderTeleopStore.getState().viewerModeRequestId;
    expect(useOperatorLeaderTeleopStore.getState()).toMatchObject({
      available: false,
      connected: false,
      reason: "Configure leader input before using Leader Teleop.",
    });

    const connectLeaderButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Connect",
    );
    expect(connectLeaderButton?.disabled).toBe(false);
    await act(async () => {
      connectLeaderButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(useOperatorLeaderTeleopStore.getState()).toMatchObject({
      available: true,
      connected: true,
      reason: "Input connected. Robot motion is off until follower hardware is ready.",
    });
    expect(
      vi
        .mocked(fetchMock)
        .mock.calls.some((call) => String(call[0]).endsWith("/lease/request")),
    ).toBe(false);
    expect(useOperatorLeaderTeleopStore.getState().viewerModeRequestId).toBe(
      initialViewerModeRequestId + 1,
    );
    const connectedFixOrderButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Fix order");
    expect(connectedFixOrderButton?.disabled).toBe(false);
    await act(async () => {
      connectedFixOrderButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(useOperatorLeaderTeleopStore.getState()).toMatchObject({
      available: true,
      connected: true,
      reason: "Input connected. Robot motion is off until follower hardware is ready.",
    });
    const initialViewerModeExitRequestId =
      useOperatorLeaderTeleopStore.getState().viewerModeExitRequestId;

    const disconnectLeaderButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Disconnect");
    expect(disconnectLeaderButton?.disabled).toBe(false);
    await act(async () => {
      disconnectLeaderButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(useOperatorLeaderTeleopStore.getState()).toMatchObject({
      available: false,
      connected: false,
      reason: "Configure leader input before using Leader Teleop.",
    });
    expect(useOperatorLeaderTeleopStore.getState().viewerModeExitRequestId).toBe(
      initialViewerModeExitRequestId + 1,
    );

    expect(container.textContent).not.toContain("Input route");
    expect(container.textContent).not.toContain("Gateway leader input");
    expect(container.textContent).not.toContain("Control target");
    expect(container.textContent).not.toContain("Studio UI");
    expect(container.textContent).not.toContain("Real robot");
    expect(container.textContent).not.toContain("Simulated gateway");
    expect(container.textContent).not.toContain("Operator input");
    expect(container.textContent).not.toContain("Dataset recording");
    expect(container.textContent).not.toContain("Start recording");
    expect(container.textContent).not.toContain("Validate replay");
    expect(container.textContent).not.toContain("MJLab gate");
    expect(container.textContent).not.toContain("Export LeRobot");
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("uses the selected LeRobot calibration source for leader calibration", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const calibrationJointNames = [
      "shoulder_pan",
      "shoulder_lift",
      "elbow_flex",
      "wrist_flex",
      "wrist_roll",
      "gripper",
    ];
    useJointStore.getState().setAvailableJoints([
      "arm_shoulder_pan",
      "arm_shoulder_lift",
      "arm_elbow_flex",
      "arm_wrist_flex",
      "arm_wrist_roll",
      "arm_gripper",
    ]);
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop")) {
        return new Response(JSON.stringify(TEST_PROVIDER_MANIFEST), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "active",
            current_session_id: "operator-session-1",
            robot_id: "openarm",
            mode: "manual",
            runtime_mode: "observe",
            control_lease_owner: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: 5,
            estimated_end_to_end_latency_ms: 10,
            robot_state: {
              mode: "manual",
              connection_state: "active",
              estop: false,
              control_rtt_ms: 4,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/hardware/leaders")) {
        return new Response(
          JSON.stringify({
            available: true,
            leaders: [
              {
                id: "leader",
                path: "/dev/ttyACM0",
                device_path: "/dev/ttyACM0",
                identity_key: "path:ttyACM0",
                identity_stable: false,
                source: "tty_glob",
                available: true,
                leader_type: "serial_leader_candidate",
                motor_bus: "feetech",
                motor_ids: [1, 2, 3, 4, 5, 6],
                motor_count: 6,
                control_parts: [
                  {
                    id: "teleoperators:so100_leader:my_leader:all",
                    kind: "arm",
                    label: "Leader arm",
                    actuator_count: 6,
                    motor_bus: "feetech",
                    motor_ids: [1, 2, 3, 4, 5, 6],
                    joint_names: calibrationJointNames,
                    calibration_category: "teleoperators",
                    calibration_profile: "so100_leader",
                    calibration_id: "my_leader",
                    calibration_group: "all",
                  },
                  {
                    id: "robots:so100_follower:my_follower:all",
                    kind: "arm",
                    label: "Follower arm",
                    actuator_count: 6,
                    motor_bus: "feetech",
                    motor_ids: [1, 2, 3, 4, 5, 6],
                    joint_names: calibrationJointNames,
                    calibration_category: "robots",
                    calibration_profile: "so100_follower",
                    calibration_id: "my_follower",
                    calibration_group: "all",
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith(OPERATOR_HELPER_LEADER_PATHS.calibrationStart)) {
        return new Response(
          JSON.stringify({
            started: true,
            command: ["lerobot-calibrate", "--robot.type=so100_follower"],
            display_command: "lerobot-calibrate --robot.type=so100_follower",
            message: "Opened LeRobot calibration in a terminal.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "studio",
          studioRobotName: "openarm",
        }),
      );
      await flushMicrotasks();
    });
    await clickOpenArmLeaderScan(container);

    const calibrationSelect = container.querySelector(
      'select[aria-label="Calibration"]',
    ) as HTMLSelectElement | null;
    expect(calibrationSelect?.disabled).toBe(false);
    expect(
      Array.from(calibrationSelect?.options ?? []).map((option) => option.text),
    ).toEqual([
      "teleoperator: so100_leader · my_leader · all",
      "robot/follower: so100_follower · my_follower · all",
    ]);

    await act(async () => {
      if (calibrationSelect) {
        calibrationSelect.value = "robots:so100_follower:my_follower:all";
        calibrationSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await flushMicrotasks();
    });
    const calibrateLeaderButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Calibrate");
    await act(async () => {
      calibrateLeaderButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    const leaderCalibrationCall = vi
      .mocked(fetchMock)
      .mock.calls.find((call) =>
        String(call[0]).endsWith(OPERATOR_HELPER_LEADER_PATHS.calibrationStart),
      );
    expect(JSON.parse(String(leaderCalibrationCall?.[1]?.body))).toEqual({
      port: "/dev/ttyACM0",
      motor_ids: [1, 2, 3, 4, 5, 6],
      calibration_category: "robots",
      calibration_profile: "so100_follower",
      calibration_id: "my_follower",
      calibration_group: "all",
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("blocks an uncalibrated LeKiwi arm leader before target mapping", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    useJointStore.getState().setAvailableJoints([
      "arm_shoulder_pan",
      "arm_shoulder_lift",
      "arm_elbow_flex",
      "arm_forearm_roll",
      "arm_wrist_flex",
      "arm_wrist_roll",
      "arm_auxiliary_1",
      "arm_auxiliary_2",
      "arm_auxiliary_3",
      "arm_auxiliary_4",
      "arm_auxiliary_5",
      "arm_gripper",
    ]);
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop")) {
        return new Response(JSON.stringify(TEST_PROVIDER_MANIFEST), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "active",
            current_session_id: "operator-session-1",
            robot_id: "lekiwi",
            mode: "manual",
            runtime_mode: "observe",
            control_lease_owner: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: 5,
            estimated_end_to_end_latency_ms: 10,
            robot_state: {
              mode: "manual",
              connection_state: "active",
              estop: false,
              control_rtt_ms: 4,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/hardware/leaders")) {
        return new Response(
          JSON.stringify({
            leaders: [
              {
                id: "so100-leader",
                path: "/dev/serial/by-id/usb-1a86_USB_Single_Serial_58FA095368-if00",
                device_path: "/dev/ttyACM0",
                identity_key: "serial-by-id:1a86_USB_Single_Serial_58FA095368",
                identity_stable: true,
                serial: "58FA095368",
                source: "serial_by_id",
                available: true,
                leader_type: "serial_leader_candidate",
                hardware_family: "arm_controller",
                motor_bus: "feetech",
                motor_ids: [1, 2, 3, 4, 5],
                motor_count: 5,
                control_parts: [
                  {
                    id: "feetech:1-2-3-4-5",
                    kind: "arm",
                    label: "Arm",
                    actuator_count: 5,
                    motor_bus: "feetech",
                    motor_ids: [1, 2, 3, 4, 5],
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "studio",
          studioRobotName: "lekiwi",
        }),
      );
      await flushMicrotasks();
    });
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });

    await clickOpenArmLeaderScan(container);

    expect(container.textContent).toContain("Arm device");
    expect(container.textContent).toContain("Calibration required");
    expect(container.textContent).toContain("5 actuators");
    expect(container.textContent).toContain("Calibration required");
    const targetSelect = container.querySelector(
      'select[aria-label="Target"]',
    ) as HTMLSelectElement | null;
    expect(targetSelect?.disabled).toBe(true);

    const connectLeaderButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Connect",
    );
    expect(connectLeaderButton?.disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("allows a calibrated smaller arm leader to drive the first target arm axes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    useJointStore.getState().setAvailableJoints([
      "arm_shoulder_pan",
      "arm_shoulder_lift",
      "arm_elbow_flex",
      "arm_forearm_roll",
      "arm_wrist_flex",
      "arm_wrist_roll",
      "arm_auxiliary_1",
      "arm_auxiliary_2",
      "arm_auxiliary_3",
      "arm_auxiliary_4",
      "arm_auxiliary_5",
      "arm_gripper",
    ]);
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop")) {
        return new Response(JSON.stringify(TEST_PROVIDER_MANIFEST), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "active",
            current_session_id: "operator-session-1",
            robot_id: "lekiwi",
            mode: "manual",
            runtime_mode: "observe",
            control_lease_owner: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: 5,
            estimated_end_to_end_latency_ms: 10,
            robot_state: {
              mode: "manual",
              connection_state: "active",
              estop: false,
              control_rtt_ms: 4,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/hardware/leaders")) {
        return new Response(
          JSON.stringify({
            leaders: [
              {
                id: "so100-leader",
                path: "/dev/serial/by-id/usb-1a86_USB_Single_Serial_58FA095368-if00",
                device_path: "/dev/ttyACM0",
                identity_key: "serial-by-id:1a86_USB_Single_Serial_58FA095368",
                identity_stable: true,
                serial: "58FA095368",
                source: "serial_by_id",
                available: true,
                leader_type: "serial_leader_candidate",
                hardware_family: "arm_controller",
                motor_bus: "feetech",
                motor_ids: [1, 2, 3, 4, 5],
                motor_count: 5,
                control_parts: [
                  {
                    id: "feetech:1-2-3-4-5",
                    kind: "arm",
                    label: "Arm",
                    actuator_count: 5,
                    motor_bus: "feetech",
                    motor_ids: [1, 2, 3, 4, 5],
                    calibration_category: "teleoperators",
                    calibration_profile: "so100_leader",
                    calibration_id: "my_leader",
                    calibration_group: "all",
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/hardware/leader-state")) {
        return new Response(
          JSON.stringify({
            connected: true,
            port: "/dev/ttyACM0",
            side: "both",
            source_ts_ms: Date.now(),
            joints: {
              joint_1: {
                position_rad: TEST_OPENARM_LEADER_TELEMETRY.positionRad,
              },
            },
            error: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "studio",
          studioRobotName: "lekiwi",
        }),
      );
      await flushMicrotasks();
    });
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });

    await clickOpenArmLeaderScan(container);

    expect(container.textContent).toContain("Arm device");
    expect(container.textContent).toContain(
      "LeRobot teleoperator calibration: so100_leader · my_leader · all",
    );
    expect(container.textContent).toContain("5 actuators");
    expect(container.textContent).toContain(
      "5 of 12 Arm axes will move.",
    );
    expect(
      vi
        .mocked(fetchMock)
        .mock.calls.filter((call) =>
          String(call[0]).endsWith("/hardware/leaders/release"),
        ),
    ).toHaveLength(0);

    const targetSelect = container.querySelector(
      'select[aria-label="Target"]',
    ) as HTMLSelectElement | null;
    expect(targetSelect?.value).toBe("arm.primary");
    expect(targetSelect?.disabled).toBe(false);

    const connectLeaderButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Connect",
    );
    expect(connectLeaderButton?.disabled).toBe(false);
    await act(async () => {
      connectLeaderButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(useOperatorLeaderTeleopStore.getState()).toMatchObject({
      available: true,
      connected: true,
    });
    const leaderReleaseCountAfterConnect = vi
      .mocked(fetchMock)
      .mock.calls.filter((call) =>
        String(call[0]).endsWith("/hardware/leaders/release"),
      ).length;

    await clickOpenArmLeaderScan(container);

    expect(useOperatorLeaderTeleopStore.getState()).toMatchObject({
      available: true,
      connected: true,
    });
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "Disconnect",
      ),
    ).toBe(true);
    expect(
      vi
        .mocked(fetchMock)
        .mock.calls.filter((call) =>
          String(call[0]).endsWith("/hardware/leaders/release"),
        ),
    ).toHaveLength(leaderReleaseCountAfterConnect);
    const viewerExitRequestIdBeforeClose =
      useOperatorLeaderTeleopStore.getState().viewerModeExitRequestId;

    await act(async () => {
      root.unmount();
    });
    expect(
      vi
        .mocked(fetchMock)
        .mock.calls.filter((call) =>
          String(call[0]).endsWith("/hardware/leaders/release"),
        ),
    ).toHaveLength(leaderReleaseCountAfterConnect + 1);
    expect(useOperatorLeaderTeleopStore.getState()).toMatchObject({
      available: false,
      connected: false,
      localLeaderAssigned: false,
      studioIkAffectsFollowerHardware: false,
      viewerModeExitRequestId: viewerExitRequestIdBeforeClose + 1,
    });
    container.remove();
  });

  it("does not block leader connection from stale follower role storage", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const serialPort =
      "/dev/serial/by-id/usb-1a86_USB_Single_Serial_58FA095368-if00";
    useJointStore.getState().setAvailableJoints([
      "arm_shoulder_pan",
      "arm_shoulder_lift",
      "arm_elbow_flex",
      "arm_forearm_roll",
      "arm_wrist_flex",
      "arm_wrist_roll",
    ]);
    window.localStorage.setItem(
      OPERATOR_DEVICE_ROLE_ASSIGNMENTS_STORAGE_KEY,
      JSON.stringify({ [serialPort]: "follower" }),
    );
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop")) {
        return new Response(JSON.stringify(TEST_PROVIDER_MANIFEST), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "active",
            current_session_id: "operator-session-1",
            robot_id: "lekiwi",
            mode: "manual",
            runtime_mode: "observe",
            control_lease_owner: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: TEST_PROVIDER_MAX_LINEAR_SPEED_MPS,
            estimated_end_to_end_latency_ms: TEST_PROVIDER_MAX_LINEAR_SPEED_MPS,
            robot_state: {
              mode: "manual",
              connection_state: "active",
              estop: false,
              control_rtt_ms: TEST_PROVIDER_MAX_LINEAR_SPEED_MPS,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/hardware/leaders")) {
        return new Response(
          JSON.stringify({
            leaders: [
              {
                id: "so100-leader",
                path: serialPort,
                device_path: "/dev/ttyACM0",
                identity_key: "serial-by-id:1a86_USB_Single_Serial_58FA095368",
                identity_stable: true,
                serial: "58FA095368",
                source: "serial_by_id",
                available: true,
                leader_type: "serial_leader_candidate",
                hardware_family: "arm_controller",
                motor_bus: "feetech",
                motor_ids: [1, 2, 3, 4, 5, 6],
                motor_count: 6,
                control_parts: [
                  {
                    id: "feetech:1-2-3-4-5-6",
                    kind: "arm",
                    label: "Arm",
                    actuator_count: 6,
                    motor_bus: "feetech",
                    motor_ids: [1, 2, 3, 4, 5, 6],
                    calibration_category: "teleoperators",
                    calibration_profile: "so100_leader",
                    calibration_id: "my_leader",
                    calibration_group: "all",
                    configured_port: serialPort,
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "studio",
          studioRobotName: "lekiwi",
        }),
      );
      await flushMicrotasks();
    });
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });

    await clickOpenArmLeaderScan(container);

    const conflict =
      "Disconnect this device as follower before selecting it as leader.";
    expect(container.textContent).not.toContain(conflict);
    const connectLeaderButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Connect",
    );
    expect(connectLeaderButton?.disabled).toBe(false);
    expect(connectLeaderButton?.title).toBe("");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("does not block controller connection while a LeRobot follower is selected", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const serialPort =
      "/dev/serial/by-id/usb-1a86_USB_Single_Serial_58FA095368-if00";
    useJointStore.getState().setAvailableJoints([
      "arm_shoulder_pan",
      "arm_shoulder_lift",
      "arm_elbow_flex",
      "arm_forearm_roll",
      "arm_wrist_flex",
      "arm_wrist_roll",
    ]);
    window.localStorage.setItem(
      OPERATOR_DEVICE_ROLE_ASSIGNMENTS_STORAGE_KEY,
      JSON.stringify({ [serialPort]: "follower" }),
    );
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop")) {
        return new Response(
          JSON.stringify({
            contract_version: "urdf-studio.teleop.v1",
            provider_id: "urdf-studio.robot-gateway",
            provider_display_name: "URDF Studio Robot Gateway",
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
                id: "so100_follower_joint_jog",
                label: "SO100 follower joint jog",
                summary: "LeRobot follower target.",
                control_target_label: "Arm",
                transport: "robot_gateway",
                capabilities: {
                  arm_joint_state: true,
                  arm_joint_command: true,
                  state_mirroring: true,
                  joint_jog: true,
                },
                robot_family: "manipulator",
                robot_id: "so100",
                adapter_id: "lerobot",
                teleoperation_mode: "real_hardware",
                hardware_device_key: serialPort,
                controlled_joint_names: ["arm_shoulder_pan"],
                topics: {
                  joint_states: ["provider:/telemetry/state"],
                  joint_jog: "provider:/control/joint-jog",
                },
              },
            ],
            camera_streams: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "active",
            current_session_id: "operator-session-1",
            robot_id: "so100",
            mode: "manual",
            runtime_mode: "observe",
            control_lease_owner: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: TEST_PROVIDER_MAX_LINEAR_SPEED_MPS,
            estimated_end_to_end_latency_ms: TEST_PROVIDER_MAX_LINEAR_SPEED_MPS,
            robot_state: {
              mode: "manual",
              connection_state: "active",
              estop: false,
              control_rtt_ms: TEST_PROVIDER_MAX_LINEAR_SPEED_MPS,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/hardware/leaders")) {
        return new Response(
          JSON.stringify({
            leaders: [
              {
                id: "so100-leader",
                path: serialPort,
                device_path: "/dev/ttyACM0",
                identity_key: "serial-by-id:1a86_USB_Single_Serial_58FA095368",
                identity_stable: true,
                serial: "58FA095368",
                source: "serial_by_id",
                available: true,
                leader_type: "serial_leader_candidate",
                hardware_family: "arm_controller",
                motor_bus: "feetech",
                motor_ids: [1, 2, 3, 4, 5, 6],
                motor_count: 6,
                control_parts: [
                  {
                    id: "feetech:1-2-3-4-5-6",
                    kind: "arm",
                    label: "Arm",
                    actuator_count: 6,
                    motor_bus: "feetech",
                    motor_ids: [1, 2, 3, 4, 5, 6],
                    calibration_category: "teleoperators",
                    calibration_profile: "so100_leader",
                    calibration_id: "my_leader",
                    calibration_group: "all",
                    configured_port: serialPort,
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "studio",
          studioRobotName: "so100",
        }),
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });

    await clickOpenArmLeaderScan(container);

    const conflict =
      "Disconnect this device as follower before selecting it as leader.";
    expect(container.textContent).not.toContain(conflict);
    const connectLeaderButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Connect",
    );
    expect(connectLeaderButton?.disabled).toBe(false);
    expect(connectLeaderButton?.title).toBe("");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("blocks undersized leaders for explicit left and right arm targets", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    useJointStore.getState().setAvailableJoints([
      "openarm_left_joint1",
      "openarm_left_joint2",
      "openarm_left_joint3",
      "openarm_left_joint4",
      "openarm_left_joint5",
      "openarm_left_joint6",
      "openarm_left_joint7",
      "openarm_left_finger_joint1",
      "openarm_right_joint1",
      "openarm_right_joint2",
      "openarm_right_joint3",
      "openarm_right_joint4",
      "openarm_right_joint5",
      "openarm_right_joint6",
      "openarm_right_joint7",
      "openarm_right_finger_joint1",
    ]);
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop")) {
        return new Response(JSON.stringify(TEST_PROVIDER_MANIFEST), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "active",
            current_session_id: "operator-session-1",
            robot_id: "openarm",
            mode: "manual",
            runtime_mode: "observe",
            control_lease_owner: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: 5,
            estimated_end_to_end_latency_ms: 10,
            robot_state: {
              mode: "manual",
              connection_state: "active",
              estop: false,
              control_rtt_ms: 4,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/hardware/leaders")) {
        return new Response(
          JSON.stringify({
            leaders: [
              {
                id: "small-leader",
                path: "/dev/ttyACM0",
                device_path: "/dev/ttyACM0",
                identity_key: "path:ttyACM0",
                identity_stable: false,
                source: "tty_glob",
                available: true,
                leader_type: "serial_leader_candidate",
                hardware_family: "arm_controller",
                motor_bus: "feetech",
                motor_ids: [1, 2, 3, 4, 5],
                motor_count: 5,
                control_parts: [
                  {
                    id: "feetech:1-2-3-4-5",
                    kind: "arm",
                    label: "Arm",
                    actuator_count: 5,
                    motor_bus: "feetech",
                    motor_ids: [1, 2, 3, 4, 5],
                    calibration_category: "teleoperators",
                    calibration_profile: "so100_leader",
                    calibration_id: "small_leader",
                    calibration_group: "all",
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "studio",
          studioRobotName: "openarm",
        }),
      );
      await flushMicrotasks();
    });
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });

    await clickOpenArmLeaderScan(container);

    expect(container.textContent).toContain("Left arm");
    expect(container.textContent).toContain("Right arm");
    expect(container.textContent).toContain(
      "Use a single-arm target for partial mapping.",
    );
    const targetSelect = container.querySelector(
      'select[aria-label="Target"]',
    ) as HTMLSelectElement | null;
    expect(targetSelect?.value).toBe("arm.left");
    expect(targetSelect?.disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe("OperatorTeleopPanel collaboration authorization", () => {
  it("connects the OpenArm HF live stream from the teleop panel lifecycle only", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop")) {
        return new Response(JSON.stringify({ ...TEST_PROVIDER_MANIFEST, camera_streams: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "idle",
            current_session_id: null,
            robot_id: "openarm",
            mode: "manual",
            runtime_mode: "observe",
            control_lease_owner: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: 1,
            estimated_end_to_end_latency_ms: 1,
            robot_state: {
              mode: "manual",
              connection_state: "idle",
              estop: false,
              control_rtt_ms: 1,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(createElement(OperatorTeleopPanel, { studioRobotName: "atlas" }));
      await flushMicrotasks();
    });
    expect(startOpenArmHfLiveObserveMock).not.toHaveBeenCalled();
    expect(stopOpenArmHfLiveObserveMock).not.toHaveBeenCalled();

    await act(async () => {
      root.render(createElement(OperatorTeleopPanel, { studioRobotName: "Open Arm Bimanual" }));
      await flushMicrotasks();
    });
    expect(startOpenArmHfLiveObserveMock).not.toHaveBeenCalled();
    expect(useOperatorPerceptionStore.getState().openArmHfLiveObserveRequested).toBe(false);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "camera",
          studioRobotName: "Open Arm Bimanual",
        }),
      );
      await flushMicrotasks();
    });
    expect(startOpenArmHfLiveObserveMock).toHaveBeenCalledOnce();
    expect(stopOpenArmHfLiveObserveMock).not.toHaveBeenCalled();
    expect(useOperatorPerceptionStore.getState().openArmHfLiveObserveRequested).toBe(true);
    const disconnectLiveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Disconnect live"
    );
    await act(async () => {
      disconnectLiveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });
    expect(stopOpenArmHfLiveObserveMock).toHaveBeenCalledOnce();

    const connectLiveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Connect live"
    );
    await act(async () => {
      connectLiveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });
    expect(startOpenArmHfLiveObserveMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.unmount();
    });
    expect(stopOpenArmHfLiveObserveMock).toHaveBeenCalledOnce();
    container.remove();

    const transitionContainer = document.createElement("div");
    document.body.appendChild(transitionContainer);
    const transitionRoot = createRoot(transitionContainer);

    await act(async () => {
      transitionRoot.render(
        createElement(OperatorTeleopPanel, {
          panelView: "camera",
          studioRobotName: "OpenArm Bimanual",
        })
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(startOpenArmHfLiveObserveMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      transitionRoot.render(
        createElement(OperatorTeleopPanel, {
          panelView: "hardware",
          studioRobotName: "OpenArm Bimanual",
        }),
      );
      await flushMicrotasks();
    });
    expect(stopOpenArmHfLiveObserveMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      transitionRoot.render(
        createElement(OperatorTeleopPanel, {
          panelView: "studio",
          studioRobotName: "OpenArm Bimanual",
        }),
      );
      await flushMicrotasks();
    });
    expect(stopOpenArmHfLiveObserveMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      transitionRoot.unmount();
    });
    transitionContainer.remove();
  });

  it("cleans stale follower roles immediately and leader roles after a hardware panel is opened", async () => {
    const storedAssignments = {
      "serial-by-id:leader": "leader",
      "serial-by-id:follower": "follower",
    };
    window.localStorage.setItem(
      OPERATOR_DEVICE_ROLE_ASSIGNMENTS_STORAGE_KEY,
      JSON.stringify(storedAssignments),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop")) {
        return new Response(JSON.stringify(TEST_PROVIDER_MANIFEST), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "idle",
            current_session_id: null,
            robot_id: "atlas",
            mode: "manual",
            runtime_mode: "observe",
            control_lease_owner: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: 1,
            estimated_end_to_end_latency_ms: 1,
            robot_state: {
              mode: "manual",
              connection_state: "idle",
              estop: false,
              control_rtt_ms: 1,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "camera",
          studioRobotName: "atlas",
        }),
      );
      await flushMicrotasks();
    });

    expect(
      JSON.parse(
        window.localStorage.getItem(OPERATOR_DEVICE_ROLE_ASSIGNMENTS_STORAGE_KEY) ??
          "{}",
      ),
    ).toEqual({ "serial-by-id:leader": "leader" });
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/hardware/leaders/release"),
      expect.anything(),
    );

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "hardware",
          studioRobotName: "atlas",
        }),
      );
      await flushMicrotasks();
    });

    expect(
      JSON.parse(
        window.localStorage.getItem(OPERATOR_DEVICE_ROLE_ASSIGNMENTS_STORAGE_KEY) ??
          "{}",
      ),
    ).toEqual({});

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("passes provider-advertised MoQ camera tracks to the OpenArm live observer", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop")) {
        return new Response(
          JSON.stringify({
            ...TEST_PROVIDER_MANIFEST,
            provider_display_name: "OpenArm Provider",
            live_transport: TEST_OPENARM_LIVE_TRANSPORT,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "idle",
            current_session_id: null,
            robot_id: "openarm",
            mode: "manual",
            runtime_mode: "observe",
            control_lease_owner: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: 1,
            estimated_end_to_end_latency_ms: 1,
            robot_state: {
              mode: "manual",
              connection_state: "idle",
              estop: false,
              control_rtt_ms: 1,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    useCameraStore.getState().loadCameras({
      cameras: [
        {
          id: "camera-config-openarm-depth",
          name: TEST_CAMERA_STREAM.id,
          parent_joint: "openarm_body_world_joint",
          pose: {
            xyz: [...TEST_CAMERA_CONFIG_POSE.position],
            rpy: [...OPENARM_HF_LIVE_CAMERA_RPY_RAD],
          },
          intrinsics: {
            width: TEST_CAMERA_STREAM.intrinsics.width,
            height: TEST_CAMERA_STREAM.intrinsics.height,
            fov_deg: 70,
          },
        },
      ],
    });

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "camera",
          studioRobotName: "openarm",
        }),
      );
      await flushMicrotasks();
    });

    expect(startOpenArmHfLiveObserveMock).toHaveBeenCalledOnce();
    expect(startOpenArmHfLiveObserveMock.mock.calls[0]?.[0]).toMatchObject({
      relayUrl: TEST_LIVE_RELAY_URL,
      realSenseSources: [
        {
          cameraId: TEST_CAMERA_STREAM.id,
          label: TEST_CAMERA_STREAM.label,
          path: "",
          namespace: TEST_LIVE_NAMESPACE,
          trackNames: {
            video: TEST_CAMERA_VIDEO_TRACK_NAME,
            depth: TEST_CAMERA_DEPTH_TRACK_NAME,
            metadata: TEST_CAMERA_METADATA_TRACK_NAME,
          },
          pose: TEST_CAMERA_CONFIG_POSE,
        },
      ],
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("restarts OpenArm live observe when the loaded camera config changes the cloud extrinsics", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop")) {
        return new Response(
          JSON.stringify({
            ...TEST_PROVIDER_MANIFEST,
            provider_display_name: "OpenArm Provider",
            live_transport: TEST_OPENARM_LIVE_TRANSPORT,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "idle",
            current_session_id: null,
            robot_id: "openarm",
            mode: "manual",
            runtime_mode: "observe",
            control_lease_owner: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: 1,
            estimated_end_to_end_latency_ms: 1,
            robot_state: {
              mode: "manual",
              connection_state: "idle",
              estop: false,
              control_rtt_ms: 1,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "camera",
          studioRobotName: "openarm",
        }),
      );
      await flushMicrotasks();
    });

    expect(startOpenArmHfLiveObserveMock).toHaveBeenCalledOnce();
    expect(startOpenArmHfLiveObserveMock.mock.calls[0]?.[0]).toMatchObject({
      realSenseSources: [
        {
          pose: TEST_CAMERA_POSE,
        },
      ],
    });

    await act(async () => {
      useCameraStore.getState().loadCameras({
        cameras: [
          {
            id: "camera-config-openarm-depth",
            name: TEST_CAMERA_STREAM.id,
            parent_joint: "openarm_body_world_joint",
            pose: {
              xyz: [...TEST_CAMERA_CONFIG_POSE.position],
              rpy: [...OPENARM_HF_LIVE_CAMERA_RPY_RAD],
            },
            intrinsics: {
              width: TEST_CAMERA_STREAM.intrinsics.width,
              height: TEST_CAMERA_STREAM.intrinsics.height,
              fov_deg: 70,
            },
          },
        ],
      });
      await flushMicrotasks();
    });

    expect(stopOpenArmHfLiveObserveMock).toHaveBeenCalledOnce();
    expect(startOpenArmHfLiveObserveMock).toHaveBeenCalledTimes(2);
    expect(startOpenArmHfLiveObserveMock.mock.calls[1]?.[0]).toMatchObject({
      realSenseSources: [
        {
          pose: TEST_CAMERA_CONFIG_POSE,
        },
      ],
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("keeps gateway controls disabled when the collaboration link lacks a teleop permit", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      if (String(input).includes("urdf-studio-teleop")) {
        return new Response(JSON.stringify(TEST_PROVIDER_MANIFEST), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(input).endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "active",
            current_session_id: "operator-session-1",
            robot_id: "atlas",
            mode: "manual",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          operator_rtt_ms: 5,
          estimated_end_to_end_latency_ms: 10,
          robot_state: {
            mode: "manual",
            connection_state: "active",
            estop: false,
            control_rtt_ms: 4,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "hardware",
          studioRobotName: "atlas",
          collaborationSessionId: "collab-123",
        })
      );
      await flushMicrotasks();
    });

    const connectButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Connect",
    );
    expect(connectButton?.disabled).toBe(true);
    expect(container.textContent).toContain("cannot teleoperate");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("auto-connects OpenArm live observe from the camera view only", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop")) {
        return new Response(JSON.stringify({ ...TEST_PROVIDER_MANIFEST, camera_streams: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "active",
            current_session_id: "robot-gateway-session",
            robot_id: "openarm",
            mode: "manual",
            runtime_mode: "observe",
            control_lease_owner: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: 1,
            estimated_end_to_end_latency_ms: 1,
            robot_state: {
              mode: "manual",
              connection_state: "active",
              estop: false,
              control_rtt_ms: 1,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "studio",
          studioRobotName: "OpenArm Bimanual",
        }),
      );
      await flushMicrotasks();
    });
    expect(startOpenArmHfLiveObserveMock).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "hardware",
          studioRobotName: "OpenArm Bimanual",
        }),
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(startOpenArmHfLiveObserveMock).not.toHaveBeenCalled();
    expect(useOperatorPerceptionStore.getState().openArmHfLiveObserveRequested).toBe(false);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "camera",
          studioRobotName: "OpenArm Bimanual",
        }),
      );
      await flushMicrotasks();
    });

    expect(startOpenArmHfLiveObserveMock).toHaveBeenCalledOnce();
    expect(useOperatorPerceptionStore.getState().openArmHfLiveObserveRequested).toBe(true);
    expect(stopOpenArmHfLiveObserveMock).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("hides gateway live tools and clears stale follower locks for model mismatches", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let leaseOwner: string | null = null;
    const manifest = {
      contract_version: "urdf-studio.teleop.v1",
      provider_id: "urdf-studio.robot-gateway",
      provider_display_name: "URDF Studio Robot Gateway",
      connection_modes: [
        {
          id: "direct_local",
          label: "This computer",
          summary: "Follower hardware is attached to this workstation.",
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
      live_transport: TEST_OPENARM_LIVE_TRANSPORT,
      profiles: [
        {
          id: "lekiwi_base_drive",
          label: "LeKiwi base drive",
          summary: "Mobile base profile.",
          control_target_label: "Wheels",
          transport: "robot_gateway",
          capabilities: {
            base_twist: true,
          },
          robot_family: "mobile_base",
          robot_id: "openarm",
          adapter_id: "lekiwi_native",
          teleoperation_mode: "real_hardware",
          controlled_joint_names: [],
          topics: {
            twist: "provider:/control/twist",
          },
          limits: {
            max_linear_speed_mps: TEST_PROVIDER_MAX_LINEAR_SPEED_MPS,
            max_yaw_speed_rps: TEST_PROVIDER_MAX_YAW_SPEED_RPS,
            command_tick_ms: TEST_PROVIDER_COMMAND_TICK_MS,
            deadman_timeout_ms: TEST_PROVIDER_DEADMAN_TIMEOUT_MS,
            max_joint_jog_delta_rad: 0,
            default_joint_jog_step_rad: 0,
            max_joint_velocity_rad_per_s: 0,
          },
        },
        {
          id: "openarm_dual_arm_joint_jog",
          label: "OpenArm dual-arm joint jog",
          summary: "OpenArm teleop control profile.",
          control_target_label: "OpenArm robot gateway",
          transport: "robot_gateway",
          capabilities: {
            arm_joint_state: true,
            arm_joint_command: true,
            state_mirroring: true,
            joint_jog: true,
          },
          robot_family: "manipulator",
          robot_id: "openarm",
          adapter_id: "openarm_native",
          teleoperation_mode: "real_hardware",
          hardware_device_key: "/dev/serial/by-id/openarm-can0",
          controlled_joint_names: ["openarm_left_joint1"],
          topics: {
            joint_states: ["provider:/telemetry/state"],
            joint_jog: "provider:/control/joint-jog",
          },
          limits: {
            max_linear_speed_mps: 0,
            max_yaw_speed_rps: 0,
            command_tick_ms: TEST_PROVIDER_COMMAND_TICK_MS,
            deadman_timeout_ms: TEST_PROVIDER_DEADMAN_TIMEOUT_MS,
            max_joint_jog_delta_rad:
              TEST_PROVIDER_JOINT_LIMITS.defaultJointJogStepRad,
            default_joint_jog_step_rad:
              TEST_PROVIDER_JOINT_LIMITS.defaultJointJogStepRad,
            max_joint_velocity_rad_per_s:
              TEST_PROVIDER_JOINT_LIMITS.maxJointVelocityRadPerSec,
          },
        },
        {
          id: "openarm_right_arm_joint_jog",
          label: "OpenArm right arm joint jog",
          summary: "OpenArm right arm target.",
          control_target_label: "OpenArm right arm",
          transport: "robot_gateway",
          capabilities: {
            arm_joint_state: true,
            arm_joint_command: true,
            state_mirroring: true,
            joint_jog: true,
          },
          robot_family: "manipulator",
          robot_id: "openarm",
          adapter_id: "openarm_native",
          teleoperation_mode: "real_hardware",
          hardware_device_key: "/dev/serial/by-id/openarm-can1",
          controlled_joint_names: ["openarm_right_joint1"],
          topics: {
            joint_states: ["provider:/telemetry/state"],
            joint_jog: "provider:/control/joint-jog",
          },
          limits: {
            max_linear_speed_mps: 0,
            max_yaw_speed_rps: 0,
            command_tick_ms: TEST_PROVIDER_COMMAND_TICK_MS,
            deadman_timeout_ms: TEST_PROVIDER_DEADMAN_TIMEOUT_MS,
            max_joint_jog_delta_rad:
              TEST_PROVIDER_JOINT_LIMITS.defaultJointJogStepRad,
            default_joint_jog_step_rad:
              TEST_PROVIDER_JOINT_LIMITS.defaultJointJogStepRad,
            max_joint_velocity_rad_per_s:
              TEST_PROVIDER_JOINT_LIMITS.maxJointVelocityRadPerSec,
          },
        },
      ],
      camera_streams: [TEST_CAMERA_STREAM],
    };
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop")) {
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "active",
            current_session_id: "robot-gateway-session",
            robot_id: "openarm",
            mode: "manual",
            runtime_mode: "control",
            control_lease_owner: leaseOwner,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: TEST_PROVIDER_MAX_LINEAR_SPEED_MPS,
            estimated_end_to_end_latency_ms: TEST_PROVIDER_MAX_LINEAR_SPEED_MPS,
            robot_state: {
              mode: "manual",
              connection_state: "active",
              estop: false,
              control_rtt_ms: TEST_PROVIDER_MAX_LINEAR_SPEED_MPS,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/lease/request")) {
        leaseOwner = "browser-operator";
        return new Response(
          JSON.stringify({
            accepted: true,
            operator_id: leaseOwner,
            profile_id: "openarm_dual_arm_joint_jog",
            reason: "Control lease granted.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/lease/release")) {
        leaseOwner = null;
        return new Response(
          JSON.stringify({
            accepted: true,
            operator_id: "browser-operator",
            profile_id: "openarm_dual_arm_joint_jog",
            reason: "Control lease released.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/control/stop")) {
        return new Response(
          JSON.stringify({ accepted: true, command_kind: "stop" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/hardware/follower/release")) {
        return new Response(JSON.stringify({ released: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/telemetry/state")) {
        return new Response(
          JSON.stringify({
            robot_id: "openarm",
            adapter_id: "openarm_native",
            profile_id: "openarm_dual_arm_joint_jog",
            sequence: TEST_CAMERA_FIXTURE.pointCloudSequence,
            source_ts_ms: Date.now(),
            mode: "manual",
            estop: false,
            heartbeat_ok: true,
            joint_positions_rad: { openarm_left_joint1: 0 },
            gripper_positions_rad: {},
            hardware_motion_safety: {
              motion_ready: true,
              authoritative_joint_feedback_ready: true,
              joint_rotation_calibration_ready: true,
              joint_rotation_calibration_id: "test-calibration",
              self_collision_preflight_ready: true,
              gripper_motion_enabled: false,
              last_reject_reason: null,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
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
      if (url.endsWith("/hardware/leaders")) {
        return new Response(
          JSON.stringify({
            available: false,
            leaders: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/point-cloud")) {
        return new Response(JSON.stringify(TEST_POINT_CLOUD_FRAME), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem(
      OPERATOR_DEVICE_ROLE_ASSIGNMENTS_STORAGE_KEY,
      JSON.stringify({ "/dev/serial/by-id/openarm-can1": "follower" }),
    );

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "hardware",
          studioRobotName: "studio-mismatch",
        }),
      );
      await flushMicrotasks();
    });

    expect(container.textContent).toContain("Robot");
    expect(container.textContent).toContain("Detected targets");
    expect(container.textContent).toContain("Config");
    expect(container.textContent).toContain(".env.robot.local");
    expect(container.textContent).toContain("OpenArm arm");
    expect(container.textContent).toContain("OpenArm right arm");
    expect(container.textContent).not.toContain("used as follower");
    expect(container.textContent).toContain("Connect");
    expect(container.textContent).not.toContain("connected follower");
    expect(container.textContent).not.toContain("already follower");
    expect(container.textContent).not.toContain("OpenArm dual-arm joint jog");
    expect(container.textContent).not.toContain("OpenArm robot gateway");
    expect(container.textContent).toContain("Port: /dev/serial/by-id/openarm-can0");
    expect(container.textContent).not.toContain("LeKiwi base drive");
    expect(container.textContent).not.toContain("Follower connection");
    expect(container.textContent).not.toContain("This computer");
    expect(container.textContent).not.toContain("SSH tunnel");
    expect(container.textContent).not.toContain("OpenArm live");
    expect(container.textContent).not.toContain("Camera MoQ live tracks");
    expect(container.textContent).not.toContain(TEST_CAMERA_STREAM.label);
    expect(startOpenArmHfLiveObserveMock).not.toHaveBeenCalled();
    expect(
      vi.mocked(fetchMock).mock.calls.some((call) => String(call[0]).endsWith("/point-cloud")),
    ).toBe(false);
    const targetSelect = container.querySelector(
      'select[aria-label="Robot target"]',
    ) as HTMLSelectElement | null;
    expect(
      Array.from(targetSelect?.options ?? []).map((option) => option.textContent),
    ).toEqual([
      "OpenArm arm",
      "OpenArm right arm",
    ]);
    const editEnvButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Config",
    );
    await act(async () => {
      editEnvButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });
    expect(
      vi
        .mocked(fetchMock)
        .mock.calls.some((call) => String(call[0]).endsWith("/config/env/open")),
    ).toBe(true);
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).not.toContain("URDF_BUTTERCLAW_ROBOT_USE_SSH_TUNNEL");

    expect(useOperatorLeaderTeleopStore.getState()).toMatchObject({
      available: false,
      connected: false,
      reason: "Configure leader input before using Leader Teleop.",
    });
    expect(
      vi
        .mocked(fetchMock)
        .mock.calls.some((call) =>
          String(call[0]).includes("/hardware/leader-state"),
        ),
    ).toBe(false);
    expect(
      vi.mocked(fetchMock).mock.calls.some((call) => String(call[0]).endsWith("/lease/request")),
    ).toBe(false);
    expect(
      vi
        .mocked(fetchMock)
        .mock.calls.some((call) => String(call[0]).endsWith("/telemetry/state")),
    ).toBe(false);
    expect(
      vi
        .mocked(fetchMock)
        .mock.calls.some((call) => String(call[0]).endsWith("/control/stop")),
    ).toBe(false);
    expect(targetSelect?.disabled).toBe(false);
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "Connect",
      ),
    ).toBe(true);
    const inactiveDisconnectButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Disconnect");
    expect(inactiveDisconnectButton?.disabled).toBe(true);
    expect(
      vi
        .mocked(fetchMock)
        .mock.calls.some((call) =>
          String(call[0]).endsWith("/hardware/follower/release"),
        ),
    ).toBe(false);
    expect(
      JSON.parse(
        window.localStorage.getItem(OPERATOR_DEVICE_ROLE_ASSIGNMENTS_STORAGE_KEY) ??
          "{}",
      ),
    ).toEqual({});
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "Connect",
      ),
    ).toBe(true);
    expect(container.textContent).not.toContain("Base drive");
    expect(container.textContent).not.toContain("Wheels");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("opens the selected LeRobot follower calibration file", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const followerJointNames = ["wrist_roll"];
    let leaseOwner: string | null = null;
    const wristRollPositionRad = 0;
    window.localStorage.setItem(
      OPERATOR_DEVICE_ROLE_ASSIGNMENTS_STORAGE_KEY,
      JSON.stringify({ "/dev/serial/by-id/so100": "leader" }),
    );
    const fetchMock: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop")) {
        return new Response(
          JSON.stringify({
            contract_version: "urdf-studio.teleop.v1",
            provider_id: "urdf-studio.robot-gateway",
            provider_display_name: "URDF Studio Robot Gateway",
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
                id: "so100_follower_joint_jog",
                label: "SO100 follower joint jog",
                summary: "LeRobot follower target.",
                control_target_label: "Arm",
                transport: "robot_gateway",
                capabilities: {
                  arm_joint_state: true,
                  arm_joint_command: true,
                  state_mirroring: true,
                  joint_jog: true,
                },
                robot_family: "manipulator",
                robot_id: "so100",
                adapter_id: "lerobot",
                teleoperation_mode: "real_hardware",
                hardware_device_key: "/dev/serial/by-id/so100",
                controlled_joint_names: followerJointNames,
                topics: {
                  joint_states: ["provider:/telemetry/state"],
                  joint_jog: "provider:/control/joint-jog",
                },
                limits: {
                  max_linear_speed_mps: 0,
                  max_yaw_speed_rps: 0,
                  command_tick_ms: TEST_PROVIDER_COMMAND_TICK_MS,
                  deadman_timeout_ms: TEST_PROVIDER_DEADMAN_TIMEOUT_MS,
                  max_joint_jog_delta_rad:
                    TEST_PROVIDER_JOINT_LIMITS.defaultJointJogStepRad,
                  default_joint_jog_step_rad:
                    TEST_PROVIDER_JOINT_LIMITS.defaultJointJogStepRad,
                  max_joint_velocity_rad_per_s:
                    TEST_PROVIDER_JOINT_LIMITS.maxJointVelocityRadPerSec,
                },
              },
            ],
            camera_streams: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "active",
            current_session_id: "robot-gateway-session",
            robot_id: "so100",
            mode: "manual",
            runtime_mode: "control",
            control_lease_owner: leaseOwner,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: TEST_PROVIDER_MAX_LINEAR_SPEED_MPS,
            estimated_end_to_end_latency_ms: TEST_PROVIDER_MAX_LINEAR_SPEED_MPS,
            robot_state: {
              mode: "manual",
              connection_state: "active",
              estop: false,
              control_rtt_ms: TEST_PROVIDER_MAX_LINEAR_SPEED_MPS,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/lease/request")) {
        leaseOwner = "browser-operator";
        return new Response(
          JSON.stringify({
            accepted: true,
            operator_id: leaseOwner,
            profile_id: "so100_follower_joint_jog",
            reason: "Control lease granted.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith(OPERATOR_HELPER_LEROBOT_CALIBRATIONS_PATH)) {
        return new Response(
          JSON.stringify({
            entries: [
              {
                id: "robots:so100_follower:so100-left-1:all",
                category: "robots",
                profile_id: "so100_follower",
                calibration_id: "so100-left-1",
                calibration_dir: "/calibrations/robots/so100_follower",
                group_id: "all",
                path: "/calibrations/robots/so100_follower/so100-left-1.json",
                joint_names: followerJointNames,
                motor_ids: [1],
                actuator_count: followerJointNames.length,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith(OPERATOR_HELPER_LEROBOT_CALIBRATION_OPEN_PATH)) {
        return new Response(
          JSON.stringify({
            path: "/calibrations/robots/so100_follower/so100-left-1.json",
            exists: true,
            opened: true,
            message: "Opened LeRobot calibration file.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith(OPERATOR_HELPER_LEROBOT_CALIBRATION_SYNC_PATH)) {
        return new Response(
          JSON.stringify({
            path: "/calibrations/robots/so100_follower/so100-left-1.json",
            exists: true,
            mtime_ns: 10,
            changed: false,
            applied: false,
            message: "",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/telemetry/state")) {
        return new Response(
          JSON.stringify({
            robot_id: "so100",
            adapter_id: "lerobot",
            profile_id: "so100_follower_joint_jog",
            sequence: TEST_CAMERA_FIXTURE.pointCloudSequence,
            source_ts_ms: Date.now(),
            mode: "manual",
            estop: false,
            heartbeat_ok: true,
            joint_positions_rad: { wrist_roll: wristRollPositionRad },
            gripper_positions_rad: {},
            hardware_motion_safety: {
              motion_ready: true,
              authoritative_joint_feedback_ready: true,
              joint_rotation_calibration_ready: true,
              joint_rotation_calibration_id: "so100-left-1",
              self_collision_preflight_ready: true,
              gripper_motion_enabled: false,
              last_reject_reason: null,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    useJointStore.getState().setAvailableJoints(["arm_wrist_roll"]);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          panelView: "hardware",
          studioRobotName: "so100",
        }),
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });

    const connectButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Connect",
    );
    expect(container.textContent).not.toContain(
      "Disconnect this device as leader before selecting it as follower.",
    );
    expect(connectButton?.disabled).toBe(false);
    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(
      JSON.parse(
        window.localStorage.getItem(OPERATOR_DEVICE_ROLE_ASSIGNMENTS_STORAGE_KEY) ??
          "{}",
      ),
    ).toEqual({});
    expect(container.textContent).not.toContain("Joint jog");
    expect(container.textContent).not.toContain("Manual calibration only.");
    expect(container.textContent).not.toContain("Calibrate jog");

    const fixOrderButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Fix order",
    );
    expect(fixOrderButton?.disabled).toBe(false);
    await act(async () => {
      fixOrderButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(container.textContent).toContain("Opened LeRobot calibration file.");
    const openCalibrationFileButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Open file");
    expect(openCalibrationFileButton?.disabled).toBe(false);
    const openCalibrationCall = vi
      .mocked(fetchMock)
      .mock.calls.find((call) =>
        String(call[0]).endsWith(OPERATOR_HELPER_LEROBOT_CALIBRATION_OPEN_PATH),
      );
    expect(openCalibrationCall).not.toBeNull();
    expect(JSON.parse(String(openCalibrationCall?.[1]?.body))).toEqual({
      calibration_source: {
        category: "robots",
        profile_id: "so100_follower",
        calibration_id: "so100-left-1",
        calibration_dir: "/calibrations/robots/so100_follower",
        group_id: "all",
      },
    });
    expect(container.textContent).toContain("Opened LeRobot calibration file.");
    expect(container.textContent).not.toContain("Done: 1/1 motors");
    expect(container.textContent).not.toContain(
      "Calibration order is already consistent.",
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("requests a robot-gateway lease before enabling OpenArm joint jog", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const putImageDataMock = vi.fn();
    const getCanvasContextMock = vi
      .spyOn(
        HTMLCanvasElement.prototype as unknown as {
          getContext: (contextId: string) => CanvasRenderingContext2D | null;
        },
        "getContext"
      )
      .mockReturnValue({
        putImageData: putImageDataMock,
      } as unknown as CanvasRenderingContext2D);
    class TestImageData {
      readonly data: Uint8ClampedArray;
      readonly width: number;
      readonly height: number;
      readonly colorSpace = "srgb";

      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    }
    vi.stubGlobal("ImageData", TestImageData);
    const liveVideoTrack = { stop: vi.fn() };
    const liveVideoStream = {
      getVideoTracks: () => [liveVideoTrack],
      getTracks: () => [liveVideoTrack],
    } as unknown as MediaStream;
    const originalCaptureStream = HTMLCanvasElement.prototype.captureStream;
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: vi.fn(() => liveVideoStream),
    });
    let leaseOwner: string | null = null;
    const jointJogLimits = {
      defaultStepRad: 0.01,
      maxDeltaRad: 0.05,
      maxVelocityRadPerSec: 0.5,
    };
    const jointJogBodies: unknown[] = [];
    const calibrationJogBodies: unknown[] = [];
    const manifest = {
      contract_version: "urdf-studio.teleop.v1",
      provider_id: "urdf-studio.robot-gateway",
      provider_display_name: "URDF Studio Robot Gateway",
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
          id: "openarm_dual_arm_joint_jog",
          label: "OpenArm dual-arm joint jog",
          summary: "OpenArm teleop control profile.",
          control_target_label: "OpenArm robot gateway",
          transport: "robot_gateway",
          capabilities: {
            arm_joint_state: true,
            arm_joint_command: true,
            state_mirroring: true,
            joint_jog: true,
            gripper: true,
          },
          robot_family: "manipulator",
          robot_id: "openarm",
          adapter_id: "openarm_native",
          teleoperation_mode: "real_hardware",
          controlled_joint_names: [
            "openarm_left_joint1",
            "openarm_right_joint1",
            "openarm_left_finger_joint1",
          ],
          topics: {
            joint_states: ["provider:/telemetry/state"],
            joint_jog: "provider:/control/joint-jog",
          },
          limits: {
            max_linear_speed_mps: 0,
            max_yaw_speed_rps: 0,
            command_tick_ms: TEST_PROVIDER_COMMAND_TICK_MS,
            deadman_timeout_ms: TEST_PROVIDER_DEADMAN_TIMEOUT_MS,
            max_joint_jog_delta_rad: jointJogLimits.maxDeltaRad,
            default_joint_jog_step_rad: jointJogLimits.defaultStepRad,
            max_joint_velocity_rad_per_s: jointJogLimits.maxVelocityRadPerSec,
          },
        },
      ],
      camera_streams: [TEST_CAMERA_STREAM],
    };
    const fetchMock: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop")) {
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/session")) {
        return new Response(
          JSON.stringify({
            state: "active",
            current_session_id: "robot-gateway-session",
            robot_id: "openarm",
            mode: "manual",
            runtime_mode: "control",
            control_lease_owner: leaseOwner,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.endsWith("/stats")) {
        return new Response(
          JSON.stringify({
            operator_rtt_ms: 1,
            estimated_end_to_end_latency_ms: 1,
            robot_state: {
              mode: "manual",
              connection_state: "active",
              estop: false,
              control_rtt_ms: 1,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.endsWith("/lease/request")) {
        leaseOwner = "browser-operator";
        return new Response(
          JSON.stringify({
            accepted: true,
            operator_id: leaseOwner,
            profile_id: "openarm_dual_arm_joint_jog",
            reason: "Control lease granted.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.endsWith("/telemetry/state")) {
        return new Response(
          JSON.stringify({
            robot_id: "openarm",
            adapter_id: "openarm_native",
            profile_id: "openarm_dual_arm_joint_jog",
            sequence: 1,
            source_ts_ms: Date.now(),
            mode: "manual",
            estop: false,
            heartbeat_ok: true,
            joint_positions_rad: {
              openarm_left_joint1: 0.1,
              openarm_right_joint1: 0.1,
            },
            gripper_positions_rad: {},
            hardware_motion_safety: {
              motion_ready: true,
              authoritative_joint_feedback_ready: true,
              joint_rotation_calibration_ready: true,
              joint_rotation_calibration_id: "test-calibration",
              self_collision_preflight_ready: true,
              gripper_motion_enabled: false,
              last_reject_reason: null,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/hardware/leaders")) {
        return new Response(
          JSON.stringify({
            available: true,
            leaders: [
              {
                id: "mini-right",
                path: "/dev/ttyACM0",
                device_path: "/dev/ttyACM0",
                identity_key: "path:ttyACM0",
                identity_stable: false,
                source: "tty_glob",
                available: true,
                leader_type: "serial_leader_candidate",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/hardware/leader-state")) {
        return new Response(
          JSON.stringify({
            connected: true,
            port: "/dev/ttyACM0",
            side: "both",
            source_ts_ms: Date.now(),
            joints: {
              openarm_left_joint1: {
                position_rad: TEST_OPENARM_LEADER_TELEMETRY.positionRad,
              },
            },
            error: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/control/joint-jog")) {
        jointJogBodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            accepted: true,
            command_kind: "joint_jog",
            sequence: jointJogBodies.length,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith(OPERATOR_HELPER_OPENARM_CALIBRATION_JOG_PATH)) {
        const body = JSON.parse(String(init?.body));
        calibrationJogBodies.push(body);
        return new Response(
          JSON.stringify({
            accepted: true,
            command_kind: "openarm_calibration_jog",
            sequence: calibrationJogBodies.length,
            applied_joint_name: body.joint_name,
            applied_delta_rad: body.delta_rad,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/point-cloud")) {
        return new Response(JSON.stringify(TEST_POINT_CLOUD_FRAME), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    useOperatorLeaderTeleopStore
      .getState()
      .setLeaderTeleopViewerModeActive(true);

    await act(async () => {
      root.render(
        createElement(OperatorTeleopPanel, {
          studioRobotName: "openarm",
          collaborationSessionId: "collab-owner-session",
          collaborationOwnerToken: "owner-token",
        }),
      );
      await flushMicrotasks();
    });

    expect(startOpenArmHfLiveObserveMock).not.toHaveBeenCalled();
    expect(
      vi.mocked(fetchMock).mock.calls.some((call) => String(call[0]).endsWith("/point-cloud"))
    ).toBe(false);
    expect(useOperatorPerceptionStore.getState().activePointCloudFrame).toBeNull();
    expect(useOperatorPerceptionStore.getState().activeCameraVideoFrame).toBeNull();
    expect(putImageDataMock).not.toHaveBeenCalled();

    const connectButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Connect",
    );
    expect(connectButton).toBeTruthy();
    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(
      vi.mocked(fetchMock).mock.calls.some((call) => String(call[0]).endsWith("/lease/request"))
    ).toBe(true);
    const leaseRequest = vi
      .mocked(fetchMock)
      .mock.calls.find((call) => String(call[0]).endsWith("/lease/request"))?.[1];
    expect(
      (leaseRequest?.headers as Headers).get(COLLABORATION_SESSION_TOKEN_HEADER),
    ).toBe("owner-token");
    expect(
      (leaseRequest?.headers as Headers).has("X-Operator-Helper-Token"),
    ).toBe(false);
    expect(stopOpenArmHfLiveObserveMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Motion safety ready");
    expect(container.textContent).toContain("RobotUsing");
    expect(container.textContent).not.toContain("Before motion");
    expect(container.textContent).not.toContain("OKFollower gateway");
    expect(container.textContent).not.toContain("OKJoint rotation calibration");
    expect(container.textContent).not.toContain("OKFresh telemetry");
    expect(container.textContent).not.toContain("OKSelf-collision preflight");
    expect(container.textContent).not.toContain("Leader autodetect");
    expect(container.textContent).not.toContain("teleop control token");
    expect(useOperatorLeaderTeleopStore.getState()).toMatchObject({
      studioIkAffectsFollowerHardware: true,
      available: false,
      connected: false,
      reason: "Configure leader input before using Leader Teleop.",
    });
    expect(
      useOperatorPerceptionStore.getState().activeLeaderJointTelemetryByName
        .openarm_left_joint1?.positionRad,
    ).toBeUndefined();
    expect(
      useOperatorPerceptionStore.getState().activeFollowerJointTelemetryByName
        .openarm_left_joint1?.positionRad,
    ).toBe(0.1);
    expect(jointJogBodies).toEqual([]);
    const immediateTimer = vi
      .spyOn(window, "setTimeout")
      .mockImplementation((handler: Parameters<typeof window.setTimeout>[0]) => {
        if (typeof handler === "function") {
          handler();
        }
        return undefined as unknown as ReturnType<typeof window.setTimeout>;
      });
    const testAllButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Test all arm joints",
    );
    expect(testAllButton).toBeTruthy();
    try {
      await act(async () => {
        testAllButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await flushMicrotasks();
        await flushMicrotasks();
        await flushMicrotasks();
        await flushMicrotasks();
      });
    } finally {
      immediateTimer.mockRestore();
    }
    expect(calibrationJogBodies).toEqual([
      expect.objectContaining({
        joint_name: "openarm_left_joint1",
        delta_rad: OPERATOR_OPENARM_CALIBRATION_JOG.stepRad,
      }),
      expect.objectContaining({
        joint_name: "openarm_left_joint1",
        delta_rad: -OPERATOR_OPENARM_CALIBRATION_JOG.stepRad,
      }),
      expect.objectContaining({
        joint_name: "openarm_right_joint1",
        delta_rad: OPERATOR_OPENARM_CALIBRATION_JOG.stepRad,
      }),
      expect.objectContaining({
        joint_name: "openarm_right_joint1",
        delta_rad: -OPERATOR_OPENARM_CALIBRATION_JOG.stepRad,
      }),
    ]);
    expect(calibrationJogBodies).not.toContainEqual(
      expect.objectContaining({ joint_name: "openarm_left_finger_joint1" }),
    );
    expect(useJointStore.getState().jointValues.openarm_left_joint1).toBeCloseTo(
      0.1,
    );
    expect(useJointStore.getState().jointValues.openarm_right_joint1).toBeCloseTo(
      0.1,
    );
    expect(container.textContent).toContain("Manual calibration only.");
    expect(container.textContent).not.toContain("Base drive");
    expect(container.textContent).not.toContain("Forward");
    expect(container.textContent).not.toContain("Linear speed");
    expect(container.textContent).not.toContain("Last drive command");

    await act(async () => {
      root.unmount();
    });
    expect(useOperatorLeaderTeleopStore.getState().studioIkAffectsFollowerHardware).toBe(false);
    getCanvasContextMock.mockRestore();
    if (originalCaptureStream) {
      Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
        configurable: true,
        value: originalCaptureStream,
      });
    } else {
      delete HTMLCanvasElement.prototype.captureStream;
    }
    container.remove();
  });
});

describe("createOperatorCommandQueue", () => {
  it("coalesces motion while a command is in flight and sends stop immediately", async () => {
    let resolveFirstCommand: (() => void) | null = null;
    const send = vi.fn(async () => {
      if (send.mock.calls.length === 1) {
        await new Promise<void>((resolve) => {
          resolveFirstCommand = resolve;
        });
      }
    });
    const nowMs = vi
      .fn<() => number>()
      .mockReturnValueOnce(FIRST_COMMAND_TS_MS)
      .mockReturnValueOnce(SECOND_COMMAND_TS_MS);
    const queue = createOperatorCommandQueue({ nowMs, send });

    queue.enqueue({ kind: "twist", twist: { x: 0.1, y: 0, omega: 0 } });
    queue.enqueue({ kind: "twist", twist: { x: 0.2, y: 0, omega: 0 } });
    queue.enqueue({ kind: "stop", twist: OPERATOR_HELPER_STOP_TWIST });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]).toEqual([
      { x: 0.1, y: 0, omega: 0 },
      { command_kind: "twist", sequence: 1, source_ts_ms: FIRST_COMMAND_TS_MS },
    ]);
    expect(send.mock.calls[1]).toEqual([
      OPERATOR_HELPER_STOP_TWIST,
      { command_kind: "stop", sequence: 2, source_ts_ms: SECOND_COMMAND_TS_MS },
    ]);

    resolveFirstCommand?.();
    await flushMicrotasks();

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("reserves metadata for direct priority commands without duplicating sequences", () => {
    const nowMs = vi
      .fn<() => number>()
      .mockReturnValueOnce(FIRST_COMMAND_TS_MS)
      .mockReturnValueOnce(SECOND_COMMAND_TS_MS);
    const queue = createOperatorCommandQueue({
      nowMs,
      send: vi.fn(async () => undefined),
    });

    expect(queue.reserveMetadata("joint_jog")).toEqual({
      command_kind: "joint_jog",
      sequence: 1,
      source_ts_ms: FIRST_COMMAND_TS_MS,
    });
    expect(queue.reserveMetadata("estop")).toEqual({
      command_kind: "estop",
      sequence: 2,
      source_ts_ms: SECOND_COMMAND_TS_MS,
    });
    expect(queue.getLastSequence()).toBe(2);
  });
});
