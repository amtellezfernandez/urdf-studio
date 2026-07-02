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
              targetKind: "physics_simulator",
              detail: "URDF open",
              robotAssetFormat: "urdf",
              sceneAssetFormat: "urdf",
              transferStrategy: "direct",
              transferLabel: "Direct URDF",
              transferDescription: "Uses the loaded URDF directly.",
              createsTransferAsset: false,
              statusLabel: "ready",
              openLabel: "Open in Genesis",
              openingLabel: "Opening Genesis",
              isBusy: false,
              canOpen: true,
              disabledLabel: "Genesis soon",
              onAction: prepareGenesis,
            },
            {
              id: "mjlab",
              label: "MJLab",
              targetKind: "physics_simulator",
              detail: "MJCF open and validation",
              robotAssetFormat: "mjcf",
              sceneAssetFormat: "mjcf",
              transferStrategy: "convert",
              transferLabel: "Converts to MJCF",
              transferDescription: "URDF Studio writes a new MJCF simulator asset.",
              createsTransferAsset: true,
              statusLabel: "ready",
              openLabel: "Open in MJLab",
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
              targetKind: "physics_simulator",
              detail: "URDF soon",
              robotAssetFormat: "urdf",
              sceneAssetFormat: "urdf",
              transferStrategy: "planned",
              transferLabel: "Planned URDF",
              transferDescription: "Opening is not enabled yet.",
              createsTransferAsset: true,
              statusLabel: "planned",
              openLabel: "Open in SAPIEN 2",
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

    expect(textContent(container)).toContain("Targets");
    expect(textContent(container)).toContain("Simulators + tools");
    expect(textContent(container)).toContain("3 obj · 2 cam");
    expect(textContent(container)).toContain("3 targets");
    expect(textContent(container)).toContain("ready");
    expect(textContent(container)).not.toContain("Adapt");
    expect(textContent(container)).not.toContain("Open In");
    expect(textContent(container)).not.toContain("Simulation Prep");
    expect(textContent(container)).toContain("Genesis");
    expect(textContent(container)).toContain("MJLab");
    expect(textContent(container)).toContain("SAPIEN 2");
    expect(textContent(container)).toContain("URDF");
    expect(textContent(container)).toContain("MJCF");
    expect(textContent(container)).not.toContain("Direct URDF");
    expect(textContent(container)).not.toContain("Writes MJCF");
    expect(textContent(container)).not.toContain("Planned URDF");

    await act(async () => {
      container
        .querySelector('button[aria-label="Open in Genesis"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container
        .querySelector('button[aria-label="Open in MJLab"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const disabledButton = container.querySelector(
      'button[aria-label="SAPIEN 2 soon"]'
    );
    expect(disabledButton?.hasAttribute("disabled")).toBe(true);
    expect(disabledButton?.getAttribute("class")).toContain("bg-background/20");
    expect(disabledButton?.getAttribute("class")).toContain("text-muted-foreground/70");
    expect(prepareGenesis).toHaveBeenCalledTimes(1);
    expect(prepareMjlab).toHaveBeenCalledTimes(1);
    expect(prepareSapien).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
