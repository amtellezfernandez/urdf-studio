/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WORLD_SCENE_PACKAGE_SCHEMA_VERSION } from "@/features/world-share/worldScenePackageParams";
import type { WorldScenePackageManifest } from "@/features/world-share/worldScenePackageTypes";
import { useWorkspaceTransferLauncher } from "@/app/pages/index/useWorkspaceTransferLauncher";

const {
  fetchWorkspaceTransferTargetsMock,
  fetchWorkspaceTransferTargetStatusMock,
  openWorkspaceTransferTargetMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  fetchWorkspaceTransferTargetsMock: vi.fn(),
  fetchWorkspaceTransferTargetStatusMock: vi.fn(),
  openWorkspaceTransferTargetMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/features/world-share/workspaceTransferApi", () => ({
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
  },
}));

const createWorldPackage = (): WorldScenePackageManifest => ({
  schema_version: WORLD_SCENE_PACKAGE_SCHEMA_VERSION,
  package_id: "demo-world",
  version: "1.0.0",
  title: "Demo World",
  created_at: "2026-01-01T00:00:00.000Z",
  runtime_targets: [],
  interface: {
    observation_modalities: ["state"],
    action_semantics: "joint_position",
    timestep_ms: 10,
    frame_convention: "ros-rep-103",
  },
  artifacts: [],
  world_snapshot: {
    urdf_xml: "<robot name=\"demo\"><link name=\"base\"/></robot>",
    joint_positions: {},
    cameras: [],
    objects: [],
    scenario_time_ms: 0,
    scenario_duration_ms: 0,
  },
  provenance: {},
  security: {
    signature_ref: null,
    attestation_refs: [],
    sbom_ref: null,
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
    fetchWorkspaceTransferTargetsMock.mockReset();
    fetchWorkspaceTransferTargetStatusMock.mockReset();
    openWorkspaceTransferTargetMock.mockReset();
    toastErrorMock.mockReset();
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
  });

  it("ensures the world layout before building the simulator package", async () => {
    const ensureWorldLayoutForTransfer = vi.fn(async () => undefined);
    const buildCurrentWorldScenePackageManifest = vi.fn(async () => createWorldPackage());
    let hookValue: ReturnType<typeof useWorkspaceTransferLauncher> | null = null;

    const Harness = () => {
      hookValue = useWorkspaceTransferLauncher({
        activeUrdfPath: "robot.urdf",
        attachedIluSessionId: "",
        buildCurrentWorldScenePackageManifest,
        ensureWorldLayoutForTransfer,
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

    expect(ensureWorldLayoutForTransfer).toHaveBeenCalledOnce();
    expect(buildCurrentWorldScenePackageManifest).toHaveBeenCalledOnce();
    expect(openWorkspaceTransferTargetMock).toHaveBeenCalledOnce();
    expect(
      ensureWorldLayoutForTransfer.mock.invocationCallOrder[0]
    ).toBeLessThan(buildCurrentWorldScenePackageManifest.mock.invocationCallOrder[0]);
    expect(
      buildCurrentWorldScenePackageManifest.mock.invocationCallOrder[0]
    ).toBeLessThan(openWorkspaceTransferTargetMock.mock.invocationCallOrder[0]);

    await act(async () => {
      root.unmount();
    });
  });

  it("does not open a simulator when world-layout preparation fails", async () => {
    const ensureWorldLayoutForTransfer = vi.fn(async () => {
      throw new Error("Default world layout transfer failed");
    });
    const buildCurrentWorldScenePackageManifest = vi.fn(async () => createWorldPackage());
    let hookValue: ReturnType<typeof useWorkspaceTransferLauncher> | null = null;

    const Harness = () => {
      hookValue = useWorkspaceTransferLauncher({
        activeUrdfPath: "robot.urdf",
        attachedIluSessionId: "",
        buildCurrentWorldScenePackageManifest,
        ensureWorldLayoutForTransfer,
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

    expect(ensureWorldLayoutForTransfer).toHaveBeenCalledOnce();
    expect(buildCurrentWorldScenePackageManifest).not.toHaveBeenCalled();
    expect(openWorkspaceTransferTargetMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("Default world layout transfer failed");

    await act(async () => {
      root.unmount();
    });
  });

  it("blocks a robot-only transfer package when the Studio scene has objects", async () => {
    const ensureWorldLayoutForTransfer = vi.fn(async () => undefined);
    const buildCurrentWorldScenePackageManifest = vi.fn(async () => createWorldPackage());
    let hookValue: ReturnType<typeof useWorkspaceTransferLauncher> | null = null;

    const Harness = () => {
      hookValue = useWorkspaceTransferLauncher({
        activeUrdfPath: "robot.urdf",
        attachedIluSessionId: "",
        buildCurrentWorldScenePackageManifest,
        ensureWorldLayoutForTransfer,
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

    expect(ensureWorldLayoutForTransfer).toHaveBeenCalledOnce();
    expect(buildCurrentWorldScenePackageManifest).toHaveBeenCalledOnce();
    expect(openWorkspaceTransferTargetMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Workspace transfer blocked: Studio has world objects, but the generated scene package is empty."
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("blocks a robot-only transfer package when the live object store has objects", async () => {
    const ensureWorldLayoutForTransfer = vi.fn(async () => undefined);
    const buildCurrentWorldScenePackageManifest = vi.fn(async () => createWorldPackage());
    const getWorldObjectCountForTransfer = vi.fn(() => 2);
    let hookValue: ReturnType<typeof useWorkspaceTransferLauncher> | null = null;

    const Harness = () => {
      hookValue = useWorkspaceTransferLauncher({
        activeUrdfPath: "robot.urdf",
        attachedIluSessionId: "",
        buildCurrentWorldScenePackageManifest,
        ensureWorldLayoutForTransfer,
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

    expect(ensureWorldLayoutForTransfer).toHaveBeenCalledOnce();
    expect(getWorldObjectCountForTransfer).toHaveBeenCalledOnce();
    expect(buildCurrentWorldScenePackageManifest).toHaveBeenCalledOnce();
    expect(openWorkspaceTransferTargetMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Workspace transfer blocked: Studio has world objects, but the generated scene package is empty."
    );

    await act(async () => {
      root.unmount();
    });
  });
});
