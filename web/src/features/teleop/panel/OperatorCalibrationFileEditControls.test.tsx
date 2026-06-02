// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { OperatorCalibrationFileEditControls } from "@/features/teleop/panel/OperatorCalibrationFileEditControls";
import type { OperatorCalibrationFileEditMotionRow } from "@/features/teleop/panel/OperatorCalibrationFileEditControls";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const buildMotionRows = ({
  shoulderPanRad,
  elbowFlexRad,
}: {
  shoulderPanRad: number;
  elbowFlexRad: number;
}): OperatorCalibrationFileEditMotionRow[] => [
  {
    jointName: "wrist_roll",
    motorId: 5,
    positionRad: 0,
    targetJointName: "arm_wrist_roll",
  },
  {
    jointName: "shoulder_pan",
    motorId: 1,
    positionRad: shoulderPanRad,
    targetJointName: "arm_shoulder_pan",
  },
  {
    jointName: "elbow_flex",
    motorId: 3,
    positionRad: elbowFlexRad,
    targetJointName: "arm_elbow_flex",
  },
];

describe("OperatorCalibrationFileEditControls", () => {
  it("orders motor rows by motor id", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(OperatorCalibrationFileEditControls, {
          buttonClassName: "button",
          message: null,
          jointCount: 3,
          busy: false,
          motionRows: buildMotionRows({
            shoulderPanRad: 0,
            elbowFlexRad: 0,
          }),
          onOpenFile: vi.fn(),
          onCancel: vi.fn(),
        }),
      );
    });

    const bodyRows = Array.from(container.querySelectorAll("tbody tr"));
    expect(
      bodyRows.map(
        (row) =>
          row.querySelector('[aria-label^="Motor ID for"]')?.textContent,
      ),
    ).toEqual(["1", "3", "5"]);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("highlights the motor row with the largest recent movement", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const commonProps = {
      buttonClassName: "button",
      message: null,
      jointCount: 2,
      busy: false,
      onOpenFile: vi.fn(),
      onCancel: vi.fn(),
    };

    await act(async () => {
      root.render(
        createElement(OperatorCalibrationFileEditControls, {
          ...commonProps,
          motionRows: buildMotionRows({
            shoulderPanRad: 0,
            elbowFlexRad: 0,
          }),
        }),
      );
    });

    await act(async () => {
      root.render(
        createElement(OperatorCalibrationFileEditControls, {
          ...commonProps,
          motionRows: buildMotionRows({
            shoulderPanRad: 0.01,
            elbowFlexRad: 0.2,
          }),
        }),
      );
    });

    const movingRow = container.querySelector('tr[data-moving-most="true"]');
    expect(movingRow?.textContent).toContain("elbow_flex");
    expect(movingRow?.textContent).toContain("arm_elbow_flex");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("shows motor ids as read-only text", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(OperatorCalibrationFileEditControls, {
          buttonClassName: "button",
          message: null,
          jointCount: 2,
          busy: false,
          motionRows: buildMotionRows({
            shoulderPanRad: 0,
            elbowFlexRad: 0,
          }),
          onOpenFile: vi.fn(),
          onCancel: vi.fn(),
        }),
      );
    });

    expect(container.querySelector('input[aria-label^="Motor ID for"]')).toBeNull();
    expect(
      container.querySelector('[aria-label="Motor ID for elbow_flex"]')?.textContent,
    ).toBe("3");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
