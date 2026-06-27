// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { OperatorFollowerConnectionCard } from "@/features/teleop/panel/OperatorFollowerConnectionCard";
import { formatOperatorFollowerEnvConfigRef } from "@/features/teleop/panel/operatorFollowerEnvConfig";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const createInactiveCalibrationFileEditView = () => ({
  available: true,
  disabled: true,
  active: false,
  busy: false,
  message: null,
  jointCount: 0,
  motionRows: [],
  onStart: vi.fn(),
  onOpenFile: vi.fn(),
  onCancel: vi.fn(),
});

describe("OperatorFollowerConnectionCard", () => {
  it("formats active env config paths for the compact follower card", () => {
    expect(formatOperatorFollowerEnvConfigRef(null)).toBe("Process env");
    expect(
      formatOperatorFollowerEnvConfigRef("/workspace/.env.robot.local"),
    ).toBe(".env.robot.local");
    expect(
      formatOperatorFollowerEnvConfigRef(
        "/workspace/.env.robots/so100-left-1.env",
      ),
    ).toBe(".env.robots/so100-left-1.env");
  });

  it("shows LeRobot calibration without requiring an active connection", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const startCalibration = vi.fn();

    await act(async () => {
      root.render(
        createElement(OperatorFollowerConnectionCard, {
          buttonClassName: "button",
          calibration: {
            available: true,
            command: null,
            isStarting: false,
            message: null,
            required: false,
            onStart: startCalibration,
          },
          calibrationFileEdit: createInactiveCalibrationFileEditView(),
          calibrationSourceSelection: {
            error: null,
            options: [
              {
                id: "robots:so100_follower:so100-left-1:all",
                label: "so100_follower · so100-left-1",
                optionLabel: "so100_follower · so100-left-1 (Recommended)",
                detailLines: ["robots · 6 motors"],
                compatibility: "recommended",
                compatibilityLabel: "Recommended",
                source: {
                  category: "robots",
                  profileId: "so100_follower",
                  calibrationId: "so100-left-1",
                  calibrationDir: "/calibrations/robots/so100_follower",
                  groupId: "all",
                },
              },
            ],
            selectedSourceId: "robots:so100_follower:so100-left-1:all",
            showAll: false,
            onSelectSource: vi.fn(),
            onToggleShowAll: vi.fn(),
          },
          camera: {
            count: 1,
            selectedLabel: "OpenArm depth camera",
            statusLabel: "Camera detected.",
            detailLines: ["1 camera advertised by gateway.", "robot_world, 640x480"],
          },
          connection: {
            connectDisabled: false,
            issue: null,
            isBusy: false,
            isConnected: false,
            isDisconnectAvailable: false,
            motionReady: false,
            motionSafetyLabel: "LeRobot state read failed: port is in use",
            onToggleConnection: vi.fn(),
          },
          envConfig: {
            configRef: "/workspace/.env.robot.local",
            error: null,
            isOpening: false,
            onOpen: vi.fn(),
          },
          targetSelection: {
            disabled: false,
            selectedProfileId: "so100_follower_joint_jog",
            onSelectProfile: vi.fn(),
            options: [
              {
                profileId: "so100_follower_joint_jog",
                deviceKey: "/dev/serial/by-id/so100",
                label: "Arm",
                optionLabel: "Arm",
                detailLines: ["Port: /dev/serial/by-id/so100", "6 joints"],
                assignedRole: null,
                status: "available",
                statusLabel: "available",
              },
            ],
          },
        }),
      );
    });

    expect(container.textContent).toContain(
      "LeRobot will ask to use or redo calibration.",
    );
    expect(container.textContent).toContain("Recommended");
    expect(container.textContent).toContain("OpenArm depth camera · 1 camera");
    expect(container.textContent).toContain("so100_follower");
    expect(container.textContent).toContain(".env.robot.local");
    expect(container.textContent).not.toContain("Remote");
    const calibrateButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Calibrate",
    );
    expect(calibrateButton).toBeTruthy();

    await act(async () => {
      calibrateButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(startCalibration).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("shows scanned robot hardware targets and exposes rescan", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onScan = vi.fn();

    await act(async () => {
      root.render(
        createElement(OperatorFollowerConnectionCard, {
          buttonClassName: "button",
          calibration: {
            available: false,
            command: null,
            isStarting: false,
            message: null,
            required: false,
            onStart: vi.fn(),
          },
          calibrationFileEdit: createInactiveCalibrationFileEditView(),
          calibrationSourceSelection: {
            error: null,
            options: [],
            selectedSourceId: null,
            showAll: false,
            onSelectSource: vi.fn(),
            onToggleShowAll: vi.fn(),
          },
          connection: {
            connectDisabled: true,
            issue: null,
            isBusy: false,
            isConnected: false,
            isDisconnectAvailable: false,
            motionReady: false,
            motionSafetyLabel: "Motion safety not ready",
            onToggleConnection: vi.fn(),
          },
          envConfig: {
            configRef: null,
            error: null,
            isOpening: false,
            onOpen: vi.fn(),
          },
          hardwareDetection: {
            requested: true,
            resolved: true,
            error: null,
            targets: [
              {
                id: "robot-left",
                label: "openarm_follower · my_follower_left · all",
                detailLines: [
                  "Port: /dev/serial/by-id/openarm-left",
                  "8 actuators",
                ],
              },
            ],
            onScan,
          },
          targetSelection: {
            disabled: false,
            selectedProfileId: "detected:bi_openarm_follower:my_follower",
            onSelectProfile: vi.fn(),
            options: [
              {
                profileId: "detected:bi_openarm_follower:my_follower",
                deviceKey: "/dev/serial/by-id/openarm-left|/dev/serial/by-id/openarm-right",
                label: "bi_openarm_follower · my_follower",
                optionLabel: "bi_openarm_follower · my_follower",
                detailLines: [
                  "Left: /dev/serial/by-id/openarm-left",
                  "Right: /dev/serial/by-id/openarm-right",
                ],
                assignedRole: null,
                status: "available",
                statusLabel: "setup",
                setupOnly: true,
                robotType: "bi_openarm_follower",
              },
            ],
          },
        }),
      );
    });

    expect(container.textContent).toContain("Detected targets");
    expect(container.textContent).toContain("1 detected");
    expect(container.textContent).toContain(
      "openarm_follower · my_follower_left · all",
    );
    expect(container.textContent).toContain("Setup");
    expect(container.textContent).toContain("bi_openarm_follower · my_follower");
    expect(container.textContent).toContain("/dev/serial/by-id/openarm-left");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "Use target",
      ),
    ).toBe(true);

    const rescanButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Rescan",
    );
    await act(async () => {
      rescanButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onScan).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("labels detected setup application without showing robot connection state", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(OperatorFollowerConnectionCard, {
          buttonClassName: "button",
          calibration: {
            available: false,
            command: null,
            isStarting: false,
            message: null,
            required: false,
            onStart: vi.fn(),
          },
          calibrationFileEdit: createInactiveCalibrationFileEditView(),
          calibrationSourceSelection: {
            error: null,
            options: [],
            selectedSourceId: null,
            showAll: false,
            onSelectSource: vi.fn(),
            onToggleShowAll: vi.fn(),
          },
          connection: {
            connectDisabled: true,
            issue: null,
            isBusy: true,
            isConnected: false,
            isDisconnectAvailable: false,
            motionReady: false,
            motionSafetyLabel: "Motion safety not ready",
            onToggleConnection: vi.fn(),
          },
          envConfig: {
            configRef: "/workspace/.env.robot.local",
            error: null,
            isOpening: false,
            onOpen: vi.fn(),
          },
          targetSelection: {
            disabled: false,
            selectedProfileId: "detected:bi_openarm_follower:my_follower",
            onSelectProfile: vi.fn(),
            options: [
              {
                profileId: "detected:bi_openarm_follower:my_follower",
                deviceKey: "/dev/serial/by-id/openarm-left|/dev/serial/by-id/openarm-right",
                label: "bi_openarm_follower · my_follower",
                optionLabel: "bi_openarm_follower · my_follower",
                detailLines: [
                  "Left: /dev/serial/by-id/openarm-left",
                  "Right: /dev/serial/by-id/openarm-right",
                ],
                assignedRole: null,
                status: "available",
                statusLabel: "setup",
                setupOnly: true,
                robotType: "bi_openarm_follower",
              },
            ],
          },
        }),
      );
    });

    expect(container.textContent).toContain("Applying");
    expect(container.textContent).not.toContain("Connecting");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("shows the follower calibration result message", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(OperatorFollowerConnectionCard, {
          buttonClassName: "button",
          calibration: {
            available: true,
            command: "lerobot-calibrate --robot.type=so100_follower",
            isStarting: false,
            message: "Open a terminal on the robot gateway machine and run this command.",
            required: true,
            onStart: vi.fn(),
          },
          calibrationFileEdit: createInactiveCalibrationFileEditView(),
          calibrationSourceSelection: {
            error: null,
            options: [],
            selectedSourceId: null,
            showAll: false,
            onSelectSource: vi.fn(),
            onToggleShowAll: vi.fn(),
          },
          connection: {
            connectDisabled: false,
            issue: null,
            isBusy: false,
            isConnected: false,
            isDisconnectAvailable: false,
            motionReady: false,
            motionSafetyLabel: "Motion safety not ready",
            onToggleConnection: vi.fn(),
          },
          envConfig: {
            configRef: "/workspace/.env.robot.local",
            error: null,
            isOpening: false,
            onOpen: vi.fn(),
          },
          targetSelection: {
            disabled: false,
            selectedProfileId: "so100_follower_joint_jog",
            onSelectProfile: vi.fn(),
            options: [
              {
                profileId: "so100_follower_joint_jog",
                deviceKey: "/dev/serial/by-id/so100",
                label: "Arm",
                optionLabel: "Arm",
                detailLines: ["Port: /dev/serial/by-id/so100", "6 joints"],
                assignedRole: null,
                status: "available",
                statusLabel: "available",
              },
            ],
          },
        }),
      );
    });

    expect(container.textContent).toContain(
      "Open a terminal on the robot gateway machine and run this command.",
    );
    expect(container.textContent).toContain(
      "lerobot-calibrate --robot.type=so100_follower",
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("shows LeRobot direct teleop runtime details", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(OperatorFollowerConnectionCard, {
          buttonClassName: "button",
          calibration: {
            available: false,
            command: null,
            isStarting: false,
            message: null,
            required: false,
            onStart: vi.fn(),
          },
          calibrationFileEdit: createInactiveCalibrationFileEditView(),
          calibrationSourceSelection: {
            error: null,
            options: [],
            selectedSourceId: null,
            showAll: false,
            onSelectSource: vi.fn(),
            onToggleShowAll: vi.fn(),
          },
          connection: {
            connectDisabled: false,
            issue: null,
            isBusy: false,
            isConnected: true,
            isDisconnectAvailable: true,
            motionReady: true,
            motionSafetyLabel: "Motion ready",
            onToggleConnection: vi.fn(),
          },
          directTeleop: {
            available: true,
            busy: false,
            disabled: false,
            issue: null,
            running: true,
            statusLabel: "LeRobot direct running.",
            detailLines: [
              "State: running",
              "Follower: so100_follower",
              "Leader: so100_leader · blue",
              "PID: 4200",
              "Command: lerobot-teleoperate --robot.type=so100_follower",
            ],
            onStart: vi.fn(),
            onStop: vi.fn(),
          },
          envConfig: {
            configRef: null,
            error: null,
            isOpening: false,
            onOpen: vi.fn(),
          },
          targetSelection: {
            disabled: false,
            selectedProfileId: "so100_follower_joint_jog",
            onSelectProfile: vi.fn(),
            options: [],
          },
        }),
      );
    });

    expect(container.textContent).toContain("LeRobot direct running.");
    expect(container.textContent).toContain("Follower: so100_follower");
    expect(container.textContent).toContain("Leader: so100_leader · blue");
    expect(container.textContent).toContain("PID: 4200");
    expect(container.textContent).toContain(
      "Command: lerobot-teleoperate --robot.type=so100_follower",
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
