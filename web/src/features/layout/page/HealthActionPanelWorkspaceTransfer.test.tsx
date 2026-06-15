/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { HealthActionPanelWorkspaceTransfer } from "./HealthActionPanelWorkspaceTransfer";

const textContent = (node: ParentNode) => node.textContent ?? "";

describe("HealthActionPanelWorkspaceTransfer", () => {
  it("renders compact workspace transfer targets and disabled future adapters", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const prepareGenesis = vi.fn();
    const prepareMjlab = vi.fn();
    const prepareSapien = vi.fn();

    await act(async () => {
      root.render(
        createElement(HealthActionPanelWorkspaceTransfer, {
          className: "",
          sceneSummary: "3 obj · 2 cam",
          targets: [
            {
              id: "genesis",
              label: "Genesis",
              detail: "URDF open",
              openLabel: "Open Genesis",
              openingLabel: "Opening Genesis",
              isBusy: false,
              canOpen: true,
              disabledLabel: "Genesis soon",
              onAction: prepareGenesis,
            },
            {
              id: "mjlab",
              label: "MJLab",
              detail: "MJCF open and validation",
              openLabel: "Open MJLab",
              openingLabel: "Opening MJLab",
              isBusy: false,
              isActive: true,
              canOpen: true,
              disabledLabel: "MJLab soon",
              onAction: prepareMjlab,
            },
            {
              id: "sapien2",
              label: "SAPIEN 2",
              detail: "URDF soon",
              openLabel: "Open SAPIEN 2",
              openingLabel: "Opening SAPIEN 2",
              isBusy: false,
              canOpen: false,
              disabledLabel: "SAPIEN 2 soon",
              onAction: prepareSapien,
            },
          ],
        })
      );
    });

    expect(textContent(container)).toContain("Open");
    expect(textContent(container)).toContain("3 obj · 2 cam");
    expect(textContent(container)).not.toContain("ready");
    expect(textContent(container)).not.toContain("Adapt");
    expect(textContent(container)).not.toContain("Simulation Prep");
    expect(textContent(container)).toContain("Genesis");
    expect(textContent(container)).toContain("MJLab");
    expect(textContent(container)).toContain("SAPIEN 2");

    await act(async () => {
      container
        .querySelector('button[aria-label="Open Genesis"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container
        .querySelector('button[aria-label="Open MJLab"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const disabledButton = container.querySelector(
      'button[aria-label="SAPIEN 2 soon"]'
    );
    expect(disabledButton?.hasAttribute("disabled")).toBe(true);
    expect(disabledButton?.getAttribute("class")).toContain("bg-neutral-950");
    expect(disabledButton?.getAttribute("class")).toContain("text-neutral-500");
    expect(prepareGenesis).toHaveBeenCalledTimes(1);
    expect(prepareMjlab).toHaveBeenCalledTimes(1);
    expect(prepareSapien).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
