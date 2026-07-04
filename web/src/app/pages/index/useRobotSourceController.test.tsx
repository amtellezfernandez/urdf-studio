/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CORE_FOLDER_UPLOAD_SCREEN_PARAMS } from "@/app/pages/index/coreFolderUploadScreenState";
import type { SourceEntryActions } from "@/app/pages/index/sourceEntryTypes";
import { useRobotSourceController } from "@/app/pages/index/useRobotSourceController";

const { toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

type HookResult = ReturnType<typeof useRobotSourceController>;

type RenderedHarness = {
  getHook: () => HookResult;
  onFolderSelectedMock: ReturnType<typeof vi.fn>;
  onGitHubSelectedMock: ReturnType<typeof vi.fn>;
  onUrlSelectedMock: ReturnType<typeof vi.fn>;
  unmount: () => Promise<void>;
};

const ROBOT_SOURCE_CONTROLLER_TEST_FIXTURES = {
  githubRepoUrl: "https://github.com/acme/robot",
  githubUrdfPath: "robots/arm/robot.urdf",
  localRobotSourceLabel: "robot_pkg",
  remoteRobotUrl: "https://example.test/robot.urdf",
} as const;

const flushAsyncWork = async () => {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
};

const createFile = ({
  content = "<robot name='demo' />",
  name,
  relativePath,
}: {
  content?: string;
  name: string;
  relativePath?: string;
}): File => {
  const file = new File([content], name);
  if (relativePath) {
    Object.defineProperty(file, "webkitRelativePath", {
      configurable: true,
      enumerable: true,
      value: relativePath,
      writable: false,
    });
  }
  return file;
};

const renderRobotSourceController = async ({
  shouldPreserveCameras = () => false,
}: {
  shouldPreserveCameras?: () => boolean;
} = {}): Promise<RenderedHarness> => {
  let hookValue: HookResult | null = null;
  const root: Root = createRoot(document.createElement("div"));
  const onFolderSelectedMock = vi.fn(async () => undefined);
  const onGitHubSelectedMock = vi.fn(async () => undefined);
  const onUrlSelectedMock = vi.fn(async () => undefined);

  const Harness = () => {
    hookValue = useRobotSourceController({
      onFolderSelected: onFolderSelectedMock as SourceEntryActions["onFolderSelected"],
      onGitHubSelected: onGitHubSelectedMock as SourceEntryActions["onGitHubSelected"],
      onUrlSelected: onUrlSelectedMock as SourceEntryActions["onUrlSelected"],
      shouldPreserveCameras,
    });
    return null;
  };

  await act(async () => {
    root.render(createElement(Harness));
    await flushAsyncWork();
  });

  return {
    getHook: () => {
      if (!hookValue) {
        throw new Error("Hook did not render.");
      }
      return hookValue;
    },
    onFolderSelectedMock,
    onGitHubSelectedMock,
    onUrlSelectedMock,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
};

describe("useRobotSourceController", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
  });

  it("stages local robot files and preserves cameras when loading", async () => {
    const harness = await renderRobotSourceController({ shouldPreserveCameras: () => true });
    const urdfFile = createFile({
      name: "robot.urdf",
      relativePath: `${ROBOT_SOURCE_CONTROLLER_TEST_FIXTURES.localRobotSourceLabel}/robot.urdf`,
    });

    await act(async () => {
      harness.getHook().stageLocalRobotFiles([urdfFile]);
    });

    expect(harness.getHook().stagedRobot?.label).toBe(
      ROBOT_SOURCE_CONTROLLER_TEST_FIXTURES.localRobotSourceLabel
    );
    expect(harness.getHook().lastLocalFolder).toBe(
      ROBOT_SOURCE_CONTROLLER_TEST_FIXTURES.localRobotSourceLabel
    );
    expect(
      localStorage.getItem(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalRobotSourceStorageKey)
    ).toBe(ROBOT_SOURCE_CONTROLLER_TEST_FIXTURES.localRobotSourceLabel);
    expect(toastSuccessMock).toHaveBeenCalledWith(
      `Selected ${ROBOT_SOURCE_CONTROLLER_TEST_FIXTURES.localRobotSourceLabel} for setup.`
    );

    await act(async () => {
      await harness.getHook().loadStagedRobot();
    });

    expect(harness.onFolderSelectedMock).toHaveBeenCalledWith([urdfFile], {
      preserveCameras: true,
    });
    expect(harness.getHook().loadedRobotName).toBe(
      ROBOT_SOURCE_CONTROLLER_TEST_FIXTURES.localRobotSourceLabel
    );
    expect(harness.getHook().stagedRobot).toBeNull();

    await harness.unmount();
  });

  it("stages a GitHub robot source and loads it on demand", async () => {
    const harness = await renderRobotSourceController();

    await act(async () => {
      harness.getHook().setGithubUrl(` ${ROBOT_SOURCE_CONTROLLER_TEST_FIXTURES.githubRepoUrl} `);
      harness
        .getHook()
        .setGithubUrdfPath(` ${ROBOT_SOURCE_CONTROLLER_TEST_FIXTURES.githubUrdfPath} `);
      await flushAsyncWork();
    });
    await act(async () => {
      harness.getHook().stageGithubRobot();
      await flushAsyncWork();
    });

    expect(harness.getHook().stagedRobot?.label).toBe("robot.urdf");
    expect(harness.onGitHubSelectedMock).not.toHaveBeenCalled();

    await act(async () => {
      await harness.getHook().loadStagedRobot();
    });

    expect(harness.onGitHubSelectedMock).toHaveBeenCalledWith({
      repoUrl: ROBOT_SOURCE_CONTROLLER_TEST_FIXTURES.githubRepoUrl,
      urdfPath: ROBOT_SOURCE_CONTROLLER_TEST_FIXTURES.githubUrdfPath,
    });
    expect(harness.getHook().loadedRobotName).toBe("robot.urdf");

    await harness.unmount();
  });

  it("rejects an empty remote robot URL without staging", async () => {
    const harness = await renderRobotSourceController();

    await act(async () => {
      harness.getHook().stageUrlRobot();
    });

    expect(harness.getHook().stagedRobot).toBeNull();
    expect(harness.onUrlSelectedMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Paste a URDF, Xacro, Hugging Face, or raw URL first."
    );

    await harness.unmount();
  });
});
