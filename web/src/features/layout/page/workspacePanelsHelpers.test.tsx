/** @vitest-environment jsdom */
import { act, createElement, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { lazyNamedComponent } from "@/features/layout/page/workspacePanelsHelpers";

describe("workspacePanelsHelpers", () => {
  it("creates a lazy component from a named export", async () => {
    const LazyExample = lazyNamedComponent(
      async () => ({
        Example: () => createElement("div", { "data-example": "true" }, "Example"),
      }),
      "Example"
    );

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "loading") },
          createElement(LazyExample)
        )
      );
    });

    expect(container.querySelector('[data-example="true"]')?.textContent).toBe("Example");

    await act(async () => {
      root.unmount();
    });
  });
});
