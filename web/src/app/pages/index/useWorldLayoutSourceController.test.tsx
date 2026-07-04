/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CORE_FOLDER_UPLOAD_SCREEN_PARAMS } from "@/app/pages/index/coreFolderUploadScreenState";
import { useWorldLayoutSourceController } from "@/app/pages/index/useWorldLayoutSourceController";
import type { SourceEntryActions } from "@/app/pages/index/sourceEntryTypes";

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

type HookResult = ReturnType<typeof useWorldLayoutSourceController>;

type RenderedHarness = {
  getHook: () => HookResult;
  onImportWorldLayoutMock: SourceEntryActions["onImportWorldLayout"];
  unmount: () => Promise<void>;
};

const WORLD_LAYOUT_CONTROLLER_TEST_FIXTURES = {
  localLayoutFileName: "demo-world-layout.json",
  localMeshFileName: "crate.glb",
  worldLayoutUrl: "https://example.test/world-layout.json",
} as const;

const flushAsyncWork = async () => {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
};

const createFile = ({
  content = "asset",
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

const renderWorldLayoutSourceController = async ({
  onImportWorldLayout = vi.fn(async () => undefined),
}: {
  onImportWorldLayout?: SourceEntryActions["onImportWorldLayout"];
} = {}): Promise<RenderedHarness> => {
  let hookValue: HookResult | null = null;
  const root: Root = createRoot(document.createElement("div"));

  const Harness = () => {
    hookValue = useWorldLayoutSourceController({ onImportWorldLayout });
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
    onImportWorldLayoutMock: onImportWorldLayout,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
};

describe("useWorldLayoutSourceController", () => {
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    let objectUrlIndex = 0;
    URL.createObjectURL = vi.fn(() => {
      objectUrlIndex += 1;
      return `blob:world-layout-controller-${objectUrlIndex}`;
    });
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it("loads a remote world layout and records it as recent", async () => {
    const harness = await renderWorldLayoutSourceController();

    await act(async () => {
      await harness
        .getHook()
        .loadWorldLayoutFromUrl(` ${WORLD_LAYOUT_CONTROLLER_TEST_FIXTURES.worldLayoutUrl} `);
    });

    expect(harness.onImportWorldLayoutMock).toHaveBeenCalledWith(
      WORLD_LAYOUT_CONTROLLER_TEST_FIXTURES.worldLayoutUrl
    );
    expect(harness.getHook().worldLayoutUrl).toBe(
      WORLD_LAYOUT_CONTROLLER_TEST_FIXTURES.worldLayoutUrl
    );
    expect(harness.getHook().loadedWorldLayoutName).toBe("world-layout.json");
    expect(harness.getHook().recentWorldLayouts).toEqual([
      WORLD_LAYOUT_CONTROLLER_TEST_FIXTURES.worldLayoutUrl,
    ]);
    expect(
      JSON.parse(
        localStorage.getItem(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.recentWorldLayoutsStorageKey) ??
          "[]"
      )
    ).toEqual([WORLD_LAYOUT_CONTROLLER_TEST_FIXTURES.worldLayoutUrl]);
    expect(toastSuccessMock).toHaveBeenCalledWith("Loaded world layout.");

    await harness.unmount();
  });

  it("loads local world layout files with mesh URI asset maps and revokes object URLs", async () => {
    const harness = await renderWorldLayoutSourceController();

    await act(async () => {
      await harness.getHook().processWorldLayoutFiles([
        createFile({
          content: "{}",
          name: WORLD_LAYOUT_CONTROLLER_TEST_FIXTURES.localLayoutFileName,
        }),
        createFile({
          name: WORLD_LAYOUT_CONTROLLER_TEST_FIXTURES.localMeshFileName,
          relativePath: "worlds/demo/meshes/crate.glb",
        }),
      ]);
    });

    expect(harness.onImportWorldLayoutMock).toHaveBeenCalledWith(
      "blob:world-layout-controller-1",
      {
        meshUriAssetMap: expect.objectContaining({
          "meshes/crate.glb": "blob:world-layout-controller-2",
        }),
      }
    );
    expect(harness.getHook().lastLocalWorldLayout).toBe(
      WORLD_LAYOUT_CONTROLLER_TEST_FIXTURES.localLayoutFileName
    );
    expect(harness.getHook().loadedWorldLayoutName).toBe(
      WORLD_LAYOUT_CONTROLLER_TEST_FIXTURES.localLayoutFileName
    );
    expect(
      localStorage.getItem(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalWorldLayoutStorageKey)
    ).toBe(WORLD_LAYOUT_CONTROLLER_TEST_FIXTURES.localLayoutFileName);

    await harness.unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:world-layout-controller-1");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:world-layout-controller-2");
  });

  it("rejects an empty remote world layout URL without importing", async () => {
    const harness = await renderWorldLayoutSourceController();

    await act(async () => {
      await harness.getHook().loadWorldLayoutFromUrl("   ");
    });

    expect(harness.onImportWorldLayoutMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("Please enter a world layout link.");

    await harness.unmount();
  });
});
