/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDemoMotionSequences, type DemoMotionSequence } from "@/shared/samples/demoMotion";
import { useDemoMotionFlow } from "@/app/pages/index/useDemoMotionFlow";

const playFramesSpy = vi.fn();
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
  createDemoMotionSequences: vi.fn(),
  toDemoAnimationFrames: (sequence: DemoMotionSequence) =>
    sequence.frames.map((frame) => ({
      timestamp: frame.timestamp,
      joints: frame.jointPositions,
    })),
}));

vi.mock("@/app/pages/index/demoBootstrap", () => ({
  loadDemoFileListFromManifestUrls: (...args: unknown[]) =>
    loadDemoFileListFromManifestUrlsSpy(...args),
  loadDemoFileListProgressivelyFromManifestUrls: (...args: unknown[]) =>
    loadDemoFileListProgressivelyFromManifestUrlsSpy(...args),
}));

vi.mock("@/features/viewer/playback/viewerPlayback", () => ({
  viewerPlayback: {
    playFrames: (...args: unknown[]) => playFramesSpy(...args),
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

const createDemoMotionSequence = (): DemoMotionSequence => ({
  id: "demo-pickup",
  frames: [
    { timestamp: 0, jointPositions: { joint_a: 0 } },
    { timestamp: 100, jointPositions: { joint_a: 0.5 } },
  ],
  createdAt: 1,
  metadata: {
    joint_names: ["joint_a"],
    source: "demo",
    label: "Pickup",
    createdAt: 1,
    num_frames: 2,
    fps: 60,
    additional: {
      demoType: "pickup",
    },
  },
});

describe("useDemoMotionFlow", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    playFramesSpy.mockReset();
    toastErrorSpy.mockReset();
    toastInfoSpy.mockReset();
    loadDemoFileListFromManifestUrlsSpy.mockReset();
    loadDemoFileListProgressivelyFromManifestUrlsSpy.mockReset();
  });

  it("plays demo motion frames without starting playback on first launch", async () => {
    const demoMotionSequence = createDemoMotionSequence();
    vi.mocked(createDemoMotionSequences).mockReturnValue([demoMotionSequence]);

    const optionsRef: { current: HookOptions } = {
      current: {
        activeUrdfPath: null,
        availableJoints: ["joint_a"],
        hasLoadedFiles: true,
        jointLimits: {
          joint_a: { type: "revolute", lower: -1, upper: 1 },
        },
        loadFilesFromFolderWithFreshCameras: vi.fn(),
        playbackHandlers: {
          playFrames: vi.fn(),
        },
        prepareDemoScene: vi.fn(() => true),
        robot: null,
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

    expect(playFramesSpy).toHaveBeenCalledTimes(1);
    expect(playFramesSpy.mock.calls[0]?.[1]).toEqual({
      autoplay: false,
      applyInitialFrame: false,
    });
    expect(toastErrorSpy).not.toHaveBeenCalled();

    await act(async () => {
      hookValue?.handlePlayDemoMotion();
    });

    expect(playFramesSpy).toHaveBeenCalledTimes(2);
    expect(playFramesSpy.mock.calls[1]?.[1]).toEqual({
      autoplay: true,
      applyInitialFrame: true,
    });
    expect(toastErrorSpy).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("uses manifest preferences to prepare and preserve the demo world layout", async () => {
    const demoMotionSequence = createDemoMotionSequence();
    vi.mocked(createDemoMotionSequences).mockReturnValue([demoMotionSequence]);
    const prepareDemoScene = vi.fn(() => true);
    const skipDefaultWorldLayoutAutoImportRef = { current: false };
    const optionsRef: { current: HookOptions } = {
      current: {
        activeUrdfPath: "demo.urdf",
        availableJoints: ["joint_a"],
        hasLoadedFiles: true,
        jointLimits: {
          joint_a: { type: "revolute", lower: -1, upper: 1 },
        },
        loadFilesFromFolderWithFreshCameras: vi.fn(),
        playbackHandlers: {
          playFrames: vi.fn(),
        },
        prepareDemoScene,
        prepareDemoWorldLayoutOnMotion: true,
        preserveDemoWorldLayoutOnMotion: true,
        robot: null,
        skipDefaultWorldLayoutAutoImportRef,
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

    expect(prepareDemoScene).toHaveBeenCalledOnce();
    expect(skipDefaultWorldLayoutAutoImportRef.current).toBe(true);
    expect(playFramesSpy).toHaveBeenCalledOnce();

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
      preferences: {
        prepareDemoWorldLayoutOnMotion: true,
        preserveDemoWorldLayoutOnMotion: true,
        suppressDefaultWorldLayoutAutoImport: true,
      },
    });

    const loadDemoUrdfTextWithFreshCameras = vi.fn();
    const hydrateDemoAssetsFromFiles = vi.fn(
      async (_files: FileList, _options?: { shouldApply?: () => boolean }) => true
    );
    const loadFilesFromFolderWithFreshCameras = vi.fn();
    const onDemoManifestPreferences = vi.fn();
    const optionsRef: { current: HookOptions } = {
      current: {
        activeUrdfPath: "lekiwi.urdf",
        availableJoints: [],
        hasLoadedFiles: false,
        hydrateDemoAssetsFromFiles,
        jointLimits: {},
        loadDemoUrdfTextWithFreshCameras,
        loadFilesFromFolderWithFreshCameras,
        onDemoManifestPreferences,
        playbackHandlers: {},
        prepareDemoScene: vi.fn(() => true),
        robot: null,
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
    expect(onDemoManifestPreferences).toHaveBeenCalledWith({
      activePath: "lekiwi.urdf",
      preferences: {
        prepareDemoWorldLayoutOnMotion: true,
        preserveDemoWorldLayoutOnMotion: true,
        suppressDefaultWorldLayoutAutoImport: true,
      },
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

  it("does not suppress default world layout while autoloading the demo robot", async () => {
    vi.resetModules();
    vi.doMock("@/shared/config/demo", () => ({
      DEMO_AUTOLOAD: true,
      DEMO_LOCAL_MANIFEST_URL: "/demo/local-manifest.json",
      DEMO_MANIFEST_URL: "/demo/manifest.json",
      DEMO_MODE: true,
    }));
    vi.doMock("@/app/pages/index/demoBootstrap", () => ({
      loadDemoFileListFromManifestUrls: (...args: unknown[]) =>
        loadDemoFileListFromManifestUrlsSpy(...args),
      loadDemoFileListProgressivelyFromManifestUrls: (...args: unknown[]) =>
        loadDemoFileListProgressivelyFromManifestUrlsSpy(...args),
    }));
    vi.doMock("@/shared/samples/demoMotion", () => ({
      createDemoMotionSequences: vi.fn(),
      toDemoAnimationFrames: (sequence: DemoMotionSequence) =>
        sequence.frames.map((frame) => ({
          timestamp: frame.timestamp,
          joints: frame.jointPositions,
        })),
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
    const urdfFile = new File(["<robot name='so101'/>"], "so101.urdf", {
      type: "application/xml",
    });
    loadDemoFileListFromManifestUrlsSpy.mockResolvedValue([urdfFile] as unknown as FileList);
    const skipDefaultWorldLayoutAutoImportRef = { current: false };
    const loadFilesFromFolderWithFreshCameras = vi.fn();
    const optionsRef: { current: HookOptions } = {
      current: {
        activeUrdfPath: null,
        availableJoints: [],
        hasLoadedFiles: false,
        jointLimits: {},
        loadFilesFromFolderWithFreshCameras,
        playbackHandlers: {},
        prepareDemoScene: vi.fn(() => true),
        robot: null,
        skipDefaultWorldLayoutAutoImportRef,
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
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadDemoFileListFromManifestUrlsSpy).toHaveBeenCalledOnce();
    expect(loadFilesFromFolderWithFreshCameras).toHaveBeenCalledWith([urdfFile]);
    expect(skipDefaultWorldLayoutAutoImportRef.current).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("primes demo motion sequences on autoload without opening the viewer or starting playback", async () => {
    vi.resetModules();
    const demoMotionSequence = createDemoMotionSequence();
    const createDemoMotionSequencesMock = vi.fn(() => [demoMotionSequence]);
    vi.doMock("@/shared/config/demo", () => ({
      DEMO_AUTOLOAD: true,
      DEMO_LOCAL_MANIFEST_URL: "/demo/local-manifest.json",
      DEMO_MANIFEST_URL: "/demo/manifest.json",
      DEMO_MODE: true,
    }));
    vi.doMock("@/shared/samples/demoMotion", () => ({
      createDemoMotionSequences: createDemoMotionSequencesMock,
      toDemoAnimationFrames: (sequence: DemoMotionSequence) =>
        sequence.frames.map((frame) => ({
          timestamp: frame.timestamp,
          joints: frame.jointPositions,
        })),
    }));
    vi.doMock("@/features/viewer/playback/viewerPlayback", () => ({
      viewerPlayback: {
        playFrames: (...args: unknown[]) => playFramesSpy(...args),
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

    const optionsRef: { current: HookOptions } = {
      current: {
        activeUrdfPath: null,
        availableJoints: ["joint_a"],
        hasLoadedFiles: true,
        jointLimits: {
          joint_a: { type: "revolute", lower: -1, upper: 1 },
        },
        loadFilesFromFolderWithFreshCameras: vi.fn(),
        playbackHandlers: {
          playFrames: vi.fn(),
        },
        prepareDemoScene: vi.fn(() => true),
        robot: null,
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

    expect(createDemoMotionSequencesMock).toHaveBeenCalledOnce();
    expect(playFramesSpy).not.toHaveBeenCalled();
    expect(toastErrorSpy).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
