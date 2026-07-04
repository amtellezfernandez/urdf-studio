/** @vitest-environment jsdom */
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JointHierarchyNode, JointLimits } from "@/shared/lib/urdfBrowser";
import * as THREE from "three";

vi.mock("@/features/layout/JointListItem", async () => {
  const React = await import("react");
  return {
    JointListItem: ({
      jointName,
      onClick,
    }: {
      jointName: string;
      onClick?: () => void;
    }) => React.createElement("button", { "data-joint-row": jointName, onClick }, jointName),
  };
});

import { HierarchyTreeView } from "@/features/layout/HierarchyTreeView";

type HierarchyTreeViewProps = ComponentProps<typeof HierarchyTreeView>;

const jointNode: JointHierarchyNode = {
  childLink: "tool_link",
  children: [],
  depth: 0,
  jointName: "joint_a",
  order: 0,
  parentLink: "base_link",
  type: "revolute",
};

const jointLimits = {
  joint_a: { type: "revolute", lower: -1, upper: 1 },
} as unknown as JointLimits;

const createProps = (
  overrides: Partial<HierarchyTreeViewProps> = {}
): HierarchyTreeViewProps => ({
  angleUnit: "rad",
  availableJoints: ["joint_a"],
  colorJointNames: ["joint_a"],
  deletedJoints: new Set(),
  hierarchyTree: {
    filteredJoints: [jointNode],
    linkToJoints: new Map([["base_link", [jointNode]]]),
    rootLinks: ["base_link"],
  },
  jointEffortLimits: {},
  jointLimits,
  onJointSelect: vi.fn(),
  onLinkSelect: vi.fn(),
  onVisibilityToggle: vi.fn(),
  selectedJoint: null,
  selectedLink: null,
  structureLabels: {
    jointByName: {},
    linkByName: {},
  },
  visibleJoints: new Set(["joint_a"]),
  ...overrides,
});

const renderHierarchyTree = async (props: HierarchyTreeViewProps) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(HierarchyTreeView, props));
  });
  return { container, root };
};

describe("HierarchyTreeView", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("clears the selected link before selecting a hierarchy joint", async () => {
    const events: string[] = [];
    const props = createProps({
      onJointSelect: (jointName) => {
        events.push(`joint:${jointName ?? "null"}`);
      },
      onLinkSelect: (linkName) => {
        events.push(`link:${linkName ?? "null"}`);
      },
    });
    const { container, root } = await renderHierarchyTree(props);

    await act(async () => {
      Array.from(container.querySelectorAll('[data-joint-row="joint_a"]'))
        .find((button) => button.textContent === "joint_a")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(events).toEqual(["link:null", "joint:joint_a"]);

    await act(async () => {
      root.unmount();
    });
  });

  it("clears the selected joint before selecting a hierarchy link", async () => {
    const events: string[] = [];
    const props = createProps({
      onJointSelect: (jointName) => {
        events.push(`joint:${jointName ?? "null"}`);
      },
      onLinkSelect: (linkName) => {
        events.push(`link:${linkName ?? "null"}`);
      },
      selectedJoint: "joint_a",
    });
    const { container, root } = await renderHierarchyTree(props);

    await act(async () => {
      container
        .querySelector('[data-hierarchy-link-row="base_link"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(events).toEqual(["link:base_link", "joint:null"]);

    await act(async () => {
      root.unmount();
    });
  });

  it("renders the empty state when the hierarchy has no roots", async () => {
    const { container, root } = await renderHierarchyTree(
      createProps({
        hierarchyTree: {
          filteredJoints: [],
          linkToJoints: new Map(),
          rootLinks: [],
        },
      })
    );

    expect(container.textContent).toContain("No joints found");

    await act(async () => {
      root.unmount();
    });
  });

  it("toggles the end effector for a leaf link and shows its coordinates", async () => {
    const onMarkAsEndEffector = vi.fn();
    const leafLink = new THREE.Object3D();
    leafLink.name = "tool_link";
    leafLink.position.set(1, 2, 3);
    leafLink.updateMatrixWorld(true);
    const robot = {
      links: { tool_link: leafLink },
      getObjectByName: (name: string) => (name === "tool_link" ? leafLink : null),
    } as unknown as import("urdf-loader").URDFRobot;

    const { container, root } = await renderHierarchyTree(
      createProps({
        endEffectorLink: "tool_link",
        onMarkAsEndEffector,
        robot,
      })
    );

    expect(container.textContent).toContain("1.0000");
    expect(container.textContent).toContain("2.0000");
    expect(container.textContent).toContain("3.0000");

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "EE")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onMarkAsEndEffector).toHaveBeenCalledWith(null);

    await act(async () => {
      root.unmount();
    });
  });
});
