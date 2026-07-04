/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CORE_FOLDER_UPLOAD_SCREEN_PARAMS } from "@/app/pages/index/coreFolderUploadScreenState";
import { useCameraConfigSourceController } from "@/app/pages/index/useCameraConfigSourceController";
import type { CameraConfig } from "@/shared/types/camera";

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

type HookResult = ReturnType<typeof useCameraConfigSourceController>;

type RenderedHarness = {
  getHook: () => HookResult;
  loadCamerasMock: ReturnType<typeof vi.fn>;
  unmount: () => Promise<void>;
};

const CAMERA_CONFIG_CONTROLLER_TEST_FIXTURES = {
  cameraConfigUrl: "https://example.test/camera-config.json",
  localCameraConfigName: "local-camera-config.json",
} as const;

const createCameraConfigText = () =>
  JSON.stringify({
    cameras: [
      {
        intrinsics: {
          fov_deg: 70,
          height: 480,
          width: 640,
        },
        name: "front_camera",
        parent_joint: "wrist_joint",
        pose: [0.1, 0.2, 0.3, 0, 0, 0],
      },
    ],
  });

const flushAsyncWork = async () => {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
};

const renderCameraConfigSourceController = async ({
  fetchImplementation,
}: {
  fetchImplementation?: typeof fetch;
} = {}): Promise<RenderedHarness> => {
  let hookValue: HookResult | null = null;
  const loadCamerasMock = vi.fn<(cameraConfig: CameraConfig) => void>();
  const root: Root = createRoot(document.createElement("div"));

  const Harness = () => {
    hookValue = useCameraConfigSourceController({
      fetchImplementation,
      loadCameras: loadCamerasMock,
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
    loadCamerasMock,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
};

describe("useCameraConfigSourceController", () => {
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

  it("loads a remote camera config and records it as recent", async () => {
    const fetchImplementation = vi.fn(async () => ({
      ok: true,
      text: async () => createCameraConfigText(),
    })) as unknown as typeof fetch;
    const harness = await renderCameraConfigSourceController({ fetchImplementation });

    await act(async () => {
      await harness
        .getHook()
        .loadCameraConfigFromUrl(` ${CAMERA_CONFIG_CONTROLLER_TEST_FIXTURES.cameraConfigUrl} `);
    });

    expect(fetchImplementation).toHaveBeenCalledWith(
      CAMERA_CONFIG_CONTROLLER_TEST_FIXTURES.cameraConfigUrl
    );
    expect(harness.loadCamerasMock).toHaveBeenCalledWith({
      cameras: [
        expect.objectContaining({
          name: "front_camera",
          parent_joint: "wrist_joint",
        }),
      ],
    });
    expect(harness.getHook().cameraConfigUrl).toBe(
      CAMERA_CONFIG_CONTROLLER_TEST_FIXTURES.cameraConfigUrl
    );
    expect(harness.getHook().recentCameraConfigs).toEqual([
      CAMERA_CONFIG_CONTROLLER_TEST_FIXTURES.cameraConfigUrl,
    ]);
    expect(
      JSON.parse(
        localStorage.getItem(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.recentCameraConfigsStorageKey) ??
          "[]"
      )
    ).toEqual([CAMERA_CONFIG_CONTROLLER_TEST_FIXTURES.cameraConfigUrl]);
    expect(toastSuccessMock).toHaveBeenCalledWith(
      `Loaded 1 camera(s) from ${CAMERA_CONFIG_CONTROLLER_TEST_FIXTURES.cameraConfigUrl}.`
    );

    await harness.unmount();
  });

  it("loads a local camera config file and records the local file label", async () => {
    const harness = await renderCameraConfigSourceController();
    const file = new File(
      [createCameraConfigText()],
      CAMERA_CONFIG_CONTROLLER_TEST_FIXTURES.localCameraConfigName,
      { type: "application/json" }
    );

    await act(async () => {
      await harness.getHook().processCameraConfigFile(file);
    });

    expect(harness.loadCamerasMock).toHaveBeenCalledWith({
      cameras: [
        expect.objectContaining({
          name: "front_camera",
          parent_joint: "wrist_joint",
        }),
      ],
    });
    expect(harness.getHook().lastLocalCameraConfig).toBe(
      CAMERA_CONFIG_CONTROLLER_TEST_FIXTURES.localCameraConfigName
    );
    expect(
      localStorage.getItem(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalCameraConfigStorageKey)
    ).toBe(CAMERA_CONFIG_CONTROLLER_TEST_FIXTURES.localCameraConfigName);

    await harness.unmount();
  });

  it("rejects an empty remote camera config URL without fetching", async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch;
    const harness = await renderCameraConfigSourceController({ fetchImplementation });

    await act(async () => {
      await harness.getHook().loadCameraConfigFromUrl("   ");
    });

    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(harness.loadCamerasMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("Please enter a camera config URL.");

    await harness.unmount();
  });
});
