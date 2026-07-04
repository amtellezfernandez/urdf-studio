/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/layout/panels/DisplaysPanel", async () => {
  const React = await import("react");
  return {
    DisplaysPanel: () => React.createElement("div", { "data-displays-panel": "true" }, "Displays"),
  };
});

vi.mock("@/features/layout/panels/RuntimeHealthPanel", async () => {
  const React = await import("react");
  return {
    RuntimeHealthPanel: () =>
      React.createElement("div", { "data-runtime-health-panel": "true" }, "Runtime"),
  };
});
import { WorkspacePanels } from "@/features/layout/page/WorkspacePanels";

describe("WorkspacePanels", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("renders the lazy displays and runtime health panels", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(WorkspacePanels));
    });

    expect(container.querySelector('[data-displays-panel="true"]')?.textContent).toBe("Displays");
    expect(container.querySelector('[data-runtime-health-panel="true"]')?.textContent).toBe(
      "Runtime"
    );

    await act(async () => {
      root.unmount();
    });
  });
});
