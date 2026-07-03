/** @vitest-environment jsdom */
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JointLimits } from "@/shared/lib/urdfBrowser";

vi.mock("@/features/layout/JointListItem", async () => {
  const React = await import("react");
  return {
    JointListItem: ({
      groupLabel,
      isHighlighted,
      isSelected,
      isVisible,
      jointName,
      onClick,
      onVisibilityToggle,
    }: {
      groupLabel?: string | null;
      isHighlighted?: boolean;
      isSelected?: boolean;
      isVisible?: boolean;
      jointName: string;
      onClick?: () => void;
      onVisibilityToggle?: (jointName: string) => void;
    }) =>
      React.createElement(
        "div",
        {
          "data-group-label": groupLabel ?? "",
          "data-highlighted": String(Boolean(isHighlighted)),
          "data-joint-row": jointName,
          "data-selected": String(Boolean(isSelected)),
          "data-visible": String(Boolean(isVisible)),
        },
        React.createElement("button", { onClick }, jointName),
        React.createElement(
          "button",
          { onClick: () => onVisibilityToggle?.(jointName) },
          `toggle ${jointName}`
        )
      ),
  };
});

import { FlatJointBrowserView } from "@/features/layout/FlatJointBrowserView";

type FlatJointBrowserViewProps = ComponentProps<typeof FlatJointBrowserView>;

const jointLimits = {
  joint_a: { type: "revolute", lower: -1, upper: 1 },
  joint_b: { type: "fixed" },
  joint_c: { type: "continuous" },
} as unknown as JointLimits;

const createProps = (
  overrides: Partial<FlatJointBrowserViewProps> = {}
): FlatJointBrowserViewProps => ({
  activeMovingJointNames: new Set(),
  activeStructureDropGroup: null,
  angleUnit: "rad",
  availableJoints: ["joint_a", "joint_b", "joint_c"],
  canReassignStructureGroups: false,
  colorJointNames: ["joint_a", "joint_b", "joint_c"],
  collapsedJointSectionIds: new Set(),
  deletedJoints: new Set(),
  groupedJointsWithCustom: [
    {
      id: "group:arm",
      label: "arm",
      items: ["joint_a", "joint_b", "joint_c"],
    },
  ],
  hoveredJoint: "joint_c",
  isStructureDragActive: false,
  jointEffortLimits: {},
  jointLimits,
  onJointHover: vi.fn(),
  onJointSelect: vi.fn(),
  onStructureDragEnd: vi.fn(),
  onStructureDragStart: vi.fn(),
  onStructureGroupDragLeave: vi.fn(),
  onStructureGroupDragOver: vi.fn(),
  onStructureGroupDrop: vi.fn(),
  onToggleJointSectionCollapse: vi.fn(),
  onVisibilityToggle: vi.fn(),
  searchQuery: "",
  selectedJoint: "joint_b",
  structureJointLabels: {
    joint_b: "custom_arm",
  },
  typeFilter: "all",
  visibleJoints: new Set(["joint_a", "joint_c"]),
  ...overrides,
});

const renderFlatJointBrowser = async (props: FlatJointBrowserViewProps) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(FlatJointBrowserView, props));
  });
  return { container, root };
};

describe("FlatJointBrowserView", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("renders an empty filtered state", async () => {
    const props = createProps({
      groupedJointsWithCustom: [],
      searchQuery: "wrist",
    });
    const { container, root } = await renderFlatJointBrowser(props);

    expect(container.textContent).toContain("No joints match the filters");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders joint rows and wires row actions", async () => {
    const props = createProps();
    const { container, root } = await renderFlatJointBrowser(props);

    expect(container.textContent).toContain("Arm");
    expect(container.querySelector('[data-joint-row="joint_b"]')?.getAttribute("data-selected")).toBe(
      "true"
    );
    expect(
      container.querySelector('[data-joint-row="joint_c"]')?.getAttribute("data-highlighted")
    ).toBe("true");
    expect(container.querySelector('[data-joint-row="joint_a"]')?.getAttribute("data-visible")).toBe(
      "true"
    );
    expect(container.querySelector('[data-joint-row="joint_b"]')?.getAttribute("data-visible")).toBe(
      "false"
    );
    expect(
      container.querySelector('[data-joint-row="joint_b"]')?.getAttribute("data-group-label")
    ).toBe("custom_arm");

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "joint_b")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "toggle joint_a")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Arm")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onJointSelect).toHaveBeenCalledWith("joint_b");
    expect(props.onVisibilityToggle).toHaveBeenCalledWith("joint_a");
    expect(props.onToggleJointSectionCollapse).toHaveBeenCalledWith("group:arm");

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps active moving joints visible inside a collapsed section", async () => {
    const props = createProps({
      activeMovingJointNames: new Set(["joint_b"]),
      collapsedJointSectionIds: new Set(["group:arm"]),
    });
    const { container, root } = await renderFlatJointBrowser(props);

    expect(container.querySelector('[data-joint-row="joint_a"]')).toBeNull();
    expect(container.querySelector('[data-joint-row="joint_b"]')).not.toBeNull();
    expect(container.querySelector('[data-joint-row="joint_c"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
