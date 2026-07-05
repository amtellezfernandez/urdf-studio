/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TopNavBar } from "./TopNavBar";
import type { TopNavBarProps } from "@/features/layout/page/top-nav/types";

const createProps = (): TopNavBarProps => ({
  workspaceMode: "studio",
  onWorkspaceModeChange: vi.fn(),
  onExportAssemblyUrdf: vi.fn(),
  showMenus: false,
  openExportDialog: vi.fn(),
  onSave: vi.fn(),
  onRevert: vi.fn(),
  canRevert: false,
  onResetRotation: vi.fn(),
  hasRotationChanges: false,
  onCanonicalOrder: vi.fn(),
  onPrettyPrint: vi.fn(),
  onNormalizeAxes: vi.fn(),
  onFixMeshPaths: vi.fn(),
  rotationAxis: "z",
  setRotationAxis: vi.fn(),
  onRotateRobot: vi.fn(),
  angleUnit: "rad",
  setAngleUnit: vi.fn(),
  rendererRuntime: "studio3D",
  onRendererRuntimeChange: vi.fn(),
  rendererRuntimeLocked: false,
  rosVizRuntimeAvailable: false,
  viewerProfile: "studio",
  onViewerProfileChange: vi.fn(),
  viewerProfileLocked: false,
  displaysPanelOpen: false,
  runtimeHealthPanelOpen: false,
  onToggleDisplaysPanel: vi.fn(),
  onToggleRuntimeHealthPanel: vi.fn(),
  gpuMode: "high",
  setGPUMode: vi.fn(),
  collisionsVisible: false,
  setCollisionsVisible: vi.fn(),
  showUrdfEditor: false,
  setShowUrdfEditor: vi.fn(),
  urdfViewMode: "split",
  setUrdfViewMode: vi.fn(),
  isPovCamerasOverlayOpen: false,
  onOpenPovCamerasOverlay: vi.fn(),
  inertialVisualization: {
    showGlobalCOM: false,
    showLinkCOM: false,
    showInertia: false,
    showReferenceGeometry: false,
    scopedLinkNames: null,
  },
  setInertialVisualization: vi.fn(),
  onValidateCurrentWorldScenePackage: vi.fn(),
  onPublishCurrentWorldScenePackage: vi.fn(),
  onPublishCurrentWorldScenePackageToHub: vi.fn(),
  onExportCurrentWorldScenePackage: vi.fn(),
  onImportWorldScenePackage: vi.fn(),
  onExportCurrentWorldSceneLayer: vi.fn(),
  onImportSceneLayerFromUrl: vi.fn(),
  onImportSplatBackground: vi.fn(),
  onImportWorkspaceChangeSet: vi.fn(),
  onListWorldScenePackages: vi.fn(),
  onOpenWorldHubBrowser: vi.fn(),
  openObjectCreator: vi.fn(),
  onOpenCameraCreator: vi.fn(),
  onOpenCameraUpload: vi.fn(),
  exportCamerasAsJSON: vi.fn(),
  exportCamerasAsYAML: vi.fn(),
  hasCamerasToExport: false,
  workspaceLauncherStatusLabel: "Physics Warning",
  workspaceLauncherNeedsAttention: true,
  onOpenWorkspaceLauncher: vi.fn(),
  studioIssueReportUrl: undefined,
});

const renderTopNavBar = async (
  root: ReturnType<typeof createRoot>,
  props: TopNavBarProps,
  initialEntries = ["/viewer"],
) => {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries },
        createElement(TopNavBar, props),
      ),
    );
  });
};

const LocationProbe = ({
  onPathnameChange,
}: {
  onPathnameChange: (pathname: string) => void;
}) => {
  onPathnameChange(useLocation().pathname);
  return null;
};

describe("TopNavBar", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("team sharing gate unavailable")));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("keeps the top nav discreet and does not expose the old mesh-axis warning", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = createProps();

    await renderTopNavBar(root, props);

    expect(container.textContent).not.toContain("Mesh Up-Axis");
    expect(container.textContent).not.toContain("Physics Warning");
    expect(container.textContent).not.toContain("Credentials");
    expect(container.textContent).not.toContain("Browser token entry");
    expect(container.textContent).toContain("Simulation Prep");
    expect(container.textContent).not.toContain("Review");
    expect(container.querySelector('button[title^="IK"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("navigates home when the logo link is clicked", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = { ...createProps(), onGoHome: vi.fn() };
    let currentPathname = "";

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/viewer"] },
          createElement(TopNavBar, props),
          createElement(LocationProbe, {
            onPathnameChange: (pathname: string) => {
              currentPathname = pathname;
            },
          }),
        ),
      );
    });

    expect(currentPathname).toBe("/viewer");
    const homeLink = container.querySelector('a[aria-label="Go to home page"]');
    expect(homeLink).toBeTruthy();
    expect(homeLink?.getAttribute("href")).toBe("/");
    expect(homeLink?.getAttribute("title")).toBe("Go to home page");

    await act(async () => {
      homeLink?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    });

    expect(props.onGoHome).toHaveBeenCalledTimes(1);
    expect(currentPathname).toBe("/");

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps simulation prep available from the top nav and opens it on click", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = createProps();

    await renderTopNavBar(root, props);

    expect(container.textContent).toContain("Simulation Prep");
    expect(container.textContent).not.toContain("Physics Warning");
    expect(container.textContent).not.toContain("Review");

    const simulationPrepButton = container.querySelector('button[aria-label="Simulation Prep"]');
    expect(simulationPrepButton).toBeTruthy();
    expect(simulationPrepButton?.getAttribute("title")).toBe(
      "Simulation Prep: Physics Warning",
    );

    await act(async () => {
      simulationPrepButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(props.onOpenWorkspaceLauncher).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("surfaces world rollout actions from the Scene menu", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = {
      ...createProps(),
      showMenus: true,
      onExportWorldRolloutCampaign: vi.fn(),
      onRunLocalWorldRollout: vi.fn(),
      onImportWorldRolloutResults: vi.fn(),
      onOpenWorldRolloutReview: vi.fn(),
    };

    await renderTopNavBar(root, props);

    const sceneButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Scene"
    );
    expect(sceneButton).toBeTruthy();

    await act(async () => {
      sceneButton?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });

    const rolloutMenuItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (item) => item.textContent === "Export Rollout Campaign"
    );
    expect(rolloutMenuItem).toBeTruthy();

    await act(async () => {
      rolloutMenuItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(props.onExportWorldRolloutCampaign).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("surfaces workspace change import from the Scene menu", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = {
      ...createProps(),
      showMenus: true,
      onImportWorkspaceChangeSet: vi.fn(),
    };

    await renderTopNavBar(root, props);

    const sceneButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Scene"
    );
    expect(sceneButton).toBeTruthy();

    await act(async () => {
      sceneButton?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });

    const workspaceChangeMenuItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (item) => item.textContent === "Import Workspace Changes"
    );
    expect(workspaceChangeMenuItem).toBeTruthy();

    await act(async () => {
      workspaceChangeMenuItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(props.onImportWorkspaceChangeSet).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("routes camera scene and view actions through explicit open callbacks", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = {
      ...createProps(),
      showMenus: true,
      onOpenCameraUpload: vi.fn(),
      onOpenPovCamerasOverlay: vi.fn(),
    };

    await renderTopNavBar(root, props);

    const openMenu = async (label: string) => {
      const menuButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === label
      );
      expect(menuButton).toBeTruthy();
      await act(async () => {
        menuButton?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      });
    };

    const clickMenuItem = async (label: string) => {
      const menuItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
        (item) => item.textContent === label
      );
      expect(menuItem).toBeTruthy();
      await act(async () => {
        menuItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };

    await openMenu("Scene");
    await clickMenuItem("Import Camera Setup");
    expect(props.onOpenCameraUpload).toHaveBeenCalledTimes(1);

    await openMenu("View");
    await clickMenuItem("POV Cameras");
    expect(props.onOpenPovCamerasOverlay).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the issue report link icon-only", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const issueUrl = "https://github.com/acme/urdf-studio/issues/new";
    const props = { ...createProps(), studioIssueReportUrl: issueUrl };

    await renderTopNavBar(root, props);

    expect(container.textContent).not.toContain("Open issue");
    const issueLink = container.querySelector('a[aria-label="Open issue"]');
    expect(issueLink).toBeTruthy();
    expect(issueLink?.getAttribute("href")).toBe(issueUrl);
    expect(issueLink?.getAttribute("title")).toBe("Open issue");
    expect(issueLink?.className).toContain("w-7");

    await act(async () => {
      root.unmount();
    });
  });

});
