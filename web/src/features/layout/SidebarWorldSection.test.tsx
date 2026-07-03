/** @vitest-environment jsdom */
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/layout/WorldPanel", async () => {
  const React = await import("react");
  return {
    WorldPanel: ({
      onJointSelect,
      setSelectedLink,
    }: {
      onJointSelect?: (jointName: string | null) => void;
      setSelectedLink: (linkName: string | null) => void;
    }) =>
      React.createElement(
        "div",
        { "data-world-panel": "true" },
        React.createElement(
          "button",
          { onClick: () => onJointSelect?.("joint_a") },
          "select joint"
        ),
        React.createElement(
          "button",
          { onClick: () => setSelectedLink("link_a") },
          "select link"
        )
      ),
  };
});

import { SidebarWorldSection } from "@/features/layout/SidebarWorldSection";

type SidebarWorldSectionProps = ComponentProps<typeof SidebarWorldSection>;

const createProps = (
  overrides: Partial<SidebarWorldSectionProps> = {}
): SidebarWorldSectionProps => ({
  cameraCount: 3,
  endEffectorLink: "tool0",
  objectCount: 2,
  onJointSelect: vi.fn(),
  robot: null,
  setSelectedLink: vi.fn(),
  ...overrides,
});

const renderWorldSection = async (props: SidebarWorldSectionProps) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SidebarWorldSection, props));
  });
  return { container, root };
};

describe("SidebarWorldSection", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("renders counts and forwards world panel selections", async () => {
    const props = createProps();
    const { container, root } = await renderWorldSection(props);

    expect(container.textContent).toContain("2 obj · 3 cam");
    expect(container.querySelector("[data-world-panel]")).not.toBeNull();

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "select joint")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "select link")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onJointSelect).toHaveBeenCalledWith("joint_a");
    expect(props.setSelectedLink).toHaveBeenCalledWith("link_a");

    await act(async () => {
      root.unmount();
    });
  });

  it("collapses the world panel and shows the empty state only when no items exist", async () => {
    const props = createProps({ cameraCount: 0, objectCount: 0 });
    const { container, root } = await renderWorldSection(props);

    await act(async () => {
      container
        .querySelector('button[aria-label="Collapse world panel"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector("[data-world-panel]")).toBeNull();
    expect(container.textContent).toContain("No world items.");

    await act(async () => {
      root.unmount();
    });
  });
});
