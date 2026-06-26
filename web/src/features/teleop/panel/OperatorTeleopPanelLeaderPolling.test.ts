// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OperatorTeleopPanel } from "@/features/teleop/panel/OperatorTeleopPanel";
import {
  OPERATOR_LEADER_TELEOP_UNAVAILABLE_STATUS,
  useOperatorLeaderTeleopStore,
} from "@/features/teleop/operator-control/operatorLeaderTeleopStore";
import { OPERATOR_LEADER_STATE_POLL_INTERVAL_MS } from "@/features/teleop/params/operatorTeleopParams";
import { useOperatorPerceptionStore } from "@/features/teleop/perception/operatorPerceptionStore";
import { useJointStore } from "@/shared/store/useJointStore";
import {
  TEST_ELBOW_MOTOR_ID,
  TEST_OPENARM_LEADER_TELEMETRY,
  TEST_PROVIDER_MANIFEST,
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

const LEADER_POLLING_TEST_PARAMS = {
  inFlightGuardTickCount: 5,
} as const;

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
  useOperatorPerceptionStore.getState().clearActiveJointTelemetry();
  useOperatorPerceptionStore.getState().clearActiveLeaderJointTelemetry();
  useOperatorLeaderTeleopStore
    .getState()
    .setLeaderTeleopStatus(OPERATOR_LEADER_TELEOP_UNAVAILABLE_STATUS);
  useOperatorLeaderTeleopStore
    .getState()
    .setLeaderTeleopViewerModeActive(false);
  useOperatorLeaderTeleopStore
    .getState()
    .setLocalLeaderAssigned(false);
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

describe("OperatorTeleopPanel leader polling", () => {
  it("does not queue leader-state reads while a slow read is in flight", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const testLeaderMotorIds = [TEST_ELBOW_MOTOR_ID, TEST_SHOULDER_MOTOR_ID];
    const testTargetJointNames = ["arm_shoulder_pan", "arm_elbow_flex"];
    useJointStore.getState().setAvailableJoints(testTargetJointNames);

    let resolveFirstLeaderState:
      | ((response: Response) => void)
      | null = null;
    let shouldHoldLeaderStateResponse = true;
    const buildLeaderStateResponse = () =>
      new Response(
        JSON.stringify({
          connected: true,
          port: "/dev/ttyACM0",
          side: "both",
          source_ts_ms: Date.now(),
          joints: {
            shoulder_pan: {
              position_rad: TEST_OPENARM_LEADER_TELEMETRY.positionRad,
              motor_id: TEST_SHOULDER_MOTOR_ID,
            },
            elbow_flex: {
              position_rad: TEST_OPENARM_LEADER_TELEMETRY.positionRad,
              motor_id: TEST_ELBOW_MOTOR_ID,
            },
          },
          error: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const fetchMock: typeof fetch = vi.fn((input) => {
      const url = String(input);
      if (url.includes("urdf-studio-teleop")) {
        return Promise.resolve(
          new Response(JSON.stringify(TEST_PROVIDER_MANIFEST), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.endsWith("/session")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              state: "active",
              current_session_id: "operator-session-1",
              robot_id: "openarm",
              mode: "manual",
              runtime_mode: "observe",
              control_lease_owner: null,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.endsWith("/stats")) {
        return Promise.resolve(
          new Response(
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
          ),
        );
      }
      if (url.endsWith("/hardware/leaders")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              leaders: [
                {
                  id: "test-leader",
                  path: "/dev/ttyACM0",
                  device_path: "/dev/ttyACM0",
                  identity_key: "path:ttyACM0",
                  identity_stable: false,
                  source: "tty_glob",
                  available: true,
                  leader_type: "serial_leader_candidate",
                  hardware_family: "arm_controller",
                  motor_bus: "feetech",
                  motor_ids: testLeaderMotorIds,
                  motor_count: testLeaderMotorIds.length,
                  control_parts: [
                    {
                      id: "feetech:test-leader",
                      kind: "arm",
                      label: "Arm",
                      actuator_count: testLeaderMotorIds.length,
                      motor_bus: "feetech",
                      motor_ids: testLeaderMotorIds,
                      motor_model: "sts3215",
                      joint_names: ["shoulder_pan", "elbow_flex"],
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
          ),
        );
      }
      if (url.includes("/hardware/leader-state")) {
        if (!shouldHoldLeaderStateResponse) {
          return Promise.resolve(buildLeaderStateResponse());
        }
        shouldHoldLeaderStateResponse = false;
        return new Promise<Response>((resolve) => {
          resolveFirstLeaderState = resolve;
        });
      }
      if (url.endsWith("/hardware/leaders/release")) {
        return Promise.resolve(
          new Response(JSON.stringify({ released: 1 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    useOperatorLeaderTeleopStore
      .getState()
      .setLeaderTeleopViewerModeActive(true);

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

    const connectLeaderButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Connect",
    );
    expect(connectLeaderButton?.disabled).toBe(false);
    await act(async () => {
      connectLeaderButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    const countLeaderStateCalls = () =>
      vi
        .mocked(fetchMock)
        .mock.calls.filter((call) =>
          String(call[0]).includes("/hardware/leader-state"),
        ).length;
    expect(countLeaderStateCalls()).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(
        OPERATOR_LEADER_STATE_POLL_INTERVAL_MS *
          LEADER_POLLING_TEST_PARAMS.inFlightGuardTickCount,
      );
      await flushMicrotasks();
    });
    expect(countLeaderStateCalls()).toBe(1);

    await act(async () => {
      resolveFirstLeaderState?.(buildLeaderStateResponse());
      await flushMicrotasks();
      await flushMicrotasks();
    });
    await act(async () => {
      vi.advanceTimersByTime(OPERATOR_LEADER_STATE_POLL_INTERVAL_MS);
      await flushMicrotasks();
    });
    expect(countLeaderStateCalls()).toBe(2);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
