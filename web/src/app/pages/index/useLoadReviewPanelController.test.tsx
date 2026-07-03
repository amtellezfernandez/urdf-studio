/** @vitest-environment jsdom */
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildLoadReviewKey,
  useLoadReviewPanelController,
} from "@/app/pages/index/useLoadReviewPanelController";

type HarnessProps = {
  activeUrdfPath?: string | null;
  attention: boolean;
  calls: boolean[];
  file: File;
  hasLoadedFiles?: boolean;
  initiallyOpen?: boolean;
};

const createFile = (name: string, lastModified: number): File =>
  new File(["<robot />"], name, {
    lastModified,
    type: "application/xml",
  });

const Harness = ({
  activeUrdfPath = "robot.urdf",
  attention,
  calls,
  file,
  hasLoadedFiles = true,
  initiallyOpen = false,
}: HarnessProps) => {
  const [showLoadIssues, setShowLoadIssuesState] = useState(initiallyOpen);
  useLoadReviewPanelController({
    activeUrdfPath,
    hasLoadedFiles,
    hasLoadReviewAttention: attention,
    setShowLoadIssues: (open) => {
      calls.push(open);
      setShowLoadIssuesState(open);
    },
    showLoadIssues,
    urdfFile: file,
  });
  return null;
};

describe("useLoadReviewPanelController", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("builds a stable key from path and file identity", () => {
    expect(
      buildLoadReviewKey({
        activeUrdfPath: "robots/arm.urdf",
        urdfFile: createFile("arm.urdf", 123),
      })
    ).toBe("robots/arm.urdf::arm.urdf::123");
  });

  it("auto-opens once for the same loaded file with attention", async () => {
    const calls: boolean[] = [];
    const file = createFile("robot.urdf", 10);
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness, { attention: true, calls, file }));
    });
    await act(async () => {
      root.render(createElement(Harness, { attention: true, calls, file }));
    });

    expect(calls).toEqual([true]);

    await act(async () => {
      root.unmount();
    });
  });

  it("auto-closes when a loaded file no longer needs attention", async () => {
    const calls: boolean[] = [];
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(Harness, {
          attention: false,
          calls,
          file: createFile("clean.urdf", 20),
          initiallyOpen: true,
        })
      );
    });

    expect(calls).toEqual([false]);

    await act(async () => {
      root.unmount();
    });
  });
});
