/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIluSessionBridge } from "@/app/pages/index/useIluSessionBridge";
import type { IluSessionSnapshot } from "@/features/urdf/loader/iluSessionApi";

const {
  fetchIluSessionSnapshot,
  fetchIluSessionAssetManifest,
  saveIluSessionSnapshot,
  toast,
} = vi.hoisted(() => ({
  fetchIluSessionSnapshot: vi.fn<() => Promise<IluSessionSnapshot>>(),
  fetchIluSessionAssetManifest: vi.fn(),
  saveIluSessionSnapshot: vi.fn(() => Promise.resolve()),
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast,
}));

vi.mock("@/app/pages/index/demoBootstrap", () => ({
  loadDemoFileListFromManifestUrl: vi.fn(),
}));

vi.mock("@/features/urdf/loader/iluSessionApi", () => ({
  fetchIluSessionSnapshot,
  fetchIluSessionAssetManifest,
  getIluSessionAssetManifestUrl: (sessionId: string) => `/ilu-session/${sessionId}/manifest`,
  saveIluSessionSnapshot,
}));

describe("useIluSessionBridge", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    fetchIluSessionSnapshot.mockReset();
    fetchIluSessionAssetManifest.mockReset();
    saveIluSessionSnapshot.mockClear();
    toast.success.mockClear();
    toast.warning.mockClear();
    toast.error.mockClear();
  });

  it("finishes the initial attach even if callback identities change before fetch resolves", async () => {
    let resolveSnapshot: ((value: IluSessionSnapshot) => void) | null = null;
    fetchIluSessionSnapshot.mockImplementation(
      () =>
        new Promise<IluSessionSnapshot>((resolve) => {
          resolveSnapshot = resolve;
        })
    );

    const loadUrdfText = vi.fn();
    const markUrdfContentReloaded = vi.fn();
    const setOriginalVizUrdfContent = vi.fn();
    const setSavedVizUrdfContent = vi.fn();
    const clearGitHubSource = vi.fn();
    const setGitHubSource = vi.fn();
    const hydrateLoadedAssetsFromFiles = vi.fn(async () => true);

    const Harness = ({ token }: { token: number }) => {
      useIluSessionBridge({
        clearGitHubSource,
        hydrateLoadedAssetsFromFiles,
        iluSessionParam: "session-1",
        loadUrdfText,
        markUrdfContentReloaded,
        setOriginalVizUrdfContent,
        setSavedVizUrdfContent,
        setGitHubSource,
        updateUrdfFile: () => {
          void token;
        },
        vizUrdfContent: "",
      });
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness, { token: 1 }));
    });

    await act(async () => {
      root.render(createElement(Harness, { token: 2 }));
    });

    expect(fetchIluSessionSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSnapshot?.({
        schema: "ilu-shared-session",
        schemaVersion: 1,
        sessionId: "session-1",
        createdAt: "2026-03-25T09:00:00.000Z",
        updatedAt: "2026-03-25T09:00:01.000Z",
        workingUrdfPath: "/tmp/demo.urdf",
        lastUrdfPath: "/tmp/demo.urdf",
        urdfContent: "<robot name='demo'/>",
        loadedSource: null,
        githubSource: null,
      });
      await Promise.resolve();
    });

    expect(loadUrdfText).toHaveBeenCalledTimes(1);
    expect(loadUrdfText).toHaveBeenCalledWith("<robot name='demo'/>", {
      activePath: "/tmp/demo.urdf",
      filename: "demo.urdf",
    });
    expect(markUrdfContentReloaded).toHaveBeenCalledTimes(1);
    expect(setOriginalVizUrdfContent).toHaveBeenCalledWith("<robot name='demo'/>");
    expect(setSavedVizUrdfContent).toHaveBeenCalledWith("<robot name='demo'/>");
    expect(toast.success).toHaveBeenCalledWith("Attached ilu session");
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
