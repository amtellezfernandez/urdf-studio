/** @vitest-environment jsdom */
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/layout/HierarchyTreeView", async () => {
  const React = await import("react");
  return {
    HierarchyTreeView: ({
      hierarchyTree,
    }: {
      hierarchyTree: { filteredJoints: unknown[] };
    }) =>
      React.createElement(
        "div",
        { "data-hierarchy-tree": "true" },
        `tree ${hierarchyTree.filteredJoints.length}`
      ),
  };
});

import { HierarchyJointBrowserView } from "@/features/layout/HierarchyJointBrowserView";

type HierarchyJointBrowserViewProps = ComponentProps<typeof HierarchyJointBrowserView>;

const createProps = (
  overrides: Partial<HierarchyJointBrowserViewProps> = {}
): HierarchyJointBrowserViewProps => ({
  angleUnit: "rad",
  availableJoints: ["joint_a"],
  colorJointNames: ["joint_a"],
  deletedJoints: new Set(),
  endEffectorLink: null,
  hierarchyTree: {
    filteredJoints: [
      {
        childLink: "tool",
        children: [],
        depth: 0,
        jointName: "joint_a",
        order: 0,
        parentLink: "base",
        type: "revolute",
      },
    ],
    linkToJoints: new Map(),
    rootLinks: ["base"],
  },
  jointEffortLimits: {},
  jointLimits: {},
  onJointSelect: vi.fn(),
  onLinkSelect: vi.fn(),
  onVisibilityToggle: vi.fn(),
  searchQuery: "",
  selectedJoint: null,
  selectedLink: null,
  structureLabels: {
    jointByName: {},
    linkByName: {},
  },
  typeFilter: "all",
  visibleJoints: new Set(["joint_a"]),
  ...overrides,
});

const renderHierarchyJointBrowser = async (props: HierarchyJointBrowserViewProps) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(HierarchyJointBrowserView, props));
  });
  return { container, root };
};

describe("HierarchyJointBrowserView", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("renders the loading state without a hierarchy tree", async () => {
    const props = createProps({ hierarchyTree: null });
    const { container, root } = await renderHierarchyJointBrowser(props);

    expect(container.textContent).toContain("Loading hierarchy");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders the filtered empty state from the tree filter result", async () => {
    const props = createProps({
      hierarchyTree: {
        filteredJoints: [],
        linkToJoints: new Map(),
        rootLinks: [],
      },
      searchQuery: "wrist",
    });
    const { container, root } = await renderHierarchyJointBrowser(props);

    expect(container.textContent).toContain("No joints match the filters");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders the hierarchy tree when filtered joints are available", async () => {
    const props = createProps();
    const { container, root } = await renderHierarchyJointBrowser(props);

    expect(container.querySelector("[data-hierarchy-tree]")?.textContent).toBe("tree 1");

    await act(async () => {
      root.unmount();
    });
  });
});
