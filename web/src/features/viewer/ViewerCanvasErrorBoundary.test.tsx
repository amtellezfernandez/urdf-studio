// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ViewerCanvasErrorBoundary } from "@/features/viewer/ViewerCanvasErrorBoundary";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const CANVAS_ERROR_BOUNDARY_TEST_FIXTURE = {
  renderErrorMessage: "webgl context failed",
};

const preventExpectedRenderError = (event: ErrorEvent) => {
  if (event.message.includes(CANVAS_ERROR_BOUNDARY_TEST_FIXTURE.renderErrorMessage)) {
    event.preventDefault();
  }
};

describe("ViewerCanvasErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.addEventListener("error", preventExpectedRenderError);
  });

  afterEach(() => {
    window.removeEventListener("error", preventExpectedRenderError);
    vi.restoreAllMocks();
  });

  it("renders a canvas fallback and retries without reloading the app", async () => {
    let shouldThrow = true;
    const ThrowingCanvasChild = () => {
      if (shouldThrow) {
        throw new Error(CANVAS_ERROR_BOUNDARY_TEST_FIXTURE.renderErrorMessage);
      }
      return createElement("div", null, "canvas restored");
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(
          ViewerCanvasErrorBoundary,
          null,
          createElement(ThrowingCanvasChild),
        ),
      );
    });

    expect(container.textContent).toContain("3D viewer failed to render");
    expect(container.textContent).toContain(
      CANVAS_ERROR_BOUNDARY_TEST_FIXTURE.renderErrorMessage,
    );

    shouldThrow = false;
    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry Viewer",
    );
    expect(retryButton).toBeDefined();

    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("canvas restored");

    await act(async () => {
      root.unmount();
    });
  });
});
