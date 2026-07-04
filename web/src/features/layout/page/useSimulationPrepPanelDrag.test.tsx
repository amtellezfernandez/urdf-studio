/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  SIMULATION_PREP_PANEL_DEFAULT_TOP_PX,
  SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX,
  getSimulationPrepPanelInitialPosition,
} from "@/features/layout/page/simulationPrepPanelParams";
import {
  useSimulationPrepPanelDrag,
  type UseSimulationPrepPanelDragResult,
} from "@/features/layout/page/useSimulationPrepPanelDrag";

type RenderedHarness = {
  container: HTMLDivElement;
  getHook: () => UseSimulationPrepPanelDragResult;
  unmount: () => Promise<void>;
};

const PANEL_DRAG_TEST_FIXTURES = {
  dragStartX: 240,
  dragStartY: 80,
  dragTargetX: 120,
  dragTargetY: 120,
  viewportHeight: 900,
  viewportWidth: 1200,
} as const;

const flushAsyncWork = async () => {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
};

const setViewportSize = ({ width, height }: { width: number; height: number }) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
};

const renderPanelDragHook = async (open = true): Promise<RenderedHarness> => {
  let hookValue: UseSimulationPrepPanelDragResult | null = null;
  const container = document.createElement("div");
  const root: Root = createRoot(container);

  const Harness = () => {
    const hook = useSimulationPrepPanelDrag(open);
    hookValue = hook;
    return createElement(
      "div",
      {
        "data-panel": "simulation-prep-test",
        onMouseDown: hook.handlePanelDragStart,
        ref: hook.panelRef,
      },
      createElement("button", { type: "button" }, "nested action")
    );
  };

  await act(async () => {
    root.render(createElement(Harness));
    await flushAsyncWork();
  });

  return {
    container,
    getHook: () => {
      if (!hookValue) {
        throw new Error("Hook did not render.");
      }
      return hookValue;
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
};

describe("useSimulationPrepPanelDrag", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setViewportSize({
      width: PANEL_DRAG_TEST_FIXTURES.viewportWidth,
      height: PANEL_DRAG_TEST_FIXTURES.viewportHeight,
    });
  });

  it("starts at the panel default position and updates during drag", async () => {
    const harness = await renderPanelDragHook();
    const panel = harness.container.querySelector(
      '[data-panel="simulation-prep-test"]'
    ) as HTMLDivElement | null;
    const initialPosition = getSimulationPrepPanelInitialPosition(
      PANEL_DRAG_TEST_FIXTURES.viewportWidth
    );

    expect(harness.getHook().panelPosition).toEqual(initialPosition);

    await act(async () => {
      panel?.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          clientX: PANEL_DRAG_TEST_FIXTURES.dragStartX,
          clientY: PANEL_DRAG_TEST_FIXTURES.dragStartY,
        })
      );
    });

    expect(harness.getHook().isDragging).toBe(true);
    expect(document.body.style.cursor).toBe("grabbing");

    await act(async () => {
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: PANEL_DRAG_TEST_FIXTURES.dragTargetX,
          clientY: PANEL_DRAG_TEST_FIXTURES.dragTargetY,
        })
      );
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      await flushAsyncWork();
    });

    expect(harness.getHook().panelPosition).toEqual({
      left: Math.max(
        SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX,
        initialPosition.left -
          (PANEL_DRAG_TEST_FIXTURES.dragStartX - PANEL_DRAG_TEST_FIXTURES.dragTargetX)
      ),
      top: SIMULATION_PREP_PANEL_DEFAULT_TOP_PX +
        (PANEL_DRAG_TEST_FIXTURES.dragTargetY - PANEL_DRAG_TEST_FIXTURES.dragStartY),
    });
    expect(harness.getHook().isDragging).toBe(false);
    expect(document.body.style.cursor).toBe("");

    await harness.unmount();
  });

  it("does not start dragging from nested controls", async () => {
    const harness = await renderPanelDragHook();
    const nestedButton = harness.container.querySelector("button");

    await act(async () => {
      nestedButton?.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          clientX: PANEL_DRAG_TEST_FIXTURES.dragStartX,
          clientY: PANEL_DRAG_TEST_FIXTURES.dragStartY,
        })
      );
      await flushAsyncWork();
    });

    expect(harness.getHook().isDragging).toBe(false);
    expect(document.body.style.cursor).toBe("");

    await harness.unmount();
  });
});
