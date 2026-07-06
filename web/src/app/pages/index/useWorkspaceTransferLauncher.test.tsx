/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorldSceneRegistryEnvelope } from "@/features/world-share/worldScenePackageTypes";
import { useWorkspaceTransferLauncher } from "@/app/pages/index/useWorkspaceTransferLauncher";

const {
  cancelWorkspaceTransferTargetLaunchMock,
  fetchWorkspaceTransferTargetsMock,
  fetchWorkspaceTransferTargetStatusMock,
  openWorkspaceTransferTargetMock,
  toastErrorMock,
  toastWarningMock,
} = vi.hoisted(() => ({
  cancelWorkspaceTransferTargetLaunchMock: vi.fn(),
  fetchWorkspaceTransferTargetsMock: vi.fn(),
  fetchWorkspaceTransferTargetStatusMock: vi.fn(),
  openWorkspaceTransferTargetMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastWarningMock: vi.fn(),
}));

vi.mock("@/features/world-share/workspaceTransferApi", () => ({
  cancelWorkspaceTransferTargetLaunch: (...args: unknown[]) =>
    cancelWorkspaceTransferTargetLaunchMock(...args),
  fetchWorkspaceTransferTargets: (...args: unknown[]) =>
    fetchWorkspaceTransferTargetsMock(...args),
  fetchWorkspaceTransferTargetStatus: (...args: unknown[]) =>
    fetchWorkspaceTransferTargetStatusMock(...args),
  openWorkspaceTransferTarget: (...args: unknown[]) =>
    openWorkspaceTransferTargetMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    message: vi.fn(),
    success: vi.fn(),
    warning: (...args: unknown[]) => toastWarningMock(...args),
  },
}));

const createWorldPackage = (): WorldSceneRegistryEnvelope => ({
  package_id: "demo-world",
  version: "1.0.0",
  artifacts: [],
  provenance: {},
  world: {
    name: "Demo World",
    urdf_xml: "<robot name=\"demo\"><link name=\"base\"/></robot>",
    joint_positions: {},
    cameras: [],
    objects: [],
    scenario_time_ms: 0,
    scenario_duration_ms: 0,
  },
});

const blenderTarget = {
  targetId: "blender",
  label: "Blender",
  targetKind: "authoring_tool",
  capabilities: {
    workspaceTarget: true,
    motionValidation: false,
    layoutRoundTrip: true,
  },
  transferPolicy: {
    robotAssetFormat: "native",
    sceneAssetFormat: "native",
    frameConvention: "ros-rep-103",
    transferStrategy: "direct",
  },
} as const;

describe("useWorkspaceTransferLauncher", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    cancelWorkspaceTransferTargetLaunchMock.mockReset();
    fetchWorkspaceTransferTargetsMock.mockReset();
    fetchWorkspaceTransferTargetStatusMock.mockReset();
    openWorkspaceTransferTargetMock.mockReset();
    toastErrorMock.mockReset();
    toastWarningMock.mockReset();
    fetchWorkspaceTransferTargetsMock.mockResolvedValue([blenderTarget]);
    fetchWorkspaceTransferTargetStatusMock.mockResolvedValue({
      targetId: "blender",
      available: true,
      status: "ready",
      dependencies: [],
    });
    openWorkspaceTransferTargetMock.mockResolvedValue({
      targetId: "blender",
      started: true,
      pid: 1234,
      command: ["python", "-m", "backend.scripts.blender_workspace_prepare"],
      worldPackagePath: "/tmp/world-package.json",
      robotUrdfPath: "/tmp/robot.urdf",
      bundledMeshCount: 0,
      unresolvedMeshRefs: [],
      worldObjectCount: 3,
      cameraCount: 0,
    });
    cancelWorkspaceTransferTargetLaunchMock.mockResolvedValue({
      targetId: "blender",
      launchId: "launch-123",
      cancelled: true,
      processStopped: true,
      pid: 1234,
    });
  });

  const openedWorkspaceResponse = {
    targetId: "blender",
    started: true,
    pid: 1234,
    command: ["python", "-m", "backend.scripts.blender_workspace_prepare"],
    worldPackagePath: "/tmp/world-package.json",
    robotUrdfPath: "/tmp/robot.urdf",
    bundledMeshCount: 0,
    unresolvedMeshRefs: [],
    worldObjectCount: 3,
    cameraCount: 0,
  };

  it("keeps degraded but available simulator targets openable and marked for attention", async () => {
    fetchWorkspaceTransferTargetStatusMock.mockResolvedValueOnce({
      targetId: "blender",
      available: true,
      status: "ready, display degraded: software OpenGL",
      dependencies: [
        {
          name: "hardware OpenGL",
          available: false,
          required: false,
          scope: "runtime",
        },
      ],
    });
    let hookValue: ReturnType<typeof useWorkspaceTransferLauncher> | null = null;

    const Harness = () => {
      hookValue = useWorkspaceTransferLauncher({
        activeUrdfPath: "robot.urdf",
        attachedIluSessionId: "",
        buildCurrentWorldSceneRegistryEnvelope: vi.fn(async () => createWorldPackage()),
        meshFiles: {},
        originalUrdfContent: "<robot name=\"demo\"/>",
        packageRoots: {},
        vizUrdfContent: "<robot name=\"demo\"/>",
        worldCameraCount: 0,
        worldObjectCount: 0,
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

    expect(hookValue?.workspaceTransfer.targets[0]?.canOpen).toBe(true);
    expect(hookValue?.workspaceTransfer.targets[0]?.needsAttention).toBe(true);
    expect(hookValue?.workspaceTransfer.targets[0]?.statusLabel).toBe(
      "ready, display degraded: software OpenGL"
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("opens a simulator from the current workspace package without mutating the scene first", async () => {
    const buildCurrentWorldSceneRegistryEnvelope = vi.fn(async () => createWorldPackage());
    let hookValue: ReturnType<typeof useWorkspaceTransferLauncher> | null = null;

    const Harness = () => {
      hookValue = useWorkspaceTransferLauncher({
        activeUrdfPath: "robot.urdf",
        attachedIluSessionId: "",
        buildCurrentWorldSceneRegistryEnvelope,
        meshFiles: {},
        originalUrdfContent: "<robot name=\"demo\"/>",
        packageRoots: {},
        vizUrdfContent: "<robot name=\"demo\"/>",
        worldCameraCount: 0,
        worldObjectCount: 0,
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

    const openAction = hookValue?.workspaceTransfer.targets[0]?.onAction;
    expect(hookValue?.workspaceTransfer.targets[0]?.openLabel).toBe("Open in Blender");
    expect(openAction).toBeDefined();
    await act(async () => {
      await (openAction?.() as unknown as Promise<void>);
      await Promise.resolve();
    });

    expect(buildCurrentWorldSceneRegistryEnvelope).toHaveBeenCalledOnce();
    expect(openWorkspaceTransferTargetMock).toHaveBeenCalledOnce();
    expect(
      buildCurrentWorldSceneRegistryEnvelope.mock.invocationCallOrder[0]
    ).toBeLessThan(openWorkspaceTransferTargetMock.mock.invocationCallOrder[0]);

    await act(async () => {
      root.unmount();
    });
  });

  it("deduplicates rapid simulator open clicks before loading state commits", async () => {
    let resolveOpen:
      | ((value: typeof openedWorkspaceResponse) => void)
      | undefined;
    openWorkspaceTransferTargetMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOpen = resolve;
      })
    );
    const buildCurrentWorldSceneRegistryEnvelope = vi.fn(async () => createWorldPackage());
    let hookValue: ReturnType<typeof useWorkspaceTransferLauncher> | null = null;

    const Harness = () => {
      hookValue = useWorkspaceTransferLauncher({
        activeUrdfPath: "robot.urdf",
        attachedIluSessionId: "",
        buildCurrentWorldSceneRegistryEnvelope,
        meshFiles: {},
        originalUrdfContent: "<robot name=\"demo\"/>",
        packageRoots: {},
        vizUrdfContent: "<robot name=\"demo\"/>",
        worldCameraCount: 0,
        worldObjectCount: 0,
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

    const openAction = hookValue?.workspaceTransfer.targets[0]?.onAction;
    let firstOpen: Promise<void> | undefined;
    let secondOpen: Promise<void> | undefined;
    await act(async () => {
      firstOpen = openAction?.() as Promise<void>;
      secondOpen = openAction?.() as Promise<void>;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(buildCurrentWorldSceneRegistryEnvelope).toHaveBeenCalledOnce();
    expect(openWorkspaceTransferTargetMock).toHaveBeenCalledOnce();
    expect(hookValue?.workspaceTransfer.targets[0]?.isBusy).toBe(true);

    await act(async () => {
      resolveOpen?.(openedWorkspaceResponse);
      await firstOpen;
      await secondOpen;
      await Promise.resolve();
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("aborts an in-flight simulator open when the stop action runs", async () => {
    let observedSignal: AbortSignal | null = null;
    let observedLaunchId: string | null = null;
    openWorkspaceTransferTargetMock.mockImplementationOnce(
      ({ launchId, signal }: { launchId?: string; signal?: AbortSignal }) => {
        observedLaunchId = launchId ?? null;
        observedSignal = signal ?? null;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Workspace transfer cancelled.", "AbortError")),
            { once: true }
          );
        });
      }
    );
    const buildCurrentWorldSceneRegistryEnvelope = vi.fn(async () => createWorldPackage());
    let hookValue: ReturnType<typeof useWorkspaceTransferLauncher> | null = null;

    const Harness = () => {
      hookValue = useWorkspaceTransferLauncher({
        activeUrdfPath: "robot.urdf",
        attachedIluSessionId: "",
        buildCurrentWorldSceneRegistryEnvelope,
        meshFiles: {},
        originalUrdfContent: "<robot name=\"demo\"/>",
        packageRoots: {},
        vizUrdfContent: "<robot name=\"demo\"/>",
        worldCameraCount: 0,
        worldObjectCount: 0,
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

    let launchPromise: Promise<void> | undefined;
    await act(async () => {
      launchPromise = hookValue?.workspaceTransfer.targets[0]?.onAction() as Promise<void>;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openWorkspaceTransferTargetMock).toHaveBeenCalledOnce();
    expect(hookValue?.workspaceTransfer.targets[0]?.isBusy).toBe(true);
    expect(hookValue?.workspaceTransfer.targets[0]?.cancelLabel).toBe(
      "Stop opening Blender"
    );

    await act(async () => {
      hookValue?.workspaceTransfer.targets[0]?.onCancel?.();
      await launchPromise;
      await Promise.resolve();
    });

    expect(observedSignal?.aborted).toBe(true);
    expect(observedLaunchId).toBeTruthy();
    expect(cancelWorkspaceTransferTargetLaunchMock).toHaveBeenCalledWith({
      targetId: "blender",
      launchId: observedLaunchId,
      targetLabel: "Blender",
    });
    expect(hookValue?.workspaceTransfer.targets[0]?.isBusy).toBe(false);
    expect(toastErrorMock).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("warns when the simulator opens with unresolved mesh references", async () => {
    openWorkspaceTransferTargetMock.mockResolvedValueOnce({
      targetId: "blender",
      started: true,
      pid: 1234,
      command: ["python", "-m", "backend.scripts.blender_workspace_prepare"],
      worldPackagePath: "/tmp/world-package.json",
      robotUrdfPath: "/tmp/robot.urdf",
      bundledMeshCount: 0,
      unresolvedMeshRefs: ["meshes/missing-left.stl", "meshes/missing-right.stl"],
      worldObjectCount: 1,
      cameraCount: 0,
    });
    const buildCurrentWorldSceneRegistryEnvelope = vi.fn(async () => createWorldPackage());
    let hookValue: ReturnType<typeof useWorkspaceTransferLauncher> | null = null;

    const Harness = () => {
      hookValue = useWorkspaceTransferLauncher({
        activeUrdfPath: "robot.urdf",
        attachedIluSessionId: "",
        buildCurrentWorldSceneRegistryEnvelope,
        meshFiles: {},
        originalUrdfContent: "<robot name=\"demo\"/>",
        packageRoots: {},
        vizUrdfContent: "<robot name=\"demo\"/>",
        worldCameraCount: 0,
        worldObjectCount: 0,
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

    await act(async () => {
      await (hookValue?.workspaceTransfer.targets[0]?.onAction() as unknown as Promise<void>);
      await Promise.resolve();
    });

    expect(toastWarningMock).toHaveBeenCalledWith(
      "2 meshes could not be resolved: meshes/missing-left.stl, meshes/missing-right.stl"
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("warns when the simulator reports launch diagnostics", async () => {
    openWorkspaceTransferTargetMock.mockResolvedValueOnce({
      targetId: "blender",
      started: true,
      pid: 1234,
      command: ["python", "-m", "backend.scripts.blender_workspace_prepare"],
      worldPackagePath: "/tmp/world-package.json",
      robotUrdfPath: "/tmp/robot.urdf",
      bundledMeshCount: 0,
      unresolvedMeshRefs: [],
      workspaceWarnings: ["PyBullet GUI is using software OpenGL."],
      worldObjectCount: 1,
      cameraCount: 0,
    });
    const buildCurrentWorldSceneRegistryEnvelope = vi.fn(async () => createWorldPackage());
    let hookValue: ReturnType<typeof useWorkspaceTransferLauncher> | null = null;

    const Harness = () => {
      hookValue = useWorkspaceTransferLauncher({
        activeUrdfPath: "robot.urdf",
        attachedIluSessionId: "",
        buildCurrentWorldSceneRegistryEnvelope,
        meshFiles: {},
        originalUrdfContent: "<robot name=\"demo\"/>",
        packageRoots: {},
        vizUrdfContent: "<robot name=\"demo\"/>",
        worldCameraCount: 0,
        worldObjectCount: 0,
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

    await act(async () => {
      await (hookValue?.workspaceTransfer.targets[0]?.onAction() as unknown as Promise<void>);
      await Promise.resolve();
    });

    expect(toastWarningMock).toHaveBeenCalledWith(
      "PyBullet GUI is using software OpenGL."
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("blocks a robot-only transfer package when the Studio scene has objects", async () => {
    const buildCurrentWorldSceneRegistryEnvelope = vi.fn(async () => createWorldPackage());
    let hookValue: ReturnType<typeof useWorkspaceTransferLauncher> | null = null;

    const Harness = () => {
      hookValue = useWorkspaceTransferLauncher({
        activeUrdfPath: "robot.urdf",
        attachedIluSessionId: "",
        buildCurrentWorldSceneRegistryEnvelope,
        meshFiles: {},
        originalUrdfContent: "<robot name=\"demo\"/>",
        packageRoots: {},
        vizUrdfContent: "<robot name=\"demo\"/>",
        worldCameraCount: 0,
        worldObjectCount: 2,
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

    await act(async () => {
      await (hookValue?.workspaceTransfer.targets[0]?.onAction() as unknown as Promise<void>);
      await Promise.resolve();
    });

    expect(buildCurrentWorldSceneRegistryEnvelope).toHaveBeenCalledOnce();
    expect(openWorkspaceTransferTargetMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Workspace transfer blocked: Studio has world objects, but the generated scene package is empty."
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("blocks a robot-only transfer package when the live object store has objects", async () => {
    const buildCurrentWorldSceneRegistryEnvelope = vi.fn(async () => createWorldPackage());
    const getWorldObjectCountForTransfer = vi.fn(() => 2);
    let hookValue: ReturnType<typeof useWorkspaceTransferLauncher> | null = null;

    const Harness = () => {
      hookValue = useWorkspaceTransferLauncher({
        activeUrdfPath: "robot.urdf",
        attachedIluSessionId: "",
        buildCurrentWorldSceneRegistryEnvelope,
        getWorldObjectCountForTransfer,
        meshFiles: {},
        originalUrdfContent: "<robot name=\"demo\"/>",
        packageRoots: {},
        vizUrdfContent: "<robot name=\"demo\"/>",
        worldCameraCount: 0,
        worldObjectCount: 0,
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

    await act(async () => {
      await (hookValue?.workspaceTransfer.targets[0]?.onAction() as unknown as Promise<void>);
      await Promise.resolve();
    });

    expect(getWorldObjectCountForTransfer).toHaveBeenCalledOnce();
    expect(buildCurrentWorldSceneRegistryEnvelope).toHaveBeenCalledOnce();
    expect(openWorkspaceTransferTargetMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Workspace transfer blocked: Studio has world objects, but the generated scene package is empty."
    );

    await act(async () => {
      root.unmount();
    });
  });
});
