/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HealthActionPanel } from "./HealthActionPanel";

describe("HealthActionPanel frame actions", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("honors the repair orientation disabled prop", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          statusLabel: "Frame Warning",
          onRepairOrientation: vi.fn(),
          repairOrientationLabel: "Export Cleanup",
          repairOrientationDisabled: true,
        })
      );
    });

    const repairOrientationButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Export Cleanup")
    );
    expect(repairOrientationButton).toBeTruthy();
    expect((repairOrientationButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });
});
