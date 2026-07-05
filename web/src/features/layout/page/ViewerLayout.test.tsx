/** @vitest-environment jsdom */
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { Box3 } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/layout/page/ViewerHost", async () => {
  const React = await import("react");
  return {
    ViewerHost: ({
      fallbackClassName,
      viewerKey,
    }: {
      fallbackClassName: string;
      viewerKey: string;
    }) =>
      React.createElement("div", {
        "data-viewer-host": viewerKey,
        "data-viewer-host-fallback": fallbackClassName,
      }),
  };
});

vi.mock("@/features/layout/page/WorkspaceViewerContent", async () => {
  const React = await import("react");
  return {
    WorkspaceViewerContent: ({
      assemblySecondaryModelsCount,
      primaryRobotName,
      showUrdfEditor,
      workspaceMode,
    }: {
      assemblySecondaryModelsCount: number;
      primaryRobotName: string;
      showUrdfEditor: boolean;
      workspaceMode: string;
    }) =>
      React.createElement("div", {
        "data-workspace-viewer-content": `${workspaceMode}:${primaryRobotName}:${assemblySecondaryModelsCount}:${showUrdfEditor}`,
      }),
  };
});

vi.mock("@/features/urdf/editor/URDFComparison", async () => {
  const React = await import("react");
  return {
    URDFComparison: ({
      inline,
      isOpen,
      splitView,
    }: {
      inline: boolean;
      isOpen: boolean;
      splitView: boolean;
    }) =>
      React.createElement("div", {
        "data-urdf-comparison": `${isOpen}:${inline}:${splitView}`,
      }),
  };
});

import { ViewerLayout } from "@/features/layout/page/ViewerLayout";

type ViewerLayoutProps = ComponentProps<typeof ViewerLayout>;

const createProps = (overrides: Partial<ViewerLayoutProps> = {}): ViewerLayoutProps => ({
  workspaceMode: "studio",
  assemblyContactPairCount: 0,
  assemblySecondaryModels: [],
  collisionMergedLinks: [],
  collisionSimplifyLinks: [],
  collisionVisibility: {},
  collisionsVisible: false,
  endEffectorLink: null,
  getExportUrdfContent: vi.fn(() => "<robot />"),
  handleFrameChange: vi.fn(),
  handleIkApplied: vi.fn(),
  handleJointChange: vi.fn(),
  handleRobotJointsLoaded: vi.fn(),
  handleVizUrdfChange: vi.fn(),
  hoveredJoint: null,
  hoveredLink: null,
  inertialVisualization: {
    showGlobalCOM: false,
    showInertia: false,
    showLinkCOM: false,
    showReferenceGeometry: false,
    scopedLinkNames: null,
  },
  isRightSidebarCollapsed: false,
  isSidebarCollapsed: false,
  jointAxes: {},
  jointLimits: {},
  jointValues: {},
  meshFiles: {},
  originalUrdfContent: "<robot name='test' />",
  rightSidebarWidth: 280,
  robot: null,
  robotBoundingBox: null as Box3 | null,
  rotationPlaneVisible: false,
  selectedJoint: null,
  selectedLink: null,
  setHasAnimationFrames: vi.fn(),
  setHoveredJoint: vi.fn(),
  setHoveredLink: vi.fn(),
  setIsPlaying: vi.fn(),
  setRobot: vi.fn(),
  setRobotBoundingBox: vi.fn(),
  setSelectedJoint: vi.fn(),
  setSelectedLink: vi.fn(),
  setShowUrdfEditor: vi.fn(),
  setUrdfEditorSplitView: vi.fn(),
  setUrdfViewMode: vi.fn(),
  showUrdfEditor: false,
  sidebarWidth: 320,
  simulationPrepPanelOpen: false,
  urdfAnalysis: null,
  urdfContentVersion: 7,
  urdfEditorSplitView: false,
  urdfFile: { name: "viz-robot.urdf" } as File,
  urdfViewMode: "split",
  updateUrdfFile: vi.fn(),
  vizUrdfContent: "<robot name='viz' />",
  ...overrides,
});

const renderViewerLayout = async (props: ViewerLayoutProps) => {
  const container = document.createElement("div");
  const root = createRoot(container);

  await act(async () => {
    root.render(createElement(ViewerLayout, props));
  });

  return { container, root };
};

describe("ViewerLayout", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("renders a full-screen thumbnail viewer without sidebar margins", async () => {
    const { container, root } = await renderViewerLayout(
      createProps({
        thumbnailMode: true,
      })
    );

    const main = container.querySelector("main");
    expect(main?.className).toContain("h-screen");
    expect(container.querySelector('[data-viewer-host="urdf-7"]')).toBeTruthy();
    expect(container.querySelector("[data-workspace-viewer-content]")).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("renders the viewer and inline URDF comparison when the editor is open", async () => {
    const { container, root } = await renderViewerLayout(
      createProps({
        showUrdfEditor: true,
        urdfEditorSplitView: true,
      })
    );

    expect(container.querySelector('[data-viewer-host="urdf-7"]')).toBeTruthy();
    expect(container.querySelector('[data-urdf-comparison="true:true:true"]')).toBeTruthy();
    expect(container.querySelector("[data-workspace-viewer-content]")).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("renders workspace viewer content with derived layout margins when the editor is closed", async () => {
    const { container, root } = await renderViewerLayout(
      createProps({
        isRightSidebarCollapsed: true,
        showUrdfEditor: false,
      })
    );

    const main = container.querySelector("main") as HTMLElement | null;
    expect(main?.style.marginLeft).toBe("320px");
    expect(main?.style.marginRight).toBe("0px");
    expect(main?.style.marginTop).toBe("28px");
    expect(
      container.querySelector('[data-workspace-viewer-content="studio:robot.urdf:0:false"]')
    ).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
  });
});
