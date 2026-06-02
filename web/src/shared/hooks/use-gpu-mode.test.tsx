// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { GPUModeProvider, useGPUMode } from "@/shared/hooks/use-gpu-mode";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_BLOCKED_ERROR_NAME = "SecurityError";

const withBlockedLocalStorage = async (callback: () => Promise<void>) => {
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("localStorage blocked", STORAGE_BLOCKED_ERROR_NAME);
    },
  });
  try {
    await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(window, "localStorage", descriptor);
    }
  }
};

const GpuModeProbe = () => {
  const { gpuMode } = useGPUMode();
  return createElement("span", null, gpuMode);
};

describe("GPUModeProvider", () => {
  it("renders with defaults when localStorage is blocked", async () => {
    await withBlockedLocalStorage(async () => {
      const container = document.createElement("div");
      const root = createRoot(container);

      await act(async () => {
        root.render(
          createElement(
            GPUModeProvider,
            null,
            createElement(GpuModeProbe),
          ),
        );
      });

      expect(container.textContent).toBe("low");

      await act(async () => {
        root.unmount();
      });
    });
  });
});
