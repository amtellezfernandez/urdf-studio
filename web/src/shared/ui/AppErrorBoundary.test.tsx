// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppErrorBoundary } from "@/shared/ui/AppErrorBoundary";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const APP_ERROR_BOUNDARY_TEST_FIXTURE = {
  bootErrorMessage: "provider boot failed",
};

const ThrowingBootChild = () => {
  throw new Error(APP_ERROR_BOUNDARY_TEST_FIXTURE.bootErrorMessage);
};

describe("AppErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a visible fallback when app boot children throw", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(
          AppErrorBoundary,
          null,
          createElement(ThrowingBootChild),
        ),
      );
    });

    expect(container.textContent).toContain(
      "Something went wrong while rendering the UI",
    );
    expect(container.textContent).toContain(
      APP_ERROR_BOUNDARY_TEST_FIXTURE.bootErrorMessage,
    );

    await act(async () => {
      root.unmount();
    });
  });
});
