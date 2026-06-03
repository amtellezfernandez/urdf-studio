/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIluAssemblyBridge } from "@/app/pages/index/useIluAssemblyBridge";
import type { IluAssemblyManifest } from "@/features/urdf/loader/iluAssemblyApi";

const { fetchIluAssemblyManifest, toast, loadDemoFileListFromManifestUrl } = vi.hoisted(() => ({
  fetchIluAssemblyManifest: vi.fn<() => Promise<IluAssemblyManifest>>(),
  loadDemoFileListFromManifestUrl: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast,
}));

vi.mock("@/app/pages/index/demoBootstrap", () => ({
  loadDemoFileListFromManifestUrl,
}));

vi.mock("@/features/urdf/loader/iluAssemblyApi", () => ({
  fetchIluAssemblyManifest,
  getIluAssemblyManifestUrl: (assemblyId: string) => `/ilu-assembly/${assemblyId}/manifest`,
}));

describe("useIluAssemblyBridge", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    fetchIluAssemblyManifest.mockReset();
    loadDemoFileListFromManifestUrl.mockReset();
    toast.success.mockClear();
    toast.error.mockClear();
  });

  it("attaches an ilu assembly into assembly mode and seeds selected URDF paths", async () => {
    const fileList = {
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* iterator() {},
    } as unknown as FileList;
    fetchIluAssemblyManifest.mockResolvedValue({
      label: "Bench Assembly",
      files: [{ path: "base/base.urdf", url: "/ilu-assembly/a/asset?path=base%2Fbase.urdf" }],
      selectedPaths: ["base/base.urdf", "tool/tool.urdf"],
      namesByPath: {
        "base/base.urdf": "base.urdf",
        "tool/tool.urdf": "tool.urdf",
      },
      sourceByPath: {
        "base/base.urdf": { type: "local", folder: "base_pkg" },
        "tool/tool.urdf": { type: "local", folder: "tool_pkg" },
      },
    });
    loadDemoFileListFromManifestUrl.mockResolvedValue(fileList);

    const loadFilesFromFolder = vi.fn(async () => {});
    const clearGitHubSource = vi.fn();
    const clearAssemblySelection = vi.fn();
    const clearAssemblyPlacement = vi.fn();
    const setAssemblySelectedUrdfPaths = vi.fn();
    const onWorkspaceModeChange = vi.fn();

    const Harness = () => {
      useIluAssemblyBridge({
        iluAssemblyParam: "assembly-1",
        loadFilesFromFolder,
        clearGitHubSource,
        clearAssemblySelection,
        clearAssemblyPlacement,
        setAssemblySelectedUrdfPaths,
        onWorkspaceModeChange,
      });
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchIluAssemblyManifest).toHaveBeenCalledWith("assembly-1");
    expect(loadDemoFileListFromManifestUrl).toHaveBeenCalledWith("/ilu-assembly/assembly-1/manifest");
    expect(onWorkspaceModeChange).toHaveBeenCalledWith("assembly");
    expect(clearGitHubSource).toHaveBeenCalledTimes(1);
    expect(clearAssemblySelection).toHaveBeenCalledTimes(1);
    expect(clearAssemblyPlacement).toHaveBeenCalledTimes(1);
    expect(loadFilesFromFolder).toHaveBeenCalledWith(fileList, { preserveCameras: false });
    expect(setAssemblySelectedUrdfPaths).toHaveBeenCalledWith(
      ["base/base.urdf", "tool/tool.urdf"],
      {
        "base/base.urdf": "base.urdf",
        "tool/tool.urdf": "tool.urdf",
      },
      {
        "base/base.urdf": { type: "local", folder: "base_pkg" },
        "tool/tool.urdf": { type: "local", folder: "tool_pkg" },
      }
    );
    expect(toast.success).toHaveBeenCalledWith("Attached ilu assembly with 2 robots");
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("clears the attaching state when callbacks change before a failed attach settles", async () => {
    let rejectManifest: (error: Error) => void = () => {};
    const manifestPromise = new Promise<IluAssemblyManifest>((_, reject) => {
      rejectManifest = reject;
    });
    fetchIluAssemblyManifest.mockReturnValue(manifestPromise);

    const loadFilesFromFolder = vi.fn(async () => {});
    const setAssemblySelectedUrdfPaths = vi.fn();

    const Harness = ({ version }: { version: number }) => {
      const { isAttachingIluAssembly } = useIluAssemblyBridge({
        iluAssemblyParam: "missing-assembly",
        loadFilesFromFolder,
        clearGitHubSource: () => {
          void version;
        },
        clearAssemblySelection: () => {
          void version;
        },
        clearAssemblyPlacement: () => {
          void version;
        },
        setAssemblySelectedUrdfPaths,
        onWorkspaceModeChange: () => {
          void version;
        },
      });
      return createElement("span", null, isAttachingIluAssembly ? "loading" : "idle");
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness, { version: 1 }));
      await Promise.resolve();
    });
    expect(container.textContent).toBe("loading");

    await act(async () => {
      root.render(createElement(Harness, { version: 2 }));
      await Promise.resolve();
    });

    await act(async () => {
      rejectManifest(new Error("Assembly not found"));
      await manifestPromise.catch(() => {});
      await Promise.resolve();
    });

    expect(container.textContent).toBe("idle");
    expect(toast.error).toHaveBeenCalledWith("Assembly not found");
    expect(loadFilesFromFolder).not.toHaveBeenCalled();
    expect(setAssemblySelectedUrdfPaths).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
