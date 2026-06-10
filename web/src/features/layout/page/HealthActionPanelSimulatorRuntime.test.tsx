/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { HealthActionPanelSimulatorRuntime } from "./HealthActionPanelSimulatorRuntime";

const textContent = (node: ParentNode) => node.textContent ?? "";

describe("HealthActionPanelSimulatorRuntime", () => {
  it("renders compact open targets and disabled future adapters", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const openGenesis = vi.fn();
    const openMjlab = vi.fn();
    const openSapien = vi.fn();

    await act(async () => {
      root.render(
        createElement(HealthActionPanelSimulatorRuntime, {
          className: "",
          statusLabel: "Ready",
          targets: [
            {
              id: "genesis",
              label: "Genesis",
              detail: "Interactive world viewer",
              actionLabel: "Open in Genesis",
              busyLabel: "Opening Genesis",
              isBusy: false,
              isAvailable: true,
              isReady: null,
              unavailableLabel: "Genesis is not available yet",
              onAction: openGenesis,
            },
            {
              id: "mjlab",
              label: "MJLab",
              detail: "World viewer and motion validation",
              actionLabel: "Open in MJLab",
              busyLabel: "Opening MJLab",
              isBusy: false,
              isAvailable: true,
              isReady: true,
              unavailableLabel: "MJLab is not available yet",
              onAction: openMjlab,
            },
            {
              id: "sapien2",
              label: "SAPIEN 2",
              detail: "Not available yet",
              actionLabel: "Open in SAPIEN 2",
              busyLabel: "Opening SAPIEN 2",
              isBusy: false,
              isAvailable: false,
              isReady: null,
              unavailableLabel: "SAPIEN 2 is not available yet",
              onAction: openSapien,
            },
          ],
        })
      );
    });

    expect(textContent(container)).toContain("Open in");
    expect(textContent(container)).not.toContain("ready");
    expect(textContent(container)).toContain("Soon available");
    expect(textContent(container)).not.toContain("Simulation Prep");
    expect(textContent(container)).toContain("Genesis");
    expect(textContent(container)).toContain("MJLab");
    expect(textContent(container)).toContain("SAPIEN 2");

    await act(async () => {
      container
        .querySelector('button[aria-label="Open in Genesis"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container
        .querySelector('button[aria-label="Open in MJLab"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const unavailableButton = container.querySelector(
      'button[aria-label="SAPIEN 2 is not available yet"]'
    );
    expect(unavailableButton?.hasAttribute("disabled")).toBe(true);
    expect(unavailableButton?.getAttribute("class")).toContain("bg-neutral-900");
    expect(openGenesis).toHaveBeenCalledTimes(1);
    expect(openMjlab).toHaveBeenCalledTimes(1);
    expect(openSapien).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
