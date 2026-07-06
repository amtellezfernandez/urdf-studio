/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoreFolderUploadScreen } from "@/app/pages/index/CoreFolderUploadScreen";
import type { SourceEntryActions } from "@/app/pages/index/sourceEntryTypes";
import { GPUModeProvider } from "@/shared/hooks/use-gpu-mode";
import { useCameraStore } from "@/shared/store/useCameraStore";

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

type RenderedScreen = {
  actions: SourceEntryActions;
  container: HTMLDivElement;
  rerender: () => Promise<void>;
  unmount: () => Promise<void>;
};

const CORE_FOLDER_UPLOAD_SCREEN_TEST_FIXTURES = {
  localLayoutFileName: "demo-world-layout.json",
  localMeshFileName: "crate.glb",
  worldLayoutUrl: "https://example.test/world-layout.json",
} as const;

const createActions = (): SourceEntryActions => ({
  onFolderSelected: vi.fn(async () => undefined),
  onGitHubSelected: vi.fn(async () => undefined),
  onImportWorldLayout: vi.fn(async () => undefined),
  onOpenWorldOnlyWorkspace: vi.fn(),
  onPlayDemoMotion: vi.fn(),
  onUrlSelected: vi.fn(async () => undefined),
});

const flushAsyncWork = async () => {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
};

const setInputValue = (input: HTMLInputElement, value: string): void => {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const clickButton = (button: HTMLButtonElement): void => {
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

const getButtonByText = (container: HTMLElement, label: string): HTMLButtonElement => {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return button;
};

const renderCoreFolderUploadScreen = async (): Promise<RenderedScreen> => {
  const actions = createActions();
  const container = document.createElement("div");
  const root: Root = createRoot(container);

  const rerender = async () => {
    await act(async () => {
      root.render(
        createElement(GPUModeProvider, null, createElement(CoreFolderUploadScreen, actions))
      );
      await flushAsyncWork();
    });
  };

  await rerender();

  return {
    actions,
    container,
    rerender,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
};

describe("CoreFolderUploadScreen", () => {
  const originalCreateObjectUrl = URL.createObjectURL;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    useCameraStore.getState().clearCameras();
    let objectUrlIndex = 0;
    URL.createObjectURL = vi.fn(() => {
      objectUrlIndex += 1;
      return `blob:entry-world-layout-${objectUrlIndex}`;
    });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectUrl;
  });

  it("opens the workspace after loading only a world layout", async () => {
    const screen = await renderCoreFolderUploadScreen();
    const setupButton = getButtonByText(screen.container, "Load Setup");
    expect(setupButton.disabled).toBe(true);

    const worldUrlInput = screen.container.querySelector(
      'input[placeholder="https://.../world-layout.json"]'
    );
    if (!(worldUrlInput instanceof HTMLInputElement)) {
      throw new Error("World layout URL input was not rendered.");
    }

    const worldLoader = worldUrlInput.closest(".space-y-4");
    const worldLoadButton = Array.from(worldLoader?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.trim() === "Load"
    );
    if (!(worldLoadButton instanceof HTMLButtonElement)) {
      throw new Error("World layout load button was not rendered.");
    }

    await act(async () => {
      setInputValue(worldUrlInput, CORE_FOLDER_UPLOAD_SCREEN_TEST_FIXTURES.worldLayoutUrl);
      clickButton(worldLoadButton);
      await flushAsyncWork();
    });

    expect(screen.actions.onImportWorldLayout).toHaveBeenCalledWith(
      CORE_FOLDER_UPLOAD_SCREEN_TEST_FIXTURES.worldLayoutUrl
    );
    expect(getButtonByText(screen.container, "Load Setup").disabled).toBe(false);

    await act(async () => {
      clickButton(getButtonByText(screen.container, "Load Setup"));
      await flushAsyncWork();
    });

    expect(screen.actions.onOpenWorldOnlyWorkspace).toHaveBeenCalledOnce();
    expect(screen.actions.onFolderSelected).not.toHaveBeenCalled();
    expect(screen.actions.onGitHubSelected).not.toHaveBeenCalled();
    expect(screen.actions.onUrlSelected).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("Setup loaded.");

    await screen.unmount();
  });

  it("passes local world layout asset files as mesh URI asset maps", async () => {
    const screen = await renderCoreFolderUploadScreen();
    const worldFileInput = screen.container.querySelector(
      'input[aria-label="Select world layout folder"]'
    );
    if (!(worldFileInput instanceof HTMLInputElement)) {
      throw new Error("World layout folder input was not rendered.");
    }

    Object.defineProperty(worldFileInput, "files", {
      configurable: true,
      value: [
        createFile({
          content: "{}",
          name: CORE_FOLDER_UPLOAD_SCREEN_TEST_FIXTURES.localLayoutFileName,
        }),
        createFile({
          name: CORE_FOLDER_UPLOAD_SCREEN_TEST_FIXTURES.localMeshFileName,
          relativePath: "worlds/demo/meshes/crate.glb",
        }),
      ],
    });

    await act(async () => {
      worldFileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await flushAsyncWork();
    });

    expect(screen.actions.onImportWorldLayout).toHaveBeenCalledWith(
      "blob:entry-world-layout-1",
      {
        meshUriAssetMap: expect.objectContaining({
          "meshes/crate.glb": "blob:entry-world-layout-2",
        }),
      }
    );
    expect(getButtonByText(screen.container, "Load Setup").disabled).toBe(false);

    await screen.unmount();
  });
});
