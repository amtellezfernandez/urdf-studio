/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIluCalibrationFocus } from "@/app/pages/index/useIluCalibrationFocus";

const { toast } = vi.hoisted(() => ({
  toast: {
    info: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast,
}));

describe("useIluCalibrationFocus", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    toast.info.mockClear();
  });

  it("applies the focused joint once after the ILU session finishes attaching", async () => {
    const setSelectedJoint = vi.fn();
    const setSelectedLink = vi.fn();

    const Harness = ({ isAttaching }: { isAttaching: boolean }) => {
      useIluCalibrationFocus({
        availableJoints: ["base_joint", "mount_joint"],
        calibrate: true,
        focusJoint: "mount_joint",
        isAttachingIluSession: isAttaching,
        setSelectedJoint,
        setSelectedLink,
      });
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness, { isAttaching: true }));
    });

    expect(setSelectedJoint).not.toHaveBeenCalled();
    expect(setSelectedLink).not.toHaveBeenCalled();

    await act(async () => {
      root.render(createElement(Harness, { isAttaching: false }));
    });

    expect(setSelectedLink).toHaveBeenCalledWith(null);
    expect(setSelectedJoint).toHaveBeenCalledWith("mount_joint");
    expect(toast.info).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(createElement(Harness, { isAttaching: false }));
    });

    expect(setSelectedJoint).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});
