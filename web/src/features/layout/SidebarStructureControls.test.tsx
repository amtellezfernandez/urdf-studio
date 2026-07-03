/** @vitest-environment jsdom */
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarStructureControls } from "@/features/layout/SidebarStructureControls";

type SidebarStructureControlsProps = ComponentProps<typeof SidebarStructureControls>;

const createProps = (
  overrides: Partial<SidebarStructureControlsProps> = {}
): SidebarStructureControlsProps => ({
  canReassignStructureGroups: true,
  effectiveStructureViewMode: "links",
  headerClassName: "structure-header",
  isSubgroupCreatorOpen: false,
  jointTypes: ["revolute", "fixed"],
  linkGroupingMode: "body",
  onCloseSubgroupCreator: vi.fn(),
  onCreateCustomSubgroup: vi.fn(),
  onLinkGroupingModeChange: vi.fn(),
  onOpenSubgroupCreator: vi.fn(),
  onSearchQueryChange: vi.fn(),
  onStructureViewModeChange: vi.fn(),
  onSubgroupDraftLabelChange: vi.fn(),
  onTypeFilterChange: vi.fn(),
  searchQuery: "arm",
  structureModeOptions: [
    { value: "flat", label: "Joints (4)" },
    { value: "links", label: "Links (3)", requiresUrdf: true },
    { value: "hierarchy", label: "Hierarchy", requiresUrdf: true },
  ],
  subgroupActionButtonClassName: "subgroup-action",
  subgroupDraftLabel: "",
  typeFilter: "all",
  urdfContentAvailable: true,
  ...overrides,
});

const renderControls = async (props: SidebarStructureControlsProps) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SidebarStructureControls, props));
  });
  return { container, root };
};

describe("SidebarStructureControls", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("wires mode, search, grouping, and subgroup actions", async () => {
    const props = createProps();
    const { container, root } = await renderControls(props);

    expect((container.querySelector("input") as HTMLInputElement | null)?.placeholder).toBe(
      "Search links..."
    );

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Joints (4)")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container
        .querySelector('button[aria-label="Clear structure search"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Mesh")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Subgroup")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onStructureViewModeChange).toHaveBeenCalledWith("flat");
    expect(props.onSearchQueryChange).toHaveBeenCalledWith("");
    expect(props.onLinkGroupingModeChange).toHaveBeenCalledWith("mesh");
    expect(props.onOpenSubgroupCreator).toHaveBeenCalledOnce();

    await act(async () => {
      root.unmount();
    });
  });

  it("disables URDF-required modes when no URDF is loaded", async () => {
    const props = createProps({
      effectiveStructureViewMode: "flat",
      urdfContentAvailable: false,
    });
    const { container, root } = await renderControls(props);

    const linksButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Links (3)"
    );
    const hierarchyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Hierarchy"
    );

    expect(linksButton?.disabled).toBe(true);
    expect(hierarchyButton?.disabled).toBe(true);

    await act(async () => {
      linksButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      hierarchyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onStructureViewModeChange).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("renders subgroup draft controls and keyboard shortcuts", async () => {
    const props = createProps({
      effectiveStructureViewMode: "flat",
      isSubgroupCreatorOpen: true,
      searchQuery: "",
      subgroupDraftLabel: "arm1_gripper",
    });
    const { container, root } = await renderControls(props);

    const subgroupInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.placeholder === "New subgroup (e.g. arm1_gripper)"
    );
    expect(subgroupInput?.value).toBe("arm1_gripper");

    await act(async () => {
      subgroupInput?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      subgroupInput?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Add")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Cancel")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onCreateCustomSubgroup).toHaveBeenCalledTimes(2);
    expect(props.onCloseSubgroupCreator).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.unmount();
    });
  });
});
