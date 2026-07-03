/** @vitest-environment jsdom */
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkData } from "@/shared/lib/urdfBrowser";
import { LinkBrowserView } from "@/features/layout/LinkBrowserView";

type LinkBrowserViewProps = ComponentProps<typeof LinkBrowserView>;

const createMeshLinkData = (filename: string): LinkData =>
  ({
    name: "mesh_link",
    visuals: [
      {
        geometry: {
          type: "mesh",
          params: { filename },
        },
      },
    ],
    collisions: [],
  }) as unknown as LinkData;

const createProps = (overrides: Partial<LinkBrowserViewProps> = {}): LinkBrowserViewProps => ({
  activeStructureDropGroup: null,
  areAllFilteredLinksSelected: false,
  canReassignDisplayedLinkGroups: false,
  collapsedLinkSectionIds: new Set(),
  displayedLinkSections: [
    {
      id: "group:arm",
      label: "arm",
      items: ["link_a", "link_b", "link_c"],
    },
  ],
  effectiveEndEffectorLink: "link_b",
  endEffectorLink: "link_b",
  formatSectionLabel: (label) => label.toUpperCase(),
  highlightedLinkName: "link_c",
  isStructureDragActive: false,
  linkDataByName: {
    link_c: createMeshLinkData("meshes/link_c.stl"),
  },
  linksWithCollisionSet: new Set(["link_a", "link_b"]),
  mergedLinkSet: new Set(["link_b"]),
  onAddMeshCollisionForLink: vi.fn(),
  onBatchLinkToggle: vi.fn(),
  onLinkSelect: vi.fn(),
  onMarkAsEndEffector: vi.fn(),
  onStructureDragEnd: vi.fn(),
  onStructureDragStart: vi.fn(),
  onStructureGroupDragLeave: vi.fn(),
  onStructureGroupDragOver: vi.fn(),
  onStructureGroupDrop: vi.fn(),
  onToggleBatchLinkGroup: vi.fn(),
  onToggleLinkSectionCollapse: vi.fn(),
  onToggleSelectAllFilteredLinks: vi.fn(),
  searchQuery: "",
  selectedBatchLinkNames: ["link_a"],
  selectedBatchLinks: new Set(["link_a"]),
  selectedLink: "link_b",
  simplifiedLinkSet: new Set(["link_a"]),
  voxelDerivedInertialLinkSet: new Set(["link_c"]),
  ...overrides,
});

const renderLinkBrowser = async (props: LinkBrowserViewProps) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(LinkBrowserView, props));
  });
  return { container, root };
};

describe("LinkBrowserView", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("renders an empty search state", async () => {
    const props = createProps({
      displayedLinkSections: [],
      searchQuery: "wrist",
    });
    const { container, root } = await renderLinkBrowser(props);

    expect(container.textContent).toContain("No links match the search");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders link status chips and wires link actions", async () => {
    const props = createProps();
    const { container, root } = await renderLinkBrowser(props);

    expect(container.textContent).toContain("Select all");
    expect(container.textContent).toContain("1 selected");
    expect(container.textContent).toContain("ARM");
    expect(container.textContent).toContain("Simp");
    expect(container.textContent).toContain("Mrg+EE");
    expect(container.textContent).toContain("Vox");
    expect(container.textContent).toContain("Add Col");

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Select all")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "ARM")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      Array.from(container.querySelectorAll("span"))
        .find((span) => span.textContent === "link_b")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Add Col")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Clear EE")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onToggleSelectAllFilteredLinks).toHaveBeenCalledOnce();
    expect(props.onToggleBatchLinkGroup).toHaveBeenCalledWith(["link_a", "link_b", "link_c"]);
    expect(props.onLinkSelect).toHaveBeenCalledWith("link_b");
    expect(props.onAddMeshCollisionForLink).toHaveBeenCalledWith("link_c");
    expect(props.onMarkAsEndEffector).toHaveBeenCalledWith(null);

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the end-effector link visible inside a collapsed section", async () => {
    const props = createProps({
      collapsedLinkSectionIds: new Set(["group:arm"]),
      effectiveEndEffectorLink: "link_b",
      selectedBatchLinkNames: [],
      selectedBatchLinks: new Set(),
    });
    const { container, root } = await renderLinkBrowser(props);

    expect(container.textContent).not.toContain("link_a");
    expect(container.textContent).toContain("link_b");
    expect(container.textContent).not.toContain("link_c");

    await act(async () => {
      root.unmount();
    });
  });
});
