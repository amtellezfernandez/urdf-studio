/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import { useIndexPageParams } from "@/app/pages/index/useIndexPageParams";

describe("useIndexPageParams", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState({}, "", "/");
  });

  it("parses ilu calibration query params", async () => {
    window.history.replaceState(
      {},
      "",
      "/?ilu_session=session-42&ilu_focus_joint=mount_joint&ilu_calibrate=1"
    );

    let captured:
      | ReturnType<typeof useIndexPageParams>
      | null = null;

    const Harness = () => {
      captured = useIndexPageParams();
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
    });

    expect(captured?.iluSessionParam).toBe("session-42");
    expect(captured?.iluFocusJointParam).toBe("mount_joint");
    expect(captured?.iluCalibrateParam).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("defaults ilu calibration query params when they are absent", async () => {
    let captured:
      | ReturnType<typeof useIndexPageParams>
      | null = null;

    const Harness = () => {
      captured = useIndexPageParams();
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
    });

    expect(captured?.iluSessionParam).toBe("");
    expect(captured?.iluFocusJointParam).toBe("");
    expect(captured?.iluCalibrateParam).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });
});
