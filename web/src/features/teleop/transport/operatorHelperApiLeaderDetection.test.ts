import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchOperatorLeaderDetection,
  fetchOperatorLeaderState,
} from "@/features/teleop/transport/operatorHelperApi";
import {
  OPERATOR_HELPER_LEADER_DETECTION_PATH,
  OPERATOR_HELPER_LEADER_STATE_PATH,
} from "@/features/teleop/params/operatorTeleopParams";

const TEST_LEADER_STATE_FIXTURE = {
  jointPositionRad: 0.25,
  jointVelocityRadPerSec: 0.5,
  jointTorqueNm: 0.1,
  sourceTsMs: 1_234,
} as const;

describe("fetchOperatorLeaderDetection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes autodetected serial arm controllers", async () => {
    const fixture = {
      baseUrl: "http://127.0.0.1:8091/robot-gateway",
      path: "/dev/serial/by-id/usb-1a86_USB_Single_Serial_5A46082861-if00",
      devicePath: "/dev/ttyACM0",
      identityKey: "serial-by-id:1a86_USB_Single_Serial_5A46082861",
      label: "1a86 USB Single Serial 5A46082861",
      serial: "5A46082861",
      recommendedEnv: "LEADER_SERIAL_PORT",
    } as const;
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            leaders: [
              {
                id: fixture.path,
                path: fixture.path,
                device_path: fixture.devicePath,
                identity_key: fixture.identityKey,
                identity_stable: true,
                serial: fixture.serial,
                label: fixture.label,
                source: "serial_by_id",
                leader_type: "serial_leader_candidate",
                hardware_family: "arm_controller",
                motor_bus: "feetech",
                motor_ids: [1, 2, 3, 4, 5, 6, 7, 8],
                motor_models: {
                  1: "sts3215",
                  2: "sts3215",
                },
                motor_count: 8,
                motor_probe_error: null,
                control_parts: [
                  {
                    id: "feetech:1-2-3-4-5-6-7-8",
                    kind: "arm",
                    label: "Arm",
                    actuator_count: 8,
                    motor_bus: "feetech",
                    motor_ids: [1, 2, 3, 4, 5, 6, 7, 8],
                    motor_model: "sts3215",
                    motor_models: {
                      1: "sts3215",
                      2: "sts3215",
                    },
                  },
                ],
                recommended_env: fixture.recommendedEnv,
                available: true,
              },
            ],
            runtime_providers: [
              {
                id: "lerobot",
                label: "LeRobot local hardware",
                kind: "hardware",
                status: "available",
                connectable: true,
                summary: "LeRobot provider",
              },
              {
                id: "dora",
                label: "dora dataflow",
                kind: "dataflow",
                status: "needs_config",
                connectable: false,
                summary: "Configure a dataflow",
                config_ref: "/tmp/demo.yml",
                node_id: null,
              },
            ],
            preferred_leader_port: fixture.path,
          }),
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const detection = await fetchOperatorLeaderDetection(
      fixture.baseUrl,
    );

    expect(String(vi.mocked(fetchMock).mock.calls[0][0])).toBe(
      `${fixture.baseUrl}${OPERATOR_HELPER_LEADER_DETECTION_PATH}`,
    );
    expect(detection.preferredLeaderPort).toBe(fixture.path);
    expect(detection.runtimeProviders).toEqual([
      {
        id: "lerobot",
        label: "LeRobot local hardware",
        kind: "hardware",
        status: "available",
        connectable: true,
        summary: "LeRobot provider",
        configRef: null,
        nodeId: null,
      },
      {
        id: "dora",
        label: "dora dataflow",
        kind: "dataflow",
        status: "needs_config",
        connectable: false,
        summary: "Configure a dataflow",
        configRef: "/tmp/demo.yml",
        nodeId: null,
      },
    ]);
    expect(detection.leaders).toEqual([
      {
        id: fixture.path,
        path: fixture.path,
        devicePath: fixture.devicePath,
        identityKey: fixture.identityKey,
        identityStable: true,
        serial: fixture.serial,
        label: fixture.label,
        source: "serial_by_id",
        leaderType: "serial_leader_candidate",
        hardwareFamily: "arm_controller",
        motorBus: "feetech",
        motorIds: [1, 2, 3, 4, 5, 6, 7, 8],
        motorModels: {
          1: "sts3215",
          2: "sts3215",
        },
        motorCount: 8,
        motorProbeError: null,
        controlParts: [
          {
            id: "feetech:1-2-3-4-5-6-7-8",
            kind: "arm",
            label: "Arm",
            actuatorCount: 8,
            motorBus: "feetech",
            motorIds: [1, 2, 3, 4, 5, 6, 7, 8],
            motorModel: "sts3215",
            motorModels: {
              1: "sts3215",
              2: "sts3215",
            },
            jointNames: [],
            calibrationCategory: null,
            calibrationProfile: null,
            calibrationId: null,
            calibrationGroup: null,
            calibrationMtimeNs: 0,
            zeroPositionsRad: {},
            configuredPort: null,
            configuredPortMatches: false,
            configuredPortStatus: "none",
          },
        ],
        recommendedEnv: fixture.recommendedEnv,
        available: true,
      },
    ]);
  });

  it("derives generic arm control parts from motor metadata when control parts are absent", async () => {
    const fixture = {
      baseUrl: "http://127.0.0.1:8091/robot-gateway",
      path: "/dev/serial/by-id/usb-1a86_USB_Single_Serial_58FA095368-if00",
      devicePath: "/dev/ttyACM0",
      identityKey: "serial-by-id:1a86_USB_Single_Serial_58FA095368",
    } as const;
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            leaders: [
              {
                id: fixture.path,
                path: fixture.path,
                device_path: fixture.devicePath,
                identity_key: fixture.identityKey,
                identity_stable: true,
                serial: "58FA095368",
                label: "Serial arm controller",
                source: "serial_by_id",
                leader_type: "serial_leader_candidate",
                hardware_family: "arm_controller",
                motor_bus: "feetech",
                motor_ids: [1, 2, 3, 4, 5, 6],
                motor_count: 6,
                available: true,
              },
            ],
            preferred_leader_port: fixture.path,
          }),
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const detection = await fetchOperatorLeaderDetection(
      fixture.baseUrl,
    );

    expect(detection.leaders[0]?.controlParts).toEqual([
      {
        id: "feetech:1-2-3-4-5-6",
        kind: "arm",
        label: "Arm",
        actuatorCount: 6,
        motorBus: "feetech",
        motorIds: [1, 2, 3, 4, 5, 6],
        motorModel: null,
        motorModels: {},
        jointNames: [],
        calibrationCategory: null,
        calibrationProfile: null,
        calibrationId: null,
        calibrationGroup: null,
        calibrationMtimeNs: 0,
        zeroPositionsRad: {},
        configuredPort: null,
        configuredPortMatches: false,
        configuredPortStatus: "none",
      },
    ]);
  });
});

describe("fetchOperatorLeaderState", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes read-only OpenArm leader joint state", async () => {
    const fixture = {
      baseUrl: "http://127.0.0.1:8091/robot-gateway",
      port: "/dev/serial/by-id/openarm-mini",
    } as const;
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            connected: true,
            port: fixture.port,
            side: "both",
            source_ts_ms: TEST_LEADER_STATE_FIXTURE.sourceTsMs,
            joints: {
              openarm_left_joint1: {
                position_rad: TEST_LEADER_STATE_FIXTURE.jointPositionRad,
                velocity_rad_per_sec:
                  TEST_LEADER_STATE_FIXTURE.jointVelocityRadPerSec,
                torque_nm: TEST_LEADER_STATE_FIXTURE.jointTorqueNm,
              },
            },
            error: null,
          }),
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const state = await fetchOperatorLeaderState(
      fixture.port,
      "both",
      fixture.baseUrl,
    );

    const expectedStateUrl =
      `${fixture.baseUrl}${OPERATOR_HELPER_LEADER_STATE_PATH}` +
      "?port=%2Fdev%2Fserial%2Fby-id%2Fopenarm-mini&side=both";
    expect(String(vi.mocked(fetchMock).mock.calls[0][0])).toBe(
      expectedStateUrl,
    );
    expect(state).toEqual({
      connected: true,
      port: fixture.port,
      side: "both",
      sourceTsMs: TEST_LEADER_STATE_FIXTURE.sourceTsMs,
      joints: {
        openarm_left_joint1: {
          positionRad: TEST_LEADER_STATE_FIXTURE.jointPositionRad,
          velocityRadPerSec: TEST_LEADER_STATE_FIXTURE.jointVelocityRadPerSec,
          torqueNm: TEST_LEADER_STATE_FIXTURE.jointTorqueNm,
        },
      },
      error: null,
    });
  });

  it("requests generic leader state for explicit motor ids", async () => {
    const fixture = {
      baseUrl: "http://127.0.0.1:8091/robot-gateway",
      port: "/dev/serial/by-id/generic-arm",
    } as const;
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            connected: true,
            port: fixture.port,
            side: "both",
            source_ts_ms: TEST_LEADER_STATE_FIXTURE.sourceTsMs,
            joints: {
              leader_axis_1: {
                position_rad: TEST_LEADER_STATE_FIXTURE.jointPositionRad,
              },
            },
            error: null,
          }),
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const state = await fetchOperatorLeaderState(
      fixture.port,
      "both",
      fixture.baseUrl,
      {
        motorIds: [1, 2, 3, 4, 5, 6],
        motorModel: "sts3215",
        calibrationCategory: "teleoperators",
        calibrationProfile: "so100_leader",
        calibrationId: "my_leader",
        calibrationGroup: "all",
      },
    );

    expect(String(vi.mocked(fetchMock).mock.calls[0][0])).toBe(
      `${fixture.baseUrl}${OPERATOR_HELPER_LEADER_STATE_PATH}` +
        "?port=%2Fdev%2Fserial%2Fby-id%2Fgeneric-arm&side=both&motor_ids=1%2C2%2C3%2C4%2C5%2C6&motor_model=sts3215&calibration_category=teleoperators&calibration_profile=so100_leader&calibration_id=my_leader&calibration_group=all",
    );
    expect(state.joints.leader_axis_1?.positionRad).toBe(
      TEST_LEADER_STATE_FIXTURE.jointPositionRad,
    );
  });
});
