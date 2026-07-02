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
  showPovCameras: false,
  setShowPovCameras: vi.fn(),
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
  onImportWorkspaceChangeSet: vi.fn(),
  onListWorldScenePackages: vi.fn(),
  onOpenWorldHubBrowser: vi.fn(),
  openObjectCreator: vi.fn(),
  setShowCameraCreator: vi.fn(),
  setShowCameraUpload: vi.fn(),
  exportCamerasAsJSON: vi.fn(),
  exportCamerasAsYAML: vi.fn(),
  hasCamerasToExport: false,
  isIkPanelOpen: false,
  onOpenIkPanel: vi.fn(),
  selectedIkSolverId: "ik-js",
  ikSolverOptions: [{ id: "ik-js", label: "IK JS" }],
  onSelectIkSolver: vi.fn(),
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
    expect(container.textContent).toContain("Open In");
    expect(container.textContent).not.toContain("Review");

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

    expect(container.textContent).toContain("Open In");
    expect(container.textContent).not.toContain("Physics Warning");
    expect(container.textContent).not.toContain("Review");

    const simulationPrepButton = container.querySelector('button[aria-label="Open In"]');
    expect(simulationPrepButton).toBeTruthy();
    expect(simulationPrepButton?.getAttribute("title")).toBe("Open In: Physics Warning");

    await act(async () => {
      simulationPrepButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(props.onOpenWorkspaceLauncher).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("uses teleop connection state, not popup visibility, for leader and follower colors", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = {
      ...createProps(),
      leaderInputConnected: true,
      leaderInputPanelOpen: false,
      followerHardwareConnected: false,
      followerHardwarePanelOpen: true,
    };

    await renderTopNavBar(root, props);

    const buttons = Array.from(container.querySelectorAll("button"));
    const leaderButton = buttons.find(
      (button) => button.textContent === "Controller",
    );
    const followerButton = buttons.find(
      (button) => button.textContent === "Robot",
    );

    expect(leaderButton?.className).toContain("border-emerald-500/35");
    expect(followerButton?.className).not.toContain("border-emerald-500/35");
    expect(followerButton?.className).toContain("bg-muted/30");

    await act(async () => {
      root.unmount();
    });
  });

  it("surfaces world rollout actions from the Worlds menu", async () => {
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

    const worldsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Worlds"
    );
    expect(worldsButton).toBeTruthy();

    await act(async () => {
      worldsButton?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
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

  it("surfaces workspace change import from the Worlds menu", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = {
      ...createProps(),
      showMenus: true,
      onImportWorkspaceChangeSet: vi.fn(),
    };

    await renderTopNavBar(root, props);

    const worldsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Worlds"
    );
    expect(worldsButton).toBeTruthy();

    await act(async () => {
      worldsButton?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
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

  it("mounts the share menu only after collaboration actions are ready", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const baseProps = createProps();
    const propsWithShare = {
      ...baseProps,
      collaborationOwner: true,
      collaborationStatus: "connected" as const,
      onCreateCollaborationLink: vi.fn(),
      onEmailCollaborationLink: vi.fn(),
      onResetCollaborationLink: vi.fn(),
    };

    await renderTopNavBar(root, baseProps);
    expect(container.querySelector('button[aria-label="Share"]')).toBeNull();

    await renderTopNavBar(root, propsWithShare);
    const shareButton = container.querySelector('button[aria-label="Share"]');
    expect(shareButton).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps share link labels stable while an invite action is in flight", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = {
      ...createProps(),
      collaborationInviteAction: "creating" as const,
      collaborationOwner: true,
      collaborationStatus: "idle" as const,
      onCreateCollaborationLink: vi.fn(),
      onEmailCollaborationLink: vi.fn(),
      onResetCollaborationLink: vi.fn(),
      onSetCollaborationSharingEnabled: vi.fn(),
    };

    await renderTopNavBar(root, props);

    const shareButton = container.querySelector('button[aria-label="Share"]');
    expect(shareButton).toBeTruthy();
    expect(shareButton?.getAttribute("title")).toBe("Share");
    expect(shareButton?.className).toContain("text-muted-foreground");

    await act(async () => {
      shareButton?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });

    expect(document.body.textContent).toContain("Share");
    expect(document.body.textContent).not.toContain("Creating link...");
    expect(document.body.textContent).toContain("Local only");
    expect(document.body.textContent).toContain("Localhost links only work on this computer. Restart Studio to enable network links for Wi-Fi or Tailnet.");
    expect(document.body.textContent).toContain("People with access");
    expect(document.body.textContent).toContain("Titular");
    expect(document.body.textContent).toContain("Anyone with view link");
    expect(document.body.textContent).toContain("Anyone with edit link");
    expect(document.body.textContent).toContain("Link sharing is off");
    expect(document.body.textContent).toContain("Inactive");
    expect(document.body.textContent).not.toContain("Private workspace");
    expect(document.body.textContent).not.toContain("Team workspace");
    const copyButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Copy link"),
    ) as HTMLButtonElement | undefined;
    expect(copyButton).toBeTruthy();
    expect(copyButton?.disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });


  it("turns Team sharing on in-session and uses the network invite URL", async () => {
    const teamUrl = "http://192.168.1.40:5173";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            available: true,
            enabled: false,
            localUrl: "http://localhost:5173",
            teamUrl,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            available: true,
            enabled: true,
            localUrl: "http://localhost:5173",
            teamUrl,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            available: true,
            enabled: false,
            localUrl: "http://localhost:5173",
            teamUrl,
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    const root = createRoot(container);
    const props = {
      ...createProps(),
      collaborationOwner: true,
      collaborationStatus: "connected" as const,
      onCreateCollaborationLink: vi.fn(),
      onEmailCollaborationLink: vi.fn(),
      onResetCollaborationLink: vi.fn(),
      onSetCollaborationSharingEnabled: vi.fn(),
    };

    await renderTopNavBar(root, props);
    await act(async () => {
      await Promise.resolve();
    });

    const shareButton = container.querySelector('button[aria-label="Share"]');
    expect(shareButton).toBeTruthy();
    await act(async () => {
      shareButton?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });

    const reactivateSharingButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent === "Reactivate sharing",
    );
    expect(reactivateSharingButton).toBeTruthy();

    await act(async () => {
      reactivateSharingButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/__urdf_team_sharing",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ enabled: true }) }),
    );

    expect(document.body.textContent).toContain(
      "Network link is on. This link works for devices on the same Wi-Fi or Tailnet.",
    );

    const emptySendButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent === "Send",
    ) as HTMLButtonElement | undefined;
    expect(emptySendButton?.disabled).toBe(true);
    expect(props.onEmailCollaborationLink).not.toHaveBeenCalled();

    expect(document.body.textContent).toContain("Anyone with view link");
    expect(document.body.textContent).toContain("Anyone with edit link");
    expect(document.body.textContent).toContain("Choose permissions for this invite.");
    expect(document.body.textContent).toContain("Teleop is for trusted operators only.");

    const permissionSelect = Array.from(document.body.querySelectorAll("select")).find(
      (select) => select.value === "viewer",
    ) as HTMLSelectElement | undefined;
    expect(permissionSelect).toBeTruthy();
    await act(async () => {
      if (permissionSelect) permissionSelect.value = "editor";
      permissionSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(permissionSelect?.value).toBe("editor");

    await act(async () => {
      if (permissionSelect) permissionSelect.value = "viewer_teleop";
      permissionSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(permissionSelect?.value).toBe("viewer_teleop");
    expect(document.body.textContent).toContain("Can view + teleop");

    let copyLinkButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Copy link"),
    ) as HTMLButtonElement | undefined;
    if (!copyLinkButton) {
      await act(async () => {
        shareButton?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      });
      copyLinkButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Copy link"),
      ) as HTMLButtonElement | undefined;
    }
    expect(copyLinkButton).toBeTruthy();
    expect(copyLinkButton?.disabled).toBe(false);
    await act(async () => {
      copyLinkButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(props.onCreateCollaborationLink).toHaveBeenCalledWith(teamUrl, "viewer_teleop");

    const stopSharingButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent === "Stop sharing",
    ) as HTMLButtonElement | undefined;
    expect(stopSharingButton).toBeTruthy();
    expect(stopSharingButton?.disabled).toBe(false);
    await act(async () => {
      stopSharingButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(props.onSetCollaborationSharingEnabled).toHaveBeenCalledWith(false);
    expect(fetchMock).not.toHaveBeenLastCalledWith(
      "/__urdf_team_sharing",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ enabled: false }) }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("pauses reusable network links without turning off the network gateway", async () => {
    const teamUrl = "http://192.168.1.40:5173";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          available: true,
          enabled: true,
          localUrl: "http://localhost:5173",
          teamUrl,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    const root = createRoot(container);
    const props = {
      ...createProps(),
      collaborationOwner: true,
      collaborationSharingEnabled: false,
      collaborationStatus: "connected" as const,
      onCreateCollaborationLink: vi.fn(),
      onEmailCollaborationLink: vi.fn(),
      onResetCollaborationLink: vi.fn(),
      onSetCollaborationSharingEnabled: vi.fn(),
    };

    await renderTopNavBar(root, props);
    await act(async () => {
      await Promise.resolve();
    });

    const shareButton = container.querySelector('button[aria-label="Share"]');
    await act(async () => {
      shareButton?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });

    expect(document.body.textContent).toContain("Sharing is paused");
    expect(document.body.textContent).toContain("Existing links stay reusable");
    expect(document.body.textContent).toContain("Temporarily unavailable");
    expect(document.body.textContent).toContain("Paused");
    const copyLinkButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Copy link"),
    ) as HTMLButtonElement | undefined;
    expect(copyLinkButton?.disabled).toBe(true);

    const reactivateSharingButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent === "Reactivate sharing",
    ) as HTMLButtonElement | undefined;
    expect(reactivateSharingButton?.disabled).toBe(false);
    await act(async () => {
      reactivateSharingButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(props.onSetCollaborationSharingEnabled).toHaveBeenCalledWith(true);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/__urdf_team_sharing",
      expect.objectContaining({ method: "POST" }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps localhost sharing local-only behind a grey share menu", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = {
      ...createProps(),
      collaborationOwner: true,
      collaborationPeerCount: 3,
      collaborationStatus: "connected" as const,
      onCreateCollaborationLink: vi.fn(),
      onEmailCollaborationLink: vi.fn(),
      onResetCollaborationLink: vi.fn(),
      onSetCollaborationSharingEnabled: vi.fn(),
    };

    await renderTopNavBar(root, props);

    expect(container.textContent).not.toContain("Live session");
    expect(container.textContent).not.toContain("Lock editing");
    expect(container.textContent).not.toContain("Rotate link");
    expect(container.textContent).not.toContain("Team workspace");

    const shareButton = container.querySelector('button[aria-label="Share"]');
    expect(shareButton).toBeTruthy();
    expect(shareButton?.getAttribute("title")).toBe("Share");
    expect(shareButton?.textContent).toContain("3");

    await act(async () => {
      shareButton?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });

    expect(document.body.textContent).toContain("Share");
    expect(document.body.textContent).toContain("2 guests connected");
    expect(document.body.textContent).toContain("Local only");
    expect(document.body.textContent).toContain("Localhost links only work on this computer. Restart Studio to enable network links for Wi-Fi or Tailnet.");
    expect(document.body.textContent).toContain("People with access");
    expect(document.body.textContent).toContain("Titular");
    expect(document.body.textContent).toContain("Anyone with view link");
    expect(document.body.textContent).toContain("Anyone with edit link");
    expect(document.body.textContent).toContain("Link sharing is off");
    expect(document.body.textContent).toContain("Inactive");
    expect(document.body.textContent).toContain("Reactivate sharing");
    expect(document.body.textContent).toContain("Reset link");
    const menuText = document.body.textContent ?? "";
    expect(menuText.indexOf("People with access")).toBeLessThan(menuText.indexOf("Link sharing"));
    expect(menuText.indexOf("Link sharing")).toBeLessThan(menuText.indexOf("Add more people"));
    expect(document.body.textContent).not.toContain("Private workspace");
    expect(document.body.textContent).not.toContain("Team workspace");

    const emailInput = document.body.querySelector("input") as HTMLInputElement | null;
    expect(emailInput?.placeholder).toBe("Reactivate sharing first");
    expect(emailInput?.disabled).toBe(true);
    expect(props.onEmailCollaborationLink).not.toHaveBeenCalled();

    const copyLinkButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Copy link"),
    ) as HTMLButtonElement | undefined;
    expect(copyLinkButton).toBeTruthy();
    expect(copyLinkButton?.disabled).toBe(true);

    const resetLinkButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent === "Reset link",
    );
    expect(resetLinkButton).toBeTruthy();
    await act(async () => {
      resetLinkButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(props.onCreateCollaborationLink).not.toHaveBeenCalled();
    expect(props.onResetCollaborationLink).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});
