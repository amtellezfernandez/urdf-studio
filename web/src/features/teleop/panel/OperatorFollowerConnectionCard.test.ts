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
    expect(container.textContent).toContain("Gateway env");
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
});
