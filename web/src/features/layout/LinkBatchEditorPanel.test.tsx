/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinkBatchEditorPanel } from "@/features/layout/LinkBatchEditorPanel";

const createProps = () => ({
  canClearMergedCollision: true,
  canMergeCollisions: true,
  canSimplifyCollisions: true,
  hasMixedBatchMergeState: false,
  hasMixedBatchSimplifyState: true,
  hasSelectedCollisionBatchLinks: true,
  mergedLinkSet: new Set(["link_b"]),
  onApplyCollisionMerge: vi.fn(),
  onClearCollisionMerge: vi.fn(),
  onClearSelection: vi.fn(),
  onRestoreCollisionMeshes: vi.fn(),
  onSimplifyCollisions: vi.fn(),
  selectedBatchCollisionCount: 2,
  selectedBatchLinkNames: ["link_a", "link_b"],
  selectedBatchMergedCount: 2,
  selectedBatchSimplifiedCount: 1,
  simplifiedLinkSet: new Set(["link_a"]),
});

describe("LinkBatchEditorPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("summarizes selected links and wires collision actions", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = createProps();

    await act(async () => {
      root.render(createElement(LinkBatchEditorPanel, props));
    });

    expect(container.textContent).toContain("2 links selected");
    expect(container.textContent).toContain("Simplification state: mixed");
    expect(container.textContent).toContain("Merged collision state: active");
    expect(container.textContent).toContain("link_a");
    expect(container.textContent).toContain("link_b");

    const simplifyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Simplify Collisions"
    );
    const mergeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Merge As One Collision"
    );
    const clearSelectionButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Clear Selection"
    );

    await act(async () => {
      simplifyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      mergeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      clearSelectionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onSimplifyCollisions).toHaveBeenCalledOnce();
    expect(props.onApplyCollisionMerge).toHaveBeenCalledOnce();
    expect(props.onClearSelection).toHaveBeenCalledOnce();

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps collision actions disabled when selected links do not have collisions", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = {
      ...createProps(),
      canClearMergedCollision: false,
      canMergeCollisions: false,
      canSimplifyCollisions: false,
      hasSelectedCollisionBatchLinks: false,
      selectedBatchCollisionCount: 0,
      selectedBatchMergedCount: 0,
      selectedBatchSimplifiedCount: 0,
    };

    await act(async () => {
      root.render(createElement(LinkBatchEditorPanel, props));
    });

    expect(container.textContent).toContain(
      "Simplification state: no URDF collisions in selection"
    );
    expect(container.textContent).toContain(
      "Merged collision state: no URDF collisions in selection"
    );

    const actionButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent !== "Clear Selection"
    );
    expect(actionButtons.every((button) => button.disabled)).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });
});
