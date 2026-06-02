/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEpisode } from "@/features/dataset";
import { createDemoEpisodes } from "@/shared/samples/demoMotion";
import { useDemoMotionFlow } from "@/app/pages/index/useDemoMotionFlow";

const playEpisodeSpy = vi.fn();
const toastErrorSpy = vi.fn();
const toastInfoSpy = vi.fn();
const loadDemoFileListFromManifestUrlsSpy = vi.fn();
const loadDemoFileListProgressivelyFromManifestUrlsSpy = vi.fn();

vi.mock("@/shared/config/demo", () => ({
  DEMO_AUTOLOAD: false,
  DEMO_LOCAL_MANIFEST_URL: "/demo/local-manifest.json",
  DEMO_MANIFEST_URL: "/demo/manifest.json",
  DEMO_MODE: false,
}));

vi.mock("@/shared/samples/demoMotion", () => ({
  createDemoEpisodes: vi.fn(),
}));

vi.mock("@/app/pages/index/demoBootstrap", () => ({
  loadDemoFileListFromManifestUrls: (...args: unknown[]) =>
    loadDemoFileListFromManifestUrlsSpy(...args),
  loadDemoFileListProgressivelyFromManifestUrls: (...args: unknown[]) =>
    loadDemoFileListProgressivelyFromManifestUrlsSpy(...args),
}));

vi.mock("@/features/viewer/playback/viewerPlayback", () => ({
  viewerPlayback: {
    playEpisode: (...args: unknown[]) => playEpisodeSpy(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorSpy(...args),
    info: (...args: unknown[]) => toastInfoSpy(...args),
  },
}));

type HookResult = ReturnType<typeof useDemoMotionFlow>;
type HookOptions = Parameters<typeof useDemoMotionFlow>[0];

describe("useDemoMotionFlow", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    playEpisodeSpy.mockReset();
    toastErrorSpy.mockReset();
    toastInfoSpy.mockReset();
    loadDemoFileListFromManifestUrlsSpy.mockReset();
    loadDemoFileListProgressivelyFromManifestUrlsSpy.mockReset();
  });

  it("loads demo episodes into the replay viewer without starting playback on first launch", async () => {
    const demoEpisode = createEpisode(
      "demo-pickup",
      1,
      [
        { timestamp: 0, jointPositions: { joint_a: 0 } },
        { timestamp: 100, jointPositions: { joint_a: 0.5 } },
      ],
      {
        joint_names: ["joint_a"],
        source: "demo",
      }
    );
    vi.mocked(createDemoEpisodes).mockReturnValue([demoEpisode]);

    const loadDemoEpisodes = vi.fn();
    const setViewerEpisode = vi.fn();
    const setIsViewerOpen = vi.fn();
    const optionsRef: { current: HookOptions } = {
      current: {
        activeUrdfPath: null,
        availableJoints: ["joint_a"],
        datasetActions: {
          loadDemoEpisodes,
        } as never,
        hasLoadedFiles: true,
        isLeKiwiDemoRobot: false,
        jointLimits: {
          joint_a: { type: "revolute", lower: -1, upper: 1 },
        },
        loadFilesFromFolderWithFreshCameras: vi.fn(),
        playbackHandlers: {
          playEpisode: vi.fn(),
        },
        prepareDemoScene: vi.fn(() => true),
        robot: null,
        setIsViewerOpen,
        setViewerEpisode,
        skipDefaultWorldLayoutAutoImportRef: {
          current: false,
        },
        urdfAnalysis: null,
      },
    };

    let hookValue: HookResult | null = null;
    const Harness = () => {
      hookValue = useDemoMotionFlow(optionsRef.current);
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      hookValue?.handlePlayDemoMotion();
    });

    expect(loadDemoEpisodes).toHaveBeenCalledWith([demoEpisode]);
    expect(setViewerEpisode).toHaveBeenCalledWith(demoEpisode);
    expect(setIsViewerOpen).toHaveBeenCalledWith(true);
    expect(playEpisodeSpy).toHaveBeenCalledTimes(1);
    expect(playEpisodeSpy.mock.calls[0]?.[1]).toEqual({
      autoplay: false,
      applyInitialFrame: false,
    });
    expect(toastErrorSpy).not.toHaveBeenCalled();

    await act(async () => {
      hookValue?.handlePlayDemoMotion();
    });

    expect(playEpisodeSpy).toHaveBeenCalledTimes(2);
    expect(playEpisodeSpy.mock.calls[1]?.[1]).toEqual({
      autoplay: true,
      applyInitialFrame: true,
    });
    expect(toastErrorSpy).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("loads bundled demo URDF before hydrating remaining manifest assets", async () => {
    const urdfFile = new File(["<robot name='lekiwi'/>"], "lekiwi.urdf", {
      type: "application/xml",
    });
    Object.defineProperty(urdfFile, "webkitRelativePath", {
      value: "lekiwi.urdf",
      enumerable: true,
      configurable: true,
    });
    const meshFile = new File(["solid base"], "base.stl", {
      type: "model/stl",
    });
    Object.defineProperty(meshFile, "webkitRelativePath", {
      value: "meshes/base.stl",
      enumerable: true,
      configurable: true,
    });
    const loadRemainingFileList = vi.fn(
      async () => [meshFile] as unknown as FileList
    );
    loadDemoFileListProgressivelyFromManifestUrlsSpy.mockResolvedValue({
      initialFileList: [urdfFile] as unknown as FileList,
      loadRemainingFileList,
    });

    const loadDemoUrdfTextWithFreshCameras = vi.fn();
    const hydrateDemoAssetsFromFiles = vi.fn(
      async (_files: FileList, _options?: { shouldApply?: () => boolean }) => true
    );
    const loadFilesFromFolderWithFreshCameras = vi.fn();
    const optionsRef: { current: HookOptions } = {
      current: {
        activeUrdfPath: "lekiwi.urdf",
        availableJoints: [],
        datasetActions: null,
        hasLoadedFiles: false,
        hydrateDemoAssetsFromFiles,
        isLeKiwiDemoRobot: false,
        jointLimits: {},
        loadDemoUrdfTextWithFreshCameras,
        loadFilesFromFolderWithFreshCameras,
        playbackHandlers: {},
        prepareDemoScene: vi.fn(() => true),
        robot: null,
        setIsViewerOpen: vi.fn(),
        setViewerEpisode: vi.fn(),
        skipDefaultWorldLayoutAutoImportRef: {
          current: false,
        },
        urdfAnalysis: null,
      },
    };

    let hookValue: HookResult | null = null;
    const Harness = () => {
      hookValue = useDemoMotionFlow(optionsRef.current);
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      await hookValue?.loadBundledDemoRobot();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadDemoFileListProgressivelyFromManifestUrlsSpy).toHaveBeenCalledOnce();
    expect(loadDemoFileListFromManifestUrlsSpy).not.toHaveBeenCalled();
    expect(loadFilesFromFolderWithFreshCameras).not.toHaveBeenCalled();
    expect(loadDemoUrdfTextWithFreshCameras).toHaveBeenCalledWith("<robot name='lekiwi'/>", {
      activePath: "lekiwi.urdf",
      filename: "lekiwi.urdf",
    });
    expect(loadRemainingFileList).toHaveBeenCalledOnce();
    expect(hydrateDemoAssetsFromFiles).toHaveBeenCalledWith([meshFile], {
      activePath: "lekiwi.urdf",
      shouldApply: expect.any(Function),
      urdfContent: "<robot name='lekiwi'/>",
    });
    const hydrateOptions = hydrateDemoAssetsFromFiles.mock.calls[0]?.[1] as
      | { shouldApply?: () => boolean }
      | undefined;
    expect(hydrateOptions?.shouldApply?.()).toBe(true);
    expect(
      loadDemoUrdfTextWithFreshCameras.mock.invocationCallOrder[0]
    ).toBeLessThan(hydrateDemoAssetsFromFiles.mock.invocationCallOrder[0]);

    await act(async () => {
      root.unmount();
    });
  });

  it("primes demo episodes on autoload without opening the viewer or starting playback", async () => {
    vi.resetModules();
    const demoEpisode = createEpisode(
      "demo-pickup",
      1,
      [
        { timestamp: 0, jointPositions: { joint_a: 0 } },
        { timestamp: 100, jointPositions: { joint_a: 0.5 } },
      ],
      {
        joint_names: ["joint_a"],
        source: "demo",
      }
    );
    const createDemoEpisodesMock = vi.fn(() => [demoEpisode]);
    vi.doMock("@/shared/config/demo", () => ({
      DEMO_AUTOLOAD: true,
      DEMO_LOCAL_MANIFEST_URL: "/demo/local-manifest.json",
      DEMO_MANIFEST_URL: "/demo/manifest.json",
      DEMO_MODE: true,
    }));
    vi.doMock("@/shared/samples/demoMotion", () => ({
      createDemoEpisodes: createDemoEpisodesMock,
    }));
    vi.doMock("@/features/viewer/playback/viewerPlayback", () => ({
      viewerPlayback: {
        playEpisode: (...args: unknown[]) => playEpisodeSpy(...args),
      },
    }));
    vi.doMock("sonner", () => ({
      toast: {
        error: (...args: unknown[]) => toastErrorSpy(...args),
        info: (...args: unknown[]) => toastInfoSpy(...args),
      },
    }));
    const { useDemoMotionFlow: useDemoMotionFlowWithAutoload } = await import(
      "@/app/pages/index/useDemoMotionFlow"
    );

    const loadDemoEpisodes = vi.fn();
    const setViewerEpisode = vi.fn();
    const setIsViewerOpen = vi.fn();
    const optionsRef: { current: HookOptions } = {
      current: {
        activeUrdfPath: null,
        availableJoints: ["joint_a"],
        datasetActions: {
          loadDemoEpisodes,
        } as never,
        hasLoadedFiles: true,
        isLeKiwiDemoRobot: false,
        jointLimits: {
          joint_a: { type: "revolute", lower: -1, upper: 1 },
        },
        loadFilesFromFolderWithFreshCameras: vi.fn(),
        playbackHandlers: {
          playEpisode: vi.fn(),
        },
        prepareDemoScene: vi.fn(() => true),
        robot: null,
        setIsViewerOpen,
        setViewerEpisode,
        skipDefaultWorldLayoutAutoImportRef: {
          current: false,
        },
        urdfAnalysis: null,
      },
    };

    const Harness = () => {
      useDemoMotionFlowWithAutoload(optionsRef.current);
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(createDemoEpisodesMock).toHaveBeenCalledOnce();
    expect(loadDemoEpisodes).toHaveBeenCalledWith([demoEpisode]);
    expect(setViewerEpisode).not.toHaveBeenCalled();
    expect(setIsViewerOpen).not.toHaveBeenCalled();
    expect(playEpisodeSpy).not.toHaveBeenCalled();
    expect(toastErrorSpy).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
