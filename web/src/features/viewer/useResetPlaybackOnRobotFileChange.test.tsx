/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useResetPlaybackOnRobotFileChange,
  type UseResetPlaybackOnRobotFileChangeOptions,
} from "@/features/viewer/useResetPlaybackOnRobotFileChange";

const flushAsyncWork = async () => {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
};

const renderResetPlaybackHook = async (
  initialOptions: UseResetPlaybackOnRobotFileChangeOptions
) => {
  let currentOptions = initialOptions;
  const container = document.createElement("div");
  const root: Root = createRoot(container);

  const Harness = () => {
    useResetPlaybackOnRobotFileChange(currentOptions);
    return null;
  };

  const render = async () => {
    await act(async () => {
      root.render(createElement(Harness));
      await flushAsyncWork();
    });
  };

  await render();

  return {
    rerender: async (options: Partial<UseResetPlaybackOnRobotFileChangeOptions>) => {
      currentOptions = {
        ...currentOptions,
        ...options,
      };
      await render();
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
};

describe("useResetPlaybackOnRobotFileChange", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("resets playback on first mount and whenever the loaded robot file changes", async () => {
    const resetPlayback = vi.fn();
    const firstRobotFile = new File(["<robot name='a' />"], "a.urdf", {
      type: "application/xml",
    });
    const secondRobotFile = new File(["<robot name='b' />"], "b.urdf", {
      type: "application/xml",
    });

    const harness = await renderResetPlaybackHook({
      resetPlayback,
      robotFile: null,
    });

    expect(resetPlayback).toHaveBeenCalledTimes(1);

    await harness.rerender({ robotFile: null });
    expect(resetPlayback).toHaveBeenCalledTimes(1);

    await harness.rerender({ robotFile: firstRobotFile });
    expect(resetPlayback).toHaveBeenCalledTimes(2);

    await harness.rerender({ robotFile: firstRobotFile });
    expect(resetPlayback).toHaveBeenCalledTimes(2);

    await harness.rerender({ robotFile: secondRobotFile });
    expect(resetPlayback).toHaveBeenCalledTimes(3);

    await harness.unmount();
  });

  it("does not reset when only the reset callback identity changes", async () => {
    const firstResetPlayback = vi.fn();
    const secondResetPlayback = vi.fn();
    const robotFile = new File(["<robot name='a' />"], "a.urdf", {
      type: "application/xml",
    });

    const harness = await renderResetPlaybackHook({
      resetPlayback: firstResetPlayback,
      robotFile,
    });

    expect(firstResetPlayback).toHaveBeenCalledTimes(1);

    await harness.rerender({ resetPlayback: secondResetPlayback });

    expect(firstResetPlayback).toHaveBeenCalledTimes(1);
    expect(secondResetPlayback).not.toHaveBeenCalled();

    const nextRobotFile = new File(["<robot name='b' />"], "b.urdf", {
      type: "application/xml",
    });
    await harness.rerender({ robotFile: nextRobotFile });

    expect(secondResetPlayback).toHaveBeenCalledTimes(1);

    await harness.unmount();
  });
});
