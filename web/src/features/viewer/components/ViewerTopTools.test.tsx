/** @vitest-environment jsdom */
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ViewerTopTools } from "@/features/viewer/components/ViewerTopTools";

type ViewerTopToolsProps = ComponentProps<typeof ViewerTopTools>;

const createProps = (
  overrides: Partial<ViewerTopToolsProps> = {}
): ViewerTopToolsProps => ({
  activeWheelDriveCount: 0,
  canOpenDragModeMenu: true,
  canUseDragHandleMode: true,
  dragMode: "drag-handle",
  hasSelectedWorldObject: false,
  hasStudioWheelDrive: false,
  isDragModeMenuOpen: true,
  isFollowingOrbit: false,
  isObjectToolsOpen: false,
  isReadOnly: false,
  isRobotLoaded: true,
  isWheelDriveEnabled: false,
  isWheelRolesOpen: false,
  objectEditMode: "move",
  orbitFollowProgress: 0,
  studioWheelRoleDisplayEntries: [],
  onDeleteSelectedWorldObject: vi.fn(),
  onDragModeSelect: vi.fn(),
  onDuplicateSelectedWorldObject: vi.fn(),
  onObjectEditModeSelect: vi.fn(),
  onObjectToolsToggle: vi.fn(),
  onResetPose: vi.fn(),
  onStopOrbitFollow: vi.fn(),
  onToggleDragModeMenu: vi.fn(),
  onToggleWheelDriveMode: vi.fn(),
  onToggleWheelRoles: vi.fn(),
  onWheelDriveJointToggle: vi.fn(),
  ...overrides,
});

const renderViewerTopTools = async (props: ViewerTopToolsProps) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(ViewerTopTools, props));
  });
  return { container, root };
};

describe("ViewerTopTools", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("shows both drag modes without clipping the dropdown", async () => {
    const props = createProps();
    const { container, root } = await renderViewerTopTools(props);

    const toolbar = container.firstElementChild;
    expect(toolbar?.className).toContain("overflow-visible");
    expect(toolbar?.className).not.toContain("overflow-y-hidden");
    expect(container.textContent).toContain("Drag:");
    expect(container.textContent).toContain("Move Joints");
    expect(container.textContent).toContain("Drag Handle");

    const moveJointsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Move Joints"
    );
    expect(moveJointsButton).toBeTruthy();

    await act(async () => {
      moveJointsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(props.onDragModeSelect).toHaveBeenCalledWith("move-joints");

    await act(async () => {
      root.unmount();
    });
  });
});
