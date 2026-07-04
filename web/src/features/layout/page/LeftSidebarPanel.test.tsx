/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeftSidebarPanel } from "./LeftSidebarPanel";
import { useCameraStore } from "@/shared/store/useCameraStore";
import type { WorkspaceTransferState } from "@/features/layout/page/workspaceTransferState";

vi.mock("@/features/layout/panels/CameraPreviewPanel", async () => {
  const React = await import("react");
  return {
    CameraPreviewPanel: ({ cameras }: { cameras: unknown[] }) =>
      React.createElement("div", { "data-camera-panel": String(cameras.length) }),
  };
});

const workspaceTransfer: WorkspaceTransferState = {
  sceneSummary: "13 obj · 2 cam",
  targets: [
    {
      id: "genesis",
      label: "Genesis",
      targetKind: "physics_simulator",
      detail: "URDF simulation workspace · 13 obj · 2 cam",
      robotAssetFormat: "urdf",
      sceneAssetFormat: "urdf",
      transferStrategy: "direct",
      transferDescription: "Uses the loaded URDF directly.",
      createsTransferAsset: false,
      statusLabel: "ready",
      openLabel: "Open in Genesis",
      openingLabel: "Opening Genesis",
      isBusy: false,
      canOpen: true,
      disabledLabel: "Genesis unavailable",
      onAction: vi.fn(),
    },
  ],
};

const createProps = () => ({
  workspaceMode: "studio" as const,
  assemblyInspector: null,
  assemblyHasPhysicalContact: false,
  assemblyContactPairCount: 0,
  assemblyProposalRequested: false,
  onRequestAssemblyProposal: vi.fn(),
  isLoading: false,
  availableJoints: [],
  availableLinks: [],
  cameraCount: 1,
  onJointSelect: vi.fn(),
  selectedJoint: null,
  originalUrdfContent: "<robot name='test' />",
  vizUrdfContent: "<robot name='test' />",
  sidebarWidth: 260,
  isSidebarCollapsed: false,
  onToggleCollapse: vi.fn(),
  meshFiles: {},
  topPanelHeight: 0.34,
  onVerticalResizeStart: vi.fn(),
  onSidebarResizeStart: vi.fn(),
  workspaceTransfer,
  workspaceLauncherNeedsAttention: false,
  workspaceLauncherStatusLabel: "Ready",
  onOpenWorkspaceLauncher: vi.fn(),
});

describe("LeftSidebarPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    useCameraStore.setState({
      cameras: [
        {
          id: "camera-1",
          name: "Camera 1",
          parent_joint: "base",
          pose: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
          intrinsics: { width: 640, height: 480, fov_deg: 60 },
        },
      ],
      selectedCameraId: null,
    });
  });

  it("renders compact simulator targets above a resizable camera section", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = createProps();

    await act(async () => {
      root.render(createElement(LeftSidebarPanel, props));
    });

    expect(container.textContent).toContain("Simulation Prep");
    expect(container.textContent).toContain("Genesis");
    expect(container.textContent).not.toContain("URDF simulation workspace");
    expect(container.querySelector("[data-camera-panel]")?.getAttribute("data-camera-panel")).toBe("1");

    const splitContainer = container.querySelector("[data-left-sidebar-split-container='true']");
    expect(splitContainer).toBeTruthy();
    expect(
      (splitContainer?.firstElementChild as HTMLElement | null)?.style.flexBasis
    ).toBe("34%");

    const resizeHandle = container.querySelector('[aria-label="Resize cameras panel"]');
    expect(resizeHandle).toBeTruthy();
    await act(async () => {
      resizeHandle?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 })
      );
    });
    expect(props.onVerticalResizeStart).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps a busy simulator target clickable as a stop action", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = createProps();
    const onAction = vi.fn();
    const onCancel = vi.fn();
    props.workspaceTransfer = {
      ...workspaceTransfer,
      targets: [
        {
          ...workspaceTransfer.targets[0],
          isBusy: true,
          cancelLabel: "Stop opening Genesis",
          onAction,
          onCancel,
        },
      ],
    };

    await act(async () => {
      root.render(createElement(LeftSidebarPanel, props));
    });

    const stopButton = container.querySelector(
      'button[aria-label="Stop opening Genesis"]'
    ) as HTMLButtonElement | null;
    expect(stopButton).toBeTruthy();
    expect(stopButton?.disabled).toBe(false);
    expect(stopButton?.querySelector(".lucide-x")).toBeTruthy();

    await act(async () => {
      stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("shows the launcher status label when there are no workspace targets", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = createProps();
    props.workspaceTransfer = {
      sceneSummary: null,
      targets: [],
    };
    props.workspaceLauncherStatusLabel = "Backend offline";

    await act(async () => {
      root.render(createElement(LeftSidebarPanel, props));
    });

    expect(container.textContent).toContain("Backend offline");
    expect(container.textContent).toContain(
      "Start the backend to list compatible simulators and tools."
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("marks degraded openable simulator targets with an attention dot", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = createProps();
    props.workspaceTransfer = {
      ...workspaceTransfer,
      targets: [
        {
          ...workspaceTransfer.targets[0],
          needsAttention: true,
          statusLabel: "ready, display degraded: software OpenGL",
        },
      ],
    };

    await act(async () => {
      root.render(createElement(LeftSidebarPanel, props));
    });

    const openButton = container.querySelector(
      'button[aria-label="Open in Genesis"]'
    ) as HTMLButtonElement | null;
    expect(openButton).toBeTruthy();
    expect(openButton?.disabled).toBe(false);
    expect(openButton?.title).toContain("display degraded");
    expect(openButton?.querySelector("span")?.className).toContain("bg-amber");

    await act(async () => {
      root.unmount();
    });
  });
});
